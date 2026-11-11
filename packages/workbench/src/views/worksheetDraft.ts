/**
 * The worksheet edit panel's state, kept apart from its rendering so the rules can be tested: what
 * the merchant has changed, what is wrong with it, and the requests a Save sends.
 *
 * Everything is staged and sent on Save, in an order that lets one save free a name and reuse it:
 * the worksheet's own name and notes, then the removed columns, then the renamed ones, then the new.
 * A request that fails leaves the rest staged, with its error on the row it concerns.
 */

import { __, _x, sprintf } from '@invflux/i18n';
import type { WorkbenchWorksheet, WorksheetColumnDef } from '../types';

/** The longest a worksheet column's name may be, as the server holds it. */
export const MAX_COLUMN_NAME = 100;
/** How many columns a worksheet may have, as the server holds it. */
export const MAX_COLUMNS = 20;

/** The types a column may be given directly, rather than by being made like another column. */
export const PLAIN_TYPES = ['text', 'integer', 'decimal', 'decimal:money'] as const;

export interface DraftColumn {
  /** Stable within the panel, for a row that has no server key yet. */
  localId: string;
  /** The server's column key (`c3`), or null for a column added in this panel. */
  key: string | null;
  columnId: string | null;
  /** As typed. Empty on a column made like another means that column's name ({@link columnName}). */
  name: string;
  /** The name as saved, or null for a new column. */
  savedName: string | null;
  type: string | null;
  like: string | null;
  likeLabel: string | null;
  /** Where the column it is made like takes its values from, shown beside its name, or null. */
  likeOrigin: string | null;
  /** How many lines hold a value in it, as last listed. */
  values: number;
  removed: boolean;
  /** The server's refusal of this row's last request, shown beside its name. */
  serverError: string | null;
}

export interface WorksheetDraft {
  id: number;
  name: string;
  savedName: string;
  description: string;
  savedDescription: string;
  columns: DraftColumn[];
}

let localIds = 0;
const nextLocalId = (): string => `new-${++localIds}`;

export function draftFrom(worksheet: WorkbenchWorksheet): WorksheetDraft {
  return {
    id: worksheet.id,
    name: worksheet.name,
    savedName: worksheet.name,
    description: worksheet.description ?? '',
    savedDescription: worksheet.description ?? '',
    columns: (worksheet.columns ?? []).map((c) => ({
      localId: c.key,
      key: c.key,
      columnId: c.columnId,
      // Named after the column it is made like: shown as inheriting that name.
      name: c.like !== null && c.name === c.likeLabel ? '' : c.name,
      savedName: c.name,
      type: c.type,
      like: c.like,
      likeLabel: c.likeLabel,
      likeOrigin: c.likeOrigin ?? null,
      values: c.values,
      removed: false,
      serverError: null,
    })),
  };
}

/** A new column, staged. `choice` is `type:<dataType>` or `like:<column id>`. */
export function newColumn(
  name: string,
  choice: string,
  likeLabel: string | null,
  likeOrigin: string | null = null,
): DraftColumn {
  const like = choice.startsWith('like:') ? choice.slice(5) : null;
  return {
    localId: nextLocalId(),
    key: null,
    columnId: null,
    name: name.trim(),
    savedName: null,
    type: like === null ? choice.replace(/^type:/, '') : null,
    like,
    likeLabel,
    likeOrigin,
    values: 0,
    removed: false,
    serverError: null,
  };
}

/**
 * The name a column is saved under: as typed, or, left empty on a column made like another, that
 * column's name. Empty only on a plain column with no name typed.
 */
export function columnName(column: Pick<DraftColumn, 'name' | 'like' | 'likeLabel'>): string {
  const typed = column.name.trim();
  return typed === '' && column.like !== null ? (column.likeLabel ?? '') : typed;
}

const live = (draft: WorksheetDraft): DraftColumn[] => draft.columns.filter((c) => !c.removed);

/** Whether the panel holds no change: the one case Save is disabled. */
export function isUnchanged(draft: WorksheetDraft): boolean {
  return (
    draft.name.trim() === draft.savedName &&
    draft.description.trim() === draft.savedDescription &&
    draft.columns.every((c) => c.key !== null && !c.removed && columnName(c) === c.savedName)
  );
}

export function worksheetNameError(draft: WorksheetDraft): string | null {
  return draft.name.trim() === '' ? __('Enter a name for the worksheet.') : null;
}

/** What is wrong with a column's name, given the other columns kept; null when nothing is. */
export function columnNameError(draft: WorksheetDraft, column: DraftColumn): string | null {
  if (column.removed) return null;
  const name = columnName(column);
  if (name === '') return __('A column name is required.');
  if (name.length > MAX_COLUMN_NAME) {
    return sprintf(
      /* translators: %d = the longest a worksheet column's name may be, in characters. */
      __('A column name can be at most %d characters long.'),
      MAX_COLUMN_NAME,
    );
  }
  const lower = name.toLowerCase();
  const taken = live(draft).some(
    (other) => other.localId !== column.localId && columnName(other).toLowerCase() === lower,
  );
  return taken ? __('This worksheet already has a column with that name.') : null;
}

/**
 * What is wrong with a name for a column about to be added, given what it holds (`choice`, as for
 * {@link newColumn}); null when nothing is.
 */
export function newColumnNameError(
  draft: WorksheetDraft,
  name: string,
  choice = 'type:text',
  likeLabel: string | null = null,
): string | null {
  return columnNameError(draft, { ...newColumn(name, choice, likeLabel), localId: '' });
}

/** Whether a column could be added: the panel holds fewer than the most a worksheet may have. */
export function canAddColumn(draft: WorksheetDraft): boolean {
  return live(draft).length < MAX_COLUMNS;
}

/** Whether anything in the draft would be refused, so a Save is not sent. */
export function hasErrors(draft: WorksheetDraft): boolean {
  return (
    worksheetNameError(draft) !== null ||
    draft.columns.some((c) => columnNameError(draft, c) !== null)
  );
}

/** The values a Save would delete: those of the saved columns staged for removal. */
export function valuesRemoved(draft: WorksheetDraft): number {
  return draft.columns
    .filter((c) => c.removed && c.key !== null)
    .reduce((sum, c) => sum + c.values, 0);
}

export type SaveRequest =
  | { kind: 'worksheet'; body: { name: string; description: string | null } }
  | { kind: 'remove'; localId: string; key: string }
  | { kind: 'rename'; localId: string; key: string; body: { name: string } }
  | { kind: 'add'; localId: string; body: { name: string; type?: string; like?: string } };

/** The requests a Save sends, in the order it sends them. */
export function saveRequests(draft: WorksheetDraft): SaveRequest[] {
  const out: SaveRequest[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (name !== draft.savedName || description !== draft.savedDescription) {
    out.push({
      kind: 'worksheet',
      body: { name, description: description === '' ? null : description },
    });
  }
  for (const c of draft.columns) {
    if (c.removed && c.key !== null) out.push({ kind: 'remove', localId: c.localId, key: c.key });
  }
  for (const c of draft.columns) {
    if (!c.removed && c.key !== null && columnName(c) !== c.savedName) {
      out.push({ kind: 'rename', localId: c.localId, key: c.key, body: { name: columnName(c) } });
    }
  }
  for (const c of draft.columns) {
    if (!c.removed && c.key === null) {
      out.push({
        kind: 'add',
        localId: c.localId,
        body:
          c.like !== null
            ? { name: columnName(c), like: c.like }
            : { name: columnName(c), type: c.type ?? 'text' },
      });
    }
  }
  return out;
}

/**
 * The draft once a request has succeeded: the worksheet's saved name and notes, a removed column
 * gone, a renamed one's saved name, an added one's key. What it leaves staged is what is still to send.
 */
export function afterSaved(
  draft: WorksheetDraft,
  request: SaveRequest,
  added?: WorksheetColumnDef,
): WorksheetDraft {
  switch (request.kind) {
    case 'worksheet':
      return {
        ...draft,
        savedName: request.body.name,
        savedDescription: request.body.description ?? '',
      };
    case 'remove':
      return { ...draft, columns: draft.columns.filter((c) => c.localId !== request.localId) };
    case 'rename':
      return {
        ...draft,
        columns: draft.columns.map((c) =>
          c.localId === request.localId
            ? { ...c, savedName: request.body.name, serverError: null }
            : c,
        ),
      };
    case 'add':
      return {
        ...draft,
        columns: draft.columns.map((c) =>
          c.localId === request.localId && added !== undefined
            ? {
                ...c,
                key: added.key,
                columnId: added.columnId,
                savedName: added.name,
                likeLabel: added.likeLabel,
                likeOrigin: added.likeOrigin ?? c.likeOrigin,
                serverError: null,
              }
            : c,
        ),
      };
  }
}

/** The draft with a request's refusal recorded on the row it concerns. */
export function afterRefused(
  draft: WorksheetDraft,
  request: SaveRequest,
  message: string,
): WorksheetDraft {
  if (request.kind === 'worksheet') return draft;
  return {
    ...draft,
    columns: draft.columns.map((c) =>
      c.localId === request.localId ? { ...c, serverError: message } : c,
    ),
  };
}

/** How a column says what it holds: its plain type's name, or the column it was made like. */
export function columnKindLabel(column: Pick<DraftColumn, 'type' | 'like' | 'likeLabel'>): string {
  if (column.like !== null) {
    return column.likeLabel === null
      ? __('Like a column that is no longer available')
      : sprintf(
          /* translators: %s = the Workbench column this worksheet column takes its kind of value from, e.g. "Post status". */
          __('Like %s'),
          column.likeLabel,
        );
  }
  return plainTypeLabel(column.type ?? 'text');
}

export function plainTypeLabel(type: string): string {
  // Short words that name other things elsewhere ("Text" as a message, "Money" as a payment), so each
  // carries the context of a kind of value a worksheet column holds.
  switch (type) {
    case 'integer':
    case 'number':
      return _x('Integer', 'a kind of value a worksheet column holds: a whole number');
    case 'decimal':
      return _x(
        'Decimal',
        'a kind of value a worksheet column holds: a number with decimals, not money',
      );
    case 'decimal:money':
      return _x('Money', 'a kind of value a worksheet column holds');
    default:
      return _x('Text', 'a kind of value a worksheet column holds');
  }
}
