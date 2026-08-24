/**
 * Built-in header aliases for the {@link ImportWizard}, keyed by *concept* (not by any one host's field
 * key). A concept's list is the union across every shipped language — a store imports foreign suppliers'
 * documents regardless of its own UI locale, so these are raw literals, never `__()`-wrapped, and always
 * all on. Matching folds case / accents / spacing (see the wizard's `norm`), so one literal covers
 * "Qté"/"Qte"; list the distinct word only.
 *
 * Hosts spread the concepts their columns use: `aliases: [...COMMON_ALIASES.qty, 'ordered']`. Concepts
 * that are specific to one surface (a supplier document's "Expected/Confirmed", a catalogue's MOQ) stay
 * inline on that host rather than bloating this shared set.
 */
/**
 * Normalize one alias for storage + matching: lowercase, strip diacritics, keep only alphanumerics,
 * spaces, and `-._`, and collapse runs of whitespace. Crucially KEEPS inter-word spaces so the fuzzy
 * matcher's token term still sees word boundaries (`"confirmed qty"` stays two tokens). Removing commas /
 * semicolons also guarantees an alias can never contain a CSV delimiter, so the list round-trips safely.
 *
 * This is deliberately different from `foldKey` (in ./fuzzy-match): that one strips spaces + punctuation
 * for *comparison*; this keeps them for *storage*.
 */
export function normalizeAlias(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a comma/semicolon-separated alias list into normalized, de-duplicated entries. */
export function parseAliasCsv(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,;]/)) {
    const a = normalizeAlias(raw);
    if ('' !== a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Serialize an alias list to the canonical `", "`-joined CSV (normalized + de-duplicated). */
export function serializeAliases(list: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const a = normalizeAlias(raw);
    if ('' !== a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out.join(', ');
}

export const COMMON_ALIASES: Record<string, readonly string[]> = {
  sku: ['reference', 'ref', 'article', 'code', 'item', 'référence', 'code article', 'artikel', 'referencia'],
  supplier_sku: ['supplier ref', 'supplier sku', 'vendor sku', 'vendor code', 'réf fournisseur', 'code fournisseur', 'lieferant'],
  gtin: ['barcode', 'ean', 'ean13', 'upc', 'gtin', 'code barre', 'code-barres', 'código de barras'],
  qty: ['qty', 'quantity', 'quantities', 'qté', 'quantité', 'menge', 'anzahl', 'cantidad'],
  cost: ['price', 'unit price', 'cost', 'unit cost', 'cost each', 'prix', 'prix unitaire', 'coût', 'pu', 'tarif', 'preis', 'precio'],
};
