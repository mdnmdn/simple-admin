// data.js — seed data for the kitchen-sink example ONLY.
//
// This example's whole point is showing every --sa-* token reskin real content (it started life
// as the theme-switcher example), so it needs a dataset that actually exercises the full
// field/input catalog (03-fields-and-inputs-reference.md) instead of the posts/authors shape
// shared by the other three examples.
//
// IMPORTANT: this file does NOT modify examples/mock-data-provider.js — it just imports the
// generic, seed-agnostic createMockDataProvider factory from there and calls it with a different
// seedData object. The other examples keep using defaultSeedData from that file untouched.

import { createMockDataProvider } from '../mock-data-provider.js';

export const CATEGORIES = [
  { id: 1, name: 'Electronics' },
  { id: 2, name: 'Books' },
  { id: 3, name: 'Home & Garden' },
  { id: 4, name: 'Outdoors' },
];

export const TAGS = [
  { id: 1, name: 'New' },
  { id: 2, name: 'Sale' },
  { id: 3, name: 'Featured' },
  { id: 4, name: 'Limited' },
  { id: 5, name: 'Eco-friendly' },
  { id: 6, name: 'Bestseller' },
];

// authors/posts kept in the same shape the other examples use, so this example still exercises
// that resource pair too (text/email/boolean/date/reference), just alongside the richer catalog.
export const AUTHORS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
];

const POST_TITLES = [
  'Getting started with data providers',
  'A tour of the datagrid',
  'Building forms without a framework',
  'Signals vs virtual DOM',
  'Theming with CSS custom properties',
  'Hash routing for admin panels',
];

export const POSTS = POST_TITLES.map((title, index) => ({
  id: index + 1,
  title,
  body: `Body copy for "${title}". Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  published_at: new Date(2026, 0, 1 + index * 4).toISOString().slice(0, 10),
  author_id: AUTHORS[index % AUTHORS.length].id,
  is_published: index % 3 !== 0,
}));

export const PRODUCTS = [
  {
    id: 1,
    name: 'Aurora Wireless Headphones',
    price: 129.99,
    in_stock: true,
    release_date: '2025-03-14',
    website: 'https://example.com/products/aurora-headphones',
    contact_email: 'support@example.com',
    status: 'active',
    category_id: 1,
    tag_ids: [1, 3, 6],
    channels: ['web', 'store'],
    shipping_regions: ['US', 'EU'],
    variants: [
      { label: 'Midnight Black', sku: 'AUR-BLK' },
      { label: 'Arctic White', sku: 'AUR-WHT' },
    ],
  },
  {
    id: 2,
    name: 'Clean Code, Second Edition',
    price: 39.5,
    in_stock: true,
    release_date: '2024-11-01',
    website: 'https://example.com/products/clean-code-2e',
    contact_email: 'books@example.com',
    status: 'active',
    category_id: 2,
    tag_ids: [3],
    channels: ['web'],
    shipping_regions: ['US', 'EU', 'APAC'],
    variants: [
      { label: 'Paperback', sku: 'CC2-PB' },
      { label: 'Hardcover', sku: 'CC2-HC' },
    ],
  },
  {
    id: 3,
    name: 'Terra Ceramic Planter (Set of 3)',
    price: 54.0,
    in_stock: false,
    release_date: '2025-06-20',
    website: 'https://example.com/products/terra-planter',
    contact_email: 'home@example.com',
    status: 'draft',
    category_id: 3,
    tag_ids: [5],
    channels: ['web', 'mobile'],
    shipping_regions: ['US'],
    variants: [{ label: 'Terracotta', sku: 'TER-TCT' }],
  },
  {
    id: 4,
    name: 'Summit 40L Trail Backpack',
    price: 89.95,
    in_stock: true,
    release_date: '2025-01-09',
    website: 'https://example.com/products/summit-backpack',
    contact_email: 'outdoors@example.com',
    status: 'active',
    category_id: 4,
    tag_ids: [1, 4],
    channels: ['web', 'mobile', 'store'],
    shipping_regions: ['US', 'EU'],
    variants: [
      { label: '40L Slate', sku: 'SUM-40-SLT' },
      { label: '40L Moss', sku: 'SUM-40-MSS' },
    ],
  },
  {
    id: 5,
    name: 'Lumen Smart Desk Lamp',
    price: 44.0,
    in_stock: true,
    release_date: '2024-09-30',
    website: 'https://example.com/products/lumen-lamp',
    contact_email: 'support@example.com',
    status: 'active',
    category_id: 1,
    tag_ids: [2, 6],
    channels: ['web'],
    shipping_regions: ['US', 'EU', 'APAC'],
    variants: [{ label: 'Standard', sku: 'LUM-STD' }],
  },
  {
    id: 6,
    name: 'The Pragmatic Programmer',
    price: 34.99,
    in_stock: true,
    release_date: '2023-05-15',
    website: 'https://example.com/products/pragmatic-programmer',
    contact_email: 'books@example.com',
    status: 'archived',
    category_id: 2,
    tag_ids: [6],
    channels: ['web', 'mobile'],
    shipping_regions: ['US'],
    variants: [{ label: 'Paperback', sku: 'PRAG-PB' }],
  },
  {
    id: 7,
    name: 'Meadow Compost Bin',
    price: 68.5,
    in_stock: false,
    release_date: '2025-04-02',
    website: 'https://example.com/products/meadow-compost-bin',
    contact_email: 'home@example.com',
    status: 'draft',
    category_id: 3,
    tag_ids: [5, 4],
    channels: ['store'],
    shipping_regions: ['US', 'EU'],
    variants: [{ label: '80L', sku: 'MEA-80' }],
  },
  {
    id: 8,
    name: 'Ridgeline Insulated Water Bottle',
    price: 24.0,
    in_stock: true,
    release_date: '2025-02-11',
    website: 'https://example.com/products/ridgeline-bottle',
    contact_email: 'outdoors@example.com',
    status: 'active',
    category_id: 4,
    tag_ids: [1, 2, 5],
    channels: ['web', 'mobile', 'store'],
    shipping_regions: ['US', 'EU', 'APAC'],
    variants: [
      { label: '750ml Steel', sku: 'RID-750' },
      { label: '1L Steel', sku: 'RID-1000' },
    ],
  },
];

// Seed for the "Private" menu section (resources/audit-log.js) — the one resource in this
// example gated by `require-auth`, behind the fake test/test auth provider (auth.js). A read-only
// security/activity log is the classic case for a section that stays hidden from anonymous
// visitors while the rest of the admin (Ecommerce, Settings) is public.
export const AUDIT_LOG = [
  { id: 1, occurred_at: '2026-06-28T09:12:00', actor: 'test', action: 'login', target: '—', ip_address: '203.0.113.10' },
  { id: 2, occurred_at: '2026-06-28T09:14:31', actor: 'test', action: 'update', target: 'products#1', ip_address: '203.0.113.10' },
  { id: 3, occurred_at: '2026-06-29T11:02:47', actor: 'test', action: 'create', target: 'products#9', ip_address: '203.0.113.10' },
  { id: 4, occurred_at: '2026-06-29T11:05:03', actor: 'test', action: 'delete', target: 'products#9', ip_address: '203.0.113.10' },
  { id: 5, occurred_at: '2026-06-30T08:47:19', actor: 'test', action: 'update', target: 'categories#3', ip_address: '198.51.100.24' },
  { id: 6, occurred_at: '2026-07-01T16:30:55', actor: 'test', action: 'login', target: '—', ip_address: '198.51.100.24' },
  { id: 7, occurred_at: '2026-07-02T13:18:02', actor: 'test', action: 'update', target: 'authors#2', ip_address: '198.51.100.24' },
  { id: 8, occurred_at: '2026-07-03T10:00:41', actor: 'test', action: 'logout', target: '—', ip_address: '198.51.100.24' },
];

export const kitchenSinkSeedData = {
  categories: CATEGORIES,
  tags: TAGS,
  authors: AUTHORS,
  posts: POSTS,
  products: PRODUCTS,
  'audit-log': AUDIT_LOG,
};

export const createKitchenSinkDataProvider = () => createMockDataProvider(kitchenSinkSeedData);

export default createKitchenSinkDataProvider;
