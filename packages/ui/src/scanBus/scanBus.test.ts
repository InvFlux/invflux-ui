import { describe, expect, it, vi } from 'vitest';
import { ScanBus, type Scan } from './bus';
import { gtinKey, isValidGtin } from './kinds';
import { installWedge } from './wedge';

/** A stand-in element: just enough for routing (a parent chain) and for the wedge (tag, value). */
interface FakeEl {
  tagName: string;
  parent: FakeEl | null;
  value?: string;
  readOnly?: boolean;
  type?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setSelectionRange?: (a: number, b: number) => void;
  dispatchEvent?: (e: Event) => boolean;
}

const el = (
  tagName: string,
  parent: FakeEl | null = null,
  extra: Partial<FakeEl> = {},
): FakeEl => ({
  tagName,
  parent,
  ...extra,
});

const contains = (container: Node, node: Node): boolean => {
  for (let n = node as unknown as FakeEl | null; null !== n; n = n.parent)
    if (n === (container as unknown)) return true;
  return false;
};

const asEl = (e: FakeEl | null): Element | null => e as unknown as Element | null;

const scan = (code: string): Scan => ({ code, source: 'wedge' });

describe('ScanBus routing', () => {
  it('gives the scan to the focused registered target before the loop', () => {
    const bus = new ScanBus(contains);
    const root = el('DIV');
    const field = el('INPUT', root);
    const onField = vi.fn();
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    bus.registerTarget({ element: () => asEl(field), onScan: onField });

    expect(bus.deliver(scan('4012824402553'), asEl(field))).toEqual({ status: 'accepted' });
    expect(onField).toHaveBeenCalledOnce();
    expect(onLoop).not.toHaveBeenCalled();
  });

  it('falls to the loop when the focus is in no registered target', () => {
    const bus = new ScanBus(contains);
    const onLoop = vi.fn();
    bus.registerTarget({ element: () => asEl(el('INPUT')), onScan: vi.fn() });
    bus.registerLoop({ onScan: onLoop });

    void bus.deliver(scan('ABC-123'), asEl(el('BUTTON')));
    expect(onLoop).toHaveBeenCalledOnce();
  });

  it('reports nothing listening when there is neither', () => {
    expect(new ScanBus(contains).deliver(scan('ABC-123'), null)).toEqual({ status: 'unrouted' });
  });

  it('picks the innermost target: a field inside a registered grid is the field’s', () => {
    const bus = new ScanBus(contains);
    const grid = el('DIV');
    const field = el('INPUT', grid);
    const onGrid = vi.fn();
    const onField = vi.fn();
    bus.registerTarget({ element: () => asEl(field), onScan: onField });
    bus.registerTarget({ element: () => asEl(grid), onScan: onGrid });

    void bus.deliver(scan('ABC-123'), asEl(field));
    expect(onField).toHaveBeenCalledOnce();
    expect(onGrid).not.toHaveBeenCalled();
  });

  it('asks a grid whether the focused cell takes codes', () => {
    const bus = new ScanBus(contains);
    const grid = el('DIV');
    const gtinCell = el('TD', grid);
    const priceCell = el('TD', grid);
    const onGrid = vi.fn();
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    bus.registerTarget({
      element: () => asEl(grid),
      accepts: (f) => f === asEl(gtinCell),
      onScan: onGrid,
    });

    void bus.deliver(scan('ABC-123'), asEl(priceCell));
    expect(onLoop).toHaveBeenCalledOnce();
    void bus.deliver(scan('ABC-123'), asEl(gtinCell));
    expect(onGrid).toHaveBeenCalledOnce();
  });

  it('refuses a code of the wrong kind, and never falls through to the loop', () => {
    const bus = new ScanBus(contains);
    const field = el('INPUT');
    const onField = vi.fn();
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    bus.registerTarget({ element: () => asEl(field), kind: 'gtin', onScan: onField });

    const outcome = bus.deliver(scan('ABC-123'), asEl(field));
    expect(outcome).toMatchObject({ status: 'refused' });
    expect(onField).not.toHaveBeenCalled();
    expect(onLoop).not.toHaveBeenCalled();
  });

  it('passes on a receiver’s own refusal', () => {
    const bus = new ScanBus(contains);
    bus.registerLoop({ onScan: () => ({ refused: 'Not in this order.' }) });

    expect(bus.deliver(scan('ABC-123'), null)).toEqual({
      status: 'refused',
      message: 'Not in this order.',
    });
  });

  it('uses the last loop registered and enabled, and the earlier one again once it unregisters', () => {
    const bus = new ScanBus(contains);
    const page = vi.fn();
    const modal = vi.fn();
    const off = vi.fn();
    bus.registerLoop({ onScan: page });
    const unregister = bus.registerLoop({ onScan: modal });
    bus.registerLoop({ onScan: off, enabled: () => false });

    void bus.deliver(scan('ABC-123'), null);
    expect(modal).toHaveBeenCalledOnce();
    unregister();
    void bus.deliver(scan('ABC-123'), null);
    expect(page).toHaveBeenCalledOnce();
    expect(off).not.toHaveBeenCalled();
  });

  it('reports an answer given later once it arrives, and only then', async () => {
    const bus = new ScanBus(contains);
    const listener = vi.fn();
    bus.onOutcome(listener);
    let answer: (reply: { refused: string } | void) => void = () => undefined;
    bus.registerLoop({ onScan: () => new Promise((resolve) => (answer = resolve)) });

    const outcome = bus.deliver(scan('ABC-123'), null);
    expect(listener).not.toHaveBeenCalled();
    answer({ refused: 'Not in this order.' });

    await expect(outcome).resolves.toEqual({ status: 'refused', message: 'Not in this order.' });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(scan('ABC-123'), {
      status: 'refused',
      message: 'Not in this order.',
    });
  });

  it('reports a later answer that fails as a refusal with nothing more to say', async () => {
    const bus = new ScanBus(contains);
    bus.registerLoop({ onScan: () => Promise.reject(new Error('offline')) });

    await expect(bus.deliver(scan('ABC-123'), null)).resolves.toEqual({
      status: 'refused',
      message: '',
    });
  });

  it('tells every listener the outcome', () => {
    const bus = new ScanBus(contains);
    const listener = vi.fn();
    bus.onOutcome(listener);
    void bus.deliver(scan('ABC-123'), null);
    expect(listener).toHaveBeenCalledWith(scan('ABC-123'), { status: 'unrouted' });
  });
});

describe('GTIN kind', () => {
  it.each(['4012824402553', '9782883530430', '7680545340453', '021245565307', '96385074'])(
    'accepts %s',
    (code) => {
      expect(isValidGtin(code)).toBe(true);
    },
  );

  it.each(['4012824402554', '12345', 'ABC4012824402', '402182440255'])('refuses %s', (code) => {
    expect(isValidGtin(code)).toBe(false);
  });

  it('keys a UPC-A and its 13-digit EAN form alike', () => {
    expect(gtinKey('021245565307')).toBe(gtinKey('0021245565307'));
  });
});

describe('the wedge', () => {
  /** Fire a scanner's burst of keydowns at 10 ms intervals, closed by `terminator` when given. */
  function burst(
    target: EventTarget,
    text: string,
    start: number,
    terminator: string | null = 'Enter',
  ): KeyboardEvent[] {
    const events: KeyboardEvent[] = [];
    const fire = (key: string, code: string, at: number): void => {
      const e = new Event('keydown', { cancelable: true }) as KeyboardEvent;
      Object.assign(e, {
        key,
        code,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
      });
      Object.defineProperty(e, 'timeStamp', { value: at });
      events.push(e);
      target.dispatchEvent(e);
    };
    [...text].forEach((ch, i) =>
      fire(ch, /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`, start + i * 10),
    );
    if (null !== terminator) fire(terminator, terminator, start + text.length * 10);
    return events;
  }

  it('hands a scan to the loop when nothing editable has focus, and stops its Enter', () => {
    const bus = new ScanBus(contains);
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    const target = new EventTarget();
    installWedge(bus, { focused: () => asEl(el('BUTTON')) }, target);

    const events = burst(target, '4012824402553', 1000);
    expect(onLoop).toHaveBeenCalledWith(
      { code: '4012824402553', source: 'wedge' },
      expect.anything(),
    );
    expect(events[events.length - 1]!.defaultPrevented).toBe(true);
  });

  it('leaves a scan typed into an unregistered field alone, Enter included', () => {
    const bus = new ScanBus(contains);
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    const target = new EventTarget();
    const note = el('TEXTAREA', null, { value: '' });
    installWedge(bus, { focused: () => asEl(note) }, target);

    const events = burst(target, '4012824402553', 1000);
    expect(onLoop).not.toHaveBeenCalled();
    expect(events[events.length - 1]!.defaultPrevented).toBe(false);
  });

  it('gives a registered field its value back before handing it the code', () => {
    const bus = new ScanBus(contains);
    const field = el('INPUT', null, { value: 'tea', type: 'text', dispatchEvent: () => true });
    let seen: string | undefined;
    bus.registerTarget({
      element: () => asEl(field),
      onScan: (s) => {
        seen = `${field.value}|${s.code}`;
      },
    });
    const target = new EventTarget();
    installWedge(bus, { focused: () => asEl(field) }, target);

    // The burst's first keydown snapshots "tea"; the characters then "land".
    const first = new Event('keydown', { cancelable: true }) as KeyboardEvent;
    Object.assign(first, { key: '4', code: 'Digit4', shiftKey: false });
    Object.defineProperty(first, 'timeStamp', { value: 1000 });
    target.dispatchEvent(first);
    field.value = 'tea4012824402553';
    burst(target, '012824402553', 1010);

    expect(seen).toBe('tea|4012824402553');
  });

  it('does not take typing for a scan', () => {
    const bus = new ScanBus(contains);
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    const target = new EventTarget();
    installWedge(bus, { focused: () => null }, target);

    const fire = (key: string, at: number): void => {
      const e = new Event('keydown', { cancelable: true }) as KeyboardEvent;
      Object.assign(e, { key, code: `Key${key.toUpperCase()}`, shiftKey: false });
      Object.defineProperty(e, 'timeStamp', { value: at });
      target.dispatchEvent(e);
    };
    ['a', 'b', 'c', 'd', 'e'].forEach((k, i) => fire(k, 1000 + i * 120));
    fire('Enter', 1700);
    expect(onLoop).not.toHaveBeenCalled();
  });

  it('reads an all-digit scan through the US layout on an AZERTY machine', () => {
    const bus = new ScanBus(contains);
    const onLoop = vi.fn();
    bus.registerLoop({ onScan: onLoop });
    const target = new EventTarget();
    installWedge(bus, { focused: () => null }, target);

    // AZERTY: the unshifted digit row types punctuation.
    const azerty = '&é"\'(-è_çà';
    [...'12345'].forEach((d, i) => {
      const e = new Event('keydown', { cancelable: true }) as KeyboardEvent;
      Object.assign(e, { key: azerty[Number(d) - 1], code: `Digit${d}`, shiftKey: false });
      Object.defineProperty(e, 'timeStamp', { value: 1000 + i * 10 });
      target.dispatchEvent(e);
    });
    const enter = new Event('keydown', { cancelable: true }) as KeyboardEvent;
    Object.assign(enter, { key: 'Enter', code: 'Enter', shiftKey: false });
    Object.defineProperty(enter, 'timeStamp', { value: 1050 });
    target.dispatchEvent(enter);

    expect(onLoop).toHaveBeenCalledWith({ code: '12345', source: 'wedge' }, expect.anything());
  });

  it('ends a burst with no terminator on silence', async () => {
    vi.useFakeTimers();
    try {
      const bus = new ScanBus(contains);
      const onLoop = vi.fn();
      bus.registerLoop({ onScan: onLoop });
      const target = new EventTarget();
      installWedge(bus, { focused: () => null }, target);

      burst(target, '4012824402553', 1000, null);
      expect(onLoop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(onLoop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
