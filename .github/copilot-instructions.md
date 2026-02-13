# SQL Notebooks Extension — Copilot Instructions

## Project Overview

This is a VS Code companion extension (`ms-mssql.sql-notebooks`) that adds "SQL" as a notebook kernel in VS Code. It is part of the MSSQL extension family, alongside SQL Database Projects (`ms-mssql.sql-database-projects`).

The extension registers a `NotebookController` for the built-in `jupyter-notebook` notebook type. When a user selects "SQL" from the kernel picker and executes a cell, the extension delegates SQL execution to the MSSQL extension via its public API.

**The extension has zero runtime dependencies.** All SQL connectivity and query execution is handled by the MSSQL extension's `connectionSharing.executeSimpleQuery()` API.

## Architecture

```
User executes cell → NotebookController.executeHandler()
  → connectionManager.ensureConnection()
    → mssqlApi.promptForConnection() → IConnectionInfo
    → mssqlApi.connect(info) → connectionUri
  → connectionManager.executeQuery(sql)
    → connectionSharing.executeSimpleQuery(connectionUri, sql)
    → SimpleExecuteResult { rowCount, columnInfo, rows }
  → resultFormatter.toHtml(columnInfo, rows) → HTML table
  → NotebookCellOutput (text/html + text/plain)
```

## Key MSSQL Extension API

The MSSQL extension (`ms-mssql.mssql`) exposes these methods we use:

- `IExtension.promptForConnection()` — shows connection picker, returns `IConnectionInfo`
- `IExtension.connect(connectionInfo)` — establishes connection, returns `connectionUri: string`
- `IExtension.listDatabases(connectionUri)` — lists all databases on the server
- `IExtension.getDatabaseNameFromTreeNode(node)` — resolves database name from Object Explorer tree node
- `connectionSharing.executeSimpleQuery(connectionUri, sql)` — executes SQL, returns `SimpleExecuteResult`
- `connectionSharing.listDatabases(connectionUri)` — lists all databases on the server
- `connectionSharing.isConnected(connectionUri)` — checks if connection is alive
- `connectionSharing.disconnect(connectionUri)` — closes connection

Types are defined in `typings/vscode-mssql.d.ts`. The source of truth for the full MSSQL API is the vscode-mssql repo at `extensions/mssql/typings/vscode-mssql.d.ts`.

## Source Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point. Registers the NotebookController and commands (`createNotebook`, `changeDatabase`, `changeConnection`). |
| `src/notebookController.ts` | `NotebookController` for `jupyter-notebook` type. Handles cell execution, magic commands, status bar, code lens registration, MSSQL code lens toggle. |
| `src/connectionManager.ts` | Per-notebook connection state. Calls MSSQL extension API for connection management, database switching (disconnect+reconnect), database listing. |
| `src/notebookCodeLensProvider.ts` | Provides code lenses for notebook cells showing the correct per-notebook connection. Clickable to change database or connect. |
| `src/mssqlExtensionApi.ts` | Discovers and activates the MSSQL extension, returns typed `IExtension` API. |
| `src/resultFormatter.ts` | Converts `SimpleExecuteResult` (columnInfo + DbCellValue rows) to HTML tables and plain text. |
| `src/batchParser.ts` | Splits SQL on `GO` batch separators (T-SQL convention, case-insensitive, own line). |
| `typings/vscode-mssql.d.ts` | Type definitions for the MSSQL extension API subset we use. |

## Commands

| Command | Purpose |
|---------|---------|
| `sqlNotebooks.createNotebook` | Create a new SQL Notebook, optionally pre-connected from Object Explorer. |
| `sqlNotebooks.changeDatabase` | Show quick pick of databases on the current server, switch by disconnecting and reconnecting. |
| `sqlNotebooks.changeConnection` | Disconnect and prompt for a new connection via MSSQL connection picker. |

## Magic Commands

| Magic | Purpose |
|-------|---------|
| `%%connect` | Disconnect and prompt for a new connection. |
| `%%disconnect` | Close the current connection. |
| `%%connection` | Show the current connection info. |
| `%%use <database>` | Switch to a specific database (disconnect+reconnect). |
| `%%use` | Show interactive database picker, then switch. |

## Design Constraints — Do NOT Violate

- **No direct SQL driver.** Never add tedious, mssql npm, mssql-python, pyodbc, or any SQL driver as a dependency. All SQL execution goes through the MSSQL extension's `connectionSharing.executeSimpleQuery()` API.
- **No custom notebook renderer.** Use VS Code's built-in `text/html` rendering for cell outputs. Custom `NotebookRenderer` is Phase 1.
- **No Python, no Jupyter runtime.** This is a pure TypeScript VS Code extension.
- **One connection per notebook.** All cells share a single database connection, scoped to the notebook lifetime. To switch databases, use `%%use <database>`, click the code lens, or click the status bar.
- **Standard .ipynb format.** No custom file types or serializers.
- **Companion extension pattern.** Follow the same patterns as `ms-mssql.sql-database-projects`.
- **Always call `execution.end()`.** Every code path in cell execution must call `execution.end(success, timestamp)` — never leave a cell spinning.
- **HTML-escape all output values.** Escape `&`, `<`, `>`, `"` in all user data rendered as HTML to prevent XSS.

## Known Workarounds

### MSSQL Auto-Connect Workaround

The MSSQL extension's `SqlDocumentService.onDidOpenTextDocument()` auto-connects any newly opened SQL document to `_lastActiveConnectionInfo`. Notebook cells are `TextDocument` objects with `languageId === "sql"`, so the MSSQL extension auto-connects them to whatever was the last active connection — which may be wrong.

**Workaround:** We provide our own `NotebookCodeLensProvider` (registered with `{ language: "sql", notebookType: "jupyter-notebook" }`) that shows the correct per-notebook connection. We disable the MSSQL extension's code lens setting (`mssql.query.showActiveConnectionAsCodeLensSuggestion`) while a notebook editor is active, and restore it when the user switches to a regular `.sql` file.

### Database Switching via Disconnect+Reconnect

The MSSQL extension's `SimpleExecuteRequest` does not persist session state (e.g., `USE [database]`) between calls. Each `executeSimpleQuery()` call gets its own execution context. Therefore, switching databases requires disconnecting and reconnecting with a modified `IConnectionInfo` that has the new database name. This is the same pattern used by the MSSQL extension's copilot tools (`changeDatabaseTool.ts`).

## Code Patterns

### Cell execution pattern
```typescript
const execution = this.controller.createNotebookCellExecution(cell);
execution.executionOrder = ++this.executionOrder;
execution.start(Date.now());
try {
    // ... execute SQL, format results
    execution.replaceOutput([new vscode.NotebookCellOutput([...])]);
    execution.end(true, Date.now());
} catch (err: any) {
    execution.replaceOutput([new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.error(new Error(err.message))
    ])]);
    execution.end(false, Date.now());
}
```

### Getting the MSSQL extension API
```typescript
const ext = vscode.extensions.getExtension<IExtension>('ms-mssql.mssql');
if (!ext) { /* handle missing extension */ }
const api = ext.isActive ? ext.exports : await ext.activate();
```

### GO batch splitting
```typescript
const batches = code.split(/^\s*GO\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0);
```

## Build & Test

```bash
npm install          # Install dev dependencies (@types/vscode, typescript)
npm run build        # Compile TypeScript → out/
npm run watch        # Watch mode
# Press F5 in VS Code to launch Extension Development Host
```
