// Side effect: populate the shared datatype registries with the built-in components so every
// SPA that imports @invflux/ui shares them.
//
// These six, plus `Timeline` and `AnnotationTimelineRow` (which register themselves on import), are
// the modules named in this package's `sideEffects` allow-list. That list must stay an allow-list:
// `"sideEffects": false` drops every one of them from the bundle **with no build error**, and the
// symptom is empty registries — datatype cells, filters and settings controls that render nothing.
// A module that registers at load belongs in both places, so find them by their top-level
// `register(…)` call rather than by reading the imports below.
import './datatypes/views';
import './datatypes/codecs';
import './datatypes/editors';
import './datatypes/drilldowns';
import './filters-builtins';
import './settings/controls';
import './settings/presetNumberControl';

export type { StageCode, StockConcerns, DispatchUser, OrderViewer } from './types';
export { StockConcernBits } from './types';
export type {
  FieldMeta,
  GridColumnKind,
  GridColumnMeta,
  TaxonomySpace,
  TaxonomySpaceTaxonomy,
  TaxonomySpaceValue,
} from './types';
export { Combobox } from './Combobox';
export { fuzzyScore, HighlightMatch } from './fuzzy';
export type { FuzzyScore } from './fuzzy';
export { KobalteComboboxFirstFocus } from './KobalteComboboxFirstFocus';
export { SearchSelect } from './SearchSelect';
export type { SearchSelectOption, SearchSelectProps } from './SearchSelect';
export { SearchSelectAsync } from './SearchSelectAsync';
export type { SearchSelectAsyncProps } from './SearchSelectAsync';
export { SearchMultiSelect } from './SearchMultiSelect';
export type { SearchMultiSelectOption, SearchMultiSelectProps } from './SearchMultiSelect';
export {
  PortalCtx,
  keepVisibleDuringModals,
  keepWordPressAnnouncementsAudible,
  usePortalRoot,
  usePortalRootOptional,
} from './portal';
export { HostNavCtx, useHostNav } from './hostNav';
export type { HostNav } from './hostNav';
export { wordpressHostNav } from './host/wordpress';
export { ContextCard, ContextCardPanel } from './ContextCard';
export type { ContextCardProps, ContextCardPanelProps } from './ContextCard';
export { ContextCardBar } from './ContextCardBar';
export type { ContextCardBarProps, ContextCardDescriptor } from './ContextCardBar';
export {
  Timeline,
  EventTime,
  FallbackTimelineRow,
  timelineRowRegistry,
  formatRelative as formatRelativeTime,
  formatWallClock,
  formatEventTime,
  timelineTimeMode,
  toggleTimelineTimeMode,
} from './Timeline';
export type {
  TimelineEvent,
  TimelineRowComponent,
  TimelineRowProps,
  TimelineTimeMode,
} from './Timeline';
export { AnnotationsPanel, TagTogglePicker } from './AnnotationsPanel';
export type { AnnotationsPanelProps, ComposerTag, NoteTagDelta } from './AnnotationsPanel';
// Importing AnnotationTimelineRow also registers it against the `annotation`/`annotation.note`
// timeline slugs (side effect), so interleaved note events render in any SPA's Timeline.
export { AnnotationTimelineRow, TagDeltaPills, TagDeltaChips } from './AnnotationTimelineRow';
export type {
  AnnotationTimelinePayload,
  TagPillResolver,
  TagChipResolver,
} from './AnnotationTimelineRow';
export { diffTokens, isThreadDeleted, latestLiveVersion } from './annotations';
export type {
  AnnotationThread,
  AnnotationVersion,
  AnnotationTagActions,
  DiffMode,
  DiffSegment,
} from './annotations';
export { isTypingTarget } from './keyboard';
export {
  TAG_PALETTE,
  TAG_PALETTE_DISPLAY_ORDER,
  TAG_PALETTE_DISPLAY_COLUMNS,
  TAG_HATCH_IMAGE,
  paletteStyle,
  paletteArchivedStyle,
  paletteInk,
  tagColor,
  tagInk,
  tagArchivedFill,
  contrastRatio,
  relativeLuminance,
  type TagColor,
} from './tagPalette';
export {
  WC_ORDER_STATUS_COLOR,
  WC_ORDER_STATUS_FALLBACK_COLOR,
  DISPATCH_STATUS_COLOR,
  STAGE_COLOR,
  PROCUREMENT_STATUS_COLOR,
  STATUS_FALLBACK_COLOR,
} from './statusPalette';
export { PaletteSwatchPicker } from './PaletteSwatchPicker';
export type { PaletteSwatchPickerProps } from './PaletteSwatchPicker';
export type { ComboboxOption, ComboboxProps } from './Combobox';
export { StagePill } from './StagePill';
export { StockConcernBadge } from './StockConcernBadge';
export type { InboundCover, InboundPo } from './StockConcernBadge';
export { ViewerBadge } from './ViewerBadge';
export { FeatureGate, UPGRADE_ROUTE } from './FeatureGate';
export type { FeatureGateProps } from './FeatureGate';
export { FoldingSection } from './FoldingSection';
export type { FoldingSectionProps } from './FoldingSection';
export { createFold, FoldChevron } from './fold';
export type { Fold, FoldOptions } from './fold';
export {
  ESC_LOCAL_ATTR,
  Modal,
  MODAL_BAR_TINT,
  ModalDragHandle,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from './Modal';
export type {
  ModalAlign,
  ModalDragHandleProps,
  ModalFooterLayout,
  ModalFooterProps,
  ModalHeaderProps,
  ModalPanelProps,
  ModalPanelSize,
  ModalProps,
} from './Modal';
export { ThemeSwitcher } from './ThemeSwitcher';
export { registerCssPropertyRules } from './cssProperties';
export {
  currentThemeMode,
  cycleThemeMode,
  registerThemeRoot,
  setThemeMode,
  THEME_MODES,
  type ThemeMode,
} from './theme';
export {
  containsAcrossShadow,
  deepActiveElement,
  focusableWithin,
  FOCUSABLE_SELECTOR,
  isVisibleFocusable,
  restoreFocusTo,
} from './focusUtils';
/* ── Atomic primitives ──────────────────────────────────────────────────────
   The suite every surface builds on, so no page hand-rolls a <button>/<input>
   (and drifts). `primitives` exposes the same vocabulary as bare class-builder
   functions, for elements a third-party control owns and we only style. */
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonWeight } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonSize } from './IconButton';
export { Input } from './Input';
export type { InputProps, FieldSize } from './Input';
export { Select } from './Select';
export type { SelectProps } from './Select';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { ErrorBanner } from './ErrorBanner';
export type { ErrorBannerProps } from './ErrorBanner';
export { Pill } from './Pill';
export type { PillProps, PillTone, PillVariant, PillSize, PillShape } from './Pill';
export { Spinner } from './Spinner';
export {
  GearIcon,
  EyeIcon,
  PencilIcon,
  RefreshIcon,
  TableViewIcon,
  RecordViewIcon,
  WorkbenchLinkIcon,
  ColumnsSettingsIcon,
  PrinterIcon,
  DownloadIcon,
  CopyIcon,
  TagIcon,
  SentIcon,
  TruckIcon,
  PackageIcon,
  CloseIcon,
  ArchiveIcon,
  HourglassIcon,
  InfoIcon,
} from './icons';
export type { IconProps, IconComponent } from './icons';
export { Hint } from './Hint';
export type { SpinnerProps, SpinnerSize } from './Spinner';
export {
  buttonClass,
  checkboxClass,
  cx,
  iconButtonClass,
  inputClass,
  menuItemClass,
  // The `<NavTab>` component itself is NOT re-exported here: it wraps a router `<A>`, and four of
  // this package's consumers have no router. It lives behind the `@invflux/ui/nav` subpath so their
  // bundles never reach it; the class builder is router-free and belongs with the rest.
  navTabClasses,
  pillClass,
  selectClass,
  spinnerClass,
  textareaClass,
} from './primitives';
export type { NavTabVariant } from './primitives';
export { DropdownMenu } from './DropdownMenu';
export type { DropdownMenuProps, DropdownMenuItem } from './DropdownMenu';
export { SplitActionButton } from './SplitActionButton';
export type { SplitActionButtonProps } from './SplitActionButton';
export { buildProductActionItems, linkIcon } from './productActionsMenu';
export type { ProductLink } from './productActionsMenu';
export { ThumbnailZoom } from './ThumbnailZoom';
export type { ThumbnailZoomProps } from './ThumbnailZoom';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './SegmentedControl';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { ConfirmModal } from './ConfirmModal';
export type { ConfirmModalProps, ConfirmModalVariant } from './ConfirmModal';
export { ColumnPicker } from './ColumnPicker';
export type { PickableColumn } from './ColumnPicker';
export { RequiredMark } from './RequiredMark';
export { ProPill } from './ProPill';
export type { ProPillProps } from './ProPill';
export { BulkEditModal } from './BulkEditModal';
export type { BulkEditModalProps, BulkEditColumn, BulkEditResult } from './BulkEditModal';
export { CorrectionReviewModal, onHandCorrectionMeta } from './CorrectionReviewModal';
export type {
  CorrectionReviewModalProps,
  CorrectionReviewRow,
  CorrectionReviewGroup,
  CorrectionDispositions,
} from './CorrectionReviewModal';
export { cascadeAllocate } from './onHandCascade';
export type { SlotDeltas } from './onHandCascade';
export { ToastRegion } from './ToastRegion';
export { toast, toasts, DEFAULT_TOAST_DURATION } from './toast';
export { createSearchFailure } from './searchFailure';
export { orderTaxonomyValues } from './taxonomyOrder';
// One operator intent to submit a goods receipt. Shared, because both receiving surfaces mint one:
// the purchase-order reception form and the standalone receiving surface.
export { mintReceiptKey } from './receiptKey';
export type { SearchFailure, SearchFailureTracker } from './searchFailure';
export type { Toast, ToastOptions, ToastVariant } from './toast';

// Shared, SPA-agnostic datatype component registries: register a `dataType` slug's
// view/edit/codec/drilldown/diffPreview once, it renders the same in any SPA.
export {
  createComponentRegistry,
  datatypeChain,
  viewRegistry,
  editRegistry,
  codecRegistry,
  diffPreviewRegistry,
  drilldownRegistry,
} from './datatypes/registry';
export type {
  ComponentContext,
  ComponentRegistry,
  RegisterOpts,
  RegistrationInfo,
  ViewProps,
  ViewComponent,
  EditProps,
  EditComponent,
  EditMove,
  CodecContext,
  Codec,
  DiffPreviewProps,
  DiffPreviewComponent,
  DrilldownProps,
  DrilldownComponent,
} from './datatypes/registry';

// Settings-UI control registry: a setting's `dataType` slug selects its
// control, reusing the datatype-registry machinery; `json` is the universal fallback. Built-in
// controls register at module load (side-effect import above).
export {
  settingControlRegistry,
  resolveSettingControl,
  SETTING_CONTROL_FALLBACK,
} from './settings/registry';
export type { SettingControl, SettingControlProps, SettingMeta } from './settings/registry';

// UI slots (§3.4) + the shared plug-in API installer (§3.3) — the extension seams every SPA
// (workbench, dispatch, procurement) builds over.
export { createSlotRegistry, slotRegistry } from './slots';
export type { SlotContribution, SlotRegistry } from './slots';
export { createSurfaceSettingsRegistry, surfaceSettingsRegistry } from './surfaceSettings';
export type {
  SurfaceSettingsPanel,
  SurfaceSettingsPanelProps,
  SurfaceSettingsRegistry,
} from './surfaceSettings';
export { SettingsSection } from './SettingsSection';
export type { SettingsSectionProps } from './SettingsSection';
export { SurfaceCtx, useSurface } from './surfaceCtx';
export { PaneActiveCtx, usePaneActive } from './paneActive';
export type { SurfaceContext } from './surfaceCtx';
export { createDragReorder } from './dragReorder';
export type { DragReorder } from './dragReorder';
export {
  filterControlRegistry,
  FILTER_CONTROL_SELECT,
  FILTER_CONTROL_MULTISELECT,
  FILTER_CONTROL_MULTISELECT_ASYNC,
  FILTER_CONTROL_NUMERIC_IDS,
  FILTER_CONTROL_RANGE,
  FILTER_CONTROL_DATERANGE,
  describeConstraint,
} from './filters';
export type {
  FilterConstraint,
  FilterControl,
  FilterControlProps,
  FilterDescriptor,
  FilterQuery,
} from './filters';
export { FilterBar } from './FilterBar';
export { cancelPendingShortcut, noteKeystroke, runWhenTypingStops } from './keyBurst';
export type { FilterBarProps } from './FilterBar';
export {
  gridFiltersToDescriptors,
  readUnreservedFilterValuesFromParams,
  deleteUnreservedFilterParams,
  writeFilterValuesToParams,
  readFilterModifiersFromParams,
  writeFilterModifiersToParams,
  deleteFilterModifierParams,
} from './filterBridge';
export type { GridFilterMeta, GridFilterBridgeOptions } from './filterBridge';
export { SavedFilterControl } from './SavedFilterControl';
export type { SavedFilterControlProps } from './SavedFilterControl';
export { FilterModeToggle } from './FilterModeToggle';
export type { FilterModeToggleProps } from './FilterModeToggle';
export { FilterScopePicker } from './FilterScopePicker';
export type { FilterScopePickerProps } from './FilterScopePicker';
export { createBulkActionRegistry, bulkActionRegistry } from './bulk-actions';
export type { BulkAction, BulkActionContext, BulkActionRegistry } from './bulk-actions';
export {
  createEntityActionRegistry,
  entityActionRegistry,
  DEFAULT_PRIMARY_WEIGHT,
} from './entity-actions';
export type {
  ActionGroup,
  EntityAction,
  EntityActionContext,
  EntityActionRegistry,
  ResolvedAction,
  ResolvedActions,
} from './entity-actions';
export { installPluginApi } from './plugin-api';
export type { PluginApi, RegistryApi } from './plugin-api';
// Spreadsheet-grid primitives (pure, unit-tested) — the cell-selection state machine, clipboard
// payload builder, and paste-target geometry shared by the DataGrid extraction.
export {
  EMPTY_SELECTION,
  rectContains,
  isSelected,
  isActive,
  isMultiCell,
  selectionEdges,
  clampCoord,
  selectCell,
  extendTo,
  addRange,
  moveActive,
  selectAll,
} from './grid/cellSelection';
export type { CellCoord, SelectionRect, SelectionState, CellEdges } from './grid/cellSelection';
export { selectionBounds, buildClipboard } from './grid/clipboard';
export { pasteTargets } from './grid/paste';
export type { PasteTarget } from './grid/paste';
// The generic spreadsheet DataGrid (type-blind over its row; host supplies getValue/canEdit/…).
export { DataGrid, ColumnManagerModal } from './grid/DataGrid';
export type {
  DataGridProps,
  DataGridMenuItem,
  RowAttrs,
  DataGridComponentRole,
  DataGridLayout,
  StagedCell,
} from './grid/DataGrid';
export { makeGenericColumn, isRightAligned } from './grid/genericColumn';
export type { GenericColumnDeps } from './grid/genericColumn';

// Excel/Sheets clipboard-TSV parser — shared so the import wizard (and any paste surface) parses
// quoted/multiline cells identically across SPAs.
export { parseSpreadsheetTsv } from './excel-tsv-parser';
// Shared paste → map → resolve → preview → commit import wizard (Procurement + Workbench).
export { ImportWizard } from './ImportWizard';
export type {
  ImportField,
  ImportWizardProps,
  MappedRow,
  ResolvedRow,
  ImportRowStatus,
} from './ImportWizard';
export {
  parseImportFile,
  fetchImportAliases,
  learnImportAlias,
  saveImportAliases,
} from './import-file';
export type { ImportFileTransport, ImportAliasMap } from './import-file';
export { COMMON_ALIASES, normalizeAlias, parseAliasCsv, serializeAliases } from './import-aliases';
export { assertShape } from './assertShape';

// The REST client is deliberately NOT re-exported here — it lives at `@invflux/ui/api`. Routing a
// fetch wrapper through this barrel drags the whole component tree in with it.
export { matchScore, bestMatch, scoreColor, foldKey, DEFAULT_MATCH_THRESHOLD } from './fuzzy-match';
export type { BestMatch } from './fuzzy-match';
export { MatchSelect } from './MatchSelect';
export type { MatchSelectProps, MatchOption } from './MatchSelect';

// Workbench grid — the reusable, operator-facing, subject-centric data grid that mounts on any
// surface where merchants view + edit merchandise data. Pillar of the Central Workbench WP admin
// page; also embeds in the product inventory tab, future dispatch / procurement grids, and any
// add-on surface. Column families span catalog / stock / analytics / supplier catalog / dispatch
// concerns / costing — the grid stays type-blind and any column the server registers can appear.
// Live-updates transport is pluggable: default polling factory ships here; WebSocket / SSE swaps
// are one-liners at the mount site.
export type {
  WorkbenchRow,
  WorkbenchPage,
  WorkbenchHandles,
  SelectedCellRef,
  RowPatch,
  ReorderStatus,
  DirtyEdit,
  DirtyRow,
  WorkbenchApplyEdit,
  WorkbenchApplyRow,
  WorkbenchApplyRequest,
  WorkbenchApplyConflict,
  WorkbenchApplyResponse,
} from './workbenchGridTypes';
export { partitionApplyRows } from './grid/applyPartition';
export type { ApplyPartition, ApplyRowShape } from './grid/applyPartition';
export { useDirtyCells, pendingCellKey } from './grid/useDirtyCells';
export type { DirtyCellsStore } from './grid/useDirtyCells';
export { pollingTransport, useLiveUpdates } from './liveUpdates';
export { createViewportFill } from './viewportFill';
export type {
  LiveUpdatesTransport,
  LiveUpdatesTransportConfig,
  LiveUpdatesPollResponse,
  PollingTransportConfig,
} from './liveUpdates';
export { WorkbenchGrid } from './WorkbenchGrid';
export type {
  WorkbenchGridProps,
  WorkbenchGridContext,
  WorkbenchGridCapabilities,
} from './WorkbenchGrid';
export { workbenchValueFor, applyRowPatch } from './grid/workbenchValueFor';
export { buildWorkbenchColumns, buildStockColumns, stockSlotOf } from './grid/workbenchColumns';
export type { WorkbenchColumnDeps, StockColumnDeps, StockSlot } from './grid/workbenchColumns';
