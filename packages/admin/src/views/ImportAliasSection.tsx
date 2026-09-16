import { createEffect, createSignal, For, type JSX, Show } from 'solid-js';
import { createQuery, useQueryClient } from '@tanstack/solid-query';
import { __ } from '@invflux/i18n';
import {
  Button,
  fetchImportAliases,
  parseAliasCsv,
  saveImportAliases,
  serializeAliases,
  toast,
  type ImportAliasMap,
} from '@invflux/ui';
import type { AdminContext } from '../types';

export const IMPORT_ALIASES_QUERY_KEY = ['invflux-import-aliases'] as const;

/** Friendly labels for the known import concepts; unknown keys fall back to the raw concept id. */
const conceptLabel = (concept: string): string => {
  const labels: Record<string, string> = {
    sku: __('SKU'),
    supplier_sku: __('Supplier SKU'),
    gtin: __('Barcode (GTIN/EAN)'),
    qty: __('Quantity'),
    cost: __('Unit cost / price'),
    expected: __('Expected (supplier document)'),
  };

  return labels[concept] ?? concept;
};

/**
 * Settings-page management surface for merchant-taught ImportWizard header aliases. The primary way
 * aliases are captured is "Remember" inside the import wizard (learn-on-map); this panel lists what's
 * been learned, one **comma-separated field per concept**, and lets a settings-manager prune / add /
 * paste entries. On save each field is parsed (split on comma/semicolon), normalized + de-duplicated,
 * and the whole map is written back.
 *
 * Built-in aliases (shipped in the JS bundle) are intentionally NOT shown — this is only the custom,
 * server-stored set. Self-contained: its own load + save (PUT), independent of the settings catalog's
 * global save bar.
 */
export function ImportAliasSection(props: { context: AdminContext }): JSX.Element {
  const queryClient = useQueryClient();
  const query = createQuery(() => ({
    queryKey: IMPORT_ALIASES_QUERY_KEY,
    queryFn: () => fetchImportAliases(props.context),
  }));

  // One editable CSV text per concept. Kept as raw text while editing (smooth typing); parsed/normalized
  // only on save so a comma-in-progress isn't reformatted under the cursor.
  const [texts, setTexts] = createSignal<Record<string, string>>({});
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const textsFrom = (map: ImportAliasMap): Record<string, string> => {
    const t: Record<string, string> = {};
    for (const [concept, list] of Object.entries(map)) t[concept] = serializeAliases(list);
    return t;
  };

  // Sync from the server whenever it (re)loads, unless the user has unsaved edits.
  createEffect(() => {
    const data = query.data;
    if (data && !dirty()) setTexts(textsFrom(data));
  });

  const concepts = (): string[] =>
    Object.keys(texts()).sort((a, b) => conceptLabel(a).localeCompare(conceptLabel(b)));

  const setText = (concept: string, value: string): void => {
    setTexts((prev) => ({ ...prev, [concept]: value }));
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const map: ImportAliasMap = {};
      for (const [concept, text] of Object.entries(texts())) {
        const list = parseAliasCsv(text);
        if (list.length > 0) map[concept] = list; // an emptied field drops the concept
      }
      const saved = await saveImportAliases(props.context, map);
      queryClient.setQueryData(IMPORT_ALIASES_QUERY_KEY, saved);
      setTexts(textsFrom(saved));
      setDirty(false);
      toast.success(__('Import aliases saved.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : __('Could not save import aliases.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Show
        when={concepts().length > 0}
        fallback={
          <p class="text-sm text-text-muted">
            {__(
              'No custom aliases yet. Use “Remember” while mapping a column during an import to teach one.',
            )}
          </p>
        }
      >
        <p class="mb-3 text-xs text-text-muted">
          {__('One line per column. Separate alternate header names with commas.')}
        </p>
        <div class="space-y-2">
          <For each={concepts()}>
            {(concept) => (
              <div class="flex items-start gap-3">
                <label class="w-44 shrink-0 pt-1.5 text-sm font-medium text-text">
                  {conceptLabel(concept)}
                </label>
                <input
                  type="text"
                  class="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  placeholder={__('e.g. confirmed qty, oa qty')}
                  value={texts()[concept] ?? ''}
                  onInput={(e) => setText(concept, e.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-4 flex items-center gap-3">
        <Button disabled={!dirty() || saving()} onClick={() => void save()}>
          {saving() ? __('Saving…') : __('Save aliases')}
        </Button>
        <Show when={dirty()}>
          <span class="text-xs text-text-muted">{__('Unsaved changes')}</span>
        </Show>
      </div>
    </div>
  );
}
