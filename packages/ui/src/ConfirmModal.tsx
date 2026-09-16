import { __ } from '@invflux/i18n';
import { onMount, type JSX } from 'solid-js';
import { Button, type ButtonVariant } from './Button';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';

export type ConfirmModalVariant = 'default' | 'warning' | 'danger';

export interface ConfirmModalProps {
  /** Heading rendered at the top of the dialog. */
  title: string;
  /** Body. Can be a string or arbitrary JSX (for inline emphasis, counts, etc.). */
  message: JSX.Element;
  /** Confirm-button label. */
  confirmLabel: string;
  /** Cancel-button label. Default "Cancel". */
  cancelLabel?: string;
  /** Visual variant — drives the confirm button colour. Default `default`. */
  variant?: ConfirmModalVariant;
  /** Confirm handler. */
  onConfirm: () => void;
  /** Cancel handler — fires on backdrop click, Escape, and Cancel button. */
  onCancel: () => void;
  /**
   * Focus the confirm button on mount, so a single Enter confirms (a focused `<button>` fires its
   * click on Enter natively) and Esc still cancels. Opt-in: use it where confirming is the expected,
   * low-risk outcome (e.g. "all received — close this PO?"). Leave it off for consequential gates —
   * the dialog then focuses the cancel/dismiss button by default, so a stray Enter dismisses (the
   * safe choice) and confirming takes a deliberate Tab→Enter or Ctrl/Cmd+Enter.
   */
  autoFocusConfirm?: boolean;
}

/**
 * Generic two-button confirm dialog. Built on the shared `Modal` primitive — focus
 * trap, Esc-to-close, backdrop click, Ctrl/Cmd+Enter to confirm. Use for any
 * binary "are you sure?" gate where the action is consequential enough to deserve
 * an interrupt but lightweight enough to not need a custom modal layout
 * (`CorrectionReviewModal`, the future `BulkApplyModal`, etc.).
 *
 * Tonally the variants stack:
 *  - `default` — neutral confirm (primary button)
 *  - `warning` — amber confirm (heads-up: you're about to do something with
 *    consequences but no data loss; e.g. re-enable that triggers reconciliation)
 *  - `danger`  — red confirm (data-loss or hard-to-reverse; e.g. disabling stock
 *    tracking on a subject with ledger history)
 */
export function ConfirmModal(props: ConfirmModalProps): JSX.Element {
  const variant = (): ConfirmModalVariant => props.variant ?? 'default';
  let confirmRef: HTMLButtonElement | undefined;
  let cancelRef: HTMLButtonElement | undefined;
  onMount(() => {
    // Safe default: focus the dismiss button so a stray Enter cancels. Opt into confirm-focus only
    // for low-risk gates. Both buttons carry `eagerFocusRing` because THIS focus is programmatic:
    // `:focus-visible` would not match it after a mouse click, leaving the user no idea where focus
    // landed in a dialog whose whole point is that Enter does something.
    if (props.autoFocusConfirm) confirmRef?.focus();
    else cancelRef?.focus();
  });

  /** This dialog's variant vocabulary is a subset of the Button's, so it maps straight across. */
  const confirmVariant = (): ButtonVariant => {
    switch (variant()) {
      case 'danger':
        return 'danger';
      case 'warning':
        return 'warning';
      default:
        return 'primary';
    }
  };

  return (
    <Modal onClose={props.onCancel} closeOnBackdrop={false} label={props.title}>
      <ModalPanel
        size="md"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            props.onConfirm();
          }
        }}
      >
        <ModalHeader title={props.title} />

        <div class="p-4 text-sm text-text">{props.message}</div>

        <ModalFooter>
          <Button ref={cancelRef} variant="secondary" eagerFocusRing onClick={props.onCancel}>
            {props.cancelLabel ?? __('Cancel')}
          </Button>
          <Button
            ref={confirmRef}
            variant={confirmVariant()}
            eagerFocusRing
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
