import { __ } from '@invflux/i18n';

/**
 * The supplier documents whose **content** is captured onto a purchase order. Storing the document
 * itself is an add-on subsystem; what is recorded here are the facts it carries.
 *
 * They divide by which axis they speak to, and that division is the reason an invoice cannot share
 * the other two's flow. An order acknowledgement and an advance shipping notice both state a
 * quantity the supplier will *send*, so both write the same field. An invoice states a quantity
 * *billed* and a price — a different axis again, because a supplier can ship ten and bill twelve and
 * both figures are true. Routing an invoice through the expected-quantity capture would overwrite
 * what is coming with what is charged.
 */
export type SupplierDocKind = 'oa' | 'asn' | 'invoice';

/** The kinds in the order they are always offered, so the menu never reshuffles. */
export const SUPPLIER_DOC_KINDS: readonly SupplierDocKind[] = ['oa', 'asn', 'invoice'];

/**
 * The document's name, glossed with the acronym a merchant meets on the supplier's own paperwork.
 *
 * **The acronym is part of the translation, not appended in code**, because the two do not travel
 * the same way. `ASN` is the English initialism, and French supply-chain writing borrows it whole —
 * "avis d'expédition (ASN)". `ARC` is built from the French words themselves (accusé de réception de
 * commande) and has no English counterpart at all. A locale with no acronym in circulation should
 * simply drop the parenthesis rather than invent one.
 */
export function supplierDocLabel(kind: SupplierDocKind): string {
  switch (kind) {
    case 'oa':
      /* translators: the parenthesis glosses the name with the acronym merchants meet on supplier
         paperwork — French uses ARC. Drop it if your language has none in circulation. */
      return __('Order acknowledgement (OA)');
    case 'asn':
      /* translators: the parenthesis glosses the name with the acronym merchants meet on supplier
         paperwork. ASN is borrowed as-is by several languages, French included. */
      return __('Advance shipping notice (ASN)');
    case 'invoice':
      return __('Invoice');
  }
}

/** One line telling the three apart at the moment of choosing. */
export function supplierDocHint(kind: SupplierDocKind): string {
  switch (kind) {
    case 'oa':
      return __('The supplier’s confirmation of the order');
    case 'asn':
      return __('The supplier’s dispatch notice');
    case 'invoice':
      return __('What the supplier charged — quantities billed and their prices');
  }
}

/**
 * The capture bar's own heading.
 *
 * It names the document rather than the category, because the kind is chosen before the bar opens
 * and nothing else on screen would say which one. That matters most for the two that look alike: an
 * acknowledgement and a shipping notice write the same field through the same grid, so a bar reading
 * only "supplier document" would let the wrong provenance be recorded with nothing to notice.
 */
export function supplierDocHeading(kind: SupplierDocKind): string {
  switch (kind) {
    case 'oa':
      return __('Record an order acknowledgement');
    case 'asn':
      return __('Record an advance shipping notice');
    case 'invoice':
      return __('Record an invoice');
  }
}
