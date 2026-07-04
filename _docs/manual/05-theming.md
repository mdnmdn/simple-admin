# 5. Theming

## Light DOM, not Shadow DOM

simple-admin's custom elements (`<sa-admin>`, `<sa-datagrid>`, `<sa-simple-form>`, every field and input, ...) render their children directly into the **light DOM**. None of them call `attachShadow()`. There is no shadow boundary anywhere in the library.

The practical consequence: your page's own CSS applies to simple-admin's rendered markup exactly like it would to any other element on the page. If your app uses Tailwind, a utility-class design system, a CSS reset, or plain hand-written CSS, it reaches straight into `<sa-datagrid>`'s rows and `<sa-simple-form>`'s inputs — no `::part()`, no `::slotted()`, no shadow-piercing combinators, no workarounds. You style simple-admin the same way you'd style any other block of HTML on your page.

This is also why simple-admin ships class names and `data-sa-part` attributes at all (see below) — since there's no encapsulation, a predictable naming convention is what lets you target specific structural parts precisely instead of relying on brittle descendant selectors.

## Including the theme

simple-admin ships two optional CSS files under `src/theme/`:

```html
<link rel="stylesheet" href="src/theme/base.css" />
<link rel="stylesheet" href="src/theme/shadcn.css" />
```

- **`base.css`** is the structural stylesheet — layout (grid/flex/spacing), borders, focus states, and just enough button/input chrome to make the default admin usable. It's optional but recommended: without it, simple-admin still works, but you get unstyled markup (block-level elements with no spacing, no borders, browser-default form controls). Every visual value in it is a CSS custom property, so it's meant to be overridden rather than fought with.
- **`shadcn.css`** is an optional preset, loaded *in addition to* `base.css`, that does two things. First, it maps `base.css`'s `--sa-*` custom properties onto shadcn/ui's own token names (`--primary`, `--border`, `--radius`, `--input`, `--card`, `--sidebar`, etc.): if your app already defines those shadcn tokens on `:root`/`.dark`, dropping in `shadcn.css` themes simple-admin to match automatically, with zero `--sa-*` overrides of your own. Second, for each token the preset *also* carries shadcn/ui's own default "neutral" value (in `oklch`) as the fallback — plus a built-in dark theme — so an app that does **not** already run shadcn still gets a faithful shadcn look, light and dark, out of the box. Dark mode activates on either `.dark` (shadcn's class) or `[data-theme='dark']` (see §4 of `07-personalizing-controls.md`).

Load order between the two doesn't matter — `base.css` reads each `--sa-*` variable via `var(--sa-x, var(--x, <hardcoded-default>))`, so as long as both files (and your own token definitions, if any) are present before first paint, the fallback chain resolves correctly regardless of cascade order. If you skip `shadcn.css` entirely, `base.css` still falls back to shadcn's default token *names* (in case your app defines `--primary`/`--border`/etc. under its own theme without using the preset) and finally to a hardcoded default color if neither is present.

This is exactly how the bundled example wires it up (`examples/html-only/index.html`):

```html
<link rel="stylesheet" href="../../src/theme/base.css" />
<link rel="stylesheet" href="../../src/theme/shadcn.css" />
```

If you're using the built `dist/` output instead of the source tree, `npm run build` concatenates both files into a single `dist/simple-admin.css` for you.

## The `--sa-*` custom property list

Every design-token variable simple-admin reads, as declared/consumed in `src/theme/base.css`, with its shadcn fallback name (the value `shadcn.css` maps it to) and hardcoded ultimate default:

| Variable | Purpose | shadcn fallback | Hardcoded default |
|---|---|---|---|
| `--sa-radius` | Border radius for cards, inputs, buttons, the datagrid | `--radius` | `0.5rem` |
| `--sa-spacing` | Base spacing unit; nearly every padding/gap in the sheet is `calc(var(--sa-spacing) * N)` | `--spacing` | `0.25rem` |
| `--sa-font-sans` | Font stack for the whole admin shell | `--font-sans` | system-font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`) |
| `--sa-font-size` | Base font size on `.sa-admin` | *(none — no shadcn equivalent)* | `0.875rem` |
| `--sa-background` | Page/input background | `--background` | `#fff` |
| `--sa-foreground` | Primary text color | `--foreground` | `#09090b` |
| `--sa-card` | Card surfaces (e.g. the login card); falls back to `--sa-background` | `--card` | *(inherits `--sa-background`)* |
| `--sa-card-foreground` | Text on card surfaces; falls back to `--sa-foreground` | `--card-foreground` | *(inherits `--sa-foreground`)* |
| `--sa-input` | Form-control border color; falls back to `--sa-border` | `--input` | *(inherits `--sa-border`)* |
| `--sa-sidebar` | Side-menu background; falls back to `--sa-muted` | `--sidebar` | *(inherits `--sa-muted`)* |
| `--sa-sidebar-border` | Side-menu right border; falls back to `--sa-border` | `--sidebar-border` | *(inherits `--sa-border`)* |
| `--sa-primary` | Appbar background, primary buttons, active form-tab underline | `--primary` | `#18181b` |
| `--sa-primary-foreground` | Text/icon color on primary-colored surfaces | `--primary-foreground` | `#fff` |
| `--sa-secondary` | Default button background, field chips | `--secondary` | `#f4f4f5` |
| `--sa-secondary-foreground` | Text on secondary-colored surfaces | `--secondary-foreground` | `#18181b` |
| `--sa-accent` | Hover/selected background for menu items and datagrid rows | `--accent` | varies by rule (`rgba(0,0,0,.03)`–`rgba(0,0,0,.08)`) |
| `--sa-accent-foreground` | *(mapped in `shadcn.css`; not directly consumed in `base.css`)* | `--accent-foreground` | `#18181b` |
| `--sa-muted` | Side menu background, table header background, login page background | `--muted` | `#f4f4f5` |
| `--sa-muted-foreground` | Secondary/help text, table header text, pagination text | `--muted-foreground` | `#71717a` |
| `--sa-border` | Borders on the menu, table, inputs, buttons (outline variant), cards | `--border` | `#e5e7eb` |
| `--sa-ring` | Focus-visible outline on inputs and buttons | `--ring` | `#a1a1aa` |
| `--sa-destructive` | Danger button background, validation error text/borders | `--destructive` | `#ef4444` |
| `--sa-destructive-foreground` | Text on destructive-colored surfaces | `--destructive-foreground` | `#fff` |

`--sa-accent-foreground`, `--sa-popover`, and `--sa-popover-foreground` are bridged by `shadcn.css` for completeness/forward-compatibility but have no consuming rule in the current `base.css`. The `--sa-card`/`--sa-input`/`--sa-sidebar` family *is* consumed, but each falls back to an existing token (`--sa-background`/`--sa-border`/`--sa-muted`) when unset, so adding them changes nothing until you (or the shadcn preset) give them a distinct value.

## The class-name vocabulary

Every rendered element carries a plain, non-scoped class following a `sa-` BEM-style convention: `sa-<block>`, `sa-<block>__<element>`, `sa-<block>--<modifier>`. A few examples straight from the source:

- `.sa-admin` — the shell grid (`<sa-admin>`'s root)
- `.sa-appbar`, `.sa-appbar__title` — top bar and its title text
- `.sa-menu`, `.sa-menu-item`, `.sa-menu-item--active` — side nav and its active-item modifier
- `.sa-content` — the main content area
- `.sa-datagrid`, `.sa-datagrid__head`, `.sa-datagrid__row`, `.sa-datagrid__row--selected`, `.sa-datagrid__row--clickable`, `.sa-datagrid__cell`, `.sa-datagrid__cell--sortable`, `.sa-datagrid__cell--checkbox`, `.sa-datagrid__select-all`, `.sa-datagrid__select`, `.sa-datagrid__bulk-toolbar` — the whole datagrid, built up in `src/components/datagrid.js`
- `.sa-field__chip` — the pill used by chip-style fields
- `.sa-filters` — the filter bar above a list
- `.sa-pagination`, `.sa-pagination__pages` — pager and its page-number cluster
- `.sa-input`, `.sa-input__label`, `.sa-input__error`, `.sa-input__helper`, `.sa-input--invalid` — the wrapper every `sa-*-input` renders (see `src/inputs/baseInput.js`, which looks up its own `.sa-input__error`/`.sa-input__helper` nodes by class)
- `.sa-simple-form`, `.sa-tabbed-form`, `.sa-form-tab`, `.sa-form-tab__tab`, `.sa-form-tab__tab--active`, `.sa-form-toolbar`
- `.sa-btn`, `.sa-btn--primary`, `.sa-btn--danger`, `.sa-btn--outline`, `.sa-btn--ghost`
- `.sa-login`, `.sa-login__card`, `.sa-login__title`
- `.sa-list`, `.sa-list__status`, `.sa-dashboard`, `.sa-access-denied`

`base.css` also has two generic attribute selectors that catch any of these without listing them individually: `[class*='sa-']` (box-sizing reset, focus rings, disabled-state opacity) and `[class$='-input']` (label/control styling shared by every `sa-*-input` wrapper).

Structural nodes additionally carry a `data-sa-part="..."` attribute, independent of (and more stable than) the class name — useful when you want a hook that won't break if a class list gains a new BEM modifier. From the source: `data-sa-part="admin"` on the shell root, `"appbar"`, `"menu"`, `"content"` on the three shell regions, `"dashboard"` / `"access-denied"` on the two placeholder panels, and inside the datagrid: `"table"`, `"head"`, `"body"`, `"header-row"`, `"header-cell"`, `"row"`, `"cell"`, `"bulk-toolbar"`.

To restyle one specific part of the UI, target its class or `data-sa-part` directly:

```css
/* Make the side menu narrower and give active items a left accent bar */
.sa-menu { min-width: 11rem; }
.sa-menu-item--active { border-left: 3px solid var(--sa-primary); }

/* Or, using the structural attribute instead of the class */
[data-sa-part="appbar"] { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
```

## Worked example: matching a shadcn/ui app

**If your app is already built on shadcn/ui**, it defines `--primary`, `--border`, `--radius`, `--muted`, etc. on `:root` (and usually a `.dark` override) via shadcn's own setup. Just load both stylesheets — no `--sa-*` overrides needed at all:

```html
<link rel="stylesheet" href="src/theme/base.css" />
<link rel="stylesheet" href="src/theme/shadcn.css" />
```

`shadcn.css` rewrites every `--sa-*` variable to `var(--primary, ...)`, `var(--border, ...)`, `var(--radius, ...)`, and so on, so simple-admin instantly inherits your app's shadcn palette, radius, and font — including dark mode, if your `.dark` class already redefines those shadcn tokens.

**If you just want the shadcn look but don't run shadcn/ui**, the same two-line include still applies — the preset's `oklch` fallbacks supply shadcn's default neutral palette and a ready-made dark theme, so you get the aesthetic (light *and* dark) without defining a single token yourself. Toggle dark by putting `class="dark"` or `data-theme="dark"` on `<html>`.

**If you're theming from scratch** (no shadcn tokens, just a custom look), skip `shadcn.css` and set the `--sa-*` variables directly, or target `sa-*` classes for anything the variables don't cover:

```css
:root {
  --sa-primary: #7c3aed;         /* violet appbar + primary buttons */
  --sa-primary-foreground: #fff;
  --sa-radius: 0.25rem;          /* squarer corners everywhere */
  --sa-border: #d4d4d8;
  --sa-font-sans: 'Inter', sans-serif;
}

/* Variables don't cover everything — reach for the class when you need to */
.sa-appbar {
  padding-inline: 2rem;
}
.sa-btn--primary {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
```

Both approaches can be mixed: load `shadcn.css` for the token inheritance, then layer a few `--sa-*` overrides or class-targeted rules afterward for the handful of details the shadcn mapping doesn't cover.

## No visual framework to fight

Beyond `base.css`'s structural rules, simple-admin has no visual framework of its own — no component library aesthetic, no opinionated skin to override. `base.css` is intentionally minimal: enough spacing/borders/focus-states to be usable out of the box, with every color, radius, and spacing decision expressed as an overridable `--sa-*` custom property. The expectation is that you style it — via `shadcn.css`'s token mapping, your own `--sa-*` overrides, or plain CSS against the `sa-*` classes and `data-sa-part` attributes — not that you work around it.
