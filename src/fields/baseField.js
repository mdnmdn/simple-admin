// BaseField mixin factory (doc 13 §2) — every display field is
// `class Xxx extends BaseField(HTMLElement)`. It provides source resolution (dot-path aware),
// RecordContext lookup, label derivation, empty handling, the render effect + teardown, and the
// missing-source diagnostic. A concrete field only overrides `renderValue` (and maybe `renderEmpty`).

import { signal, effect } from '../core/signal.js';
import { findRecordContext, contextLabel } from '../core/context.js';
import { humanize, getByPath } from '../core/util.js';
import { absorbAttributes, applyAttribute } from '../core/descriptor.js';
import { parseValidatorDSL } from '../validators/index.js';
import * as diagnostics from '../core/diagnostics.js';

// If `.descriptor` was assigned while this element was NOT yet upgraded (e.g. a field cloned as
// inert <template> content by a composite field or the datagrid — cloneNode of template content
// produces un-upgraded custom elements), the assignment became an own data property shadowing the
// prototype accessor, and the constructor's `_descriptor = {kind}` default then clobbered it on
// upgrade. Re-run the assignment through the real setter after upgrade so JS-config descriptors
// survive cloning. No-op for HTML-authored fields (they configure via attributes, not .descriptor).
const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};

export const BaseField = (Base = HTMLElement) =>
  class extends Base {
    // Attributes shared by ALL fields. Concrete fields extend via [...super.observedAttributes, …].
    static get observedAttributes() {
      return ['source', 'label', 'empty-text'];
    }

    constructor() {
      super();
      // NO DOM work in the constructor (doc 10 §3.3): metadata only.
      this._descriptor = { kind: 'field' };
      this._recordCtx = null;
      this._dispose = null;
      this._version = signal(0); // bumped to force a re-render on descriptor change
      this._renderScheduled = false;
    }

    // ---- descriptor plumbing. HTML path reads attributes; JS path sets .descriptor directly. ----
    toDescriptor() {
      return this._descriptor;
    }
    set descriptor(d) {
      this._descriptor = { kind: 'field', ...d };
      this._scheduleRender();
    }
    get descriptor() {
      return this._descriptor;
    }

    get source() {
      return this._descriptor.source;
    }
    get emptyText() {
      return this._descriptor.emptyText ?? '';
    }

    // Explicit override, else humanized source. label="" (empty string) suppresses the label.
    get label() {
      if (this._descriptor.label != null) return this._descriptor.label;
      return this.source ? humanize(this.source) : '';
    }

    // The value this field renders — `source` resolved (dot-path aware) against the record.
    getValue() {
      const record = this._recordCtx && this._recordCtx.record;
      if (!record) return undefined;
      return getByPath(record, this.source);
    }

    connectedCallback() {
      upgradeProperty(this, 'descriptor');
      if (this.isConnected) this._absorbAttributes();

      // Diagnostics: missing source (the function field is exempt — it reads the whole record).
      if (!this.source && this._descriptor.type !== 'function') {
        diagnostics.error('field-missing-source', {
          tag: this.localName,
          ctx: this._contextLabel(),
        });
        return; // degrade: render nothing, never throw.
      }

      this._recordCtx = findRecordContext(this);
      if (!this._recordCtx) {
        // Upgrade-order grace: at initial page upgrade this field can connect before its record
        // host (<sa-datagrid> row, <sa-show> layout, a parked <sa-edit> template, ...) has been
        // upgraded or has published its context. Retry once on the next microtask — by then the
        // whole module script (and any host upgrade) has run. Only warn if the field is STILL
        // connected and STILL context-less, i.e. genuinely misplaced markup.
        if (!this._retriedRecordContext) {
          this._retriedRecordContext = true;
          queueMicrotask(() => {
            if (!this.isConnected || this._dispose) return;
            this.connectedCallback();
          });
          return;
        }
        // Inert template markup never warns: HTML-authored view templates stay connected while
        // parked in <sa-admin>'s hidden authored host; a resource's non-active sibling views
        // (e.g. the <sa-show> fields while its list is displayed) stay connected but
        // display:none; and a field sitting directly under <sa-datagrid> (not inside a rendered
        // <sa-datagrid-row>) is a column template awaiting the datagrid's own deferred
        // detach-and-clone build. None of these has a record on purpose.
        const viewHost = this.closest('sa-list, sa-create, sa-edit, sa-show');
        const isParkedTemplate =
          this.closest('[data-sa-part="authored-resources"]') ||
          (viewHost && viewHost.style.display === 'none') ||
          (this.closest('sa-datagrid') && !this.closest('sa-datagrid-row'));
        if (!isParkedTemplate) {
          diagnostics.warn('field-no-record-context', {
            tag: this.localName,
            source: this.source,
          });
        }
        return;
      }
      this._retriedRecordContext = false;

      // Render effect: re-runs whenever the record signal (or descriptor version) changes.
      this._dispose = effect(() => {
        this._version.get();
        const value = this.getValue();
        if (value == null || value === '') {
          this.renderEmpty(this.emptyText);
        } else {
          this.renderValue(value, this._recordCtx.record);
        }
      });
    }

    attributeChangedCallback(name, _old, val) {
      this._patchFromAttribute(name, val);
      this._scheduleRender();
    }

    disconnectedCallback() {
      if (this._dispose) this._dispose();
      this._dispose = null;
      this._recordCtx = null;
      this._retriedRecordContext = false; // fresh one-microtask grace on the next connect
    }

    // ---- render seams a concrete field MAY override ----
    renderValue(value /*, record */) {
      this.textContent = String(value);
    }
    renderEmpty(emptyText) {
      this.textContent = emptyText;
    }

    // ---- internals provided by the mixin ----
    _absorbAttributes() {
      absorbAttributes(this._descriptor, this);
    }

    _patchFromAttribute(name, val) {
      if (name === 'validate') {
        this._descriptor.validate = parseValidatorDSL(val, {
          tag: this.localName,
          source: this._descriptor.source,
        });
        return;
      }
      applyAttribute(this._descriptor, name, val);
    }

    _scheduleRender() {
      if (this._renderScheduled) return;
      this._renderScheduled = true;
      queueMicrotask(() => {
        this._renderScheduled = false;
        this._version.set(this._version.peek() + 1);
      });
    }

    _contextLabel() {
      return contextLabel(this);
    }
  };

export default BaseField;
