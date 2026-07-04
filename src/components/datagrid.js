// SaDatagrid — <sa-datagrid> keyed-row table (doc 10 §8.2, doc 04 §2).
//
// Children-as-columns: any light-DOM child exposing `.toDescriptor()` (i.e. a `sa-*-field`,
// built on BaseField) becomes a column. Those originals are detached immediately and used only
// as clone templates — one clone per row, appended to a fresh <sa-datagrid-row> AFTER its
// `.record` is set, so RECORD_HOST_TAGS lookups (findRecordContext) always resolve. Rows are
// reconciled by `record.id` on every data change instead of being rebuilt from scratch.

import { effect } from '../core/signal.js';
import { findListContext } from '../core/context.js';
import { navigate } from '../core/router.js';
import { humanize } from '../core/util.js';
import { cloneWithDescriptors } from '../fields/templateChildren.js';
import * as diagnostics from '../core/diagnostics.js';

const BULK_BUTTON_RE = /^sa-bulk-.+-button$/;

// Publishes __recordContext on itself before its (cloned) sa-*-field children ever connect.
export class SaDatagridRow extends HTMLElement {
  constructor() {
    super();
    this.__recordContext = null;
    this._record = null;
  }
  set record(value) {
    this._record = value;
    this.__recordContext = { record: value };
  }
  get record() {
    return this._record;
  }
}

export class SaDatagrid extends HTMLElement {
  constructor() {
    super();
    this._rowMap = new Map(); // id -> <sa-datagrid-row>
    this._fieldTemplates = [];
    this._bulkButtons = [];
  }

  // `_listController` must be re-looked-up on EVERY connect (never cached past a reconnect): the
  // ancestor <sa-list> publishes a brand-new ListController instance on its own reconnect (see the
  // matching comment in list.js) whenever <sa-admin>'s dataProvider is set after it already
  // connected, and a spec-compliant single insertBefore/appendChild of an already-built subtree
  // processes connected-callback reactions in tree order (parent before descendants), so the
  // fresh controller is guaranteed to already be published by the time this runs.
  //
  // `_collectChildren()`/`_buildTable()` (turning light-DOM template children into `_fieldTemplates`
  // and building the actual <table>) must run AT MOST ONCE per element instance — they're
  // destructive (detach-and-classify) and idempotent-unsafe (appending a fresh <table> without
  // removing the previous one), so re-running them on a reconnect would duplicate the whole
  // rendered table instead of reusing it.
  //
  // That first-time build is ALSO deferred one microtask, and this is load-bearing, not
  // cosmetic: `_collectChildren()` decides "is this child a real field template?" via
  // `typeof node.toDescriptor === 'function'` — a duck-type check that is only true once that
  // child's custom element class has actually upgraded it. For an already-fully-parsed static
  // document, `customElements.define()` upgrades matching elements in **define()-call order**,
  // not tree order across different tag names — so depending on which of "sa-datagrid" or e.g.
  // "sa-text-field" happens to get defined first while the module graph loads, a child could
  // still be a plain, not-yet-upgraded element (no `.toDescriptor` yet) at the exact moment this
  // ran synchronously, making every column look "unknown" and get dropped (this was observed:
  // reordering src/index.js to register components before fields "fixed" one direction of this
  // race and immediately exposed the other — an empty datagrid with only its checkbox column).
  // Waiting one microtask defers past the ENTIRE synchronous module-load + inline-script phase
  // (module evaluation and any non-async inline script body run fully before any microtask gets a
  // turn), so by the time this actually runs, every custom element type is defined and every
  // already-parsed instance is upgraded — regardless of registration order. This eliminates the
  // race outright instead of just picking a side, so registration order in index.js no longer
  // matters for this.
  connectedCallback() {
    this.classList.add('sa-datagrid');

    this._listController = findListContext(this);
    if (!this._listController) {
      diagnostics.warn('datagrid-no-list', {});
      return;
    }

    if (this._domBuilt) {
      this._wireEffects();
      return;
    }
    if (this._domBuildScheduled) return;
    this._domBuildScheduled = true;
    queueMicrotask(() => {
      this._domBuildScheduled = false;
      if (!this.isConnected) return; // disconnected again before we got a chance to build
      this._domBuilt = true;
      this._collectChildren();
      this._resolveOptions();
      this._buildTable();
      this._wireEffects();
    });
  }

  disconnectedCallback() {
    if (this._disposeData) this._disposeData();
    if (this._disposeSelection) this._disposeSelection();
    this._disposeData = null;
    this._disposeSelection = null;
  }

  // Detach every original light-DOM child before it can connect on its own — bulk-action
  // buttons get re-homed into the toolbar (once), field elements become clone-only templates
  // that never connect directly (only their per-row clones do, once a record is set).
  _collectChildren() {
    for (const node of Array.from(this.childNodes)) {
      node.remove();
      if (node.nodeType !== 1) continue;
      const tag = node.localName;
      if (BULK_BUTTON_RE.test(tag)) {
        this._bulkButtons.push(node);
      } else if (typeof node.toDescriptor === 'function') {
        this._fieldTemplates.push(node);
      } else {
        diagnostics.warn('unknown-element', {
          tag,
          parentTag: 'sa-datagrid',
          resource: this._listController.resource,
        });
      }
    }
  }

  _resolveOptions() {
    const rawBulk =
      this.getAttribute('bulk-actions') ??
      (this._listController.descriptor && this._listController.descriptor.bulkActions);
    this._bulkEnabled = !(rawBulk === 'none' || (Array.isArray(rawBulk) && rawBulk.length === 0));

    const rawRowClick =
      this.getAttribute('row-click') ??
      (this._listController.descriptor && this._listController.descriptor.rowClick);
    this._rowClick =
      rawRowClick === undefined ||
      rawRowClick === false ||
      rawRowClick === 'false' ||
      rawRowClick === 'none'
        ? false
        : rawRowClick;
  }

  _buildTable() {
    const table = document.createElement('table');
    table.className = 'sa-datagrid__table';
    table.setAttribute('data-sa-part', 'table');

    const thead = document.createElement('thead');
    thead.className = 'sa-datagrid__head';
    thead.setAttribute('data-sa-part', 'head');

    const headRow = document.createElement('tr');
    headRow.className = 'sa-datagrid__row sa-datagrid__row--header';
    headRow.setAttribute('data-sa-part', 'header-row');

    if (this._bulkEnabled) {
      const th = document.createElement('th');
      th.className = 'sa-datagrid__cell sa-datagrid__cell--checkbox';
      th.setAttribute('data-sa-part', 'header-cell');
      this._selectAll = document.createElement('input');
      this._selectAll.type = 'checkbox';
      this._selectAll.className = 'sa-datagrid__select-all';
      this._selectAll.addEventListener('change', () => {
        const ids = this._listController.data.peek().map((r) => r.id);
        if (this._selectAll.checked) {
          for (const id of ids) this._listController.select(id);
        } else {
          for (const id of ids) this._listController.deselect(id);
        }
      });
      th.appendChild(this._selectAll);
      headRow.appendChild(th);
    }

    for (const template of this._fieldTemplates) {
      const descriptor = template.toDescriptor();
      const th = document.createElement('th');
      th.className = 'sa-datagrid__cell sa-datagrid__cell--header';
      th.setAttribute('data-sa-part', 'header-cell');
      th.textContent = descriptor.label != null ? descriptor.label : humanize(descriptor.source);

      if (descriptor.sortable !== false && descriptor.source) {
        th.classList.add('sa-datagrid__cell--sortable');
        th.addEventListener('click', () => {
          this._listController.setSort(descriptor.sortBy || descriptor.source, descriptor.sortByOrder);
        });
      }
      headRow.appendChild(th);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    this._tbody = document.createElement('tbody');
    this._tbody.className = 'sa-datagrid__body';
    this._tbody.setAttribute('data-sa-part', 'body');
    table.appendChild(this._tbody);

    this._toolbar = document.createElement('div');
    this._toolbar.className = 'sa-datagrid__bulk-toolbar';
    this._toolbar.setAttribute('data-sa-part', 'bulk-toolbar');
    this._toolbar.hidden = true;
    for (const button of this._bulkButtons) this._toolbar.appendChild(button);

    this.appendChild(this._toolbar);
    this.appendChild(table);
  }

  _wireEffects() {
    this._disposeData = effect(() => {
      const rows = this._listController.data.get();
      this._reconcileRows(rows);
    });

    this._disposeSelection = effect(() => {
      const selected = this._listController.selectedIds.get();
      this._toolbar.hidden = selected.length === 0;
      for (const [id, row] of this._rowMap) {
        const isSelected = selected.includes(id);
        row.classList.toggle('sa-datagrid__row--selected', isSelected);
        if (row._checkbox) row._checkbox.checked = isSelected;
      }
      if (this._selectAll) {
        const ids = this._listController.data.peek().map((r) => r.id);
        this._selectAll.checked = ids.length > 0 && ids.every((id) => selected.includes(id));
      }
    });
  }

  // Reconcile <tbody> children by record.id: remove stale rows, reuse/move existing ones,
  // create rows only for genuinely new ids.
  _reconcileRows(rows) {
    const nextIds = new Set(rows.map((r) => r.id));
    for (const [id, row] of Array.from(this._rowMap)) {
      if (!nextIds.has(id)) {
        row.remove();
        this._rowMap.delete(id);
      }
    }

    let cursor = this._tbody.firstChild;
    for (const record of rows) {
      let row = this._rowMap.get(record.id);
      if (!row) {
        row = this._createRow(record);
        this._rowMap.set(record.id, row);
      } else {
        row.record = record;
      }
      if (cursor !== row) {
        this._tbody.insertBefore(row, cursor);
      } else {
        cursor = cursor.nextSibling;
      }
    }
  }

  _createRow(record) {
    const row = document.createElement('sa-datagrid-row');
    row.className = 'sa-datagrid__row';
    row.setAttribute('data-sa-part', 'row');
    row.record = record; // publish __recordContext before any cell/field connects

    if (this._bulkEnabled) {
      const td = document.createElement('td');
      td.className = 'sa-datagrid__cell sa-datagrid__cell--checkbox';
      td.setAttribute('data-sa-part', 'cell');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'sa-datagrid__select';
      checkbox.addEventListener('click', (evt) => evt.stopPropagation());
      checkbox.addEventListener('change', () => this._listController.toggleSelect(record.id));
      td.appendChild(checkbox);
      row.appendChild(td);
      row._checkbox = checkbox;
    }

    for (const template of this._fieldTemplates) {
      const td = document.createElement('td');
      td.className = 'sa-datagrid__cell';
      td.setAttribute('data-sa-part', 'cell');
      td.appendChild(cloneWithDescriptors(template));
      row.appendChild(td);
    }

    if (this._rowClick) {
      row.classList.add('sa-datagrid__row--clickable');
      row.addEventListener('click', (evt) => {
        if (evt.target.closest('input, a, button')) return;
        this._handleRowClick(record);
      });
    }

    return row;
  }

  _handleRowClick(record) {
    const resource = this._listController.resource;
    if (this._rowClick === 'show') navigate(`#/${resource}/${record.id}/show`);
    else if (this._rowClick === 'edit') navigate(`#/${resource}/${record.id}`);
    else if (this._rowClick === 'expand') {
      // Expand panels are not implemented in this v1 pass.
    } else if (typeof this._rowClick === 'function') {
      const path = this._rowClick(record.id, resource, record);
      if (path) navigate(path);
    }
  }
}

if (!customElements.get('sa-datagrid-row')) customElements.define('sa-datagrid-row', SaDatagridRow);
if (!customElements.get('sa-datagrid')) customElements.define('sa-datagrid', SaDatagrid);

export default SaDatagrid;
