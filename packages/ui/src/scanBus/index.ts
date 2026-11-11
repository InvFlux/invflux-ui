import { onCleanup, onMount } from 'solid-js';
import { containsAcrossShadow, deepActiveElement } from '../focusUtils';
import { toast } from '../toast';
import { ScanBus, type ScanLoop, type ScanTarget } from './bus';
import { installWedge } from './wedge';

/**
 * The SPA's scan bus, and the two hooks a screen registers with.
 *
 * - {@link useScanTarget}: a field, or a widget such as a grid, that can take a code while it has focus.
 * - {@link useScanLoop}: a screen's loop, taking the scans no focused field took.
 *
 * Both register when the component mounts and unregister when it unmounts; focus is read when a scan
 * arrives. The wedge listener installs on the first registration, never at boot, so a page with nothing
 * that takes scans has nothing listening.
 *
 * A refusal is reported where the operator looks: a toast here, and the phone's own answer once a phone
 * is a source.
 */
export const scanBus = new ScanBus(containsAcrossShadow);

let wedgeInstalled = false;

function ensureWedge(): void {
  if (wedgeInstalled || typeof window === 'undefined') return;
  wedgeInstalled = true;
  installWedge(scanBus, { focused: deepActiveElement });
  scanBus.onOutcome((scan, outcome) => {
    if ('refused' === outcome.status && '' !== outcome.message && 'wedge' === scan.source)
      toast.error(outcome.message);
  });
}

/** Register a scan target for as long as the calling component is mounted. */
export function useScanTarget(target: ScanTarget): void {
  onMount(() => {
    ensureWedge();
    onCleanup(scanBus.registerTarget(target));
  });
}

/** Register a screen's scan loop for as long as the calling component is mounted. */
export function useScanLoop(loop: ScanLoop): void {
  onMount(() => {
    ensureWedge();
    onCleanup(scanBus.registerLoop(loop));
  });
}

export { ScanBus } from './bus';
export type {
  Scan,
  ScanContext,
  ScanLoop,
  ScanAnswer,
  ScanOutcome,
  ScanReply,
  ScanRoute,
  ScanSource,
  ScanTarget,
} from './bus';
export { gtinKey, isValidGtin, registerScanKind, scanKind, type ScanKind } from './kinds';
export { installWedge, isEditable } from './wedge';
export {
  MIN_BURST_CHARS,
  SCANNER_THRESHOLD_MS,
  appendKey,
  isScannerBurst,
  physicalChar,
  readBurst,
  resolveBurst,
  type LayoutMode,
  type RawKey,
} from './keys';
