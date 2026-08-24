/**
 * Shared file-import transport for the {@link ImportWizard}. A picked CSV / TSV / XLSX is uploaded to
 * the adapter's `POST invflux/v1/import/parse` endpoint, which parses it server-side and answers the
 * same row grid a clipboard paste produces — so no host re-implements the upload and no SPA bundle
 * ships a spreadsheet parser. Every consuming SPA (Procurement, and soon the Workbench) wires this into
 * `ImportWizard`'s `onParseFile` in one line.
 */

/** Nonce-authenticated REST coordinates, as carried on each SPA's boot context. */
export interface ImportFileTransport {
  /** WP REST root (rest_route form, e.g. `…/index.php?rest_route=/`) — the same value the SPA's api uses. */
  apiRoot: string;
  nonce: string;
}

/**
 * Upload a file to the shared parse endpoint and return its rows (ragged rows are fine — the wizard's
 * column mapper aligns by column). Throws with the server's message on a rejected / unreadable file.
 */
export async function parseImportFile(transport: ImportFileTransport, file: File): Promise<string[][]> {
  const base = `${transport.apiRoot.replace(/\/$/, '')}/invflux/v1`;
  const form = new FormData();
  form.append('file', file);

  // No Content-Type header: the browser sets `multipart/form-data` with the correct boundary itself.
  const res = await fetch(`${base}/import/parse`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-WP-Nonce': transport.nonce },
    body: form,
  });

  if (!res.ok) {
    // The import endpoint answers `{ error }`; WP core errors answer `{ message }`.
    let message = `Import parse failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (data.error) message = data.error;
      else if (data.message) message = data.message;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }

  const data = (await res.json()) as { rows?: string[][] };
  return data.rows ?? [];
}

/** Learned header aliases, keyed by concept (`sku`, `cost`, `expected`, …). */
export type ImportAliasMap = Record<string, string[]>;

const restBase = (transport: ImportFileTransport): string => `${transport.apiRoot.replace(/\/$/, '')}/invflux/v1`;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string };
    return data.error ?? data.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** GET the merchant's learned header aliases. Returns an empty map when none / unreadable. */
export async function fetchImportAliases(transport: ImportFileTransport): Promise<ImportAliasMap> {
  const res = await fetch(`${restBase(transport)}/import/aliases`, { headers: { Accept: 'application/json', 'X-WP-Nonce': transport.nonce } });
  if (!res.ok) return {};
  const data = (await res.json()) as { aliases?: ImportAliasMap };
  return data.aliases ?? {};
}

/**
 * Teach one header → concept (append-only, import-operator gated). Returns the updated map. Fire-and-
 * forget friendly — the wizard applies the alias optimistically and only needs this to persist it.
 */
export async function learnImportAlias(transport: ImportFileTransport, concept: string, header: string): Promise<ImportAliasMap> {
  const res = await fetch(`${restBase(transport)}/import/aliases/learn`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-WP-Nonce': transport.nonce },
    body: JSON.stringify({ concept, header }),
  });
  if (!res.ok) throw new Error(await readError(res, `Could not save the alias (${res.status})`));
  const data = (await res.json()) as { aliases?: ImportAliasMap };
  return data.aliases ?? {};
}

/** PUT the full alias map (settings-management gated) — wholesale replace for the Settings panel. */
export async function saveImportAliases(transport: ImportFileTransport, aliases: ImportAliasMap): Promise<ImportAliasMap> {
  const res = await fetch(`${restBase(transport)}/import/aliases`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-WP-Nonce': transport.nonce },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(await readError(res, `Could not save aliases (${res.status})`));
  const data = (await res.json()) as { aliases?: ImportAliasMap };
  return data.aliases ?? {};
}
