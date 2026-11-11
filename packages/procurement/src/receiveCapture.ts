/**
 * Code capture on the goods-receipt grid: a seam through which a capability teaches a product its
 * barcode from the goods in hand.
 *
 * The base grid's GTIN column is read-only. While a capture handler is registered and enabled, the
 * column becomes the capture cell: a code typed or scanned into it is handed to the handler, which
 * stores it on the line's product and answers with the line's codes as they now are. The grid adds them
 * to the line's match set, so the next scan of that code finds the line; a refused code never joins it.
 * The base registers none, and stores nothing itself.
 */

/** What the grid hands a capture handler: which line, and the code as read. */
export interface ReceiveCaptureContext {
  /** The grid's stable id (`po.receive`). */
  gridId: string;
  poId: number;
  subjectId: number;
  code: string;
}

/** The product that already has a code, as a refusal names it. */
export interface CodeHolderRef {
  subjectId: number;
  name: string;
  sku: string;
}

/** A capture's answer: the line's codes after it, or why it was refused. */
export type ReceiveCaptureResult =
  | { codes: string[]; gtin?: string | null }
  | { refused: string; holder?: CodeHolderRef | null };

export interface ReceiveCaptureHandler {
  /** Identifier for override: re-registering the name replaces the handler. */
  name: string;
  /**
   * Whether capture is available right now, read whenever the grid asks: a bundle loads whenever its
   * plugin is active, which is not whether its license allows the capability, or whether this user
   * may add codes.
   */
  enabled?: () => boolean;
  capture: (ctx: ReceiveCaptureContext) => Promise<ReceiveCaptureResult>;
}

const handlers = new Map<string, ReceiveCaptureHandler>();

/** Register a handler, or replace one of the same name. */
export function registerReceiveCaptureHandler(handler: ReceiveCaptureHandler): void {
  handlers.set(handler.name.toLowerCase(), handler);
}

/** The handler that captures right now: the first enabled one, or undefined when capture is off. */
export function activeReceiveCapture(): ReceiveCaptureHandler | undefined {
  for (const handler of handlers.values()) {
    if (!handler.enabled || handler.enabled()) return handler;
  }

  return undefined;
}

/** Whether a capture answer refused the code. */
export function isRefusal(
  result: ReceiveCaptureResult,
): result is { refused: string; holder?: CodeHolderRef | null } {
  return 'refused' in result;
}
