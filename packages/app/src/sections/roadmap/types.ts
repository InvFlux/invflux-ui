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
}

export interface VoteResponse {
  item_id: number;
  voted: boolean;
  votes: number[];
}
