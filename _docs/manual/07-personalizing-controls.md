# Personalizing the style of controls

`05-theming.md` covers the theming *system* (the `--sa-*` custom-property contract, the `sa-`
class/`data-sa-part` vocabulary, and light-DOM-by-design). This chapter is the practical follow-up:
concrete recipes for actually personalizing how controls look — one instance at a time, one
control type at a time, or the whole app at once with a runtime-switchable theme.

There are four levels of personalization, from broadest to narrowest. Pick the narrowest one that
does what you need — it's the easiest to maintain.

## 1. Whole-app: swap or override `--sa-*` tokens

The broadest lever. Every color/spacing/radius decision in `src/theme/base.css` reads through a
`var(--sa-*, var(--fallback-token, hardcoded-default))` chain, so redefining a handful of
`--sa-*` custom properties anywhere above the rendered elements (typically on `:root`) reskins the
entire app with no per-component work:

```css
:root {
  --sa-primary: #7c3aed;          /* violet buttons, active states */
  --sa-primary-foreground: #fff;
  --sa-radius: 0.25rem;           /* sharper corners everywhere */
  --sa-border: #d4d4d8;
}
```

See `05-theming.md` for the full token list and the `theme/shadcn.css` preset that maps these onto
a shadcn/ui app's own tokens automatically.

## 2. One control *type*, everywhere: target the class/part vocabulary

Every rendered node carries a `sa-` BEM class and, on structural nodes, a `data-sa-part` attribute
(`src/components/*.js` — e.g. `sa-datagrid__cell--sortable`, `data-sa-part="header-cell"`). Target
these directly to restyle a whole category of control without touching `--sa-*` tokens or any
component's markup:

```css
/* Make every boolean field render like a small pill badge instead of a check/cross glyph. */
sa-boolean-field {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  background: var(--sa-muted);
}

/* Give every sortable datagrid header column a subtle affordance. */
.sa-datagrid__cell--sortable {
  cursor: pointer;
}
.sa-datagrid__cell--sortable:hover {
  background: var(--sa-muted);
}

/* Bigger, rounder text inputs across the whole app. */
sa-text-input input,
sa-text-input textarea {
  padding: 0.625rem 0.875rem;
  border-radius: 0.75rem;
  font-size: 1rem;
}
```

Because every `sa-*` custom element renders into its own **light DOM** (not a shadow root, per
`05-theming.md`), plain descendant selectors like `sa-text-input input` work exactly as they would
on any other nested HTML — no `::part()`, no piercing a shadow boundary.

## 3. One control *instance*: a plain `class` attribute

Every `sa-*` element is a real `HTMLElement`. The library only ever adds classes to nodes it
creates *inside* a control (`classList.add(...)` on internal wrapper/table/button nodes) — it never
overwrites the `class` attribute of the custom element you declared. That means a plain `class`
attribute on any single instance is a safe, native way to target just that one control, with no
special library API needed:

```html
<sa-boolean-field source="is_published" class="published-pill"></sa-boolean-field>
```

```css
.published-pill {
  background: var(--sa-primary);
  color: var(--sa-primary-foreground);
}
```

This composes with level 2: the element keeps its library-added classes (`sa-field`, etc.) *and*
gets yours, so a rule like `.published-pill` can sit alongside (and override, given normal CSS
specificity/order rules) the shared `sa-boolean-field` styling.

## 4. Runtime-switchable themes (the "theme selector" pattern)

For an app that needs to let the *user* pick a look (light/dark, or a small set of brand themes),
combine `--sa-*` overrides with a single attribute selector instead of swapping stylesheets:

```css
/* One file, three themes, gated behind data-theme on <html> or <body>. */
:root,
[data-theme='light'] {
  --sa-primary: #18181b;
  --sa-background: #ffffff;
  --sa-foreground: #09090b;
  --sa-border: #e5e7eb;
}

[data-theme='dark'] {
  --sa-primary: #f4f4f5;
  --sa-primary-foreground: #18181b;
  --sa-background: #0a0a0a;
  --sa-foreground: #fafafa;
  --sa-border: #27272a;
  --sa-muted: #18181b;
}

[data-theme='ocean'] {
  --sa-primary: #0891b2;
  --sa-background: #f0fdfa;
  --sa-foreground: #134e4a;
  --sa-border: #99f6e4;
  --sa-radius: 1rem;
}
```

```js
// Switching themes at runtime is a single attribute write — no stylesheet reload, no FOUC,
// since every rule below `[data-theme="..."]` just starts resolving to different values.
function setTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem('theme', name); // optional: remember the choice
}
```

Because every component reads colors through `--sa-*` variables rather than hardcoding them, this
one attribute flip reskins the entire mounted app instantly — datagrid, forms, buttons, the login
page, everything — with zero JavaScript re-render and zero risk of a flash of the wrong theme
(the CSS cascade just resolves differently the instant the attribute changes).

A complete, runnable version of this pattern — a theme picker switching between three real
themes live over a kitchen-sink admin exercising the full field/input catalog (`products`,
plus `categories`/`tags`/`authors`/`posts`/`audit-log`) — is in `examples/kitchen-sink/`. Most of
it boots straight into content with no login required, but its "Private" menu section
(`audit-log`) is gated with `<sa-resource require-auth>` behind a fake `test`/`test` auth
provider — see [02-resources-and-views.md §8](./02-resources-and-views.md#8-auth) for how a
single resource opts into auth without turning `require-auth` on for the whole admin. It's also
split across multiple JS modules (`resources/`, `auth.js`, `theme-switcher.js`) rather than one
inline `<script>`, showing how a larger JS-config admin can be organized. Read
`examples/kitchen-sink/themes.css` for the three full token sets and
`examples/kitchen-sink/theme-switcher.js` for the switcher UI wiring itself.

## Choosing a level

| Need | Use |
|---|---|
| Reskin the whole app to match your brand/design system | Level 1 (`--sa-*` overrides or `theme/shadcn.css`) |
| Change how every field/input/button of one kind looks | Level 2 (`sa-*` class / `data-sa-part` selectors) |
| Change one specific field/input on one specific screen | Level 3 (a `class` attribute on that instance) |
| Let the end user pick light/dark/brand themes at runtime | Level 4 (`data-theme` + `--sa-*` blocks) |

All four compose freely — a theme-switcher app (level 4) can still have one specially-classed
field (level 3) and app-wide button restyling (level 2) layered on top.
