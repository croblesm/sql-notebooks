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

The MSSQL extension (`ms-mssql.mssql`) exposes these methods:

- `IExtension.promptForConnection()` — shows connection picker, returns `IConnectionInfo`
- `IExtension.connect(connectionInfo)` — establishes connection, returns `connectionUri: string`
- `connectionSharing.executeSimpleQuery(connectionUri, sql)` — executes SQL, returns `SimpleExecuteResult`
- `connectionSharing.isConnected(connectionUri)` — checks if connection is alive
- `connectionSharing.disconnect(connectionUri)` — closes connection

Types are defined in `typings/vscode-mssql.d.ts`.

## Source Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point. Registers the NotebookController. |
| `src/notebookController.ts` | `NotebookController` for `jupyter-notebook` type. Handles cell execution and magic commands. |
| `src/connectionManager.ts` | Per-notebook connection state via MSSQL extension API. |
| `src/mssqlExtensionApi.ts` | Discovers and activates the MSSQL extension, returns typed API. |
| `src/resultFormatter.ts` | Converts `SimpleExecuteResult` to HTML tables and plain text. |
| `src/batchParser.ts` | Splits SQL on `GO` batch separators. |
| `typings/vscode-mssql.d.ts` | MSSQL extension API type definitions. |

## Design Constraints — Do NOT Violate

- **No direct SQL driver.** Never add tedious, mssql npm, mssql-python, pyodbc, or any SQL driver as a dependency. All SQL execution goes through the MSSQL extension's `connectionSharing.executeSimpleQuery()` API.
- **No custom notebook renderer.** Use VS Code's built-in `text/html` rendering for cell outputs.
- **No Python, no Jupyter runtime.** This is a pure TypeScript VS Code extension.
- **One connection per notebook.** Connection is scoped to notebook lifetime. Matches ADS behavior.
- **Standard .ipynb format.** No custom file types or serializers.
- **Always call `execution.end()`.** Every code path in cell execution must call `execution.end(success, timestamp)` — never leave a cell spinning.
- **HTML-escape all output values.** Escape `&`, `<`, `>`, `"` in all user data rendered as HTML to prevent XSS.

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

## Documentation

Project docs are in `../Documentation/`. The PRD (`SQL Notebook PRD.md`) and source code are the authoritative references.
