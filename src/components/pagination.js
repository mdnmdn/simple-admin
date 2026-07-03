// SaPagination — <sa-pagination> "1–N of Total" + prev/next + page-size (doc 10 §8, doc 04 §4).

import { findListContext } from '../core/context.js';
import { effect } from '../core/signal.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaPagination extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.classList.add('sa-pagination');

    this._listController = findListContext(this);
    if (!this._listController) {
      diagnostics.warn('pagination-no-list', {});
      return;
    }

    this._render();
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
    this._dispose = null;
    this._built = false;
  }

  // The prev/info/next/select DOM must only ever be built ONCE per element instance — these are
  // persistent children that survive a disconnect (disconnectedCallback never removes them), so
  // rebuilding them on every reconnect would append a second (third, ...) set of buttons into the
  // same element instead of replacing anything. This legitimately happens whenever the parent
  // <sa-list> is detached/reattached (see the matching comment in components/list.js). Only the
  // reactive effect needs rewiring each connect, since `this._listController` is a fresh instance
  // on every reconnect and the previous effect was already disposed in disconnectedCallback.
  _render() {
    if (!this._domBuilt) {
      this._domBuilt = true;
      this._buildDom();
    }
    this._wireEffect();
  }

  _buildDom() {
    const info = document.createElement('span');
    info.className = 'sa-pagination__info';
    info.setAttribute('data-sa-part', 'info');

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'sa-pagination__prev';
    prev.setAttribute('data-sa-part', 'prev');
    prev.textContent = 'Prev';
    prev.addEventListener('click', () => {
      this._listController.setPage(Math.max(1, this._listController.page.peek() - 1));
    });

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'sa-pagination__next';
    next.setAttribute('data-sa-part', 'next');
    next.textContent = 'Next';
    next.addEventListener('click', () => {
      this._listController.setPage(this._listController.page.peek() + 1);
    });

    this.appendChild(prev);
    this.appendChild(info);
    this.appendChild(next);

    let select = null;
    const optsAttr = this.getAttribute('rows-per-page');
    if (optsAttr) {
      const options = optsAttr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      select = document.createElement('select');
      select.className = 'sa-pagination__per-page';
      select.setAttribute('data-sa-part', 'per-page');
      for (const n of options) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        this._listController.setPerPage(Number(select.value));
      });
      this.appendChild(select);
    }

    this._info = info;
    this._prev = prev;
    this._next = next;
    this._select = select;
  }

  _wireEffect() {
    const { _info: info, _prev: prev, _next: next, _select: select } = this;
    this._dispose = effect(() => {
      const total = this._listController.total.get();
      const page = this._listController.page.get();
      const perPage = this._listController.perPage.get();
      const start = total === 0 ? 0 : (page - 1) * perPage + 1;
      const end = Math.min(page * perPage, total);
      info.textContent = `${start}–${end} of ${total}`;
      prev.disabled = page <= 1;
      next.disabled = page * perPage >= total;
      if (select && Number(select.value) !== perPage) select.value = String(perPage);
    });
  }
}

if (!customElements.get('sa-pagination')) customElements.define('sa-pagination', SaPagination);

export default SaPagination;
