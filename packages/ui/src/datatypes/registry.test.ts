import { describe, expect, it } from 'vitest';
import { createComponentRegistry, datatypeChain } from './registry';

describe('datatypeChain', () => {
  it('returns the slug alone when there is no variant', () => {
    expect(datatypeChain('number')).toEqual(['number']);
  });

  it('appends the variant-stripped base for `base:variant` slugs', () => {
    expect(datatypeChain('decimal:money')).toEqual(['decimal:money', 'decimal']);
    expect(datatypeChain('term-picker:wc-taxonomy')).toEqual([
      'term-picker:wc-taxonomy',
      'term-picker',
    ]);
  });
});

describe('createComponentRegistry', () => {
  it('resolves the default component for an exact datatype', () => {
    const reg = createComponentRegistry<string>();
    reg.register('number', 'core.number', 'NUM', { default: true });

    expect(reg.resolve('number')).toBe('NUM');
    expect(reg.has('number')).toBe(true);
  });

  it('first registration becomes default implicitly', () => {
    const reg = createComponentRegistry<string>();
    reg.register('text', 'a', 'A');
    reg.register('text', 'b', 'B');

    expect(reg.resolve('text')).toBe('A');
  });

  it('explicit default wins over registration order', () => {
    const reg = createComponentRegistry<string>();
    reg.register('text', 'a', 'A');
    reg.register('text', 'b', 'B', { default: true });

    expect(reg.resolve('text')).toBe('B');
  });

  it('prefers a chosen id when present for the datatype', () => {
    const reg = createComponentRegistry<string>();
    reg.register('text', 'a', 'A', { default: true });
    reg.register('text', 'b', 'B');

    expect(reg.resolve('text', 'b')).toBe('B');
    expect(reg.resolve('text', 'missing')).toBe('A'); // falls back to default
  });

  it('falls back along the parent chain (`decimal:money` → `decimal`)', () => {
    const reg = createComponentRegistry<string>();
    reg.register('decimal', 'core.decimal', 'DEC', { default: true });

    expect(reg.resolve('decimal:money')).toBe('DEC');
    expect(reg.has('decimal:money')).toBe(true);
  });

  it('returns null when nothing matches', () => {
    const reg = createComponentRegistry<string>();
    expect(reg.resolve('unknown')).toBeNull();
    expect(reg.has('unknown')).toBe(false);
  });

  it('list() reports direct registrations with labels + default flag (for the chooser UI)', () => {
    const reg = createComponentRegistry<string>();
    reg.register('color:hex', 'core.default', 'A', { default: true, label: 'Default' });
    reg.register('color:hex', 'demo.swatch', 'B', { label: 'Swatch' });

    expect(reg.list('color:hex')).toEqual([
      { id: 'core.default', label: 'Default', isDefault: true },
      { id: 'demo.swatch', label: 'Swatch', isDefault: false },
    ]);
    // Label defaults to the id; parent-chain registrations are not listed for a child datatype.
    reg.register('number', 'core.number', 'N');
    expect(reg.list('number')).toEqual([
      { id: 'core.number', label: 'core.number', isDefault: true },
    ]);
    expect(reg.list('number:stock')).toEqual([]);
    expect(reg.list('unregistered')).toEqual([]);
  });

  it('dataTypes() enumerates every directly-registered slug', () => {
    const reg = createComponentRegistry<string>();
    reg.register('number', 'a', 'A');
    reg.register('text', 'b', 'B');
    expect(reg.dataTypes().sort()).toEqual(['number', 'text']);
  });
});
