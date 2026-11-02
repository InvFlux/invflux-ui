import { ApiError as BaseApiError, createInvFluxApi, ns } from '@invflux/ui/api';
import type { AppContext } from '../../types';
import type { PointsResponse, RoadmapResponse, VoteResponse } from './types';

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
  /**
   * Set this account's priority points on one item, absolutely; zero takes them back.
   *
   * Rejects with `priority_budget_exceeded` when the account has too few left, and with
   * `priority_not_eligible` for an item that takes no points.
   */
  setPoints(itemId: number, points: number): Promise<PointsResponse>;
}

export function createRoadmapApi(context: AppContext): RoadmapApi {
  const api = createInvFluxApi(context);

  return {
    getRoadmap: () => api.get<RoadmapResponse>(ns('/account/roadmap')),
    vote: (itemId, voted) =>
      api.post<VoteResponse>(ns('/account/roadmap/vote'), { item_id: itemId, voted }),
    setPoints: (itemId, points) =>
      api.post<PointsResponse>(ns('/account/roadmap/points'), { item_id: itemId, points }),
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

/** The service's reason for refusing a points change, if that is what this rejection is. */
export function pointsRefusal(error: unknown): 'priority_budget_exceeded' | 'priority_not_eligible' | null {
  if (!(error instanceof BaseApiError) || typeof error.body !== 'object' || error.body === null) return null;
  const code = (error.body as { error?: string }).error;
  return code === 'priority_budget_exceeded' || code === 'priority_not_eligible' ? code : null;
}

