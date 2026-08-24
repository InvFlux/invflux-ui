---
id: coexist-with-woocommerce
title: How InvFlux works with WooCommerce stock
category: Concepts
keywords: [stock management, woocommerce, coexist, adopt, managed by, external, not tracked, governed]
related: [workbench-bulk-editing]
---

# How InvFlux works with WooCommerce stock

InvFlux doesn't take over every product the moment you install it. You decide, **per product**, who
manages its stock — so you can hand products to InvFlux gradually and let WooCommerce (or another
plugin) keep managing the rest in the meantime. Nothing changes for a product until you choose to
adopt it.

Each product is in one of three states, shown by the **Stock management** control on the product's
Inventory tab and by the **Stock managed** column in the Workbench:

## InvFlux

InvFlux manages this product's stock. It tracks what's available to sell, what's reserved by open
orders, and the full history of every movement — and it keeps WooCommerce's own stock quantity in
step, so your storefront always shows the right number. This is the state where InvFlux's features
apply.

## Other

Someone other than InvFlux — WooCommerce itself, or another stock plugin — manages the quantity.
InvFlux stays hands-off: it shows you the current number but doesn't track availability, reservations,
or history for this product, and it won't change the quantity. Use this while a product is still
managed elsewhere.

## Not tracked

No one is tracking a quantity for this product. WooCommerce treats it as always available (there's no
stock number at all). This is the right state for products you never count — services, made-to-order
items, digital goods.

## Adopting a product into InvFlux

Switching a product to **InvFlux** is called *adopting* it. When you do, InvFlux takes WooCommerce's
current stock quantity as the opening figure and starts managing it from there — so the number your
customers see doesn't jump. You can adopt one product from its Inventory tab, adopt many at once from
the Workbench (see [Bulk-editing products](#/help/workbench-bulk-editing)), or accept the one-click
offer to adopt your whole catalogue when you first set InvFlux up.

You can hand a product back at any time — switch it to **Other** or **Not tracked**. InvFlux keeps the
history it recorded, in case you adopt the product again later.

## Two plugins, one number

Once InvFlux manages a product, it protects that product's stock: if another plugin tries to overwrite
the quantity, InvFlux keeps its own figure so the two don't quietly drift apart. If you *want* another
plugin to keep writing a product's stock, leave that product on **Other** rather than adopting it.
