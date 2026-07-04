// SaFilters — <sa-filters> filter form/dropdown (doc 10 §8, doc 04 §3).
//
// Publishes `this.formStore`, a FormStore-shaped adapter backed directly by the SAME
// ListController.filterValues signal used by the rest of the list — `setField` writes through
// `listController.setFilterValue` (which the store already debounces 500ms), so `sa-*-input`
// children (BaseInput) work completely unmodified via `this.closest('sa-simple-form,
// sa-tabbed-form, sa-filters').formStore`.

import { findListContext } from '../core/context.js';
import { getByPath } from '../core/util.js';
import { signal } from '../core/signal.js';
import * as diagnostics from '../core/diagnostics.js';

// Adapter object, NOT createFormController() — filters have no independent values store; they
// read/write straight through to ListController.filterValues so debouncing stays centralized.
//
// Takes a GETTER for the controller, not the controller itself, and every method dereferences it
// at call time. This lets <sa-filters> keep ONE stable formStore object for the element's whole
// lifetime while still always writing through the CURRENT ListController: custom-element
// reaction batches during boot can interleave so that a child input's (re)connect — which caches
// `this._form = host.formStore` — lands between two <sa-filters> reconnects. With a fresh
// adapter object per connect, that input ends up committing into the previous, already-disposed
// controller's filterValues, and typing into the filter silently does nothing.
const createFilterFormStore = (getListController) => {
  const registry = new Map();
  const errors = signal({});
  const touched = signal({});

  return {
    get values() {
      return getListController().filterValues;
    },
    errors,
    touched,
    getField: (source) => getByPath(getListController().filterValues.get(), source),
    setField: (source, value) => getListController().setFilterValue(source, value),
    setValues: (next) => getListController().setFilters(next),
    getError: () => undefined,
    isTouched: () => false,
    touch: () => {},
    register: (source, options = {}) => registry.set(source, options),
    unregister: (source) => registry.delete(source),
    validateField: () => undefined,
    validateAll: () => true,
    reset: () => getListController().setFilters({}),
  };
};

export class SaFilters extends HTMLElement {
  // `_listController`/`formStore` must be rebuilt on EVERY connect, never cached past a
  // reconnect: without a disconnectedCallback resetting some "already bound" flag, a stale
  // `formStore` left over from BEFORE a reconnect would stay wired to an already-disposed
  // ListController (its `filterValues` signal no longer drives the visible list at all) — typing
  // into a filter would silently do nothing. This mirrors the same reconnect scenario documented
  // in list.js/datagrid.js: whenever <sa-admin>'s dataProvider is set after it already connected,
  // every already-mounted view (including this one) disconnects and reconnects once.
  //
  // `_layoutChildren()` is still gated to run at most ONCE per element instance: it destructively
  // detaches and re-homes its light-DOM `sa-*-input` children into wrapper rows, so re-running it
  // would try to detach children that already live inside those wrapper rows instead of directly
  // under `this` — harmless to skip on reconnect since the wrapper rows and their input children
  // persist across a disconnect/reconnect exactly like a datagrid's rendered table does.
  connectedCallback() {
    this.classList.add('sa-filters');

    this._listController = findListContext(this);
    if (!this._listController) return; // degrade: no ancestor <sa-list>, nothing to bind to.

    // Publish before any sa-*-input child connects and looks up `.formStore`.
    // The adapter is created ONCE per element and dereferences this._listController at call
    // time, so inputs that cached `formStore` during ANY earlier connect still write through the
    // live controller after a reconnect replaced it (see createFilterFormStore's comment).
    if (!this.formStore) {
      this.formStore = createFilterFormStore(() => this._listController);
    }
    this.__formContext = this.formStore;

    if (!this._domBuilt) {
      this._domBuilt = true;
      this._layoutChildren();
    }
  }

  _layoutChildren() {
    const alwaysOnRow = document.createElement('div');
    alwaysOnRow.className = 'sa-filters__always-on';
    alwaysOnRow.setAttribute('data-sa-part', 'always-on');

    const hiddenRow = document.createElement('div');
    hiddenRow.className = 'sa-filters__hidden';
    hiddenRow.setAttribute('data-sa-part', 'hidden-filters');
    hiddenRow.hidden = true;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sa-filters__toggle';
    toggle.setAttribute('data-sa-part', 'add-filter');
    toggle.textContent = 'Add filter';
    toggle.addEventListener('click', () => {
      hiddenRow.hidden = !hiddenRow.hidden;
    });

    let hasHidden = false;

    for (const child of Array.from(this.childNodes)) {
      child.remove();
      if (child.nodeType !== 1) continue;
      const alwaysOn = child.hasAttribute('always-on');
      const hasDefault = child.hasAttribute('default-value');

      if (alwaysOn && hasDefault) {
        diagnostics.warn('filter-alwayson-defaultvalue', {
          tag: child.localName,
          source: child.getAttribute('source'),
        });
        child.removeAttribute('default-value');
      }

      if (alwaysOn) {
        alwaysOnRow.appendChild(child);
      } else {
        hiddenRow.appendChild(child);
        hasHidden = true;
      }
    }

    this.appendChild(alwaysOnRow);
    if (hasHidden) {
      this.appendChild(toggle);
      this.appendChild(hiddenRow);
    }
  }
}

if (!customElements.get('sa-filters')) customElements.define('sa-filters', SaFilters);

export default SaFilters;
