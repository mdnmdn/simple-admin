# simple-admin — Open Questions & Decisions to Revisit

> Honest list of the judgment calls made in `10-simple-admin-architecture.md`. Each has a stated
> recommendation (already baked into the proposal) but is worth a project-owner sanity check before
> implementation starts. Ordered roughly by impact.

---

### 1. Hash routing vs History API
**Decision:** Default to **hash routing** (`#/posts/5`), with History API as an opt-in (`routing:'history'`, `basename`).
**Why revisit:** Hash routing is the safe, zero-server-config choice for a drop-a-script-tag library and works from `file://`, CDN demos, and GitHub Pages. But it looks less "modern" and complicates deep-link SEO (irrelevant for admin tools, but some owners care about clean URLs). **Recommendation: keep hash as default; ship History mode in v0.2.** Confirm you're OK with `#/` URLs in the MVP.

### 2. Shadow DOM vs light DOM
**Decision:** **Light DOM** for all components; theming via `sa-` classes, `data-sa-part` attributes, and `--sa-*` CSS variables.
**Why revisit:** This is the single biggest architectural bet. Light DOM makes Tailwind/shadcn theming trivial but sacrifices style encapsulation (page CSS can bleed into our nodes). Shadow DOM would isolate styles but actively fights utility-class ecosystems. Given the explicit shadcn-compatibility requirement, light DOM is correct — but if the owner later prioritizes embedding into hostile/unknown host pages over Tailwind friendliness, this would flip. **Recommendation: light DOM. This is a hard-to-reverse decision; confirm before building.**

### 3. Minimal i18n now, or none?
**Decision:** Ship only the **humanize-`source`→label + `label` override + a single `translate()` seam** in v1; full Polyglot-style dictionaries in v0.3.
**Why revisit:** A real admin for a non-English team needs i18n early. But a full i18n layer is significant surface area for an MVP whose main job is proving the dual-syntax + provider-compat thesis. **Recommendation: defer full i18n; make sure the `translate()` seam is in from day one so adding it later isn't a refactor.**

### 4. How aggressive should the "unknown field" warnings be?
**Decision:** Warn on unknown tags, missing `source`, missing provider methods, undeclared references, etc. — deduped, with a global `setLogLevel`.
**Why revisit:** Too chatty and developers tune it out; too quiet and the DX nicety is lost. Open sub-questions: should an unknown `sa-*` tag *throw* in a `strict` mode? Should missing-`source` be `error` (proposed) or `warn`? Should we warn about *unused* declared resources? **Recommendation: warn-by-default, dedupe hard, offer `setLogLevel('strict')` that upgrades warns to throws for CI/dev. Confirm the error-vs-warn split in `10 §11`.**

### 5. Byte-identical descriptors from both syntaxes, or just equivalent behavior?
**Decision:** Aim for **structurally identical** descriptors (same keys/nesting), require only behavioral equivalence.
**Why revisit:** Byte-identical guarantees the two syntaxes are perfectly interchangeable and debuggable, but forces the HTML parser and JS factories to agree on every default and key order — extra discipline and tests. Pure behavioral equivalence is looser and cheaper. **Recommendation: enforce structural identity via a shared normalization function both paths call, and a round-trip test. Worth the cost; it's what makes "both first-class" real rather than marketing.**

### 6. Mutation modes — pessimistic-only in v1?
**Decision:** **Pessimistic only** in v0.1; optimistic + undoable in v0.3.
**Why revisit:** Undoable-by-default-on-Edit is one of react-admin's signature UX features, and its absence is the most visible behavioral gap for someone coming from react-admin. But it needs cache snapshot/rollback + a delayed-commit queue + undo toast — genuinely coupled to react-query in the original. **Recommendation: pessimistic v1 is the right scope cut; flag clearly in docs that undoable is coming, since react-admin users will notice immediately.**

### 7. Bundled provider twins vs import-map for `ra-data-*` packages
**Decision:** Ship our own `saDataSimpleRest`/`saDataJsonServer` twins **and** document the import-map route to use the literal npm packages.
**Why revisit:** Twins mean zero-install onboarding but a maintenance burden (keeping wire-format parity as `ra-data-*` evolves). Import-maps mean using the real packages but require a CDN/ESM resolution step users may find fiddly. **Recommendation: ship twins for the two REST flavors (they're ~50 lines each), rely on import-map for exotic providers. Confirm we're comfortable maintaining the twins.**

### 8. Validator DSL string vs JS-only validators
**Decision:** Support a `validate="required|minLength:2"` **string DSL** for HTML plus arrays of factory functions for JS/custom/async.
**Why revisit:** The DSL is ergonomic for markup but can't express regex literals, async checks, or cross-field logic — those force the `.validate` JS property, creating two mental models. **Recommendation: keep the DSL for the common built-ins only, and make the fallback to `.validate` prominent in docs. Confirm the DSL separator (`|`) doesn't clash with anything (it doesn't in HTML attributes).**

### 9. Custom-element naming: `sa-` prefix and 1:1 PascalCase mapping
**Decision:** `sa-` prefix, mechanical PascalCase→kebab mapping (`ReferenceInput`→`sa-reference-input`).
**Why revisit:** Pure bikeshedding, but locks in publicly. Alternatives: shorter prefix (`s-`), or a namespace (`admin-list`). `sa-` reads well, is unlikely to collide, and the 1:1 mapping maximizes react-admin muscle-memory. **Recommendation: keep `sa-`. Only change now if the owner has a branding preference, since renaming later is a breaking change.**

### 10. Reactive core: hand-rolled signals vs a tiny vendored library
**Decision:** **Hand-roll** signals + targeted DOM patching (~200 lines, zero deps).
**Why revisit:** Several excellent tiny signal libs exist (e.g. preact/signals-core, ~1KB). Vendoring one saves us writing/testing the reactive core; hand-rolling keeps the "zero deps, everything from scratch" promise and avoids ESM-resolution questions. **Recommendation: hand-roll — it's genuinely small, and owning it avoids a dependency in a library that markets "no install." Revisit only if the core proves buggy.**

### 11. DOM-ancestry context vs an explicit context registry
**Decision:** Resolve record/list/form context via `element.closest('sa-…')` walking the DOM.
**Why revisit:** DOM-ancestry is simple and matches how the markup reads, but breaks if a field is portaled/moved out of its logical parent, and does a tree-walk on every lookup (cheap, but not free). An explicit registry (each container registers a context id its children reference) is more robust but more machinery. **Recommendation: DOM-ancestry for v1 (memoize the closest() result per component); switch to a registry only if portaling/teleporting becomes a feature.**

### 12. getMany batching granularity
**Decision:** Per-microtask id batcher keyed by `reference`, flushed at end-of-tick.
**Why revisit:** This reproduces react-admin's N+1 avoidance, but the flush timing (microtask vs a short `setTimeout`) affects how many references coalesce, especially with async-rendered rows. Too eager and we split into several `getMany`s; too lazy and first paint is delayed. **Recommendation: microtask flush + the Map cache to catch stragglers. Fine to tune after measuring on a real 100-row grid.**

### 13. `sanitizeEmptyValues` / empty-string handling default
**Decision:** Off by default (opt-in via attribute), matching react-admin.
**Why revisit:** Some backends choke on `""` where they expect `null` or absent. react-admin defaults it off, so we match for compatibility, but it's a common footgun. **Recommendation: match react-admin (off by default) for least surprise to migrants; document it prominently.**

### 14. How much of `<Show>` and non-table list layouts in the MVP?
**Decision:** `sa-show` + simple show layout in v0.1; tabbed show, `sa-simple-list`, expand panels in v0.2.
**Why revisit:** Show is arguably optional for an MVP (Edit covers viewing), but it's cheap given the shared field vocabulary. Simple-list matters for mobile. **Recommendation: keep simple Show in v1 (near-free), defer the rest. Confirm mobile/simple-list isn't a v1 must-have for the owner's use case.**

### 15. Public API entry shape: `SimpleAdmin.admin().mount()` vs auto-mount on `<sa-admin>`
**Decision:** Support both — JS `SimpleAdmin.admin({...}).mount('#app')`, and a self-mounting `<sa-admin>` element whose `.dataProvider`/`.authProvider` are set imperatively.
**Why revisit:** Two entry points is more to document and test, but is exactly the "both syntaxes first-class" promise. A risk is subtle divergence in lifecycle/ordering between the two. **Recommendation: keep both, but route both through the same internal `bootAdmin(descriptor)` so there's one code path. Confirm the owner wants the pure-HTML (no `<script>` config) path to be truly first-class, since it constrains how providers get injected (must be settable as a property/attribute).**
