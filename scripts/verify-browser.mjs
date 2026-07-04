// Browser-driven smoke test for the four example apps, using Playwright (already a devDependency;
// `bunx playwright install chromium` / `npx playwright install chromium` if the browser binary is
// missing). Not run automatically — see _docs/verification-plan.md for why, and how to run this.
//
// Usage:
//   node scripts/build.mjs                 # optional, only needed to exercise dist-bundle
//   python3 -m http.server 8934 &          # any static file server serving the repo root
//   node scripts/verify-browser.mjs
//
// Each example is driven through: initial load -> login (admin/admin) -> list (pagination/sort/
// filter) -> reference field resolution -> create form (validation, then a real save) -> bulk
// delete. Screenshots + a JSON report land in scripts/.verification-output/ (gitignored).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'scripts', '.verification-output');
const baseUrl = process.argv[2] || 'http://localhost:8934';

const EXAMPLES = ['html-only', 'js-config', 'mixed', 'dist-bundle'];

async function verifyExample(browser, name) {
  const url = `${baseUrl}/examples/${name}/index.html`;
  const page = await browser.newPage();
  const errors = [];
  const consoleMsgs = [];
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

  const report = { name, url, errors, consoleMsgs };
  const shot = (label) => page.screenshot({ path: path.join(outDir, `${name}-${label}.png`), fullPage: true });

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await shot('01-initial');

    // Login (require-auth is set on every example). Scope to the visible <sa-login> form: the
    // page also contains parked resource-view templates (create/edit forms) whose text inputs are
    // present but display:none, so an unscoped `input[type="text"]` first-match would grab a hidden
    // one and hang.
    const userInput = page.locator('sa-login input[name="username"], sa-login input[type="text"] >> visible=true').first();
    if (await userInput.count()) {
      await userInput.fill('admin');
      await page.locator('sa-login input[type="password"] >> visible=true').first().fill('admin');
      await page.locator('sa-login button >> visible=true').first().click();
      await page.waitForTimeout(800);
      await shot('02-after-login');
    }

    // All view assertions below scope to `.sa-content` (the mounted view) and visible elements —
    // parked resources keep their own datagrid/rows/buttons connected but hidden.
    await page.waitForSelector('.sa-content sa-datagrid', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500); // initial getList + reference batching
    await shot('03-list');
    report.rowCount = await page.locator('.sa-content sa-datagrid-row >> visible=true').count();

    // Sort
    const header = page.locator('.sa-content sa-datagrid th >> visible=true').first();
    if (await header.count()) {
      await header.click();
      await page.waitForTimeout(600);
      await shot('04-after-sort');
    }

    // Filter (posts resource has a search filter in every example)
    const search = page.locator('.sa-content sa-search-input input >> visible=true').first();
    if (await search.count()) {
      await search.fill('data');
      await page.waitForTimeout(900); // 500ms debounce + fetch
      await shot('05-after-filter');
      report.filteredRowCount = await page.locator('.sa-content sa-datagrid-row >> visible=true').count();
      await search.fill('');
      await page.waitForTimeout(900);
    }

    // Reference field resolves to a name, not a raw id
    report.referenceFieldText = await page
      .locator('.sa-content sa-datagrid-row sa-reference-field >> visible=true')
      .first()
      .textContent()
      .catch(() => null);

    // Create form: submit empty (expect validation errors), then fill + save
    await page.goto(`${baseUrl}/examples/${name}/index.html#/posts/create`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot('06-create-form');

    const saveBtn = page.locator('.sa-content sa-save-button >> visible=true').first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(500);
      // First NON-EMPTY error span: every input renders an (empty) error span, so a plain first
      // match can be an errorless input's blank span.
      const errorTexts = await page.locator('.sa-content .sa-input__error').allTextContents();
      report.validationErrorText = errorTexts.map((t) => t.trim()).find(Boolean) || null;
      await shot('07-validation-errors');
    }

    const titleInput = page.locator('.sa-content sa-text-input input >> visible=true').first();
    if (await titleInput.count()) await titleInput.fill('Verification smoke test post');
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(1200);
      await shot('08-after-create-save');
    }
    report.urlAfterSave = page.url();

    // Bulk delete
    await page.goto(`${baseUrl}/examples/${name}/index.html#/posts`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const checkbox = page.locator('.sa-content sa-datagrid-row input[type="checkbox"] >> visible=true').first();
    if (await checkbox.count()) {
      await checkbox.check();
      const bulkBtn = page.locator('.sa-content sa-bulk-delete-button >> visible=true').first();
      if (await bulkBtn.count()) {
        await bulkBtn.click();
        await page.waitForTimeout(1000);
        await shot('09-after-bulk-delete');
        report.rowCountAfterBulkDelete = await page.locator('.sa-content sa-datagrid-row >> visible=true').count();
      }
    }
  } catch (e) {
    report.driverError = e.message;
    await shot('99-error-state').catch(() => {});
  }

  await page.close();
  return report;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const reports = [];
  for (const name of EXAMPLES) reports.push(await verifyExample(browser, name));
  await browser.close();
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
