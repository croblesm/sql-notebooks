import * as vscode from "vscode";
import type { IExtension, IConnectionInfo } from "vscode-mssql";
import { getMssqlApi } from "./mssqlExtensionApi";

const OUR_EXTENSION_ID = "ms-mssql.sql-notebooks";

/**
 * Manages the active database connection for a notebook.
 * One connection per notebook — matches ADS behavior.
 *
 * NOTE: The MSSQL extension's connectionSharing.getActiveEditorConnectionId()
 * uses vscode.window.activeTextEditor, which is undefined for notebook editors.
 * We cannot auto-sync with the MSSQL UI. Connection changes must be explicit:
 *   - %%connect magic command
 *   - "Create SQL Notebook" from Object Explorer (connectWith)
 *   - First cell execution (prompts the user)
 *
 * NOTE: The MSSQL extension's SqlDocumentService auto-connects any newly opened
 * SQL document to _lastActiveConnectionInfo. This means notebook cells may show
 * a different connection in the MSSQL code lens than what this ConnectionManager
 * actually uses for query execution. Our connection (under an adhoc URI) is the
 * authoritative one for SQL execution.
 */
export class ConnectionManager implements vscode.Disposable {
    private api: IExtension | undefined;
    private connectionUri: string | undefined;
    private connectionInfo: IConnectionInfo | undefined;
    private connectionLabel: string = "";
    private log: vscode.LogOutputChannel;

    constructor(log: vscode.LogOutputChannel) {
        this.log = log;
    }

    private async ensureApi(): Promise<void> {
        if (!this.api) {
            this.api = await getMssqlApi();
        }
        if (!this.api) {
            throw new Error(
                "The MSSQL extension (ms-mssql.mssql) is required but not installed. " +
                    "Please install it from the VS Code marketplace.",
            );
        }
    }

    /**
     * Query the actual database name from the server via SELECT DB_NAME().
     * Used to verify we're connected to the expected database.
     */
    private async queryActualDatabase(uri: string): Promise<string> {
        const result = await this.api!.connectionSharing.executeSimpleQuery(
            uri,
            "SELECT DB_NAME() AS [current_database]",
        );
        return result.rows?.[0]?.[0]?.displayValue ?? "(unknown)";
    }

    /**
     * Ensure we have a live connection. Reuses the existing connection if alive,
     * otherwise prompts the user to pick one.
     */
    async ensureConnection(): Promise<string> {
        await this.ensureApi();

        if (this.connectionUri) {
            if (this.api!.connectionSharing.isConnected(this.connectionUri)) {
                return this.connectionUri;
            }
            // Connection went stale
            this.log.info(
                `[ensureConnection] Connection stale, clearing: ${this.connectionUri}`,
            );
            this.connectionUri = undefined;
            this.connectionLabel = "";
        }

        // No alive connection — prompt the user
        this.log.info("[ensureConnection] No connection, prompting user");
        return this.promptAndConnect();
    }

    /**
     * Prompt the user to pick a connection via the MSSQL extension's connection dialog.
     * Used by %%connect and as fallback when no connection exists.
     */
    async promptAndConnect(): Promise<string> {
        await this.ensureApi();

        const connectionInfo = await this.api!.promptForConnection(true);
        if (!connectionInfo) {
            throw new Error("No connection selected.");
        }

        this.log.info(
            `[promptAndConnect] server=${connectionInfo.server}, database=${connectionInfo.database}`,
        );
        const uri = await this.api!.connect(connectionInfo, false);
        this.log.info(`[promptAndConnect] connect() → URI=${uri}`);

        // Verify the actual database
        try {
            const actualDb = await this.queryActualDatabase(uri);
            this.log.info(`[promptAndConnect] Actual DB: ${actualDb}`);
            this.connectionLabel = formatConnectionLabel(
                connectionInfo.server,
                actualDb,
            );
        } catch {
            this.connectionLabel = formatConnectionLabel(
                connectionInfo.server,
                connectionInfo.database,
            );
        }

        this.connectionUri = uri;
        this.connectionInfo = connectionInfo;
        return uri;
    }

    /**
     * Connect with a specific connection profile (from Object Explorer context menu).
     * After connecting, verifies the database via SELECT DB_NAME() and switches
     * with USE [database] if needed.
     */
    async connectWith(connectionInfo: IConnectionInfo): Promise<string> {
        await this.ensureApi();

        const server = connectionInfo.server;
        const database = connectionInfo.database;
        this.log.info(
            `[connectWith] server=${server}, database=${database}`,
        );

        // IExtension.connect() always creates a fresh connection URI.
        const uri = await this.api!.connect(connectionInfo, false);
        this.log.info(`[connectWith] connect() → URI=${uri}`);

        // Verify we're on the correct database.
        let actualDb = "(unknown)";
        if (database) {
            try {
                actualDb = await this.queryActualDatabase(uri);
                this.log.info(
                    `[connectWith] Actual DB: ${actualDb}, Expected: ${database}`,
                );

                if (
                    actualDb.toLowerCase() !== database.toLowerCase() &&
                    actualDb !== "(unknown)"
                ) {
                    // Wrong database — disconnect and reconnect with correct DB
                    this.log.info(
                        `[connectWith] Database mismatch! Reconnecting with [${database}]`,
                    );
                    this.api!.connectionSharing.disconnect(uri);
                    const fixedInfo = { ...connectionInfo, database };
                    const newUri = await this.api!.connect(fixedInfo, false);
                    actualDb = await this.queryActualDatabase(newUri);
                    this.log.info(
                        `[connectWith] After reconnect: ${actualDb}, URI=${newUri}`,
                    );
                    this.connectionUri = newUri;
                    this.connectionInfo = { ...connectionInfo, database: actualDb };
                    this.connectionLabel = formatConnectionLabel(server, actualDb);
                    return newUri;
                }
            } catch (err: any) {
                this.log.info(
                    `[connectWith] DB verification failed: ${err.message}`,
                );
                actualDb = database;
            }
        }

        this.connectionUri = uri;
        this.connectionInfo = { ...connectionInfo, database: actualDb };
        // Use the VERIFIED database name, not the possibly-stale profile value
        this.connectionLabel = formatConnectionLabel(server, actualDb);
        return uri;
    }

    /**
     * List all databases on the current server.
     */
    async listDatabases(): Promise<string[]> {
        if (!this.connectionUri || !this.api) {
            throw new Error("No active connection.");
        }
        return this.api.connectionSharing.listDatabases(this.connectionUri);
    }

    /**
     * Switch the notebook's database context by disconnecting and reconnecting
     * with the new database. SimpleExecuteRequest doesn't persist USE across
     * calls, so a full reconnect is required (same pattern as MSSQL copilot tools).
     */
    async changeDatabase(database: string): Promise<void> {
        if (!this.connectionInfo || !this.api) {
            throw new Error("No active connection.");
        }
        this.log.info(`[changeDatabase] Switching to [${database}]`);

        // Disconnect current connection
        if (this.connectionUri) {
            this.api.connectionSharing.disconnect(this.connectionUri);
        }

        // Reconnect with the new database
        const newInfo = { ...this.connectionInfo, database };
        const uri = await this.api.connect(newInfo, false);
        this.log.info(`[changeDatabase] Reconnected → URI=${uri}`);

        // Verify
        const actualDb = await this.queryActualDatabase(uri);
        this.log.info(`[changeDatabase] Verified: ${actualDb}`);

        this.connectionUri = uri;
        this.connectionInfo = newInfo;
        this.connectionLabel = formatConnectionLabel(
            newInfo.server,
            actualDb,
        );
    }

    /**
     * Get the current database name from the connection label.
     */
    getCurrentDatabase(): string {
        const parts = this.connectionLabel.split(" / ");
        return parts.length > 1 ? parts[1] : "";
    }

    async executeQuery(
        sql: string,
    ): Promise<import("vscode-mssql").SimpleExecuteResult> {
        if (!this.connectionUri || !this.api) {
            throw new Error("No active connection.");
        }
        return this.api.connectionSharing.executeSimpleQuery(
            this.connectionUri,
            sql,
        );
    }

    isConnected(): boolean {
        if (!this.connectionUri || !this.api) {
            return false;
        }
        return this.api.connectionSharing.isConnected(this.connectionUri);
    }

    disconnect(): void {
        this.log.info(`[disconnect] URI=${this.connectionUri ?? "none"}`);
        if (this.connectionUri && this.api) {
            this.api.connectionSharing.disconnect(this.connectionUri);
        }
        this.connectionUri = undefined;
        this.connectionInfo = undefined;
        this.connectionLabel = "";
    }

    getConnectionLabel(): string {
        return this.connectionLabel || "Not connected";
    }

    dispose(): void {
        this.disconnect();
    }
}

function formatConnectionLabel(server: string, database: string): string {
    return `${server || "unknown"} / ${database || "master"}`;
}
