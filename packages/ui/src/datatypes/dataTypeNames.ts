/**
 * The numeric datatype names, and the one place an earlier name is read as today's (§5).
 *
 * - `integer` is a whole number: a count, an id, a number of days. It clears to `null`.
 * - `quantity` is a stock quantity: units of a product. Today it holds whole units and is shown,
 *   edited and pasted as an `integer` (its parent chain ends there, see `datatypeChain`). It is its
 *   own type because a product's quantity may later be measured with decimals, and a quantity column
 *   will then take its precision from the product it shows, which an integer column never does.
 *
 * `number` was the name of `integer`, and it may still arrive: a column an add-on declares, a
 * component an add-on registers, a choice stored per datatype. The datatype registries read it, and
 * its children, as today's name. The server does the same (`WorkbenchDataType::canonical()`); the
 * two lists are kept in step.
 */

export const INTEGER = 'integer';
export const QUANTITY = 'quantity';

/** Earlier names read as today's: the stock children became quantities, the rest integers. */
const LEGACY: Readonly<Record<string, string>> = {
  number: INTEGER,
  'number:stock': 'quantity:stock',
  'number:on-order': 'quantity:on-order',
  'number:receipt': 'quantity:receipt',
};

/** Today's name for `dataType`: an earlier one translated, any other returned as given. */
export function canonicalDataType(dataType: string): string {
  const legacy = LEGACY[dataType];
  if (legacy !== undefined) return legacy;
  return dataType.startsWith('number:') ? INTEGER + dataType.slice('number'.length) : dataType;
}

/** Whether `dataType` holds whole numbers: an integer or a quantity, or a variant of either. */
export function isWholeNumberDataType(dataType: string): boolean {
  const root = canonicalDataType(dataType).split(':', 1)[0];
  return root === INTEGER || root === QUANTITY;
}
