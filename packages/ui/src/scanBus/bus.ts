import { scanKind } from './kinds';

/**
 * The scan bus: where a scan goes.
 *
 * Scanners feed it (a wedge through {@link installWedge}, a paired phone through {@link ScanBus.deliver})
 * and the places that can take a code register with it. Registration says "this can take a code", for
 * as long as the registrant is mounted; focus, read when a scan arrives, decides which one takes it:
 *
 * 1. the registered target that is, or contains, the focused element;
 * 2. otherwise the screen's scan loop, the last one registered;
 * 3. otherwise nothing, which the caller reports as "nothing listening".
 *
 * A focused registered field comes first because focus there is intent. A target that refuses a code
 * refuses it: the scan never falls through to the loop.
 *
 * This module is pure routing. It does not read the DOM itself (the caller passes the focused element
 * and a containment test), so it runs and tests without a browser.
 */

/** Where a scan came from. */
export type ScanSource = 'wedge' | 'camera';

/** One scan: a whole code, already read through the right layout. */
export interface Scan {
  code: string;
  source: ScanSource;
}

/** What happened to a scan. */
export type ScanOutcome =
  { status: 'accepted' } | { status: 'refused'; message: string } | { status: 'unrouted' };

/** What a target or loop answers: nothing (accepted), or a refusal of its own ("Not in this order"). */
export type ScanReply = void | { refused: string };

/**
 * A receiver's answer, now or once it has asked the server: a code the screen does not know may be one
 * added since it loaded. The outcome is reported when the answer arrives, so a listener (a sound, the
 * phone's reply) hears what became of the scan, never a provisional "accepted".
 */
export type ScanAnswer = ScanReply | Promise<ScanReply>;

/** What a receiver is told about the scan besides its code. */
export interface ScanContext {
  /** The element holding focus when the scan arrived, if any. */
  focused: Element | null;
}

interface Receiver {
  /** The kind of code accepted (see `kinds.ts`); `any` when omitted. */
  kind?: string;
  /** The codes this receiver expects, when it knows them. A source may believe these sooner. */
  matchSet?: () => readonly string[];
  /** Whether the receiver takes scans right now (an entitlement, a mode). Absent → always. */
  enabled?: () => boolean;
  onScan: (scan: Scan, ctx: ScanContext) => ScanAnswer;
}

/** A field, or a widget such as a grid, that can take a code while it, or something inside it, has focus. */
export interface ScanTarget extends Receiver {
  /** The registrant's root element. */
  element: () => Element | null | undefined;
  /**
   * Whether the focused element, inside {@link element}, takes codes. A grid registers once and answers
   * per scan whether its active cell's column takes codes. Absent → every focused descendant does.
   */
  accepts?: (focused: Element) => boolean;
}

/** A screen's scan loop: takes the scans no focused field took. */
export type ScanLoop = Receiver;

/** Where a scan would go right now, as {@link ScanBus.route} finds it. */
export type ScanRoute =
  { to: 'target'; target: ScanTarget } | { to: 'loop'; loop: ScanLoop } | { to: 'none' };

export type Contains = (container: Node, node: Node) => boolean;

export class ScanBus {
  private readonly targets: ScanTarget[] = [];
  private readonly loops: ScanLoop[] = [];
  private readonly listeners = new Set<(scan: Scan, outcome: ScanOutcome) => void>();
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly contains: Contains) {}

  /** Register a target; the returned function unregisters it. */
  registerTarget(target: ScanTarget): () => void {
    return this.add(this.targets, target);
  }

  /** Register a loop; the last one registered and enabled takes the scans. The returned function unregisters it. */
  registerLoop(loop: ScanLoop): () => void {
    return this.add(this.loops, loop);
  }

  /** Be told the outcome of every scan (sounds, a toast, the phone's answer). */
  onOutcome(listener: (scan: Scan, outcome: ScanOutcome) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Be told when a registration comes or goes, to recompute readiness. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** The registered target holding the focused element, innermost first, or undefined. */
  targetFor(focused: Element | null): ScanTarget | undefined {
    if (null === focused) return undefined;
    const holding = this.targets.filter((t) => {
      const root = t.element();
      return (
        null != root &&
        this.contains(root, focused) &&
        isEnabled(t) &&
        (t.accepts?.(focused) ?? true)
      );
    });
    // Innermost: the one whose root lies inside every other candidate's. A field inside a registered
    // grid is the field's business, not the grid's.
    return (
      holding.find((t) =>
        holding.every((o) => o === t || this.contains(o.element()!, t.element()!)),
      ) ?? holding[holding.length - 1]
    );
  }

  /** The screen's loop: the last one registered and enabled. */
  activeLoop(): ScanLoop | undefined {
    for (let i = this.loops.length - 1; i >= 0; i -= 1) {
      if (isEnabled(this.loops[i]!)) return this.loops[i];
    }
    return undefined;
  }

  /** Where a scan would go with this element focused. */
  route(focused: Element | null): ScanRoute {
    const target = this.targetFor(focused);
    if (undefined !== target) return { to: 'target', target };
    const loop = this.activeLoop();
    return undefined !== loop ? { to: 'loop', loop } : { to: 'none' };
  }

  /**
   * Deliver a scan along {@link route}, check its kind, and report the outcome to every listener.
   *
   * Pass a route already computed when the caller needed it first (the wedge decides on it whether to
   * swallow the scanner's Enter); otherwise it is computed here.
   *
   * A receiver that answers later (see {@link ScanAnswer}) makes this a promise of the outcome, and the
   * listeners are told when it settles. One that fails outright is a refusal with nothing to say: the
   * receiver reports its own failures, and a second message would only repeat it.
   */
  deliver(
    scan: Scan,
    focused: Element | null,
    route: ScanRoute = this.route(focused),
  ): ScanOutcome | Promise<ScanOutcome> {
    const receiver =
      'target' === route.to ? route.target : 'loop' === route.to ? route.loop : undefined;
    if (undefined === receiver) return this.report(scan, { status: 'unrouted' });
    const kind = scanKind(receiver.kind ?? 'any');
    if (undefined !== kind && !kind.test(scan.code))
      return this.report(scan, { status: 'refused', message: kind.refusal() });
    const answer = receiver.onScan(scan, { focused });
    if (answer instanceof Promise) {
      return answer.then(
        (reply) => this.report(scan, asOutcome(reply)),
        () => this.report(scan, { status: 'refused', message: '' }),
      );
    }

    return this.report(scan, asOutcome(answer));
  }

  private report(scan: Scan, outcome: ScanOutcome): ScanOutcome {
    for (const listener of this.listeners) listener(scan, outcome);

    return outcome;
  }

  private add<T>(list: T[], item: T): () => void {
    list.push(item);
    this.changed();
    return () => {
      const at = list.indexOf(item);
      if (at >= 0) {
        list.splice(at, 1);
        this.changed();
      }
    };
  }

  private changed(): void {
    for (const listener of this.changeListeners) listener();
  }
}

function asOutcome(reply: ScanReply): ScanOutcome {
  return reply ? { status: 'refused', message: reply.refused } : { status: 'accepted' };
}

function isEnabled(r: Receiver): boolean {
  return r.enabled?.() ?? true;
}
