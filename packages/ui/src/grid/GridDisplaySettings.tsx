import type { JSX } from 'solid-js';
import { __ } from '@invflux/i18n';
import { IconButton } from '../IconButton';
import { Modal, ModalHeader, ModalPanel } from '../Modal';
import { SegmentedControl } from '../SegmentedControl';
import { MAX_HEADER_LINES, type GridSettings } from './gridSettings';

/** A labeled row of mutually-exclusive choices — the shared control plus its caption. */
function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (value: T) => void;
}): JSX.Element {
  return (
    <div>
      <div class="mb-1 text-sm font-medium text-text">{props.label}</div>
      <SegmentedControl
        ariaLabel={props.label}
        options={props.options}
        value={props.value}
        onChange={(v: T) => props.onSelect(v)}
      />
    </div>
  );
}

/**
 * Grid display settings — density, text wrapping, and text size. Grid-internal + persisted (per the
 * host's `settingsKey`); a sibling to the column manager. Pure presentation, so the host never sees it.
 */
/**
 * The grid display-settings controls (row height / text wrapping / text size). Shared by the
 * standalone {@link GridSettingsModal} (used outside the unified app) and the "Data Grid" section the
 * grid contributes to the app shell's gear popover.
 */
export function GridDisplaySettingsControls(props: {
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
}): JSX.Element {
  const set = <K extends keyof GridSettings>(key: K, value: GridSettings[K]): void =>
    props.onChange({ ...props.settings, [key]: value });

  return (
    <div class="space-y-4">
      <Segmented
        label={__('Row height')}
        value={props.settings.density}
        options={[
          { value: 'compact', label: __('Compact') },
          { value: 'normal', label: __('Normal') },
          { value: 'large', label: __('Large') },
        ]}
        onSelect={(v) => set('density', v)}
      />
      <Segmented
        label={__('Text wrapping')}
        value={props.settings.wrap}
        options={[
          { value: 'no-wrap', label: __('No wrap') },
          { value: 'wrap', label: __('Wrap') },
        ]}
        onSelect={(v) => set('wrap', v)}
      />
      {/* A line budget rather than an on/off, and separate from cell wrapping on purpose. A header
          is a fixed label read once, a cell holds data of unknown length, so wanting one to wrap
          says nothing about wanting the other to — and unlike a cell, a header's height is paid
          once but occupies the top of every screen, which is what the budget bounds. `1` is the
          single-line default; above it the name wraps and is clamped, with an ellipsis. */}
      <Segmented
        label={__('Column name lines')}
        value={String(props.settings.headerLines)}
        options={Array.from({ length: MAX_HEADER_LINES }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
        onSelect={(v) => set('headerLines', Number(v))}
      />
      <Segmented
        label={__('Text size')}
        value={props.settings.textSize}
        options={[
          { value: 'small', label: __('Small') },
          { value: 'normal', label: __('Normal') },
          { value: 'large', label: __('Large') },
        ]}
        onSelect={(v) => set('textSize', v)}
      />
    </div>
  );
}

export function GridSettingsModal(props: {
  settings: GridSettings;
  onChange: (next: GridSettings) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      onClose={props.onClose}
      backdropClass="flex items-start justify-center bg-black/30 p-6 pt-16"
      label={__('Grid display')}
    >
      <ModalPanel size="sm">
        <ModalHeader
          title={__('Grid display')}
          actions={
            <IconButton size="sm" label={__('Close')} onClick={props.onClose}>
              ✕
            </IconButton>
          }
        />
        <div class="p-4">
          <GridDisplaySettingsControls settings={props.settings} onChange={props.onChange} />
        </div>
      </ModalPanel>
    </Modal>
  );
}
