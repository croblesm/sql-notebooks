import type { IDbColumn, DbCellValue } from "vscode-mssql";

const MAX_ROWS_DISPLAY = 500;
const MAX_COLUMN_WIDTH = 200;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function truncate(text: string, maxWidth: number): string {
    if (text.length > maxWidth) {
        return text.substring(0, maxWidth - 3) + "...";
    }
    return text;
}

function cellDisplayValue(cell: DbCellValue): string {
    return cell.isNull ? "NULL" : cell.displayValue;
}

export function toHtml(
    columns: IDbColumn[],
    rows: DbCellValue[][],
): string {
    const isTruncated = rows.length > MAX_ROWS_DISPLAY;
    const displayRows = rows.slice(0, MAX_ROWS_DISPLAY);

    const borderColor = "var(--vscode-panel-border, #444)";
    const headerBg = "var(--vscode-editorGroupHeader-tabsBackground, #252526)";
    const rowNumBg = "var(--vscode-editorGroupHeader-tabsBackground, #252526)";
    const rowNumColor = "var(--vscode-descriptionForeground, #858585)";
    const cellStyle = `border:1px solid ${borderColor};padding:4px 8px;`;

    const headerCells =
        `<th style="${cellStyle}background:${headerBg};"></th>` +
        columns
            .map(
                (col) =>
                    `<th style="${cellStyle}background:${headerBg};text-align:left;font-weight:600;">${escapeHtml(col.columnName)}</th>`,
            )
            .join("");

    const bodyRows = displayRows
        .map((row, rowIdx) => {
            const rowNum = `<td style="${cellStyle}background:${rowNumBg};color:${rowNumColor};text-align:right;user-select:none;">${rowIdx + 1}</td>`;
            const cells = row
                .map((cell) => {
                    const val = truncate(
                        escapeHtml(cellDisplayValue(cell)),
                        MAX_COLUMN_WIDTH,
                    );
                    return `<td style="${cellStyle}">${val}</td>`;
                })
                .join("");
            return `<tr>${rowNum}${cells}</tr>`;
        })
        .join("\n");

    let countMsg = `${rows.length} row(s)`;
    if (isTruncated) {
        countMsg += ` (showing first ${MAX_ROWS_DISPLAY})`;
    }

    return [
        '<div style="max-height:300px;overflow:auto;">',
        `<table style="border-collapse:collapse;border:1px solid ${borderColor};font-size:12px;font-family:var(--vscode-editor-font-family, monospace);">`,
        `<thead style="position:sticky;top:0;"><tr>${headerCells}</tr></thead>`,
        `<tbody>${bodyRows}</tbody>`,
        "</table>",
        "</div>",
        `<p><em>${countMsg}</em></p>`,
    ].join("\n");
}

export function toPlain(
    columns: IDbColumn[],
    rows: DbCellValue[][],
): string {
    if (rows.length === 0) {
        return "(0 rows)";
    }

    const displayRows = rows.slice(0, MAX_ROWS_DISPLAY);
    const colNames = columns.map((c) => c.columnName);
    const widths = colNames.map((c) => c.length);

    for (const row of displayRows) {
        for (let i = 0; i < row.length; i++) {
            const val = cellDisplayValue(row[i]);
            widths[i] = Math.min(
                Math.max(widths[i] || 0, val.length),
                MAX_COLUMN_WIDTH,
            );
        }
    }

    const header = colNames
        .map((c, i) => c.padEnd(widths[i]))
        .join(" | ");
    const separator = widths.map((w) => "-".repeat(w)).join("-+-");

    const lines = [header, separator];
    for (const row of displayRows) {
        const line = row
            .map((cell, i) => cellDisplayValue(cell).padEnd(widths[i]))
            .join(" | ");
        lines.push(line);
    }
    lines.push(`(${rows.length} row(s))`);
    return lines.join("\n");
}
