// resources/blog.js — "Ecommerce" menu section (the "all the others" bucket): authors + posts,
// carried over unchanged from the original single-file theme-switcher example, just declared via
// JS config instead of inline markup and grouped alongside `products` (see index.html).

import SimpleAdmin, { f, i } from '../../../src/index.js';

const GROUP = 'Ecommerce';

SimpleAdmin.resource('authors', {
  group: GROUP,
  recordRepresentation: 'name',
  list: {
    sort: { field: 'name', order: 'ASC' },
    perPage: 10,
    rowClick: 'edit',
    columns: [
      f.text({ source: 'id' }),
      f.text({ source: 'name', sortable: true }),
      f.email({ source: 'email' }),
    ],
  },
  create: {
    redirect: 'list',
    inputs: [
      i.text({ source: 'name', validate: 'required' }),
      i.email({ source: 'email', validate: 'required|email' }),
    ],
  },
  edit: {
    redirect: 'list',
    inputs: [
      i.text({ source: 'name', validate: 'required' }),
      i.email({ source: 'email', validate: 'required|email' }),
    ],
  },
  show: {
    fields: [f.text({ source: 'name' }), f.email({ source: 'email' })],
  },
});

SimpleAdmin.resource('posts', {
  group: GROUP,
  recordRepresentation: 'title',
  list: {
    sort: { field: 'published_at', order: 'DESC' },
    perPage: 10,
    rowClick: 'edit',
    filters: [
      i.search({ source: 'q', alwaysOn: true }),
      i.boolean({ source: 'is_published', label: 'Published' }),
    ],
    columns: [
      f.text({ source: 'id' }),
      f.text({ source: 'title', label: 'Title', sortable: true }),
      f.reference({
        source: 'author_id',
        reference: 'authors',
        link: 'show',
        child: f.text({ source: 'name' }),
      }),
      f.boolean({ source: 'is_published', label: 'Published' }),
      f.date({ source: 'published_at', sortable: true }),
    ],
    bulkActions: ['delete'],
  },
  create: {
    redirect: 'list',
    inputs: [
      i.text({ source: 'title', validate: 'required|minLength:3' }),
      i.text({ source: 'body', multiline: true }),
      i.reference({ source: 'author_id', reference: 'authors', child: i.select({ optionText: 'name' }) }),
      i.boolean({ source: 'is_published', label: 'Published' }),
      i.date({ source: 'published_at', validate: 'required' }),
    ],
  },
  edit: {
    redirect: 'list',
    inputs: [
      i.text({ source: 'title', validate: 'required|minLength:3' }),
      i.text({ source: 'body', multiline: true }),
      i.reference({ source: 'author_id', reference: 'authors', child: i.select({ optionText: 'name' }) }),
      i.boolean({ source: 'is_published', label: 'Published' }),
      i.date({ source: 'published_at', validate: 'required' }),
    ],
  },
  show: {
    fields: [
      f.text({ source: 'title' }),
      f.text({ source: 'body' }),
      f.reference({ source: 'author_id', reference: 'authors', link: 'edit', child: f.text({ source: 'name' }) }),
      f.boolean({ source: 'is_published', label: 'Published' }),
      f.date({ source: 'published_at' }),
    ],
  },
});
