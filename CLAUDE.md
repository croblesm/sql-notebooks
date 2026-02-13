# SQL Notebooks Extension — CLAUDE.md

## What This Project Is

A VS Code companion extension (`ms-mssql.sql-notebooks`) that adds "SQL" as a notebook kernel. It is part of the MSSQL extension family, alongside SQL Database Projects.

**The extension has zero runtime dependencies.** All SQL execution is delegated to the MSSQL extension via its `connectionSharing.executeSimpleQuery()` API.

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

## Build & Run

```bash
npm install          # Install dev dependencies
npm run build        # Compile TypeScript → out/
npm run watch        # Watch mode for development
```

Press **F5** in VS Code to launch Extension Development Host with the extension loaded.

## Design Constraints

- **No direct SQL driver.** Do not add tedious, mssql, mssql-python, or any SQL driver. All SQL goes through the MSSQL extension.
- **No custom notebook renderer.** Use VS Code's built-in `text/html` rendering. Custom `NotebookRenderer` is Phase 1.
- **No Python, no Jupyter.** This is a pure TypeScript VS Code extension.
- **One connection per notebook.** All cells share a single database connection, scoped to the notebook lifetime. To switch databases, use `%%use <database>`, click the code lens, or click the status bar. This is a technical limitation: the MSSQL extension's `connectionSharing.getActiveEditorConnectionId()` uses `vscode.window.activeTextEditor`, which is `undefined` for notebook editors (notebooks use `NotebookEditor`, not `TextEditor`). Per-cell connection sync is not possible until the MSSQL extension exposes a notebook-aware API.
- **Standard .ipynb format.** No custom file types, no custom serializer.
- **Companion extension pattern.** Follow the same patterns as `ms-mssql.sql-database-projects`.

## Known Workarounds

### MSSQL Auto-Connect Workaround

The MSSQL extension's `SqlDocumentService.onDidOpenTextDocument()` auto-connects any newly opened SQL document to `_lastActiveConnectionInfo`. Notebook cells are `TextDocument` objects with `languageId === "sql"`, so the MSSQL extension auto-connects them to whatever was the last active connection — which may be wrong.

**Workaround:** We provide our own `NotebookCodeLensProvider` (registered with `{ language: "sql", notebookType: "jupyter-notebook" }`) that shows the correct per-notebook connection. We disable the MSSQL extension's code lens setting (`mssql.query.showActiveConnectionAsCodeLensSuggestion`) while a notebook editor is active, and restore it when the user switches to a regular `.sql` file. This ensures the code lens always shows the correct connection for each notebook.

### Database Switching via Disconnect+Reconnect

The MSSQL extension's `SimpleExecuteRequest` does not persist session state (e.g., `USE [database]`) between calls. Each `executeSimpleQuery()` call gets its own execution context. Therefore, switching databases requires disconnecting and reconnecting with a modified `IConnectionInfo` that has the new database name. This is the same pattern used by the MSSQL extension's copilot tools (`changeDatabaseTool.ts`).

### IntelliSense Limitation

The MSSQL extension's IntelliSense (completions, hover, diagnostics) is powered by the SQL Tools Language Server. The language client registers with `documentSelector: ["sql"]`, so notebook cells with `languageId === "sql"` automatically receive **basic keyword IntelliSense**.

However, **context-aware IntelliSense** (table names, column names, stored procedures) requires the language server to associate a connection with each document via an `ownerUri`. The MSSQL extension's `SqlDocumentService.onDidOpenTextDocument()` auto-connects SQL documents to `_lastActiveConnectionInfo`, which may not match the notebook's actual connection — or may not exist at all.

**Why we can't fix this from the companion extension:**
- `IExtension.connect()` returns a `connectionUri` but doesn't accept a target document URI — we can't tell the language server "use this connection for this cell"
- The MSSQL extension has zero notebook-specific code; its `ownerUri` → connection mapping is internal
- `IExtension.sendRequest()` could theoretically send a `connection/connect` request with a cell's document URI as `ownerUri`, but the request types are undocumented and fragile

**What would fix this upstream:** The MSSQL extension needs a notebook-aware API, e.g. `connectDocument(documentUri: string, connectionInfo: IConnectionInfo)`, that registers a connection with the language server for a specific document URI. This would let companion extensions provide context-aware IntelliSense for notebook cells.

### Notebook Kernel Auto-Selection

When reopening a saved `.ipynb` that was using the SQL kernel, VS Code may show "Detecting Kernels" and default cells to Python language (Jupyter default). This prevents our controller from executing cells since it only handles `languageId === "sql"`.

**Workaround:** On activation, we set `NotebookControllerAffinity.Preferred` for any notebook that appears to be SQL (by checking `kernelspec` metadata, `language_info`, or cell languages). When our controller is selected, `onDidChangeSelectedNotebooks` fires and we explicitly set all code cells to SQL language via `vscode.languages.setTextDocumentLanguage()`.

## Code Conventions

- TypeScript strict mode enabled
- Use `vscode.NotebookCellOutputItem.error(new Error(...))` for errors — never let a cell execution hang without calling `execution.end()`
- HTML output must escape all user data (`&`, `<`, `>`, `"`) to prevent XSS
- GO batch splitting uses regex: `/^\s*GO\s*$/gim`
- Connection manager stores `connectionUri` (string from MSSQL extension) and `connectionInfo` (for reconnection during database switch)

## Related Repositories

- MSSQL Extension: https://github.com/microsoft/vscode-mssql (local clone at `~/vscode-mssql/`)
- VS Code Notebook API: https://code.visualstudio.com/api/extension-guides/notebook
