# Merchant-facing help content

Long-form **help articles** shown in the in-app Help surface, authored as Markdown, one file per
article. This is the *content*; the *system* that indexes, searches, and renders it (the `docsRegistry`
in `@invflux/ui`, the Markdown renderer, the Help SPA section, the build-time codegen that compiles
these files into typed article objects) is designed in the adapter and **not built yet** — so these
files are written ahead of it and wired in when it lands.

## Layout

- `help/en/*.md` — English source (the base locale).
- `help/fr/*.md` — French translations (shipped locale; `de`/`es` may lag), added later. Long article
  bodies live as per-locale Markdown, **not** in the `.po` string catalogs.

## Why here (invflux-ui), not the adapter's `docs/`

- The `docsRegistry` and the build-time codegen that consume these files live in `@invflux/ui`, so
  same-repo authoring avoids a cross-repo build dependency.
- `docs/` in the adapter is developer documentation, excluded from the shipped plugin; help articles
  are product content that ships (compiled into the SPA bundle).
- Add-ons contribute their own articles from their own packages; core
  content living in the SPA layer mirrors that.

The sub-structure (repo-root `help/` vs per-package) is provisional — it may move into the packages
when the codegen is built. The stable thing is each article's `id` (its `#/help/<id>` deep-link).

## Front matter

Each article carries YAML front matter the codegen maps onto a `DocArticle`. Provisional shape:

```yaml
---
id: workbench-bulk-editing      # stable slug — the #/help/<id> deep-link anchor. Never rename.
title: Bulk-editing products
category: Workbench             # groups articles in the Help outline
keywords: [bulk, edit, filter, select column, F2]   # fuzzy-search hints
related: [workbench-filtering, workbench-editable-cells]   # sibling article ids
---
```
