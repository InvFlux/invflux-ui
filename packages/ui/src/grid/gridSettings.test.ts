import { describe, expect, it } from 'vitest';
import {
  cellDensityTextFor,
  cellWrapClassFor,
  DEFAULT_GRID_SETTINGS,
  headerLookFor,
  type GridSettings,
} from './gridSettings';

const settings = (over: Partial<GridSettings> = {}): GridSettings => ({
  ...DEFAULT_GRID_SETTINGS,
  ...over,
});

describe('cellDensityTextFor', () => {
  it('pairs the row padding with the text size', () => {
    expect(cellDensityTextFor(settings({ density: 'compact', textSize: 'small' }))).toBe(
      'py-1 text-xs',
    );
    expect(cellDensityTextFor(settings({ density: 'large', textSize: 'large' }))).toBe(
      'py-3 text-base',
    );
  });
});

describe('cellWrapClassFor', () => {
  it('follows the grid-wide setting, and a column override wins either way', () => {
    const noWrap = ' whitespace-nowrap [&>*]:truncate';
    expect(cellWrapClassFor(settings({ wrap: 'no-wrap' }), 'a')).toBe(noWrap);
    expect(cellWrapClassFor(settings({ wrap: 'wrap' }), 'a')).toBe('');
    expect(cellWrapClassFor(settings({ wrap: 'wrap', columnWrap: { a: 'no-wrap' } }), 'a')).toBe(
      noWrap,
    );
    expect(cellWrapClassFor(settings({ wrap: 'no-wrap', columnWrap: { a: 'wrap' } }), 'a')).toBe(
      '',
    );
  });
});

describe('headerLookFor', () => {
  it('is the nowrap single-line look at one line', () => {
    const look = headerLookFor(settings({ headerLines: 1 }));
    expect(look.lines).toBe(1);
    expect(look.wrapClass).toBe('whitespace-nowrap');
    expect(look.boundStyle).toBeUndefined();
  });

  it('wraps, steps the text down a size and caps the height above one line', () => {
    const look = headerLookFor(settings({ headerLines: 2, textSize: 'normal' }));
    expect(look.wrapClass).toContain('whitespace-normal');
    expect(look.densityText).toContain('text-xs');
    expect(look.boundStyle).toEqual({ 'max-height': 'calc(2 * 1.25em)' });
  });
});
