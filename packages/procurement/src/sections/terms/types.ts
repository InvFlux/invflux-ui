/** A set of purchase terms as the list shows it — one row of `GET /procurement/terms`. */
export interface TermsSetSummary {
  id: number;
  name: string;
  archived: boolean;
  /** The current version's number. */
  ordinal: number | null;
  /** Orders issued under any of its versions — what decides between deleting and archiving it. */
  orders: number;
  /** Orders went out under the current text — what makes saving mint the next version. */
  locked: boolean;
  /** The store's own set: what an order carries when neither it nor its supplier chooses one. */
  isStoreDefault: boolean;
}

export interface TermsSetVersion {
  ordinal: number;
  current: boolean;
  retiredAt: string | null;
  orders: number;
}

/** A supplier named where a set is chosen. */
export interface SupplierRef {
  id: number;
  name: string;
}

/** One set with what its editor needs — `GET /procurement/terms/{id}`. */
export interface TermsSetDetail extends TermsSetSummary {
  /** The current version's Markdown source. */
  body: string;
  versions: TermsSetVersion[];
  /**
   * Where the set is chosen. A supplier or the store keeps it from being removed; a draft order does
   * not — removing the set releases it to inherit its supplier's terms or the store's.
   */
  selectedBy: { suppliers: SupplierRef[]; draftOrders: number; store: boolean };
}

/** What deleting or archiving a set answers. */
export interface RetireAnswer {
  outcome: 'deleted' | 'archived';
  /** Draft orders that followed the set and now inherit their supplier's terms or the store's. */
  releasedDrafts: number;
}

/**
 * Where the terms dialog was opened, in that place's own words — a draft order, a supplier, the store
 * setting — so the dialog can say which set applies there, and offer to make another one apply.
 *
 * The caller writes whole sentences rather than handing over a name to slot in, so each reads right in
 * translation: an order's terms are "on" it, a supplier's are "set for" it.
 */
export interface TermsPlace {
  /** The set that applies there now — chosen there, or inherited; null for none. */
  appliedId: number | null;
  /** Said under the set that applies: "These terms are on Draft #123, from its supplier." */
  appliesText: string;
  /** The button under any other set: "Use these terms on Draft #123". */
  useLabel: string;
  /** The list's mark on the set that applies: "On Draft #123". */
  badge: string;
  /** The save button where saving also chooses: `null` for a plain save, else the version it creates. */
  saveAndUse: (version: number | null) => string;
}

/** A place where a list's numbers stop running on by one. */
export interface NumberingBreak {
  line: number;
  expected: number;
  found: number;
}

/** A clause that reads the same as before but carries another number. */
export interface MovedClause {
  text: string;
  from: number;
  to: number;
}

/** `POST /procurement/terms/preview` — the text as a save would store it, as it will print. */
export interface TermsPreview {
  source: string;
  html: string;
  numberingBreaks: NumberingBreak[];
  renumbered: MovedClause[];
  /** Other sets whose current text is exactly this one — archived sets and the set being edited aside. */
  sameText: { id: number; name: string }[];
}
