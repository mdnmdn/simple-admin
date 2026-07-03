// Shell markup helpers for <sa-admin> (doc 10 §3.2/§5). Split out of admin.js purely to keep
// the orchestration file (routing/auth) free of DOM-assembly detail — these two functions build
// stateless, disposable DOM subtrees; admin.js owns when/how often to call them.

import { getAllResources } from '../core/registry.js';
import { currentRoute } from '../core/router.js';

// Appbar: title + optional identity + optional logout button.
export const renderAppBar = ({ title, identity, onLogout }) => {
  const header = document.createElement('header');
  header.className = 'sa-appbar';
  header.setAttribute('data-sa-part', 'appbar');

  const titleEl = document.createElement('span');
  titleEl.className = 'sa-appbar__title';
  titleEl.textContent = title || 'Admin';
  header.appendChild(titleEl);

  const spacer = document.createElement('span');
  spacer.className = 'sa-appbar__spacer';
  header.appendChild(spacer);

  if (identity) {
    const identityEl = document.createElement('span');
    identityEl.className = 'sa-appbar__identity';
    identityEl.setAttribute('data-sa-part', 'identity');
    identityEl.textContent = identity.fullName || String(identity.id ?? '');
    header.appendChild(identityEl);
  }

  if (onLogout) {
    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'sa-btn sa-appbar__logout';
    logoutBtn.setAttribute('data-sa-part', 'logout');
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', onLogout);
    header.appendChild(logoutBtn);
  }

  return header;
};

// Menu: one link per registered resource that declares a list view (doc 10 §5.2 — resources
// with no list view get no menu entry, per diagnostics 'resource-no-views').
export const renderMenu = () => {
  const nav = document.createElement('nav');
  nav.className = 'sa-menu';
  nav.setAttribute('data-sa-part', 'menu');

  const active = currentRoute.peek();

  for (const resource of getAllResources()) {
    if (!resource.list) continue;
    const link = document.createElement('a');
    link.className = 'sa-menu-item';
    link.setAttribute('data-sa-part', 'menu-item');
    if (active && active.resource === resource.name) {
      link.classList.add('sa-menu-item--active');
    }
    link.href = `#/${resource.name}`;
    link.textContent = resource.name;
    nav.appendChild(link);
  }

  return nav;
};
