/**
 * A development-only shape check for values crossing the REST boundary.
 *
 * Every client parses a response with `(await res.json()) as T` — a cast the compiler accepts
 * unconditionally, because the server's actual shape is not knowable from TypeScript. The types are
 * hand-mirrored from PHP shapers with no codegen between them, so when a field is renamed or
 * becomes nullable server-side, nothing fails at the boundary: the value arrives as `undefined`
 * somewhere deep in a component, and the symptom is a blank cell rather than an error.
 *
 * This does not fix that — it makes it *loud in development*. The check is wrapped in
 * `import.meta.env.DEV`, so a production build eliminates the whole branch as dead code and ships
 * the bare cast it already had. Zero production bytes, zero production cost.
 *
 * It deliberately checks only **key presence**, not types. Presence is what actually drifts (a
 * rename, a dropped field, a branch that omits a key), it is cheap, and it needs no schema to be
 * kept in sync — which matters, because a second hand-maintained copy of the contract is the
 * problem, not the solution.
 *
 * ```ts
 * const body = assertShape<PoDetail>(await res.json(), ['id', 'status', 'lines'], 'GET /purchase-orders/:id');
 * ```
 *
 * Note `null` is rejected outright but a *present* key holding `null` passes: a nullable field is a
 * contract, an absent one is drift.
 */
export function assertShape<T>(
  value: unknown,
  required: readonly (keyof T & string)[],
  where: string,
): T {
  if (import.meta.env.DEV) {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError(
        `${where}: expected an object from the server, received ${value === null ? 'null' : typeof value}.`,
      );
    }
    const missing = required.filter((key) => !(key in value));
    if (missing.length > 0) {
      throw new TypeError(
        `${where}: server response is missing ${missing.map((k) => `\`${k}\``).join(', ')}. ` +
          'The PHP shaper and the TypeScript type have drifted — fix the type or the shaper, ' +
          'not this call site.',
      );
    }
  }
  return value as T;
}
