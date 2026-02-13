import * as vscode from "vscode";
import type { IExtension } from "vscode-mssql";

const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

/**
 * Get the MSSQL extension API. Activates the extension if it isn't already active.
 * Returns undefined if the extension is not installed.
 */
export async function getMssqlApi(): Promise<IExtension | undefined> {
    const ext = vscode.extensions.getExtension<IExtension>(MSSQL_EXTENSION_ID);
    if (!ext) {
        return undefined;
    }
    if (!ext.isActive) {
        return await ext.activate();
    }
    return ext.exports;
}
