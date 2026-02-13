import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import { ConnectionManager } from "./connectionManager";
import { NotebookCodeLensProvider } from "./notebookCodeLensProvider";
import { parseBatches } from "./batchParser";
import * as formatter from "./resultFormatter";

/**
 * Config key the MSSQL extension uses to toggle its connection code lens.
 * We disable it while a notebook is the active editor so our code lens
 * (which shows the correct per-notebook connection) is the only one visible.
 */
const MSSQL_CODE_LENS_SETTING =
    "mssql.query.showActiveConnectionAsCodeLensSuggestion";

export class SQLNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    readonly connections = new Map<string, ConnectionManager>();
    private readonly codeLensProvider: NotebookCodeLensProvider;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly log: vscode.LogOutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private executionOrder = 0;

    /** The user's original value for the MSSQL code-lens setting. */
    private mssqlCodeLensSaved: boolean | undefined;

    constructor(log: vscode.LogOutputChannel) {
        this.log = log;

        this.controller = vscode.notebooks.createNotebookController(
            "ms-mssql.sql-notebook-controller",
            "jupyter-notebook",
            "SQL",
        );

        this.controller.supportedLanguages = ["sql"];
        this.controller.supportsExecutionOrder = true;
        this.controller.description =
            "Execute SQL against SQL Server / Azure SQL";
        this.controller.executeHandler = this.executeCells.bind(this);

        // Status bar item shows the SQL Notebooks connection (authoritative source)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99,
        );
        this.statusBarItem.name = "SQL Notebook Connection";
        this.updateStatusBar(undefined);

        // Code lens provider for notebook cells — shows correct connection
        this.codeLensProvider = new NotebookCodeLensProvider(this.connections);
        this.disposables.push(
            vscode.languages.registerCodeLensProvider(
                { language: "sql", notebookType: "jupyter-notebook" },
                this.codeLensProvider,
            ),
        );

        // Disable the MSSQL code lens while a notebook editor is active,
        // re-enable it when the user switches to a regular .sql file.
        this.disposables.push(
            vscode.window.onDidChangeActiveNotebookEditor((editor) => {
                this.toggleMssqlCodeLens(editor);
            }),
        );

        // If a notebook is already active at construction time
        if (vscode.window.activeNotebookEditor) {
            this.toggleMssqlCodeLens(vscode.window.activeNotebookEditor);
        }
    }

    /**
     * Disable the MSSQL extension's code lens when a notebook is active,
     * restore the user's original value when no notebook is active.
     */
    private toggleMssqlCodeLens(
        editor: vscode.NotebookEditor | undefined,
    ): void {
        const config = vscode.workspace.getConfiguration();
        if (editor) {
            // Save the current value (only once)
            if (this.mssqlCodeLensSaved === undefined) {
                this.mssqlCodeLensSaved = config.get<boolean>(
                    MSSQL_CODE_LENS_SETTING,
                    true,
                );
            }
            config.update(
                MSSQL_CODE_LENS_SETTING,
                false,
                vscode.ConfigurationTarget.Global,
            );
        } else {
            // Restore
            const restore = this.mssqlCodeLensSaved ?? true;
            config.update(
                MSSQL_CODE_LENS_SETTING,
                restore,
                vscode.ConfigurationTarget.Global,
            );
            this.mssqlCodeLensSaved = undefined;
        }
    }

    private getConnectionManager(
        notebook: vscode.NotebookDocument,
    ): ConnectionManager {
        const key = notebook.uri.toString();
        let mgr = this.connections.get(key);
        if (!mgr) {
            mgr = new ConnectionManager(this.log);
            this.connections.set(key, mgr);
        }
        return mgr;
    }

    /**
     * Update the status bar to show the connection for the given notebook.
     * If notebook is undefined or not connected, hides the status bar.
     */
    private updateStatusBar(
        notebook: vscode.NotebookDocument | undefined,
    ): void {
        if (!notebook) {
            this.statusBarItem.hide();
            return;
        }
        const mgr = this.connections.get(notebook.uri.toString());
        if (mgr?.isConnected()) {
            this.statusBarItem.text = `$(database) ${mgr.getConnectionLabel()}`;
            this.statusBarItem.tooltip =
                "SQL Notebooks: click to change database";
            this.statusBarItem.command = "sqlNotebooks.changeDatabase";
            this.statusBarItem.show();
        } else {
            this.statusBarItem.text = "$(database) SQL: Not connected";
            this.statusBarItem.tooltip = "SQL Notebooks: click to connect";
            this.statusBarItem.command = "sqlNotebooks.changeConnection";
            this.statusBarItem.show();
        }
    }

    private async executeCells(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController,
    ): Promise<void> {
        for (const cell of cells) {
            await this.executeCell(cell, notebook);
        }
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    private async executeCell(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
    ): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        const code = cell.document.getText().trim();

        if (!code) {
            execution.end(true, Date.now());
            return;
        }

        const connMgr = this.getConnectionManager(notebook);

        // Handle magic commands
        if (code.startsWith("%%")) {
            await this.handleMagic(code, execution, connMgr);
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        // Ensure we have a connection (one per notebook, reused across cells)
        try {
            await connMgr.ensureConnection();
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(
                        `Error: ${err.message || "Connection failed"}`,
                        "text/plain",
                    ),
                ]),
            ]);
            execution.end(false, Date.now());
            return;
        }

        // Parse batches and execute
        const batches = parseBatches(code);
        const outputs: vscode.NotebookCellOutput[] = [];

        try {
            for (const batch of batches) {
                const result = await connMgr.executeQuery(batch);

                if (result.columnInfo && result.columnInfo.length > 0) {
                    // SELECT or similar — has result set
                    const html = formatter.toHtml(
                        result.columnInfo,
                        result.rows,
                    );
                    const plain = formatter.toPlain(
                        result.columnInfo,
                        result.rows,
                    );
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                html,
                                "text/html",
                            ),
                            vscode.NotebookCellOutputItem.text(
                                plain,
                                "text/plain",
                            ),
                        ]),
                    );
                } else {
                    // INSERT, UPDATE, DELETE, DDL
                    const msg =
                        result.rowCount >= 0
                            ? `(${result.rowCount} row(s) affected)`
                            : "(Command completed successfully)";
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                msg,
                                "text/plain",
                            ),
                        ]),
                    );
                }
            }

            execution.replaceOutput(outputs);
            execution.end(true, Date.now());
        } catch (err: any) {
            // Show SQL errors as plain text — no JS stack trace
            outputs.push(
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(
                        `Error: ${err.message || "Query execution failed"}`,
                        "text/plain",
                    ),
                ]),
            );
            execution.replaceOutput(outputs);
            execution.end(false, Date.now());
        }
    }

    private async handleMagic(
        code: string,
        execution: vscode.NotebookCellExecution,
        connMgr: ConnectionManager,
    ): Promise<void> {
        const lines = code.split("\n");
        const firstLine = lines[0].trim();
        const parts = firstLine.split(/\s+/);
        const command = parts[0].substring(2).toLowerCase(); // strip %%

        try {
            switch (command) {
                case "disconnect": {
                    connMgr.disconnect();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                "Disconnected.",
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "connection": {
                    const label = connMgr.getConnectionLabel();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                label,
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "connect": {
                    // Force a new connection prompt
                    connMgr.disconnect();
                    await connMgr.promptAndConnect();
                    const info = connMgr.getConnectionLabel();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                `Connected to ${info}`,
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "use": {
                    // %%use <database> — switch database
                    await connMgr.ensureConnection();
                    let targetDb = parts.slice(1).join(" ").trim();

                    if (!targetDb) {
                        // No arg — show quick pick
                        const databases =
                            await connMgr.listDatabases();
                        const currentDb =
                            connMgr.getCurrentDatabase();
                        const picked =
                            await vscode.window.showQuickPick(
                                databases.map((db) => ({
                                    label: db,
                                    description:
                                        db.toLowerCase() ===
                                        currentDb.toLowerCase()
                                            ? "(current)"
                                            : undefined,
                                })),
                                {
                                    title: "Select Database",
                                    placeHolder:
                                        "Choose a database",
                                },
                            );
                        if (!picked) {
                            execution.replaceOutput([
                                new vscode.NotebookCellOutput([
                                    vscode.NotebookCellOutputItem.text(
                                        "No database selected.",
                                        "text/plain",
                                    ),
                                ]),
                            ]);
                            execution.end(true, Date.now());
                            break;
                        }
                        targetDb = picked.label;
                    }

                    await connMgr.changeDatabase(targetDb);
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                `Switched to ${connMgr.getConnectionLabel()}`,
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                default: {
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.error(
                                new Error(
                                    `Unknown magic command: %%${command}`,
                                ),
                            ),
                        ]),
                    ]);
                    execution.end(false, Date.now());
                }
            }
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(
                        new Error(err.message || String(err)),
                    ),
                ]),
            ]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Show a quick pick of databases for the active notebook and switch.
     * Called from the command palette, code lens click, or status bar click.
     */
    async changeDatabaseInteractive(): Promise<void> {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        if (!notebook) {
            vscode.window.showWarningMessage("No active notebook.");
            return;
        }

        const mgr = this.connections.get(notebook.uri.toString());
        if (!mgr?.isConnected()) {
            // Not connected yet — prompt for a connection first
            const connMgr = this.getConnectionManager(notebook);
            await connMgr.promptAndConnect();
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        const databases = await mgr.listDatabases();
        const currentDb = mgr.getCurrentDatabase();

        const picked = await vscode.window.showQuickPick(
            databases.map((db) => ({
                label: db,
                description:
                    db.toLowerCase() === currentDb.toLowerCase()
                        ? "(current)"
                        : undefined,
            })),
            {
                title: "Select Database",
                placeHolder: "Choose a database",
            },
        );

        if (!picked) {
            return;
        }

        await mgr.changeDatabase(picked.label);
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    /**
     * Prompt the user to pick a new connection for the active notebook.
     * Called from the "not connected" code lens or command palette.
     */
    async changeConnectionInteractive(): Promise<void> {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        if (!notebook) {
            vscode.window.showWarningMessage("No active notebook.");
            return;
        }

        const mgr = this.getConnectionManager(notebook);
        mgr.disconnect();
        await mgr.promptAndConnect();
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    async createNotebookWithConnection(
        connectionInfo?: IConnectionInfo,
    ): Promise<void> {
        const cellData = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            "",
            "sql",
        );
        const notebookData = new vscode.NotebookData([cellData]);
        const notebook = await vscode.workspace.openNotebookDocument(
            "jupyter-notebook",
            notebookData,
        );

        await vscode.window.showNotebookDocument(notebook);

        this.controller.updateNotebookAffinity(
            notebook,
            vscode.NotebookControllerAffinity.Preferred,
        );

        if (connectionInfo) {
            const connMgr = this.getConnectionManager(notebook);
            await connMgr.connectWith(connectionInfo);

            const label = connMgr.getConnectionLabel();
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            vscode.window.showInformationMessage(
                `SQL Notebook connected to ${label}`,
            );
        }
    }

    dispose(): void {
        // Restore the MSSQL code lens setting
        if (this.mssqlCodeLensSaved !== undefined) {
            vscode.workspace
                .getConfiguration()
                .update(
                    MSSQL_CODE_LENS_SETTING,
                    this.mssqlCodeLensSaved,
                    vscode.ConfigurationTarget.Global,
                );
        }

        for (const mgr of this.connections.values()) {
            mgr.dispose();
        }
        this.connections.clear();
        this.disposables.forEach((d) => d.dispose());
        this.statusBarItem.dispose();
        this.controller.dispose();
    }
}
