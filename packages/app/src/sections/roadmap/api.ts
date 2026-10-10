import { ApiError as BaseApiError, createInvFluxApi, ns } from '@invflux/ui/api';
import type { AppContext } from '../../types';
import type { RoadmapResponse, VoteResponse } from './types';

/** Nonce-authenticated client for the roadmap proxy (`invflux/v1/account/roadmap*`). */
export interface RoadmapApi {
  /**
   * The board, with this account's own votes marked when the site holds an activation.
   *
   * An unregistered site gets the same items with every `voted` false — the roadmap is public, so
   * reading it is not something registering buys.
   */
  getRoadmap(): Promise<RoadmapResponse>;
  /**
   * Cast or withdraw one vote.
   *
   * Rejects with `not_registered` on a site that has never registered: the vote is recorded against
   * an account, and there is nothing to record it against.
   */
  vote(itemId: number, voted: boolean): Promise<VoteResponse>;
}

export function createRoadmapApi(context: AppContext): RoadmapApi {
  const api = createInvFluxApi(context);

  return {
    getRoadmap: () => api.get<RoadmapResponse>(ns('/account/roadmap')),
    vote: (itemId, voted) =>
      api.post<VoteResponse>(ns('/account/roadmap/vote'), { item_id: itemId, voted }),
  };
}

/** Whether a rejection is WordPress telling us IT could not reach the licensing service. */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof BaseApiError &&
    (error.status === 503 ||
      (typeof error.body === 'object' &&
        error.body !== null &&
        (error.body as { error?: string }).error === 'service_unavailable'))
  );
}

/** Whether a rejection is "this site has no account to attach a vote to". */
export function isNotRegistered(error: unknown): boolean {
  return (
    error instanceof BaseApiError &&
    typeof error.body === 'object' &&
    error.body !== null &&
    (error.body as { error?: string }).error === 'not_registered'
  );
}
