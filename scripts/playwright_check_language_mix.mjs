// One-off UI check for the new "AI tutor language mix" radio group on the
// teacher assignment builder page. Read-only — does not save or publish.
//
// Usage:
//   NODE_PATH=/tmp/lingual-pw/node_modules node scripts/playwright_check_language_mix.mjs

import { chromium } from 'playwright';

const TEACHER_EMAIL = process.env.LINGUAL_E2E_TEACHER_EMAIL || 'testin1@gmail.com';
const TEACHER_PW = process.env.LINGUAL_E2E_TEACHER_PW || 'tbvmflazla17';
const BASE_URL = process.env.LINGUAL_E2E_BASE_URL || 'http://localhost:5173';

const log = (msg) => console.log(`[pw] ${msg}`);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    log(`navigating to ${BASE_URL}/auth`);
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'networkidle' });

    log('signing in as teacher');
    await page.locator('input[type="email"]').fill(TEACHER_EMAIL);
    await page.locator('input[type="password"]').fill(TEACHER_PW);
    await page.locator('button[type="submit"]').click();

    log('waiting for /app/teacher');
    await page.waitForURL(/\/app\/teacher(\/|$)/, { timeout: 15000 });
    log(`landed on ${page.url()}`);

    // Find the first class card link (path like /app/teacher/classes/<id>/...)
    const classLink = page.locator('a[href*="/app/teacher/classes/"][href*="/assignments"]').first();
    if (await classLink.count() === 0) {
      // Try generic class link, then derive the assignments route.
      const fallback = page.locator('a[href*="/app/teacher/classes/"]').first();
      if (await fallback.count() === 0) {
        throw new Error('No teacher class found on dashboard');
      }
      const href = await fallback.getAttribute('href');
      const classId = (href || '').split('/classes/')[1]?.split('/')[0];
      if (!classId) throw new Error(`Could not parse classId from href ${href}`);
      log(`navigating directly to assignments for class ${classId}`);
      await page.goto(`${BASE_URL}/app/teacher/classes/${classId}/assignments`, { waitUntil: 'networkidle' });
    } else {
      log('clicking first class assignments link');
      await Promise.all([
        page.waitForURL(/\/app\/teacher\/classes\/.+\/assignments$/, { timeout: 10000 }),
        classLink.click(),
      ]);
    }
    log(`assignment builder URL: ${page.url()}`);

    // The form sits behind either a Canvas item picker or an Advanced→Manual mode.
    // Try to enter Advanced → Manual so we don't need a Canvas item to render the
    // language-mix radio group.
    const advancedTab = page.getByRole('button', { name: /Advanced/i });
    if (await advancedTab.count() > 0) {
      log('switching to Advanced builder');
      await advancedTab.first().click();
    }
    const manualTab = page.getByRole('button', { name: /Manual|manual/ });
    if (await manualTab.count() > 0) {
      log('switching to manual entry');
      await manualTab.first().click();
    }

    log('looking for AI tutor language mix radio group');
    const groupLabel = page.getByText('AI tutor language mix', { exact: true });
    await groupLabel.waitFor({ state: 'visible', timeout: 8000 });

    const radioGroup = page.locator('[role="radiogroup"][aria-labelledby="canvas-language-mix-label"]');
    const optionCount = await radioGroup.locator('[role="radio"]').count();
    log(`radio options found: ${optionCount}`);
    if (optionCount !== 3) {
      throw new Error(`Expected 3 radio options, got ${optionCount}`);
    }

    const optionTexts = await radioGroup.locator('[role="radio"]').allInnerTexts();
    log('option labels:');
    optionTexts.forEach((t, i) => console.log(`    [${i}] ${t.replace(/\n/g, ' | ')}`));

    // Default should be "Mostly target language" (mostly_target).
    const defaultChecked = await radioGroup.locator('[role="radio"][aria-checked="true"]').innerText();
    log(`default selected: ${defaultChecked.split('\n')[0]}`);
    if (!/Mostly target language/i.test(defaultChecked)) {
      throw new Error(`Default option was not 'Mostly target language': got ${defaultChecked}`);
    }

    // Click "Target language only" and assert aria-checked flips.
    await radioGroup.getByRole('radio', { name: /Target language only/i }).click();
    const afterTargetOnly = await radioGroup.locator('[role="radio"][aria-checked="true"]').innerText();
    log(`after click target_only: ${afterTargetOnly.split('\n')[0]}`);
    if (!/Target language only/i.test(afterTargetOnly)) {
      throw new Error(`aria-checked did not move to target_only: got ${afterTargetOnly}`);
    }

    // Click "Bilingual scaffolding" and assert aria-checked flips.
    await radioGroup.getByRole('radio', { name: /Bilingual scaffolding/i }).click();
    const afterBilingual = await radioGroup.locator('[role="radio"][aria-checked="true"]').innerText();
    log(`after click bilingual: ${afterBilingual.split('\n')[0]}`);
    if (!/Bilingual scaffolding/i.test(afterBilingual)) {
      throw new Error(`aria-checked did not move to bilingual_scaffold: got ${afterBilingual}`);
    }

    const screenshotPath = '/tmp/language-mix-ui.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`screenshot saved: ${screenshotPath}`);
    if (consoleErrors.length) {
      log(`console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.log(`    ${e}`));
    }
    log('PASS');
  } catch (err) {
    const screenshotPath = '/tmp/language-mix-ui-FAIL.png';
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
    log(`FAIL: ${err.message}`);
    log(`screenshot saved: ${screenshotPath}`);
    if (consoleErrors.length) {
      log(`console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.log(`    ${e}`));
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
