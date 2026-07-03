# simple-admin — Syntax Reference (react-admin translation table)

> "If you know react-admin, here's the translation." For every major concept, this shows the
> **react-admin JSX**, the **simple-admin HTML custom-element** form, and the **simple-admin JS
> config** form. All three columns describe the *same behavior*; the HTML and JS forms compile to
> the same internal descriptor (see `10-simple-admin-architecture.md §2`).
>
> Conventions:
> - Custom elements are prefixed `sa-`. Attributes are kebab-case; JS config keys are camelCase.
> - JS helpers: `f` = field factories, `i` = input factories, imported from `simple-admin`.
> - `validate="required|minLength:2"` is the HTML validator DSL; the JS form uses arrays of factory calls.

---

## Quick reference: name mapping

| react-admin | simple-admin element | simple-admin JS |
|---|---|---|
| `<Admin>` | `<sa-admin>` | `SimpleAdmin.admin({...})` |
| `<Resource>` | `<sa-resource>` | `SimpleAdmin.resource(name, {...})` |
| `<List>` | `<sa-list>` | `list: {...}` |
| `<Datagrid>` / `<DataTable>` | `<sa-datagrid>` | `columns: [...]` |
| `<SimpleList>` | `<sa-simple-list>` | `body: { component:'simple-list' }` |
| `<Show>` / `<SimpleShowLayout>` | `<sa-show>` / `<sa-simple-show-layout>` | `show: {...}` |
| `<Create>` | `<sa-create>` | `create: {...}` |
| `<Edit>` | `<sa-edit>` | `edit: {...}` |
| `<SimpleForm>` | `<sa-simple-form>` | `layout:'simple', inputs:[...]` |
| `<TabbedForm>` | `<sa-tabbed-form>` | `layout:'tabbed', groups:[...]` |
| `<TextField>` | `<sa-text-field>` | `f.text({...})` |
| `<TextInput>` | `<sa-text-input>` | `i.text({...})` |
| `<ReferenceField>` | `<sa-reference-field>` | `f.reference({...})` |
| `<ReferenceInput>` | `<sa-reference-input>` | `i.reference({...})` |
| `required()` | `validate="required"` | `validate:[required()]` |

---

## 1. Admin root + data provider

**react-admin**
```jsx
import { Admin, Resource } from 'react-admin';
import simpleRestProvider from 'ra-data-simple-rest';

const App = () => (
  <Admin dataProvider={simpleRestProvider('https://api.example.com')}>
    <Resource name="posts" list={PostList} />
  </Admin>
);
```

**simple-admin — HTML**
```html
<sa-admin id="app">
  <sa-resource name="posts">
    <sa-list> … </sa-list>
  </sa-resource>
</sa-admin>
<script type="module">
  import { SimpleAdmin, saDataSimpleRest } from './simple-admin/index.js';
  document.querySelector('#app').dataProvider = saDataSimpleRest('https://api.example.com');
</script>
```

**simple-admin — JS**
```js
import { SimpleAdmin, saDataSimpleRest } from './simple-admin/index.js';

SimpleAdmin.admin({
  dataProvider: saDataSimpleRest('https://api.example.com'),
  resources: [ SimpleAdmin.resource('posts', { list: { columns: [/* … */] } }) ],
}).mount('#app');
```

---

## 2. Resource with all four views + icon + record representation

**react-admin**
```jsx
<Resource name="posts" list={PostList} create={PostCreate}
          edit={PostEdit} show={PostShow} icon={BookIcon}
          recordRepresentation={(r) => r.title} />
```

**simple-admin — HTML**
```html
<sa-resource name="posts" icon="book" record-representation="title">
  <sa-list> … </sa-list>
  <sa-create> … </sa-create>
  <sa-edit> … </sa-edit>
  <sa-show> … </sa-show>
</sa-resource>
```

**simple-admin — JS**
```js
SimpleAdmin.resource('posts', {
  icon: 'book',
  recordRepresentation: (r) => r.title,   // or 'title'
  list:   { columns: [/* … */] },
  create: { inputs:  [/* … */] },
  edit:   { inputs:  [/* … */] },
  show:   { fields:  [/* … */] },
});
```

---

## 3. List + Datagrid with columns

**react-admin**
```jsx
export const PostList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="id" />
      <TextField source="title" label="Title" />
      <DateField source="published_at" />
    </Datagrid>
  </List>
);
```

**simple-admin — HTML**
```html
<sa-list row-click="edit">
  <sa-datagrid>
    <sa-text-field source="id"></sa-text-field>
    <sa-text-field source="title" label="Title"></sa-text-field>
    <sa-date-field source="published_at"></sa-date-field>
  </sa-datagrid>
</sa-list>
```

**simple-admin — JS**
```js
list: {
  rowClick: 'edit',
  columns: [
    f.text({ source: 'id' }),
    f.text({ source: 'title', label: 'Title' }),
    f.date({ source: 'published_at' }),
  ],
}
```

---

## 4. Initial sort, perPage, permanent + default filters

**react-admin**
```jsx
<List sort={{ field: 'published_at', order: 'DESC' }}
      perPage={25}
      filter={{ is_published: true }}
      filterDefaultValues={{ status: 'open' }}>
  <Datagrid> … </Datagrid>
</List>
```

**simple-admin — HTML**
```html
<sa-list sort-field="published_at" sort-order="DESC" per-page="25"
         filter='{"is_published":true}'
         filter-default-values='{"status":"open"}'>
  <sa-datagrid> … </sa-datagrid>
</sa-list>
```

**simple-admin — JS**
```js
list: {
  sort: { field: 'published_at', order: 'DESC' },
  perPage: 25,
  filter: { is_published: true },
  filterDefaultValues: { status: 'open' },
  columns: [/* … */],
}
```

---

## 5. Filters (filter form / dropdown)

**react-admin**
```jsx
const postFilters = [
  <SearchInput source="q" alwaysOn />,
  <TextInput label="Title" source="title" />,
  <SelectInput source="status" choices={[{id:'draft',name:'Draft'},{id:'pub',name:'Published'}]} />,
];
<List filters={postFilters}> <Datagrid> … </Datagrid> </List>
```

**simple-admin — HTML**
```html
<sa-list>
  <sa-filters>
    <sa-search-input source="q" always-on></sa-search-input>
    <sa-text-input source="title" label="Title"></sa-text-input>
    <sa-select-input source="status"
      choices='[{"id":"draft","name":"Draft"},{"id":"pub","name":"Published"}]'></sa-select-input>
  </sa-filters>
  <sa-datagrid> … </sa-datagrid>
</sa-list>
```

**simple-admin — JS**
```js
list: {
  filters: [
    i.search({ source: 'q', alwaysOn: true }),
    i.text({ source: 'title', label: 'Title' }),
    i.select({ source: 'status', choices: [
      { id: 'draft', name: 'Draft' }, { id: 'pub', name: 'Published' } ] }),
  ],
  columns: [/* … */],
}
```

---

## 6. Column sorting overrides

**react-admin**
```jsx
<TextField source="title" sortable={false} />
<ReferenceField source="author_id" reference="authors" sortBy="author_id" />
```

**simple-admin — HTML**
```html
<sa-text-field source="title" sortable="false"></sa-text-field>
<sa-reference-field source="author_id" reference="authors" sort-by="author_id"></sa-reference-field>
```

**simple-admin — JS**
```js
f.text({ source: 'title', sortable: false }),
f.reference({ source: 'author_id', reference: 'authors', sortBy: 'author_id' }),
```

---

## 7. Bulk actions + row selection

**react-admin**
```jsx
<Datagrid bulkActionButtons={<><BulkDeleteButton /><BulkExportButton /></>}>
  … columns …
</Datagrid>
// disable selection entirely:
<Datagrid bulkActionButtons={false}> … </Datagrid>
```

**simple-admin — HTML**
```html
<sa-datagrid>
  … columns …
  <sa-bulk-delete-button slot="bulk"></sa-bulk-delete-button>
  <sa-bulk-export-button slot="bulk"></sa-bulk-export-button>
</sa-datagrid>
<!-- disable selection: -->
<sa-datagrid bulk-actions="none"> … </sa-datagrid>
```

**simple-admin — JS**
```js
list: { bulkActions: ['delete', 'export'], columns: [/* … */] }
// disable: list: { bulkActions: false }
```

---

## 8. Row click behavior

| react-admin | HTML | JS |
|---|---|---|
| `<Datagrid rowClick="edit">` | `<sa-datagrid>` inside `<sa-list row-click="edit">` | `rowClick: 'edit'` |
| `rowClick="show"` | `row-click="show"` | `rowClick: 'show'` |
| `rowClick={false}` | `row-click="none"` | `rowClick: false` |
| `rowClick={(id,res,rec)=>…}` | `.rowClick` JS property (fn) | `rowClick: (id,res,rec)=>…` |

---

## 9. Pagination options

**react-admin**
```jsx
<List pagination={<Pagination rowsPerPageOptions={[10, 25, 50, 100]} />}>…</List>
```

**simple-admin — HTML**
```html
<sa-list rows-per-page="10,25,50,100"> … </sa-list>
```

**simple-admin — JS**
```js
list: { pagination: { rowsPerPageOptions: [10, 25, 50, 100] }, columns: [/* … */] }
```

---

## 10. Show view (read-only detail)

**react-admin**
```jsx
export const PostShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="title" />
      <DateField source="published_at" />
      <NumberField source="views" />
    </SimpleShowLayout>
  </Show>
);
```

**simple-admin — HTML**
```html
<sa-show>
  <sa-simple-show-layout>
    <sa-text-field source="title"></sa-text-field>
    <sa-date-field source="published_at"></sa-date-field>
    <sa-number-field source="views"></sa-number-field>
  </sa-simple-show-layout>
</sa-show>
```

**simple-admin — JS**
```js
show: {
  layout: 'simple',
  fields: [
    f.text({ source: 'title' }),
    f.date({ source: 'published_at' }),
    f.number({ source: 'views' }),
  ],
}
```

---

## 11. Tabbed Show layout

**react-admin**
```jsx
<Show>
  <TabbedShowLayout>
    <TabbedShowLayout.Tab label="Main"><TextField source="title" /></TabbedShowLayout.Tab>
    <TabbedShowLayout.Tab label="Body"><RichTextField source="body" /></TabbedShowLayout.Tab>
  </TabbedShowLayout>
</Show>
```

**simple-admin — HTML**
```html
<sa-show>
  <sa-tabbed-show-layout>
    <sa-show-tab label="Main"><sa-text-field source="title"></sa-text-field></sa-show-tab>
    <sa-show-tab label="Body"><sa-text-field source="body"></sa-text-field></sa-show-tab>
  </sa-tabbed-show-layout>
</sa-show>
```

**simple-admin — JS**
```js
show: {
  layout: 'tabbed',
  groups: [
    { label: 'Main', fields: [ f.text({ source: 'title' }) ] },
    { label: 'Body', fields: [ f.text({ source: 'body' }) ] },
  ],
}
```

---

## 12. Create form with inputs

**react-admin**
```jsx
export const PostCreate = () => (
  <Create redirect="list">
    <SimpleForm defaultValues={{ nb_views: 0 }}>
      <TextInput source="title" validate={required()} />
      <TextInput source="body" multiline />
      <NumberInput source="nb_views" />
    </SimpleForm>
  </Create>
);
```

**simple-admin — HTML**
```html
<sa-create redirect="list">
  <sa-simple-form default-values='{"nb_views":0}'>
    <sa-text-input source="title" validate="required"></sa-text-input>
    <sa-text-input source="body" multiline></sa-text-input>
    <sa-number-input source="nb_views"></sa-number-input>
  </sa-simple-form>
</sa-create>
```

**simple-admin — JS**
```js
create: {
  redirect: 'list',
  defaultValues: { nb_views: 0 },
  inputs: [
    i.text({ source: 'title', validate: [required()] }),
    i.text({ source: 'body', multiline: true }),
    i.number({ source: 'nb_views' }),
  ],
}
```

---

## 13. Edit form + transform + mutation mode

**react-admin**
```jsx
export const PostEdit = () => (
  <Edit mutationMode="pessimistic" transform={(data) => ({ ...data, slug: slugify(data.title) })}>
    <SimpleForm>
      <TextInput source="title" validate={[required(), minLength(3)]} />
      <BooleanInput source="published" />
    </SimpleForm>
  </Edit>
);
```

**simple-admin — HTML**
```html
<sa-edit mutation-mode="pessimistic" transform="myApp.addSlug">
  <sa-simple-form>
    <sa-text-input source="title" validate="required|minLength:3"></sa-text-input>
    <sa-boolean-input source="published"></sa-boolean-input>
  </sa-simple-form>
</sa-edit>
<!-- transform="myApp.addSlug" references a globally-registered function -->
```

**simple-admin — JS**
```js
edit: {
  mutationMode: 'pessimistic',
  transform: (data) => ({ ...data, slug: slugify(data.title) }),
  inputs: [
    i.text({ source: 'title', validate: [required(), minLength(3)] }),
    i.boolean({ source: 'published' }),
  ],
}
```

---

## 14. Tabbed form

**react-admin**
```jsx
<Edit>
  <TabbedForm>
    <TabbedForm.Tab label="Summary"><TextInput source="title" validate={required()} /></TabbedForm.Tab>
    <TabbedForm.Tab label="Body"><TextInput source="body" multiline /></TabbedForm.Tab>
  </TabbedForm>
</Edit>
```

**simple-admin — HTML**
```html
<sa-edit>
  <sa-tabbed-form>
    <sa-form-tab label="Summary"><sa-text-input source="title" validate="required"></sa-text-input></sa-form-tab>
    <sa-form-tab label="Body"><sa-text-input source="body" multiline></sa-text-input></sa-form-tab>
  </sa-tabbed-form>
</sa-edit>
```

**simple-admin — JS**
```js
edit: {
  layout: 'tabbed',
  groups: [
    { label: 'Summary', inputs: [ i.text({ source: 'title', validate: [required()] }) ] },
    { label: 'Body',    inputs: [ i.text({ source: 'body', multiline: true }) ] },
  ],
}
```

---

## 15. Validation (built-in validators)

| react-admin | HTML DSL | JS |
|---|---|---|
| `validate={required()}` | `validate="required"` | `validate:[required()]` |
| `validate={[required(), minLength(2), maxLength(15)]}` | `validate="required|minLength:2|maxLength:15"` | `validate:[required(), minLength(2), maxLength(15)]` |
| `validate={[minValue(0), maxValue(100)]}` | `validate="minValue:0|maxValue:100"` | `validate:[minValue(0), maxValue(100)]` |
| `validate={email()}` | `validate="email"` | `validate:[email()]` |
| `validate={regex(/^\d+$/, 'Digits only')}` | `.validate` JS prop (regex needs JS) | `validate:[regex(/^\d+$/, 'Digits only')]` |
| `validate={choices(['a','b'])}` | `validate="choices:a,b"` | `validate:[choices(['a','b'])]` |
| custom async validator | `.validate` JS prop (array of fns) | `validate:[required(), asyncUniqueCheck]` |

**Form-level validate**

react-admin: `<SimpleForm validate={validateUser}>`
HTML: `<sa-simple-form validate="myApp.validateUser">` (registered fn name)
JS: `create: { validate: validateUser, inputs: [...] }`

---

## 16. Field types catalog

| react-admin | HTML | JS |
|---|---|---|
| `<TextField source="title" />` | `<sa-text-field source="title">` | `f.text({source:'title'})` |
| `<NumberField source="price" options={{style:'currency',currency:'USD'}} />` | `<sa-number-field source="price" options='{"style":"currency","currency":"USD"}'>` | `f.number({source:'price', options:{style:'currency',currency:'USD'}})` |
| `<BooleanField source="published" />` | `<sa-boolean-field source="published">` | `f.boolean({source:'published'})` |
| `<DateField source="created" showTime />` | `<sa-date-field source="created" show-time>` | `f.date({source:'created', showTime:true})` |
| `<EmailField source="email" />` | `<sa-email-field source="email">` | `f.email({source:'email'})` |
| `<UrlField source="site" />` | `<sa-url-field source="site">` | `f.url({source:'site'})` |
| `<SelectField source="status" choices={C} />` | `<sa-select-field source="status" choices='…'>` | `f.select({source:'status', choices:C})` |
| `<FunctionField render={r=>…} />` | `<sa-function-field>` + `.render` prop | `f.fn({render:r=>…})` |
| `<ArrayField source="items"><Datagrid>…</Datagrid></ArrayField>` | `<sa-array-field source="items"><sa-datagrid>…</sa-datagrid></sa-array-field>` | `f.array({source:'items', of:[/* fields */]})` |

---

## 17. Input types catalog

| react-admin | HTML | JS |
|---|---|---|
| `<TextInput source="title" multiline />` | `<sa-text-input source="title" multiline>` | `i.text({source:'title', multiline:true})` |
| `<NumberInput source="qty" step={0.5} />` | `<sa-number-input source="qty" step="0.5">` | `i.number({source:'qty', step:0.5})` |
| `<BooleanInput source="active" />` | `<sa-boolean-input source="active">` | `i.boolean({source:'active'})` |
| `<DateInput source="dob" />` | `<sa-date-input source="dob">` | `i.date({source:'dob'})` |
| `<SelectInput source="cat" choices={C} optionText="label" optionValue="code" />` | `<sa-select-input source="cat" choices='…' option-text="label" option-value="code">` | `i.select({source:'cat', choices:C, optionText:'label', optionValue:'code'})` |
| `<SelectArrayInput source="tags" choices={C} />` | `<sa-select-array-input source="tags" choices='…'>` | `i.selectArray({source:'tags', choices:C})` |
| `<CheckboxGroupInput source="roles" choices={C} />` | `<sa-checkbox-group-input source="roles" choices='…'>` | `i.checkboxGroup({source:'roles', choices:C})` |
| `<AutocompleteInput source="city" choices={C} />` | `<sa-autocomplete-input source="city" choices='…'>` | `i.autocomplete({source:'city', choices:C})` |
| `<AutocompleteArrayInput source="tags" choices={C} />` | `<sa-autocomplete-array-input source="tags" choices='…'>` | `i.autocompleteArray({source:'tags', choices:C})` |
| `<SearchInput source="q" alwaysOn />` | `<sa-search-input source="q" always-on>` | `i.search({source:'q', alwaysOn:true})` |

---

## 18. Choices contract (optionText / optionValue)

**react-admin**
```jsx
<SelectInput source="category"
  choices={[{ code:'t', label:'Tech' }, { code:'l', label:'Life' }]}
  optionText="label" optionValue="code" translateChoice={false} />
```

**simple-admin — HTML**
```html
<sa-select-input source="category"
  choices='[{"code":"t","label":"Tech"},{"code":"l","label":"Life"}]'
  option-text="label" option-value="code" translate-choice="false"></sa-select-input>
```

**simple-admin — JS**
```js
i.select({
  source: 'category',
  choices: [ { code:'t', label:'Tech' }, { code:'l', label:'Life' } ],
  optionText: 'label', optionValue: 'code', translateChoice: false,
})
```

`optionText` may also be a function (`optionText: c => \`${c.first} ${c.last}\``) via the JS form or a `.optionText` property on the element.

---

## 19. ReferenceField (many-to-one display)

**react-admin**
```jsx
<ReferenceField source="author_id" reference="authors" link="show">
  <TextField source="name" />
</ReferenceField>
```

**simple-admin — HTML**
```html
<sa-reference-field source="author_id" reference="authors" link="show">
  <sa-text-field source="name"></sa-text-field>
</sa-reference-field>
```

**simple-admin — JS**
```js
f.reference({ source: 'author_id', reference: 'authors', link: 'show',
              child: f.text({ source: 'name' }) })
```

---

## 20. ReferenceArrayField (many-to-many display)

**react-admin**
```jsx
<ReferenceArrayField source="tag_ids" reference="tags" />
```

**simple-admin — HTML**
```html
<sa-reference-array-field source="tag_ids" reference="tags"></sa-reference-array-field>
```

**simple-admin — JS**
```js
f.referenceArray({ source: 'tag_ids', reference: 'tags' })
// default rendering: chips of each related record's recordRepresentation
```

---

## 21. ReferenceManyField (one-to-many reverse lookup)

**react-admin**
```jsx
<ReferenceManyField label="Books" reference="books" target="author_id">
  <Datagrid><TextField source="title" /></Datagrid>
</ReferenceManyField>
```

**simple-admin — HTML**
```html
<sa-reference-many-field label="Books" reference="books" target="author_id">
  <sa-datagrid><sa-text-field source="title"></sa-text-field></sa-datagrid>
</sa-reference-many-field>
```

**simple-admin — JS**
```js
f.referenceMany({ label: 'Books', reference: 'books', target: 'author_id',
                  columns: [ f.text({ source: 'title' }) ] })
```

---

## 22. ReferenceInput (single relation picker)

**react-admin**
```jsx
<ReferenceInput source="company_id" reference="companies" filter={{ active: true }} perPage={50}>
  <SelectInput optionText="name" label="Employer" />
</ReferenceInput>
```

**simple-admin — HTML**
```html
<sa-reference-input source="company_id" reference="companies"
                    filter='{"active":true}' per-page="50">
  <sa-select-input option-text="name" label="Employer"></sa-select-input>
</sa-reference-input>
```

**simple-admin — JS**
```js
i.reference({ source: 'company_id', reference: 'companies',
              filter: { active: true }, perPage: 50,
              child: i.select({ optionText: 'name', label: 'Employer' }) })
```

---

## 23. ReferenceArrayInput (multi relation picker)

**react-admin**
```jsx
<ReferenceArrayInput source="tag_ids" reference="tags">
  <SelectArrayInput optionText="name" />
</ReferenceArrayInput>
```

**simple-admin — HTML**
```html
<sa-reference-array-input source="tag_ids" reference="tags">
  <sa-select-array-input option-text="name"></sa-select-array-input>
</sa-reference-array-input>
```

**simple-admin — JS**
```js
i.referenceArray({ source: 'tag_ids', reference: 'tags',
                   child: i.selectArray({ optionText: 'name' }) })
```

---

## 24. ArrayInput + iterator (repeatable groups)

**react-admin**
```jsx
<ArrayInput source="items">
  <SimpleFormIterator inline>
    <TextInput source="name" />
    <NumberInput source="price" />
  </SimpleFormIterator>
</ArrayInput>
```

**simple-admin — HTML**
```html
<sa-array-input source="items">
  <sa-form-iterator inline>
    <sa-text-input source="name"></sa-text-input>
    <sa-number-input source="price"></sa-number-input>
  </sa-form-iterator>
</sa-array-input>
```

**simple-admin — JS**
```js
i.array({ source: 'items', inline: true, of: [
  i.text({ source: 'name' }),
  i.number({ source: 'price' }),
]})
// nested source is relative to the array item, e.g. items[i].name
```

---

## 25. Auth provider + login

**react-admin**
```jsx
const authProvider = {
  async login({ username, password }) { /* store token */ },
  async logout() { localStorage.removeItem('auth'); },
  async checkAuth() { if (!localStorage.getItem('auth')) throw new Error(); },
  async checkError(error) { if ([401,403].includes(error.status)) throw new Error(); },
  async getIdentity() { return { id: 1, fullName: 'Jane' }; },
  async canAccess({ resource, action }) { return role === 'admin'; },
};
<Admin authProvider={authProvider} requireAuth>…</Admin>
```

**simple-admin — HTML**
```html
<sa-admin id="app" require-auth>…</sa-admin>
<script type="module">
  import { SimpleAdmin } from './simple-admin/index.js';
  document.querySelector('#app').authProvider = authProvider; // same object shape as react-admin
</script>
```

**simple-admin — JS**
```js
SimpleAdmin.admin({
  dataProvider,
  authProvider,      // identical contract to react-admin — drop-in
  requireAuth: true,
  resources: [/* … */],
}).mount('#app');
```

The `authProvider` object is **byte-for-byte the same shape** as react-admin's (`login`/`logout`/`checkAuth`/`checkError`/`getIdentity`/`getPermissions`/`canAccess`). No adaptation needed for classic username/password providers.

---

## 26. Access control guard (canAccess)

**react-admin**
```jsx
<CanAccess resource="logs" action="read">
  <MenuItem to="/logs">Logs</MenuItem>
</CanAccess>
```

**simple-admin — HTML**
```html
<sa-can-access resource="logs" action="read">
  <a href="#/logs">Logs</a>
</sa-can-access>
```

**simple-admin — JS**
```js
const allowed = await SimpleAdmin.canAccess({ resource: 'logs', action: 'read' });
if (allowed) { /* render the menu item */ }
```

---

## 27. Custom data provider (both frameworks, identical)

```js
// Works UNCHANGED in react-admin AND simple-admin (contract is identical).
const dataProvider = {
  getList: async (resource, { pagination:{page,perPage}, sort:{field,order}, filter }) => {
    const res = await fetch(`/api/${resource}?_page=${page}&_limit=${perPage}`);
    return { data: await res.json(), total: Number(res.headers.get('X-Total-Count')) };
  },
  getOne:  async (resource, { id }) => ({ data: await (await fetch(`/api/${resource}/${id}`)).json() }),
  getMany: async (resource, { ids }) =>
    ({ data: await (await fetch(`/api/${resource}?id=${ids.join('&id=')}`)).json() }),
  getManyReference: async (resource, { target, id, pagination, sort }) => { /* … */ },
  create: async (resource, { data }) => ({ data: /* posted record with id */ }),
  update: async (resource, { id, data }) => ({ data: /* updated record */ }),
  updateMany: async (resource, { ids, data }) => ({ data: ids }),
  delete: async (resource, { id }) => ({ data: /* deleted record */ }),
  deleteMany: async (resource, { ids }) => ({ data: ids }),
};
```

The only interop caveat is **module delivery** for published npm providers (`ra-data-simple-rest` etc.) — use an import map/CDN, or simple-admin's bundled `saDataSimpleRest`/`saDataJsonServer` twins. See `10-simple-admin-architecture.md §6.2`.
