// BaseInput mixin factory (doc 13 §3) — every form input is
// `class Xxx extends BaseInput(HTMLElement)`. Inputs are dumb, source-tagged views over one
// centralized FormStore (doc 10 §9.2). BaseInput handles FormStore lookup, register/unregister,
// read/write via getField/setField, validation compilation, format/parse, label (with required
// "*"), disabled/readOnly/helperText, dirty/touched, and the missing-source/missing-form
// diagnostics. A concrete input implements renderControl() + updateControl(value) and wires its
// control events to commit()/markTouched().

import { signal, effect } from '../core/signal.js';
import { humanize } from '../core/util.js';
import { compileValidators } from '../validators/index.js';
import { absorbAttributes, applyAttribute } from '../core/descriptor.js';
import { contextLabel } from '../core/context.js';
import * as diagnostics from '../core/diagnostics.js';

// See baseField.js for the full rationale: restores a `.descriptor` assigned before upgrade (as
// happens to inputs cloned inside inert <template> content) so JS-config descriptors survive
// cloning. No-op for HTML-authored inputs.
const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};

export const BaseInput = (Base = HTMLElement) =>
  class extends Base {
    static get observedAttributes() {
      return [
        'source',
        'label',
        'default-value',
        'disabled',
        'read-only',
        'helper-text',
        'validate',
      ];
    }

    constructor() {
      super();
      this._descriptor = { kind: 'input' };
      this._form = null;
      this._validators = [];
      this._dispose = null;
      this._version = signal(0);
      this._renderScheduled = false;
    }

    toDescriptor() {
      return this._descriptor;
    }
    set descriptor(d) {
      this._descriptor = { kind: 'input', ...d };
      this._scheduleRender();
    }
    get descriptor() {
      return this._descriptor;
    }

    get source() {
      return this._descriptor.source;
    }
    get disabled() {
      return !!this._descriptor.disabled;
    }
    get readOnly() {
      return !!this._descriptor.readOnly;
    }
    get helperText() {
      return this._descriptor.helperText ?? '';
    }

    get label() {
      const base =
        this._descriptor.label != null
          ? this._descriptor.label
          : this.source
          ? humanize(this.source)
          : '';
      return base + (this.isRequired && base ? ' *' : '');
    }
    get isRequired() {
      return this._validators.some((v) => v.isRequired);
    }

    // ---- format / parse converters (store value <-> control value) ----
    format(storeValue) {
      return (this._descriptor.format ?? ((v) => v ?? ''))(storeValue);
    }
    parse(controlValue) {
      return (this._descriptor.parse ?? ((v) => v))(controlValue);
    }

    connectedCallback() {
      upgradeProperty(this, 'descriptor');
      if (this.isConnected) this._absorbAttributes();

      if (!this.source) {
        // Don't report yet: sa-select-input/sa-autocomplete-input/sa-autocomplete-array-input are
        // legitimately sourceless when authored as a declared child of sa-reference-input/
        // sa-reference-array-input — referenceShared.js's patchChildAsDelegate() turns them into
        // rendering-only delegates with no source of their own, by overwriting THIS INSTANCE's
        // own `connectedCallback` property (shadowing the prototype method below). Whether that
        // capture has happened yet is a custom-element registration-order race (see doc 03 §7 /
        // verification-plan.md bug 1 for the sibling race in <sa-datagrid>): if this tag's
        // define() call ran before its parent's, THIS invocation — the original prototype
        // method — fires and returns, with no source, before the parent ever gets a chance to
        // detach/patch it. It may even get synchronously re-appended into the parent's control
        // before we get a turn, so `isConnected` alone can't tell us whether that happened —
        // check whether `connectedCallback` has since become an own property (the delegate
        // patch) instead, which is unaffected by any of that reparenting.
        queueMicrotask(() => {
          if (this.source) return;
          if (Object.prototype.hasOwnProperty.call(this, 'connectedCallback')) return;
          if (!this.isConnected) return;
          diagnostics.error('input-missing-source', {
            tag: this.localName,
            ctx: this._contextLabel(),
          });
        });
        return; // degrade, never throw.
      }

      // Compile validators once (fn[] or DSL string). required() flips isRequired.
      this._validators = compileValidators(this._descriptor.validate, {
        tag: this.localName,
        source: this.source,
      });

      // Locate the FormStore by DOM ancestry. Filters share the same lookup (doc 13 §4).
      const host = this.closest('sa-simple-form, sa-tabbed-form, sa-filters');
      this._form = host ? host.formStore : null;
      if (!this._form) {
        // Upgrade-order grace (same race as the sourceless case above): at initial page upgrade
        // this input can connect before its form host has been upgraded and built its FormStore.
        // Retry once on the next microtask; only warn if it is STILL connected with no store —
        // i.e. genuinely authored outside any form.
        if (!this._retriedFormLookup) {
          this._retriedFormLookup = true;
          queueMicrotask(() => {
            if (!this.isConnected || this._form || this._dispose) return;
            this.connectedCallback();
          });
          return;
        }
        // Only warn when there is genuinely NO form host in the ancestry — that's the "move it
        // inside a form" mistake the message describes. If a host element EXISTS but hasn't
        // published its formStore yet (upgrade order, or a parked/hidden template view — same
        // rule as baseField's no-record-context case), the input isn't misplaced; it re-binds
        // when the host wires up on its own connect/reconnect.
        const viewHost = this.closest('sa-list, sa-create, sa-edit, sa-show');
        const isParkedTemplate =
          host ||
          this.closest('[data-sa-part="authored-resources"]') ||
          (viewHost && viewHost.style.display === 'none');
        if (!isParkedTemplate) {
          diagnostics.warn('input-no-form', { tag: this.localName, source: this.source });
        }
        return;
      }
      this._retriedFormLookup = false;

      // Register this source with the form: seed defaultValue, validators, parse/format.
      this._form.register(this.source, {
        defaultValue: this._descriptor.defaultValue,
        validators: this._validators,
        parse: (v) => this.parse(v),
        format: (v) => this.format(v),
      });

      this.renderControl(); // concrete input builds its control DOM once.

      // Reactive read: control reflects store value + error + touched + helper.
      this._dispose = effect(() => {
        this._version.get();
        const value = this._form.getField(this.source);
        const error = this._form.getError(this.source);
        const touched = this._form.isTouched(this.source);
        this.updateControl(this.format(value));
        this.renderError(touched ? error : undefined);
        this.renderHelper(this.helperText);
      });
    }

    // Concrete inputs call this from their control's 'input'/'change' listener.
    commit(controlValue) {
      if (this._form) this._form.setField(this.source, this.parse(controlValue));
    }
    // Concrete inputs call this on blur.
    markTouched() {
      if (this._form) this._form.touch(this.source);
    }

    attributeChangedCallback(name, _old, val) {
      this._patchFromAttribute(name, val);
      this._scheduleRender();
    }

    disconnectedCallback() {
      if (this._dispose) this._dispose();
      if (this._form && typeof this._form.unregister === 'function') {
        this._form.unregister(this.source);
      }
      this._form = null;
      this._dispose = null;
      this._retriedFormLookup = false; // fresh one-microtask grace on the next connect
    }

    // ---- seams a concrete input implements/overrides ----
    renderControl() {
      /* build control DOM once; MUST be implemented by concrete input */
    }
    updateControl(_formattedValue) {
      /* push store value into the control; MUST be implemented by concrete input */
    }
    renderError(message) {
      const node = this.querySelector('.sa-input__error');
      if (node) node.textContent = message || '';
    }
    renderHelper(text) {
      const node = this.querySelector('.sa-input__helper');
      if (node) node.textContent = text || '';
    }

    // ---- internals provided by the mixin ----
    _absorbAttributes() {
      absorbAttributes(this._descriptor, this);
    }

    _patchFromAttribute(name, val) {
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

export default BaseInput;
