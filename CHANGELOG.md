# Changelog

## [0.1.4] - 2026-02-20

### Added
- PRINT statement support — `PRINT` messages now display in cell output (#2)
- Context-aware IntelliSense for notebook cells — cell URIs are registered with STS via `connection/connect` so completions, hover, and diagnostics work (#2)
- Row numbers in result grid (#2)
- Resizable columns in result grid (#2)

### Changed
- Result grid restyled to match MSSQL extension look (borders, monospace font, sticky headers, no-wrap) (#2)
- Show default database name in status bar when a new notebook is opened (#2)
- Improved database verification logic in `connectWith()` — now verifies actual database even when no target database is specified (#2)

### Contributors
- Lewis Sanchez (@lewis-sanchez)

## [0.1.3] - 2026-02-13

### Added
- Auto-select SQL kernel on reopen (`setAffinityIfSql` + `NotebookControllerAffinity.Preferred`)
- Fix cells stuck as Python language (`ensureSqlCellLanguage` via `onDidChangeSelectedNotebooks`)
- Cap result table height at 300px with scrollable container and sticky headers

### Changed
- Update status bar on active notebook switch
- Fix sticky header transparency

## [0.1.2] - 2026-02-13

### Changed
- Improved README
- Fixed icon transparency
- Version bump

## [0.1.1] - 2026-02-13

### Fixed
- Build failure: Updated Node.js from 18 to 20

## [0.1.0] - 2026-02-13

### Added
- Initial release — SQL Notebook kernel for VS Code
- Cell execution via MSSQL extension API
- Magic commands (`%%connect`, `%%disconnect`, `%%connection`, `%%use`)
- GO batch splitting
- Per-notebook connection management
- Code lens showing active connection
- Status bar with database info
