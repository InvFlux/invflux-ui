/**
 * Slot key for **Procurement's own** top-level sections (Purchase Orders, Suppliers, …).
 *
 * Deliberately namespaced rather than the bare `nav.section`: the shared slot registry is a single
 * process-wide instance, and the unified admin shell uses `nav.section` for *its* top-level surfaces
 * (Workbench, Dispatch, Procurement, …). When Procurement is embedded in that shell, both run in one
 * bundle — an un-namespaced key would cross-contaminate, putting Suppliers/Purchase-Orders in the
 * shell's tab bar and Workbench/Dispatch in Procurement's.
 *
 * Procurement is ONE top-level surface; these are its *sub*-sections, a different level of
 * navigation, so they get their own key. Add-ons contributing a Procurement section register here
 * (`window.invflux.procurement.registerSlot(PROCUREMENT_NAV_SLOT, …)`).
 */
export const PROCUREMENT_NAV_SLOT = 'procurement:nav.section';
