// resources/catalog.js — "Settings" menu section: categories + tags, the two small lookup
// resources `products.category_id`/`tag_ids` reference. Declared via JS config
// (SimpleAdmin.resource) rather than markup — see index.html for why `products` itself stays as
// HTML in this example instead of also moving here.
//
// `group: 'Settings'` is read by renderMenu() (src/components/layout.js) to bucket this
// resource's link under a "Settings" header in the side menu (doc 02-resources-and-views.md §2)
// — it has no effect on routing or data.

import SimpleAdmin, { f } from '../../../src/index.js';

const GROUP = 'Settings';

SimpleAdmin.resource('categories', {
  group: GROUP,
  recordRepresentation: 'name',
  list: {
    sort: { field: 'name', order: 'ASC' },
    perPage: 10,
    columns: [f.text({ source: 'id' }), f.text({ source: 'name', sortable: true })],
  },
});

SimpleAdmin.resource('tags', {
  group: GROUP,
  recordRepresentation: 'name',
  list: {
    sort: { field: 'name', order: 'ASC' },
    perPage: 10,
    columns: [f.text({ source: 'id' }), f.text({ source: 'name', sortable: true })],
  },
});
