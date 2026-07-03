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
        diagnostics.warn('field-no-record-context', {
          tag: this.localName,
          source: this.source,
        });
        return;
      }

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
