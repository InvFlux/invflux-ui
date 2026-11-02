/** Shapes of `GET|POST /invflux/v1/account/roadmap*`, which proxies the licensing service. */

/**
 * `shipped` | `in_progress` | `planned` | `considering` — a word, never a date.
 *
 * `considering` is not a commitment: it marks an area the service is asking about, so that a board
 * can put a question rather than only announce. It must never read as a weaker `planned`, which IS
 * a commitment. The open end of the union is deliberate — the service may serve a status this build
 * has no label for, and that degrades to the raw word rather than to a crash.
 */
export type RoadmapStatus = 'shipped' | 'in_progress' | 'planned' | 'considering' | (string & {});

/**
 * One node of the board: a bundle heading or a feature under one.
 *
 * The server does not distinguish them and neither does this type — a heading is a node with
 * `children`, and both are votable, because "this whole area matters to me" and "this feature
 * matters to me" are different things a merchant may want to say.
 */
export interface RoadmapItem {
  id: number;
  slug: string;
  status: RoadmapStatus;
  /** The product this node is the roadmap for, when it is a bundle that maps to one. */
  sku: string | null;
  title: string;
  body: string | null;
  /** Whether THIS account voted for this node. Never a tally — the server sends no counts. */
  voted: boolean;
  children: RoadmapItem[];
}

export interface RoadmapResponse {
  version: string;
  locale: string;
  items: RoadmapItem[];
  /** Present when the payload is a last-good copy served because the service was unreachable. */
  stale?: boolean;
  /**
   * This account's priority points, absent from a service that predates them. The three fields
   * are three facts, read as sent and never derived from one another: `priority` lists every
   * allocation held, including on rows that have since started or shipped, while `priority_left`
   * counts only the rows that still take points.
   */
  priority?: PriorityAllocation;
  priority_left?: number;
  priority_budget?: number;
}

/**
 * Points per item id, always an object. An early build of the service sent an empty allocation
 * as `[]` (never deployed); `pointsOn()` still accepts both, and also an absent field.
 */
export type PriorityAllocation = Record<string, number> | number[];

/** The answer to setting points on one item: the new allocation, and the account's summary. */
export interface PointsResponse {
  item_id: number;
  points: number;
  priority: PriorityAllocation;
  priority_left: number;
  priority_budget: number;
}

/** Points this account holds on one item, from either encoding of the map. */
export function pointsOn(priority: PriorityAllocation | undefined, itemId: number): number {
  if (undefined === priority || Array.isArray(priority)) return 0;
  return priority[String(itemId)] ?? 0;
}

export interface VoteResponse {
  item_id: number;
  voted: boolean;
  votes: number[];
}
