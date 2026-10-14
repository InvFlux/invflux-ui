import { _x } from '@invflux/i18n';
import type { RoadmapStatus } from './types';

/**
 * How a roadmap status is shown: its label and its pill.
 *
 * Extracted from the pill component for the reason the rest of this app extracts such things — the
 * decisions are pure, and a pure function can be asserted without a renderer. The pairing is what
 * matters: a status whose word says one thing while its colour says another is worse than either
 * alone, so both live here and change together.
 */

/**
 * The translated word for a status.
 *
 * Every label carries a context, because each is one or two English words that mean something else
 * elsewhere in the product — "Shipped" is a parcel in the dispatch surface, "Vote" is a verb here
 * and a noun in plenty of other software. A bare msgid would hand a translator no way to tell which
 * is meant, and gettext would merge the two uses into one translation.
 *
 * An unknown status returns its raw value on purpose. The licensing service may serve a status this
 * build has never heard of, and an untranslated word in a neutral pill is survivable where a blank
 * or a thrown error is not.
 */
export function statusLabel(status: RoadmapStatus): string {
  switch (status) {
    case 'shipped':
      return _x('Shipped', 'roadmap item status: a merchant can have it today');
    case 'in_progress':
      return _x(
        'In progress',
        'roadmap item status: being built, or built and not yet purchasable',
      );
    case 'planned':
      return _x('Planned', 'roadmap item status: designed and intended, not started');
    case 'considering':
      return _x(
        'Considering',
        'roadmap item status: we are asking whether this is wanted; nothing is committed',
      );
    default:
      return status;
  }
}

/**
 * The pill's classes for a status.
 *
 * `considering` must not borrow `planned`'s pill. The two differ precisely in whether anything has
 * been promised, and that is the distinction a merchant reads off the colour before reading the
 * word — so a question is outlined and a commitment is filled. An unknown status falls to the same
 * neutral fill as `planned`, which is the honest default for a word we cannot interpret.
 */
export function statusPillClass(status: RoadmapStatus): string {
  switch (status) {
    case 'shipped':
      return 'bg-green-100 text-green-800';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800';
    case 'considering':
      return 'border border-dashed border-slate-400 text-slate-600';
    default:
      return 'bg-slate-200 text-slate-700';
  }
}
