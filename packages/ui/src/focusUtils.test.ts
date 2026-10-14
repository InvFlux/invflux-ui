import { describe, expect, it } from 'vitest';
import { containsAcrossShadow } from './focusUtils';

// The ui package runs its tests in a node environment with no DOM, so these are plain objects with
// the two links the helper reads: `parentNode`, and `host` on a shadow root (whose `parentNode` is
// null, as in a browser).
interface FakeNode {
  parentNode: FakeNode | null;
  host?: FakeNode;
}

const el = (parentNode: FakeNode | null = null): FakeNode => ({ parentNode });
const shadowRootOf = (host: FakeNode): FakeNode => ({ parentNode: null, host });
const asNode = (n: FakeNode): Node => n as unknown as Node;

describe('containsAcrossShadow', () => {
  it('answers true for the element itself', () => {
    const a = el();
    expect(containsAcrossShadow(asNode(a), asNode(a))).toBe(true);
  });

  it('finds a descendant in the same tree', () => {
    const root = el();
    const mid = el(root);
    const leaf = el(mid);
    expect(containsAcrossShadow(asNode(root), asNode(leaf))).toBe(true);
  });

  it('finds a node inside the shadow root of the container, which Node.contains cannot', () => {
    // The shape of the portal root: a host element in the document, and the mount element that
    // overlays render into living in the host's own shadow root.
    const host = el(el());
    const mount = el(shadowRootOf(host));
    expect(containsAcrossShadow(asNode(host), asNode(mount))).toBe(true);
  });

  it('climbs through nested shadow roots', () => {
    const outerHost = el(el());
    const innerHost = el(shadowRootOf(outerHost));
    const leaf = el(shadowRootOf(innerHost));
    expect(containsAcrossShadow(asNode(outerHost), asNode(leaf))).toBe(true);
    expect(containsAcrossShadow(asNode(innerHost), asNode(leaf))).toBe(true);
  });

  it('is false for a sibling, so only the host that holds the node is exempted', () => {
    const parent = el();
    const host = el(parent);
    const sibling = el(parent);
    const mount = el(shadowRootOf(host));
    expect(containsAcrossShadow(asNode(sibling), asNode(mount))).toBe(false);
  });

  it('is false in the other direction: a host is not inside its own shadow content', () => {
    const host = el(el());
    const mount = el(shadowRootOf(host));
    expect(containsAcrossShadow(asNode(mount), asNode(host))).toBe(false);
  });

  it('is false for a null node', () => {
    expect(containsAcrossShadow(asNode(el()), null)).toBe(false);
  });
});
