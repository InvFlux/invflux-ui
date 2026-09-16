import { __, sprintf } from '@invflux/i18n';
import {
  ArchiveIcon,
  CloseIcon,
  CopyIcon,
  DEFAULT_PRIMARY_WEIGHT,
  DownloadIcon,
  entityActionRegistry,
  type EntityActionContext,
  PackageIcon,
  PrinterIcon,
  SentIcon,
  TagIcon,
  TruckIcon,
  WorkbenchLinkIcon,
} from '@invflux/ui';

/**
 * Core `po.detail` title-bar actions, registered once into the shared entity-action registry.
 * The component supplies a live {@link PoDetailActionContext} each render;
 * these actions are pure (lazy labels, conditions + `run` read the context), so an add-on can
 * contribute more `po.detail` actions through the same seam without touching this file.
 */
export interface PoDetailActionContext extends EntityActionContext {
  /** The PO's stage slug (in_prep/submitted/in_transit/in_reception/…). */
  stage: string;
  /** Filed out of the working lists — orthogonal to {@link stage}, never folded into it. */
  archived: boolean;
  /** A mutation is in flight — mutating actions show disabled to prevent a double-fire. */
  busy: boolean;
  /** Line count — an empty PO cancels without a confirm prompt. */
  lineCount: number;
  /** Lines that would survive being issued (quantity AND price). Zero ⇒ nothing to order. */
  submittableCount: number;
  /** Whether the PO already carries its document number — decides which send-side action headlines. */
  numbered: boolean;
  /** The document number, or null while un-numbered. Shown in the download action's label. */
  number: string | null;
  /** Workbench deep-link for this PO's products, or null when unavailable. */
  workbenchHref: string | null;
  transitionTo: (slug: string) => void;
  /** Open the pre-flight review that assigns the number and downloads the document. */
  openIssue: () => void;
  /** Record that the numbered order went to the supplier (freezes the lines). */
  markSent: () => void;
  exportXlsx: () => void;
  copyToDraft: () => void;
  print: () => void;
  openInWorkbench: () => void;
  beginCancel: () => void;
  beginArchive: () => void;
  /** Put a filed-away order back in the lists. No confirm: it is the undo, not the destructive half. */
  unarchive: () => void;
}

const SCOPE = 'po.detail';
const busyReason = (c: PoDetailActionContext): string | undefined =>
  c.busy ? __('Working…') : undefined;

let registered = false;

/** Idempotent: register the core actions once (safe to import from multiple entry points). */
export function registerPoDetailActions(): void {
  if (registered) return;
  registered = true;
  const reg = entityActionRegistry;
  const core = <const>{ owner: 'core' };

  // ── Utilities (always available) ──────────────────────────────────────────────
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'workbench',
    label: () => __('See products in workbench'),
    icon: WorkbenchLinkIcon,
    order: 100,
    isAvailable: (c) => null !== c.workbenchHref,
    run: (c) => c.openInWorkbench(),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'print',
    label: () => __('Print'),
    icon: PrinterIcon,
    order: 110,
    run: (c) => c.print(),
  });
  // The one action that puts the order file in the operator's hands. It is *also* the headline while
  // the order is numbered-but-unsent, so it bids for the primary slot rather than existing twice: a
  // separate "Export" entry beside a "Download PO-42" headline would be two names for one act.
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'download',
    // Named after the document itself once there is one — that is what the operator is reaching for.
    label: (c) =>
      null === c.number ? __('Download (.xlsx)') : sprintf(__('Download %s'), c.number),
    icon: DownloadIcon,
    group: 'primary',
    order: 120,
    promoteWhen: (c) => ('in_prep' === c.stage && c.numbered ? DEFAULT_PRIMARY_WEIGHT : false),
    disabledReason: busyReason,
    run: (c) => c.exportXlsx(),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'copy-to-draft',
    label: () => __('Copy to new draft'),
    icon: CopyIcon,
    order: 130,
    disabledReason: busyReason,
    run: (c) => c.copyToDraft(),
  });

  // ── Contextual primary (the state-derived headline) ───────────────────────────
  // Each is a `primary` candidate scoped to its own stage via isAvailable, so it headlines in that
  // stage (default weight) and is absent everywhere else — never a stray overflow item.
  // A draft moves out in two steps: first give the order its permanent number and get the document in
  // hand, then — once it has actually been sent — record that. The numbered half's headline is the
  // shared `download` action above, which promotes into this stage rather than duplicating itself.
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'assign-number',
    // Same verb as the plain download it supersedes, because it ends in the same act: the operator
    // gets the file. What is added is the number, so that leads.
    label: () => __('Assign number & download'),
    hint: () =>
      __(
        'Gives this order its permanent purchase order number and downloads it, ready to send to the supplier. The lines stay editable until you mark it as sent.',
      ),
    icon: TagIcon,
    group: 'primary',
    isAvailable: (c) => 'in_prep' === c.stage && !c.numbered,
    // A draft with rows but nothing orderable on them is refused by the server, so it shows disabled
    // and says what is missing — rather than opening a modal whose only outcome is an error.
    disabledReason: (c) =>
      busyReason(c) ??
      (0 === c.submittableCount
        ? __('Add at least one line with both a quantity and a price.')
        : undefined),
    run: (c) => c.openIssue(),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'mark-sent',
    // Records that the order went out; it does not transmit anything. The operator sends the PO
    // themselves (the download above is the hand-off), so the label promises only the bookkeeping
    // and the hint says outright who does the sending — the icon alone reads as "transmitting".
    label: () => __('Mark as sent'),
    hint: () =>
      __(
        'Records that you sent this order to the supplier, and locks the lines. InvFlux does not send it for you — download the order to get it to them.',
      ),
    icon: SentIcon,
    group: 'primary',
    // Declines the headline: while a PO is numbered-but-unsent the operator's next act is to fetch the
    // document, so the download headlines and this waits at the top of the dropdown (order below the
    // utilities) until they have actually sent it.
    promoteWhen: () => false,
    order: 10,
    isAvailable: (c) => 'in_prep' === c.stage && c.numbered,
    disabledReason: (c) =>
      busyReason(c) ??
      (0 === c.submittableCount
        ? __('Add at least one line with both a quantity and a price.')
        : undefined),
    run: (c) => c.markSent(),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'mark-in-transit',
    label: () => __('Mark in transit'),
    icon: TruckIcon,
    group: 'primary',
    isAvailable: (c) => 'submitted' === c.stage,
    disabledReason: busyReason,
    run: (c) => c.transitionTo('in_transit'),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'start-receiving',
    label: () => __('Start receiving'),
    icon: PackageIcon,
    group: 'primary',
    isAvailable: (c) => 'in_transit' === c.stage,
    disabledReason: busyReason,
    run: (c) => c.transitionTo('in_reception'),
  });

  // ── Destructive / terminal (below a divider) ──────────────────────────────────
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'cancel',
    label: () => __('Cancel PO'),
    icon: CloseIcon,
    group: 'destructive',
    order: 100,
    isAvailable: (c) => ['in_prep', 'submitted', 'in_transit', 'in_reception'].includes(c.stage),
    disabledReason: busyReason,
    run: (c) => (0 === c.lineCount ? c.transitionTo('cancelled') : c.beginCancel()),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'archive',
    label: () => __('Archive'),
    icon: ArchiveIcon,
    group: 'destructive',
    order: 110,
    // Any stage, because filing an order away says nothing about how it turned out — it is not a
    // lifecycle move. Offered only while it is *in* the lists, which is the only time it does
    // anything.
    isAvailable: (c) => !c.archived,
    disabledReason: busyReason,
    run: (c) => c.beginArchive(),
  });
  reg.register<PoDetailActionContext>(SCOPE, {
    ...core,
    id: 'unarchive',
    label: () => __('Put back in the lists'),
    icon: ArchiveIcon,
    group: 'destructive',
    order: 111,
    isAvailable: (c) => c.archived,
    disabledReason: busyReason,
    run: (c) => c.unarchive(),
  });
}
