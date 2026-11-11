import { describe, expect, it } from 'vitest';
import { draggedWidth, fittedWidth, MIN_PICTURE_WIDTH } from './pictureResize';

const start = { width: 300, height: 200 }; // 3:2

describe('draggedWidth', () => {
  it('moves both sides from a side handle, so the width changes by twice the travel', () => {
    expect(draggedWidth('right', start, 10, 0)).toBe(320);
    expect(draggedWidth('left', start, -10, 0)).toBe(320);
    expect(draggedWidth('left', start, 10, 0)).toBe(280);
  });

  it('ignores vertical travel on a side handle and horizontal travel on the bottom', () => {
    expect(draggedWidth('right', start, 0, 50)).toBe(300);
    expect(draggedWidth('bottom', start, 50, 0)).toBe(300);
  });

  it('sets the height from the bottom handle and keeps the proportions', () => {
    expect(draggedWidth('bottom', start, 0, 20)).toBe(330); // 220 high at 3:2
  });

  it('follows the larger of the two moves on a corner', () => {
    expect(draggedWidth('bottom-right', start, 30, 5)).toBe(360); // side: +60, bottom: +7.5
    expect(draggedWidth('bottom-right', start, 2, 40)).toBe(360); // side: +4, bottom: +60
    expect(draggedWidth('bottom-left', start, -30, 0)).toBe(360);
  });
});

describe('fittedWidth', () => {
  it('draws the width asked for when it fits, and what fits when it does not', () => {
    expect(fittedWidth(320, 800)).toBe(320);
    expect(fittedWidth(1200, 800)).toBe(800);
  });

  it('never draws narrower than the minimum, even where less would fit', () => {
    expect(fittedWidth(40, 800)).toBe(MIN_PICTURE_WIDTH);
    expect(fittedWidth(320, 80)).toBe(MIN_PICTURE_WIDTH);
  });
});
