// simple-admin — public entry (foundation layer).
//
// Later phases build the concrete <sa-*> components/fields/inputs on top of the primitives
// exported here. Field/input built-ins register themselves at import time via registerField/
// registerInput; third parties do the same before mounting. The <sa-admin>/<sa-resource>
// components (components phase) will wire SimpleAdmin.admin().mount() to real rendering.

// ---- reactive core ----
export { signal, computed, effect } from './core/signal.js';

// ---- validators (namespace) + DSL helpers ----
export * as validators from './validators/index.js';

// ---- diagnostics ----
export { setLogLevel } from './core/diagnostics.js';

// ---- registry (resources + field/input types) ----
export {
  registerResource,
  getResource,
  getAllResources,
  registerField,
  registerInput,
  getFieldClass,
  getInputClass,
  fields,
  fields as f,
  inputs,
  inputs as i,
  setDataProvider,
  getDataProvider,
  setAuthProvider,
  getAuthProvider,
} from './core/registry.js';

// ---- descriptor normalization ----
export {
  descriptorFromElement,
  absorbAttributes,
  applyAttribute,
  normalizeConfig,
} from './core/descriptor.js';

// ---- store controllers ----
export { createListController, createFormController } from './core/store.js';

// ---- routing ----
export { currentRoute, navigate, parseHash, startRouter } from './core/router.js';

// ---- context lookups ----
export {
  findRecordContext,
  findListContext,
  findFormContext,
  findResourceContext,
} from './core/context.js';

// ---- base mixins ----
export { BaseField } from './fields/baseField.js';
export { BaseInput } from './inputs/baseInput.js';

// ---- provider utilities ----
export { HttpError } from './providers/httpError.js';
export { fetchJson } from './providers/fetchJson.js';
export { combineDataProviders } from './providers/combine.js';
export { withLifecycleCallbacks } from './providers/lifecycle.js';
export {
  addRefreshAuthToDataProvider,
  addRefreshAuthToAuthProvider,
} from './providers/refreshAuth.js';
export { createQueryCache } from './providers/cache.js';
export { createGetManyBatcher } from './providers/batcher.js';
export { saDataSimpleRest } from './providers/simpleRest.js';
export { saDataJsonServer } from './providers/jsonServer.js';

// ---- auth wiring ----
export {
  checkAuth,
  checkError,
  canAccess,
  guardView,
  addAuthCheckToDataProvider,
} from './auth/authGuard.js';
export { createLocalAuthProvider } from './auth/localAuthProvider.js';

// ---- built-in field catalog ----
// Side-effect imports: each file calls registerField(type, ElementClass) at module scope.
//
// Registration ORDER here relative to the components block below does NOT matter (a previous
// version of this file tried to fix a real bug by reordering these two blocks — it didn't work:
// for an already-fully-parsed static document, `customElements.define()` upgrades matching
// elements in define()-call order, not tree order across different tag names, so whichever of a
// container (<sa-datagrid>) or a nested field type got registered first would upgrade-and-connect
// first regardless of which literal block comes first in this file — reordering just swapped
// which side of the race lost. The actual, order-independent fix lives in
// components/datagrid.js: it defers its light-DOM-children-as-columns collection by one
// microtask, which waits past this entire file's synchronous evaluation (and the importing
// script's own body) so every custom element is guaranteed defined and upgraded by the time it
// runs. See the long comment on `SaDatagrid.connectedCallback` for the full story.
import './fields/textField.js';
import './fields/numberField.js';
import './fields/booleanField.js';
import './fields/dateField.js';
import './fields/emailField.js';
import './fields/urlField.js';
import './fields/selectField.js';
import './fields/functionField.js';
import './fields/referenceField.js';
import './fields/referenceArrayField.js';
import './fields/arrayField.js';

// ---- built-in input catalog ----
// Side-effect imports: each file calls registerInput(type, ElementClass) at module scope.
import './inputs/textInput.js';
import './inputs/numberInput.js';
import './inputs/booleanInput.js';
import './inputs/dateInput.js';
import './inputs/emailInput.js';
import './inputs/urlInput.js';
import './inputs/searchInput.js';
import './inputs/selectInput.js';
import './inputs/selectArrayInput.js';
import './inputs/checkboxGroupInput.js';
import './inputs/autocompleteInput.js';
import './inputs/autocompleteArrayInput.js';
import './inputs/referenceInput.js';
import './inputs/referenceArrayInput.js';
import './inputs/arrayInput.js';

// ---- components (shell + views + auth UI) ----
// Side-effect imports: each defines its custom element. admin() below needs <sa-admin> etc. to
// exist as soon as index.js has been imported once, regardless of which named exports a
// particular caller actually uses.
export { SaAdmin } from './components/admin.js';
export { SaResource } from './components/resource.js';
export { SaLogin } from './components/login.js';
export { SaCanAccess } from './components/canAccess.js';
export { renderAppBar, renderMenu } from './components/layout.js';
export { SaList } from './components/list.js';
export { SaDatagrid, SaDatagridRow } from './components/datagrid.js';
export { SaFilters } from './components/filters.js';
export { SaPagination } from './components/pagination.js';
export { SaShow, SaSimpleShowLayout } from './components/show.js';
export { SaCreate } from './components/create.js';
export { SaEdit } from './components/edit.js';
export { SaSimpleForm } from './components/simpleForm.js';
export { SaTabbedForm, SaFormTab } from './components/tabbedForm.js';
export { SaFormToolbar, SaSaveButton, SaDeleteButton } from './components/toolbar.js';
export { SaBulkDeleteButton } from './components/bulkActions.js';

// ---- SimpleAdmin namespace ----
import * as registry from './core/registry.js';
import { setLogLevel as _setLogLevel } from './core/diagnostics.js';
import { normalizeConfig } from './core/descriptor.js';

// resource(name, config) -> a plain ResourceDescriptor (architecture §2.1). Registered so
// reference lookups and (later) routing/menus can find it.
const resource = (name, config = {}) => {
  const descriptor = { kind: 'resource', name, ...config };
  registry.registerResource(descriptor);
  return descriptor;
};

// admin(config) -> a builder holding the AdminDescriptor. mount(target) creates a real <sa-admin>
// element, configures it from the descriptor, and appends it into `target` (a selector string or
// an Element). `target`'s existing children (if any) are left alone; <sa-admin> only touches its
// own subtree.
const admin = (config = {}) => {
  const descriptor = { kind: 'admin', requireAuth: false, ...config };
  const builder = {
    descriptor,
    el: null,
    mount(target) {
      const container = typeof target === 'string' ? document.querySelector(target) : target;
      if (!container) {
        console.error(`[simple-admin] admin().mount(): target "${target}" was not found.`);
        return this;
      }
      const el = document.createElement('sa-admin');
      el.descriptor = descriptor;
      container.appendChild(el);
      this.el = el;
      return this;
    },
  };
  return builder;
};

export const SimpleAdmin = {
  registerField: registry.registerField,
  registerInput: registry.registerInput,
  registerResource: registry.registerResource,
  getResource: registry.getResource,
  getAllResources: registry.getAllResources,
  setLogLevel: _setLogLevel,
  fields: registry.fields,
  inputs: registry.inputs,
  resource,
  admin,
};

export default SimpleAdmin;
