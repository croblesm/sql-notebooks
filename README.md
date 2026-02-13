# SQL Notebooks

SQL notebook support for VS Code — a companion extension to the [MSSQL extension](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql).

Run SQL queries interactively in Jupyter notebooks (`.ipynb`) using the **SQL** kernel. All SQL execution is handled by the MSSQL extension — no additional drivers or runtimes required.

<!-- ![SQL Notebooks screenshot](images/screenshot.png) -->

## Features

- **SQL kernel for Jupyter notebooks** — select "SQL" from the kernel picker in any `.ipynb` file
- **One connection per notebook** — each notebook maintains its own database connection
- **Database switching** — change databases without reconnecting:
  - Click the code lens above any cell (shows current `server / database`)
  - Click the status bar item
  - Use `%%use <database>` magic command in a cell
  - Use the Command Palette: "SQL Notebooks: Change Database"
- **GO batch splitting** — T-SQL `GO` separators are handled automatically
- **HTML result tables** — query results render as formatted HTML tables
- **Magic commands** — manage connections without leaving the notebook:
  - `%%connect` — open the connection picker to connect (or switch connections)
  - `%%disconnect` — close the current connection
  - `%%connection` — display the active connection info
  - `%%use <database>` — switch to a specific database on the current server
  - `%%use` — open an interactive database picker
- **Create SQL Notebook from Object Explorer** — right-click a server or database node and select "Create SQL Notebook" to open a new notebook pre-connected to that target

## Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.85 or later
- [MSSQL extension](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) (`ms-mssql.mssql`)

## Installation

### From VSIX

1. Download the latest `.vsix` from the [Releases](https://github.com/croblesm/sql-notebooks/releases) page
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **Extensions: Install from VSIX...** and select the downloaded file

### From source

```bash
git clone https://github.com/croblesm/sql-notebooks.git
cd sql-notebooks
npm install
npm run build
npx vsce package
# Then install the generated .vsix file as above
```

## Usage

1. Open or create a `.ipynb` notebook in VS Code
2. Select **SQL** from the kernel picker (top-right of the notebook)
3. Write SQL in a code cell and run it — you'll be prompted to connect on first execution
4. Click the code lens (`server / database`) above any cell to change database
5. Use `%%connect` in a cell to switch to a different server
6. Use `%%use AdventureWorks` in a cell to switch databases

## Known Limitations

- **One connection per notebook** — all cells share a single database connection. This matches Azure Data Studio behavior. To query a different server, use `%%connect`. To switch databases on the same server, use `%%use` or click the code lens.
- **No IntelliSense** — SQL autocomplete is not yet available in notebook cells (planned for Phase 1).
- **Static result tables** — results render as HTML tables without sorting/filtering (interactive grid planned for Phase 1).
- **No query plan visualization** — execution plans are not yet supported (planned for Phase 1).

## License

[MIT](LICENSE)
