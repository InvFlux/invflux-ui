/**
 * Parse clipboard TSV as actually emitted by Excel / Google Sheets / LibreOffice Calc /
 * Numbers when copying a cell range (§11.5.1). This is NOT naive `split('\t')`:
 *
 *  - a cell containing a tab or newline is wrapped in double quotes; the embedded tab/newline
 *    belongs to the cell, not to row/column separation;
 *  - embedded double quotes are escaped by doubling (`""` → `"`).
 *
 * Implemented as a state machine (no sentinel substitution, so no collision risk with real
 * user data) returning the cell grid plus any structural errors (e.g. an unterminated quote).
 * A quote only opens a quoted field at field start; stray quotes mid-unquoted-field are literal.
 */
export function parseSpreadsheetTsv(input: string): { rows: string[][]; errors: string[] } {
  const errors: string[] = [];
  const text = input.replace(/\r\n?/g, '\n');
  if (text === '') return { rows: [], errors };

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '\t') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) errors.push('Unterminated double-quote in pasted data.');

  // Flush the final field/row.
  row.push(field);
  rows.push(row);

  // Drop a single trailing empty row produced by a terminating newline.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
  }

  return { rows, errors };
}
