// resources/audit-log.js — the "Private" menu section: a single read-only resource gated by
// `require-auth`, behind the fake test/test AuthProvider from ../auth.js. It has no create/edit
// (an audit trail shouldn't be editable from the UI), just list + show.
//
// `requireAuth: true` here — not on <sa-admin> itself — is what keeps the rest of this example
// public: SaAdmin._handleRoute (components/admin.js) gates a route when EITHER the admin-wide
// require-auth is set OR the target resource's own descriptor says requireAuth, so this one
// resource can demand a login while Ecommerce/Settings stay open to anonymous visitors sharing
// the same authProvider. See doc 02-resources-and-views.md §8.

import SimpleAdmin, { f } from '../../../src/index.js';

SimpleAdmin.resource('audit-log', {
  group: 'Private',
  requireAuth: true,
  recordRepresentation: 'action',
  list: {
    sort: { field: 'occurred_at', order: 'DESC' },
    perPage: 10,
    columns: [
      f.text({ source: 'id' }),
      f.date({ source: 'occurred_at', label: 'When', sortable: true, showTime: true }),
      f.text({ source: 'actor', label: 'Actor' }),
      f.text({ source: 'action', label: 'Action' }),
      f.text({ source: 'target', label: 'Target' }),
      f.text({ source: 'ip_address', label: 'IP address' }),
    ],
  },
  show: {
    fields: [
      f.date({ source: 'occurred_at', label: 'When', showTime: true }),
      f.text({ source: 'actor', label: 'Actor' }),
      f.text({ source: 'action', label: 'Action' }),
      f.text({ source: 'target', label: 'Target' }),
      f.text({ source: 'ip_address', label: 'IP address' }),
    ],
  },
});
