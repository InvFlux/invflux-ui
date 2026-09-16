import { createInvFluxApi, ns } from '@invflux/ui/api';
import type { AppContext } from '../../types';

/** The whole first-run screen's server state, from one read (`GET governance/onboarding`). */
export interface OnboardingStatus {
  /** Whether the adopt offer is still outstanding (the autoloaded post-install flag). */
  pending: boolean;
  /** Products WooCommerce manages that InvFlux does **not** govern yet — what is left to adopt. */
  adoptable: number;
  /**
   * Products WooCommerce manages, governed or not. Adoption never clears `_manage_stock`, so this
   * does not shrink as you adopt; it exists to separate "nothing to hand over" from "already all
   * handed over", which are both `adoptable === 0`.
   */
  managed: number;
  /** Whether High-Performance Order Storage is the authoritative order store. */
  hpos_enabled: boolean;
  /** Deep link to WooCommerce → Settings → Advanced → Features, where HPOS is turned on. */
  hpos_settings_url: string;
  /**
   * Settings whose current value is the host's rather than this merchant's, or one InvFlux has a
   * specific objection to. Counted, not listed — the screen sends the merchant to the filtered
   * settings page, which is the only surface that can drive it to zero.
   */
  settings_needing_decision: number;
}

/** One chunk of the keyset-paged adoption (`POST governance/adopt-all`). */
export interface AdoptChunk {
  processed: number;
  last_id: number;
  remaining: number;
  done: boolean;
}

export interface WelcomeApi {
  status(): Promise<OnboardingStatus>;
  adoptChunk(afterId: number, limit: number): Promise<AdoptChunk>;
  dismiss(): Promise<void>;
}

/**
 * Client for the three onboarding routes, over the shared transport — which owns URL construction
 * for both `apiRoot` forms, abort, timeout, retry and the parse-before-`ok` error handling this
 * used to do by hand (and, on the read path, not at all: it threw the status away with the body).
 */
export function createWelcomeApi(context: Pick<AppContext, 'apiRoot' | 'nonce'>): WelcomeApi {
  const api = createInvFluxApi(context);

  return {
    status: () => api.get<OnboardingStatus>(ns('/governance/onboarding')),
    // Not retried: each chunk advances a cursor server-side, so replaying one after a dropped
    // connection would re-walk products the previous attempt may already have adopted.
    adoptChunk: (afterId, limit) =>
      api.post<AdoptChunk>(ns('/governance/adopt-all'), { after_id: afterId, limit }),
    dismiss: async () => {
      await api.post<{ dismissed: boolean }>(ns('/governance/adopt-dismiss'), {});
    },
  };
}
