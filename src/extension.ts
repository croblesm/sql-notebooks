import * as vscode from "vscode";
import type { ITreeNodeInfo } from "vscode-mssql";
import { SQLNotebookController } from "./notebookController";
import { getMssqlApi } from "./mssqlExtensionApi";

const log = vscode.window.createOutputChannel("SQL Notebooks", { log: true });

export function activate(context: vscode.ExtensionContext): void {
    const controller = new SQLNotebookController(log);
    context.subscriptions.push(controller);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "sqlNotebooks.createNotebook",
            async (treeNode?: ITreeNodeInfo) => {
                // Clone the connectionProfile to avoid mutating the OE tree node's
                // shared object. The MSSQL extension may reuse this reference.
                const connectionInfo = treeNode?.connectionProfile
                    ? { ...treeNode.connectionProfile }
                    : undefined;

                if (connectionInfo && treeNode) {
                    log.info(
                        `[createNotebook] nodeType=${treeNode.nodeType}, ` +
                            `profile.server=${connectionInfo.server}, ` +
                            `profile.database=${connectionInfo.database}`,
                    );

                    // Get the correct database name from the tree node hierarchy.
                    // For database-level nodes this traverses metadata; for server
                    // nodes it returns connectionProfile.database.
                    const api = await getMssqlApi();
                    if (api) {
                        const dbName =
                            api.getDatabaseNameFromTreeNode(treeNode);
                        log.info(
                            `[createNotebook] getDatabaseNameFromTreeNode → "${dbName}"`,
                        );
                        if (dbName) {
                            connectionInfo.database = dbName;
                        }
                    }
                }

                await controller.createNotebookWithConnection(
                    connectionInfo,
                );
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "sqlNotebooks.changeDatabase",
            () => controller.changeDatabaseInteractive(),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "sqlNotebooks.changeConnection",
            () => controller.changeConnectionInteractive(),
        ),
    );
}

export function deactivate(): void {}
