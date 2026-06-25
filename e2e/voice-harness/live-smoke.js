#!/usr/bin/env node
/**
 * Staged live driver for a real prod smoke of the voice tutor.
 *
 *   --stage=recon                 login -> /app/learn, screenshot + dump assignments
 *   --stage=launch --assignment=<id>   open launch page, screenshot (shows voiceAllowed)
 *   --stage=voice  --assignment=<id> [--say="..."]   start practice, mic on, speak, capture
 *
 * recon/launch spend nothing on Realtime. Only --stage=voice opens a Realtime session.
 */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { voiceHarnessInit } from './inject.js';
import { tts } from './tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const STAGE = args.stage || 'recon';
const ASSIGNMENT = args.assignment;
const SAY = args.say || 'Hola, buenos días. Quisiera un café con leche, por favor.';
const ORIGIN = args.origin || 'https://l1ngual.com';

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const p = resolve(__dirname, '../../.env');
  if (existsSync(p)) {
    const l = readFileSync(p, 'utf8').split('\n').find((x) => x.startsWith('OPENAI_API_KEY='));
    if (l) return l.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
}

const shot = (page, name) => page.screenshot({ path: join(__dirname, `${name}.png`), fullPage: true });

async function login(page) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', process.env.STUDENT_EMAIL || 'teststudent@testing.com');
  await page.fill('input[type=password]', process.env.STUDENT_PW || 'lingual123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/app/**', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const context = await browser.newContext();
  await context.grantPermissions(['microphone'], { origin: ORIGIN }).catch(() => {});
  await context.addInitScript(voiceHarnessInit);
  const page = await context.newPage();
  page.on('console', (m) => console.log(`  [page:${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

  await login(page);
  console.log('URL after login:', page.url());

  if (STAGE === 'recon') {
    await page.goto(`${ORIGIN}/app/learn`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, 'recon');
    // Pull the student's assignments straight from the API (session cookie is set).
    const data = await page.evaluate(async () => {
      const tryUrls = ['/api/student/assignments', '/api/assignments', '/api/student/dashboard'];
      const out = {};
      for (const u of tryUrls) {
        try {
          const r = await fetch(u, { credentials: 'include' });
          out[u] = { status: r.status, body: (await r.text()).slice(0, 4000) };
        } catch (e) {
          out[u] = { error: String(e) };
        }
      }
      return out;
    });
    console.log('=== API probe ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('=== visible dashboard text ===');
    console.log((await page.evaluate(() => document.body.innerText)).slice(0, 2500));
    await browser.close();
    return;
  }

  if (!ASSIGNMENT) {
    console.error('need --assignment=<id>');
    await browser.close();
    process.exit(2);
  }

  await page.goto(`${ORIGIN}/app/assignments/${ASSIGNMENT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'launch');
  console.log('=== launch page text ===');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1800));

  if (STAGE === 'launch') {
    await browser.close();
    return;
  }

  // STAGE === 'voice'
  try {
    const startBtn = page.getByRole('button', { name: /start (assignment|text) practice/i });
    await startBtn.waitFor({ state: 'visible', timeout: 20000 });
    await startBtn.click();
    await page.waitForTimeout(3000);
    await shot(page, 'workspace');
    console.log('[voice] practice started');

    // Fresh attempt to clear prior history, so the diff isolates exactly our turn.
    if (args.fresh) {
      const fresh = page.getByRole('button', { name: /new attempt/i });
      if (await fresh.count()) {
        await fresh.first().click().catch(() => {});
        await page.waitForTimeout(3000);
        console.log('[voice] started a fresh attempt');
      }
    }

    // Click the mic (voice toggle) — button containing the lucide Mic icon.
    const mic = page.locator('button:has(svg.lucide-mic)').first();
    await mic.waitFor({ state: 'visible', timeout: 15000 });
    await mic.click();
    console.log('[voice] mic clicked — connecting…');
    await page.waitForTimeout(7000); // let WebRTC + Realtime session establish
    await shot(page, 'connected');

    const harnessState = await page.evaluate(() => ({
      type: typeof window.__voiceHarness,
      ready: window.__voiceHarness && window.__voiceHarness.isReady(),
    }));
    console.log('[voice] harness state:', JSON.stringify(harnessState));

    // One turn: capture baseline, inject + commit, poll for the tutor's reply.
    async function doTurn(text, idx) {
      const before = await page.evaluate(() => document.body.innerText);
      const beforeSet = new Set(before.split('\n').map((l) => l.trim()));
      console.log(`\n[turn ${idx}] 🗣  "${text}"`);
      const wav = await tts(text, { engine: args.engine || 'openai', apiKey: apiKey() });
      await page.evaluate((b64) => window.__voiceHarness.speak(b64), wav.toString('base64'));
      // Commit by default — semantic_vad doesn't close the turn on synthetic silence.
      if (!args['no-commit']) {
        await page.waitForTimeout(800);
        await page.evaluate(() => window.__voiceHarness.commitInput());
      }
      // Poll up to 18s for new conversation lines (user echo + tutor reply).
      let newLines = [];
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => document.body.innerText);
        newLines = after
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !beforeSet.has(l) && !l.startsWith('Status:'));
        if (newLines.length >= 2) break; // user line + at least one tutor line
      }
      await shot(page, `turn-${idx}`);
      console.log(`[turn ${idx}] new:\n${newLines.map((l) => '   ' + l).join('\n') || '   (no reply captured)'}`);
      return newLines;
    }

    const turnsList = args.turns
      ? readFileSync(resolve(process.cwd(), String(args.turns)), 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
      : [SAY];
    console.log(`[voice] running ${turnsList.length} turn(s)…`);

    for (let i = 0; i < turnsList.length; i++) {
      await doTurn(turnsList[i], i + 1);
    }

    const events = await page.evaluate(() => window.__vhEvents || []);
    const tally = {};
    for (const e of events) tally[e.t] = (tally[e.t] || 0) + 1;
    console.log('\n=== realtime event tally (whole session) ===');
    console.log(JSON.stringify(tally, null, 1));
  } catch (e) {
    console.log('[voice] STEP FAILED:', e.message);
    await shot(page, 'response').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(async (e) => {
  console.error('DRIVER ERROR:', e);
  process.exit(1);
});
