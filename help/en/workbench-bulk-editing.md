---
id: workbench-bulk-editing
title: Bulk-editing products
category: Workbench
keywords: [bulk, edit, multiple, filter, select column, fill, F2, review, apply]
related: [workbench-filtering, workbench-editable-cells, workbench-editing-lifecycle]
---

# Bulk-editing products

The Workbench lets you change one field across many products in a single pass — set a reorder point
on every product from one supplier, switch a whole category to a different backorder setting, tidy up
SKUs. The pattern is always the same five steps: **filter → select the column → edit → review →
apply.**

## The five-step maneuver

1. **Filter to the products you want.** Use the filter bar to narrow the list — by name, supplier,
   category, stock concern, and so on. Stack filters to combine them. If your list spans several
   pages, click **Load all pages** first, so a bulk edit reaches every matching product, not just the
   ones on screen.
2. **Select the column's cells.** Click a cell in the column you want to change, then drag — or
   Shift-click — to extend the selection down the column. To take the whole column at once, open the
   column header's menu and choose **Select all cells in column**.
3. **Edit.** Press **F2** (or right-click the selection → **Edit**) to open the editor for that
   column. Enter the value once; it applies to every selected cell.
4. **Review.** Your changes are staged, not yet saved — edited cells are highlighted so you can see
   exactly what will change. Click **Save** to open the review, which lists every pending change
   grouped for a last look.
5. **Apply.** Confirm in the review to write the changes. Anything you're unsure about, you can
   discard instead — nothing is saved until you apply.

## Good to know

- **Only editable columns can be bulk-edited.** Read-only columns (live stock figures, values
  inherited from a variable product's parent) don't accept edits — their cells won't open an editor.
- **Staged edits are safe to abandon.** Until you apply, you can keep adjusting the selection, change
  values, or discard the whole batch. Reloading the page also clears unsaved edits.
- **Variations follow their parent** for settings that are decided at the product level, so editing
  those on a variation row isn't offered — change them on the parent product instead.

This same filter → select → edit → review → apply skill is what the stock-management onboarding points
you to when it suggests adopting your existing catalogue in bulk.
