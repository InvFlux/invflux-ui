import { describe, expect, it } from 'vitest';
import { assertShape } from './assertShape';

interface Row {
  id: number;
  name: string;
  wac: string | null;
}

describe('assertShape', () => {
  it('returns the value unchanged when every required key is present', () => {
    const body: unknown = { id: 1, name: 'Widget', wac: '12.5000' };
    expect(assertShape<Row>(body, ['id', 'name', 'wac'], 'GET /rows')).toBe(body);
  });

  it('accepts a present key holding null — nullable is a contract, absent is drift', () => {
    const body: unknown = { id: 1, name: 'Widget', wac: null };
    expect(() => assertShape<Row>(body, ['id', 'name', 'wac'], 'GET /rows')).not.toThrow();
  });

  it('names every missing key, so one round-trip diagnoses the whole drift', () => {
    const body: unknown = { id: 1 };
    expect(() => assertShape<Row>(body, ['id', 'name', 'wac'], 'GET /rows')).toThrow(
      /missing `name`, `wac`/,
    );
  });

  it('names the endpoint, so the failure points at a shaper rather than a component', () => {
    expect(() => assertShape<Row>({}, ['id'], 'GET /purchase-orders/:id')).toThrow(
      /GET \/purchase-orders\/:id/,
    );
  });

  it('rejects null rather than letting it through as an object', () => {
    expect(() => assertShape<Row>(null, ['id'], 'GET /rows')).toThrow(/received null/);
  });

  it('rejects a non-object body', () => {
    expect(() => assertShape<Row>('not json', ['id'], 'GET /rows')).toThrow(/received string/);
  });
});
