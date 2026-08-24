import type { Codec } from './registry';
import { codecRegistry } from './registry';
import { isoDateValue, parseDateValue } from './dateValue';

/**
 * Built-in datatype codecs (§11.8): the round-trippable text representations used for
 * clipboard copy/paste. `format` produces the cell's clipboard string; `parse` validates
 * pasted text back into a value (null = type-strict reject). Registered into codecRegistry
 * on import. `decimal:money` resolves to the `decimal` codec via the registry parent chain.
 */

const asString = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const numberCodec: Codec = {
  format: (value) => (typeof value === 'number' ? String(value) : ''),
  parse: (text, ctx) => {
    const t = text.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isInteger(n)) return null;
    const min = typeof ctx.config.min === 'number' ? ctx.config.min : undefined;
    const max = typeof ctx.config.max === 'number' ? ctx.config.max : undefined;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  },
};

/**
 * Normalize a locale-formatted number string to a canonical dot-decimal string, or null when it
 * isn't a number. Handles values pasted from spreadsheets in any locale:
 *  - **grouping whitespace** — regular space, NBSP (U+00A0), narrow NBSP (U+202F), thin space
 *    (U+2009), … all matched by JS `\s` — is stripped ("1 096,90" → "1096,90");
 *  - **comma OR dot decimal** — the LAST-occurring `,`/`.` is the decimal separator; the other is a
 *    grouping separator and is stripped. So "12,50" → "12.50", "1.234,56" → "1234.56" (EU),
 *    "1,234.56" → "1234.56" (US). A lone `1,234` is read as decimal `1.234` — acceptable in the
 *    money/quantity paste context (2-decimal money is the norm; true thousands-only values are rare
 *    to paste as a bare integer with a grouping comma).
 */
function normalizeNumeric(text: string): string | null {
  let t = text.trim().replace(/\s/g, '');
  if (t === '') return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma !== -1 || lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    t = t.split(groupSep).join('').replace(decimalSep, '.');
  }
  return /^-?\d+(?:\.\d+)?$/.test(t) ? t : null;
}

const decimalCodec: Codec = {
  format: asString,
  parse: (text) => normalizeNumeric(text),
};

const moneyCodec: Codec = {
  // Money displays with fixed 2 decimals so values line up (e.g. "12.90" not "12.9"); the value
  // itself stays a DECIMAL string.
  format: (value) => {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : asString(value);
  },
  // Money often arrives with a currency symbol / code around the number ("1 096,90 €", "$12.50"):
  // strip anything that isn't a digit / separator / sign / whitespace, then normalize like a decimal.
  parse: (text) => normalizeNumeric(text.replace(/[^\d.,\-\s]/g, '')),
};

const textCodec: Codec = {
  format: asString,
  // Trim on the way in: a stray leading/trailing space in a SKU / name / GTIN is never intended and
  // makes values that look identical compare unequal. The server trims these too (authoritative);
  // doing it here keeps the staged/committed cell in step with what will be saved.
  parse: (text) => text.trim(),
};

const enumCodec: Codec = {
  format: asString,
  parse: (text, ctx) => {
    const t = text.trim();
    const options = Array.isArray(ctx.config.options) ? (ctx.config.options as unknown[]) : null;
    if (options === null) return t; // no declared option set → accept as-is
    // Options are either bare string values or `{ value, label }` objects (editable enum columns).
    const values = options.map((o) => (o !== null && typeof o === 'object' ? (o as { value?: unknown }).value : o));
    return values.includes(t) ? t : null;
  },
};

const TRUE_TOKENS = new Set(['true', 'yes', '1', 'y']);
const FALSE_TOKENS = new Set(['false', 'no', '0', 'n']);

const boolCodec: Codec = {
  format: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
  parse: (text) => {
    const t = text.toLowerCase().trim();
    if (TRUE_TOKENS.has(t)) return true;
    if (FALSE_TOKENS.has(t)) return false;
    return null;
  },
};

const imageUrlCodec: Codec = {
  format: asString,
  parse: (text) => {
    const t = text.trim();
    if (t === '') return null;
    try {
      new URL(t);
      return t;
    } catch {
      return null;
    }
  },
};

const termPickerCodec: Codec = {
  format: (value, ctx) => {
    const ids = Array.isArray(value) ? (value as number[]) : [];
    const taxonomy = typeof ctx.config.taxonomy === 'string' ? ctx.config.taxonomy : '';
    const space = ctx.taxonomySpace?.[taxonomy];
    return ids.map((id) => space?.values[String(id)]?.name ?? String(id)).join(', ');
  },
  parse: (text, ctx) => {
    const names = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (names.length === 0) return []; // empty clears the taxonomy

    const taxonomy = typeof ctx.config.taxonomy === 'string' ? ctx.config.taxonomy : '';
    const space = ctx.taxonomySpace?.[taxonomy];
    if (!space) return null;

    const idByName = new Map<string, number>();
    for (const value of Object.values(space.values)) {
      idByName.set(value.name.toLowerCase(), value.id);
    }

    const ids: number[] = [];
    for (const name of names) {
      const id = idByName.get(name.toLowerCase());
      if (id === undefined) return null; // any unresolved term rejects the whole cell (v1)
      ids.push(id);
    }
    return ids;
  },
};

// Stock-concerns bitmask → human concern names for copy; read-only, so parse never accepts.
const STOCK_CONCERN_BITS: ReadonlyArray<{ bit: number; label: string }> = [
  { bit: 0x01, label: 'Stock deficit' },
  { bit: 0x02, label: 'Inactive product' },
  { bit: 0x04, label: 'Quality hold' },
  { bit: 0x08, label: 'Expired batch' },
  { bit: 0x10, label: 'Expiry risk' },
  { bit: 0x20, label: 'Warehouse short' },
];
const stockConcernsCodec: Codec = {
  format: (value) => {
    const bits = typeof value === 'number' ? value : 0;
    return STOCK_CONCERN_BITS.filter((c) => (bits & c.bit) !== 0)
      .map((c) => c.label)
      .join(', ');
  },
  parse: () => null,
};

// Copies as the canonical `YYYY-MM-DD[ HH:MM]` (spreadsheet-friendly, locale-independent).
// Paste-rejects: the `date` datatype is view-only today (no editable date column exists yet).
const dateCodec: Codec = {
  format: (value) => {
    const parsed = parseDateValue(value);
    return parsed === null ? '' : isoDateValue(parsed);
  },
  parse: () => null,
};

codecRegistry.register('number', 'core.number', numberCodec, { default: true });
codecRegistry.register('decimal', 'core.decimal', decimalCodec, { default: true });
codecRegistry.register('decimal:money', 'core.money', moneyCodec, { default: true });
codecRegistry.register('text', 'core.text', textCodec, { default: true });
codecRegistry.register('enum', 'core.enum', enumCodec, { default: true });
codecRegistry.register('bool', 'core.bool', boolCodec, { default: true });
codecRegistry.register('date', 'core.date', dateCodec, { default: true });
codecRegistry.register('image:url', 'core.image', imageUrlCodec, { default: true });
codecRegistry.register('term-picker:wc-taxonomy', 'core.term-list', termPickerCodec, { default: true });
codecRegistry.register('stock-concerns', 'core.stock-concerns', stockConcernsCodec, { default: true });
