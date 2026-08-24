import { describe, expect, it } from 'vitest';
import { nextStage } from './cycle';

describe('nextStage — primary action (click / scan)', () => {
  it('"" → M (stage for shipping)', () => expect(nextStage('', 'primary')).toBe('M'));
  it('M → "" (unstage)', ()          => expect(nextStage('M', 'primary')).toBe(''));
  it('W → M (recover from put-aside)', () => expect(nextStage('W', 'primary')).toBe('M'));
  it('E → "" (unstage error-flagged line)', () => expect(nextStage('E', 'primary')).toBe(''));
});

describe('nextStage — alternate action (Ctrl+click)', () => {
  it('"" → W (put aside)', ()   => expect(nextStage('', 'alternate')).toBe('W'));
  it('W → M (resolve put-aside → staged)', () => expect(nextStage('W', 'alternate')).toBe('M'));
  it('M → W (move back to put-aside)', ()     => expect(nextStage('M', 'alternate')).toBe('W'));
});

describe('nextStage — no-op cases', () => {
  it('E with alternate action stays E (not part of normal cycle)', () => {
    expect(nextStage('E', 'alternate')).toBe('E');
  });
});
