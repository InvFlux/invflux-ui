// Re-export the shared portal context from @invflux/ui so this SPA's `PortalCtx.Provider` and the
// library's Kobalte wraps (SearchSelect / SearchMultiSelect / Combobox) share ONE context object —
// the wraps default their listbox portal `mount` to it. See @invflux/ui/portal.
export { PortalCtx, usePortalRoot } from '@invflux/ui';
