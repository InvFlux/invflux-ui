# Combobox Component Spec

A filterable multi-select (or single-select) combobox with tag-token display.
Implements the ARIA combobox + listbox pattern. Fully keyboard-accessible.

**Location:** `packages/ui/src/Combobox.tsx`
**Exports:** `Combobox`, `ComboboxOption` (type), `ComboboxProps` (type)
**Framework:** SolidJS + Tailwind CSS v4
**Usage context:** Shadow DOM (affects outside-click detection — see §6)

---

## 1. Props

```typescript
export interface ComboboxOption {
  value: string;
  label: string;
  depth?: number;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Available options. Order is preserved; filtering does not reorder. */
  options: ComboboxOption[];

  /** Currently selected values. Pass [] for no selection. */
  selected: string[];

  /** Fired whenever the selection changes. Receives the full new selection. */
  onChange: (selected: string[]) => void;

  /** true (default): multiple selections shown as pills.
   *  false: at most one selection; choosing a new option replaces the previous. */
  multiple?: boolean;

  placeholder?: string;

  disabled?: boolean;

  /** Cap on visible dropdown rows before scrolling. Default: 20. */
  maxVisible?: number;

  /** Forwarded to the hidden <input> for form compatibility. */
  name?: string;

  /** Used as aria-labelledby target id. Caller is responsible for the <label>. */
  labelId?: string;

  /** Extra classes for the visual input row. Defaults to min-w-52. */
  inputClass?: string;
}
```

---

## 2. Visual Anatomy

```
┌──────────────────────────────────────────────────┐
│ [Nike ×] [Adidas ×]  find brand…                 │  ← input row
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ ☑ Nike                                           │  ← dropdown (visible)
│ ☑ Adidas                                         │
│ ☐ Puma                                           │
│ ☐ Reebok                                         │
└──────────────────────────────────────────────────┘
```

### 2.1 Input Row

The outer container acts as the visual "input box":

- Border + rounded corners; same height as other form controls when empty; grows vertically as tokens fill rows.
- **Token pills** — one per selected value, left-to-right, wrapping. Each pill:
  - `label text` followed by `×` button on the right.
  - Clicking `×` removes that token. `×` button has its own focus ring; pressing Space/Enter on it also removes the token.
- **Text input** — follows the last token. No visible border; the outer container is the visual boundary. Grows to fill remaining row width; shrinks to ~4 ch minimum.
- **Focus state** — focus ring is on the outer container, not the inner `<input>`. The container is `position: relative` so the dropdown can be absolutely positioned beneath it.

### 2.2 Dropdown

Appears directly below the input row:

- `position: absolute`, `z-50`, `min-width: 100%` of the input row, `width: max-content` (can be wider if labels are long, up to a reasonable cap such as `max-width: 24rem`).
- `max-height: ~210px` (≈ 6 rows at `35px` each), `overflow-y: auto`.
- Each option row:
  - **Multi:** `[checkbox] label` — checkbox on left, label text.
  - **Single:** `label [✓]` — label text, checkmark on right only when selected.
  - Height ~35px; full-width click target (click anywhere in the row toggles/selects).
  - **Hover state**: light highlight (distinct from keyboard-active state).
  - **Keyboard-active state**: stronger highlight (e.g. blue tint), applied to the row at `activeIndex`.
  - **Selected state** (multi): checkbox checked; row background slightly tinted.
  - **Disabled option**: greyed text, no hover, no pointer interaction.
- **Empty state**: single row with "No matches" in muted text; not interactive.

---

## 3. Behavior

### 3.1 Opening / Closing

| Trigger | Result |
|---|---|
| Click input row (not on a pill or its ×) | Open dropdown; focus `<input>` |
| Focus `<input>` via Tab | Open dropdown |
| `Escape` (dropdown open) | Close dropdown; keep selection; keep input text |
| `Escape` (dropdown closed, input has text) | Clear input text |
| Click outside (pointer event not in component) | Close dropdown; keep selection |
| Tab away from component | Close dropdown |
| Select in single-select mode | Close dropdown immediately after selection |

### 3.2 Filtering

- Filtering is client-side against `option.label` (case-insensitive substring match).
- An empty input shows all options (up to `maxVisible`).
- Changing the input text resets `activeIndex` to `-1`.
- The filtered list never reorders matched options.

### 3.3 Keyboard Navigation

Focus stays in the `<input>` at all times. The dropdown is controlled by the input.

| Key | Effect |
|---|---|
| `↓` | If dropdown closed: open it. Move `activeIndex` down by 1. When at last item, wrap to `-1`. |
| `↑` | Move `activeIndex` up by 1. When at first item or `activeIndex` is `-1`, go to last item. |
| `Enter` | If `activeIndex ≥ 0`: toggle selection on that option (multi) or select and close (single). Clear input text. If `activeIndex = -1`: no-op (do not close). |
| `Escape` | See §3.1 |
| `Backspace` (input empty) | Remove the last token. If no tokens, no-op. |
| `Space` | Type a space character in the input (normal text entry). |
| `Tab` | Close dropdown; move browser focus to next focusable element. |

When `activeIndex` changes via keyboard, scroll the active row into view inside the dropdown: `element.scrollIntoView({ block: 'nearest' })`.

### 3.4 Selection

**Multi-select:**

- Clicking/Enter on an option that is not selected → adds its value to `selected`; calls `onChange`.
- Clicking/Enter on an option that is selected → removes its value; calls `onChange`.
- Clicking `×` on a token → removes that value; calls `onChange`.
- Dropdown stays open after toggle.

**Single-select:**

- Clicking/Enter on any option → sets `selected` to `[value]`; calls `onChange`; closes dropdown; clears input text.
- Clicking `×` on the single token → sets `selected` to `[]`; calls `onChange`; focuses input.

---

## 4. ARIA

```html
<!-- outer container — also the combobox role anchor -->
<div
  role="combobox"
  aria-expanded="true|false"
  aria-haspopup="listbox"
  aria-owns="combobox-{uid}-listbox"
  aria-labelledby="{labelId}"   <!-- if labelId prop provided -->
>
  <!-- tokens (not interactive from ARIA perspective; × buttons are) -->
  <span aria-hidden="true">[token pills]</span>

  <!-- the live text input -->
  <input
    type="text"
    aria-autocomplete="list"
    aria-controls="combobox-{uid}-listbox"
    aria-activedescendant="combobox-{uid}-option-{activeValue} | empty string"
    autocomplete="off"
    spellcheck="false"
  />
</div>

<!-- dropdown (always in DOM, hidden via display:none when closed) -->
<ul
  role="listbox"
  id="combobox-{uid}-listbox"
  aria-multiselectable="true|false"
>
  <li
    role="option"
    id="combobox-{uid}-option-{value}"
    aria-selected="true|false"
    aria-disabled="true"  <!-- only when option.disabled -->
  >
    ...
  </li>
</ul>
```

- Generate a stable `uid` per component instance (e.g. `createUniqueId()` from SolidJS).
- Token `×` buttons: `aria-label="Remove {label}"`, `type="button"`.
- Do not use `display: none` on the dropdown container — use `visibility: hidden` or `aria-hidden="true"` when closed so screen readers can still read the `aria-owns` relationship.
  - Actually prefer `hidden` attribute combined with CSS: `[hidden] { display: none }`. Toggle the `hidden` attribute on the `<ul>`.

---

## 5. Single-Select Differences Summary

| Aspect | Multi | Single |
|---|---|---|
| `multiple` prop | `true` (default) | `false` |
| Option rows | Checkbox left, label | Label, ✓ right if selected |
| On option pick | Toggle; stay open | Replace selection; close |
| Token count | Unlimited | 0 or 1 |
| `aria-multiselectable` | `true` | `false` |

---

## 6. Shadow DOM Considerations

Click-outside detection cannot rely on `blur` alone (focus can move inside the component without triggering blur). Use:

```js
document.addEventListener('pointerdown', handler, { capture: true });
```

In `handler`, check:

```js
const path = event.composedPath();
const isInside = path.some(el => el === containerElement);
if (!isInside) closeDropdown();
```

Register this listener on mount; remove on cleanup (`onCleanup` in SolidJS).

---

## 7. Styling Contract

The component uses Tailwind utility classes directly. The implementer must ensure the following design tokens exist in the host Tailwind config (they are already present in both workbench and dispatch packages):

| Token | Purpose |
|---|---|
| `border-border` | Input row and dropdown border |
| `bg-surface` | Input row and dropdown background |
| `text-text` | Primary text |
| `text-text-muted` | Placeholder, empty state, disabled options |
| `bg-primary` / `text-white` | Active (keyboard-highlighted) option row |

Token pills use a fixed `bg-blue-100 text-blue-800` style (not themed); adjust if the design system adds a `bg-tag` token.

---

## 8. Known Limitations (v1)

- **No virtualization**: filtering is O(n) over the full options array; adequate for ≤ 500 options. For larger sets, consider a future `createVirtualizer`-based dropdown.
- **No flip**: dropdown always opens below the input. If there is insufficient viewport space below, it clips. Flip logic (open above when near bottom of viewport) is a post-v1 enhancement.
- **No async options**: options are a static prop array. Async typeahead (debounced fetch) is out of scope.
- **No option groups**: flat list only.
