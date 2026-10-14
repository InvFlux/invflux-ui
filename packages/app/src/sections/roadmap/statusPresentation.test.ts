import { describe, expect, it } from 'vitest';
import { statusLabel, statusPillClass } from './statusPresentation';

/**
 * The board's statuses, and the one pairing that would mislead a merchant if it broke.
 *
 * These assertions read as trivial until you ask what each one is guarding. `considering` is a
 * question the service puts to merchants; `planned` is a commitment. If the two ever present
 * alike, the board silently promises work nobody has agreed to — which is the failure the whole
 * status exists to avoid.
 */
describe('roadmap status presentation', () => {
  it('names every status the service serves', () => {
    // Asserting the English, which is what an untranslated install renders. A translated build
    // substitutes at the call, so a wrong word here is wrong in every locale.
    expect(statusLabel('shipped')).toBe('Shipped');
    expect(statusLabel('in_progress')).toBe('In progress');
    expect(statusLabel('planned')).toBe('Planned');
    expect(statusLabel('considering')).toBe('Considering');
  });

  it('shows an unknown status as its own word rather than nothing', () => {
    // The service can grow a status before this build knows it. The raw word is survivable; a
    // blank pill is a rendering bug a merchant would report, and a throw takes the page down.
    expect(statusLabel('speculative')).toBe('speculative');
    expect(statusPillClass('speculative')).toBe(statusPillClass('planned'));
  });

  it('does not let a question wear a commitment’s pill', () => {
    // The assertion that matters: `considering` promises nothing, `planned` does.
    expect(statusPillClass('considering')).not.toBe(statusPillClass('planned'));
    // And it is the lighter of the two — outlined, not filled.
    expect(statusPillClass('considering')).toContain('border-dashed');
    expect(statusPillClass('considering')).not.toContain('bg-');
  });

  it('keeps every status visually distinct from the others', () => {
    const classes = (['shipped', 'in_progress', 'planned', 'considering'] as const).map(
      statusPillClass,
    );

    // Partitioned from the status list rather than spot-checked, so adding a status that reuses
    // another's pill fails here instead of shipping as a quiet ambiguity.
    expect(new Set(classes).size).toBe(classes.length);
  });
});
