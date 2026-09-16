/**
 * Supplier DTO — the shape returned by `SupplierController::present()` (raw values; formatting
 * happens in the rendering layer).
 */
export interface Supplier {
  id: number;
  name: string;
  nickname: string | null;
  displayName: string;
  openPoCount: number;
  draftPoCount: number;
  code: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  orderingUrl: string | null;
  /** The street's name alone when {@link buildingNumber} is set; the whole line otherwise. */
  address1: string | null;
  /** The house number, kept apart because a payment instruction has to state it on its own. */
  buildingNumber: string | null;
  /**
   * The street as it should read, street and number already in the destination country's word
   * order. Composed by the server so that ordering lives in one place — display this, never
   * `address1`, or a supplier that has a separate number prints its street without one.
   */
  addressLine: string;
  address2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  currency: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  costDecimals: number;
  /** *Our* account number with them — their customer reference for us (the mirror of {@link code}). */
  accountNumber: string | null;
  /** The supplier's set of purchase terms — middle rung of `order ?? supplier ?? store`; null inherits the store's. */
  termsLineageId: number | null;
  /** Locale their purchase orders are written in (e.g. `de_DE`); null uses the store's language. */
  documentLanguage: string | null;
  /** Purchase-tax rate applied to this supplier's lines, as a percentage string. */
  defaultTaxRate: string | null;
  /** Which tax regime applies when buying from them — decides whether a rate reaches the order at all. */
  taxTreatment: string;
  /** Whether their quoted prices are gross — an entry mode for the cost field, not a stored property. */
  quotesIncludeTax: boolean;
  /** WP user id of the internal buyer responsible for this supplier — written by an add-on. */
  assignedTo: number | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** `GET /procurement/suppliers` response envelope. */
export interface SuppliersResponse {
  suppliers: Supplier[];
}

/** Supplier contact DTO — shape returned by `SupplierController::presentContact()`. */
export interface SupplierContact {
  id: number;
  supplierId: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  notes: string | null;
  poRecipient: boolean;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** `GET /procurement/suppliers/{id}/contacts` response envelope. */
export interface SupplierContactsResponse {
  contacts: SupplierContact[];
}

/** Supplier-product link DTO — shape returned by `SupplierProductController::present()`. */
export interface SupplierProduct {
  id: number;
  supplierId: number;
  subjectId: number;
  /** WC post id (null if unresolved) — lets the catalogue picker skip products already linked. */
  postId: number | null;
  name: string | null;
  sku: string | null;
  supplierSku: string | null;
  gtin: string | null;
  imageUrl: string | null;
  productLabel: string;
  exists: boolean;
  unitPrice: string | null;
  currency: string | null;
  moq: number | null;
  casePack: number | null;
  leadTimeDays: number | null;
  priority: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** `GET /procurement/suppliers/{id}/products` response envelope. */
export interface SupplierProductsResponse {
  products: SupplierProduct[];
}

/** One hit from `GET /procurement/products/search` (host post ids, not subjects). */
export interface ProductSearchHit {
  postId: number;
  name: string | null;
  sku: string | null;
  gtin: string | null;
  imageUrl: string | null;
}

/** `GET /procurement/products/search` response envelope. */
export interface ProductSearchResponse {
  products: ProductSearchHit[];
}
