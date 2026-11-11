/**
 * The `enum-multi` datatype: some of `editorConfig.options`, held as their values (a custom attribute's
 * colors on a worksheet line). Shared by its view and its codec, which must read a value the same way.
 */

export interface EnumOption {
  value: string;
  label: string;
}

/** The column's options, from `{ value, label }` objects or bare strings. */
export function enumOptions(config: Record<string, unknown>): EnumOption[] {
  const raw = Array.isArray(config.options) ? (config.options as unknown[]) : [];
  return raw.flatMap((o): EnumOption[] => {
    if (typeof o === 'string') return [{ value: o, label: o }];
    if (o !== null && typeof o === 'object') {
      const { value, label } = o as { value?: unknown; label?: unknown };
      if (typeof value === 'string' || typeof value === 'number') {
        const v = String(value);
        return [{ value: v, label: typeof label === 'string' && label.trim() !== '' ? label : v }];
      }
    }
    return [];
  });
}

/**
 * The values a cell holds: its list, or a single stored value as a list of one (a value kept from
 * when the column held one value; it still shows, and can be replaced).
 */
export function enumMultiValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v !== '');
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

/** The values' labels, joined as a cell and a copy show them; a value not among the options as stored. */
export function enumMultiText(value: unknown, config: Record<string, unknown>): string {
  const labels = new Map(enumOptions(config).map((o) => [o.value, o.label]));
  return enumMultiValues(value)
    .map((v) => labels.get(v) ?? v)
    .join(', ');
}

/**
 * Pasted text as values: comma-separated, each part an option's value or label (case blind), or null
 * when any part is neither, which refuses the whole cell. Empty text is none.
 */
export function parseEnumMulti(text: string, config: Record<string, unknown>): string[] | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length === 0) return [];
  const byKey = new Map<string, string>();
  for (const o of enumOptions(config)) {
    byKey.set(o.label.toLowerCase(), o.value);
    byKey.set(o.value.toLowerCase(), o.value);
  }
  const values: string[] = [];
  for (const part of parts) {
    const value = byKey.get(part.toLowerCase());
    if (value === undefined) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}
