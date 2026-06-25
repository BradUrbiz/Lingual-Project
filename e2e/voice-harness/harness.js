#!/usr/bin/env node
/**
 * Lingual realtime-voice test harness.
 *
 * Drives the voice tutor by typing text that is synthesized (TTS) and injected
 * into the page's microphone in real time — so you can have a scripted spoken
 * conversation with the tutor without a real mic. The hard part (keeping the
 * WebRTC session live while swapping audio) is solved by overriding getUserMedia;
 * see inject.js.
 *
 * Modes:
 *   --self-test            Prove injection works against a local page (no prod, no
 *                          Realtime spend). Asserts peak RMS rises when we speak.
 *   --turns=<file>         Read newline-separated lines, speak each in order.
 *   (default REPL)         Type a line -> spoken into the call. Commands: /shot /quit
 *
 * Useful flags:
 *   --url=<url>            Page to open (default: https://l1ngual.com/login)
 *   --auto-login           Fill STUDENT_EMAIL/STUDENT_PW (defaults: test student)
 *   --engine=openai|say    TTS engine (default openai; say = free/offline)
 *   --voice=<name>         OpenAI voice (default alloy)
 *   --headless             Run headless (default: headed so you can watch/navigate)
 *   --gap=<ms>             Trailing silence after each utterance (default 700)
 *
 * Examples:
 *   npm run selftest
 *   node harness.js --auto-login                 # opens prod, logs in student
 *   node harness.js --turns=turns.example.txt --engine=say
 */
import { chromium } from 'playwright-core';
import { createInterface } from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { voiceHarnessInit } from './inject.js';
import { tts } from './tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);

const SELF_TEST = !!args['self-test'];
const ENGINE = args.engine || 'openai';
const VOICE = args.voice || 'alloy';
const HEADLESS = !!args.headless;
const GAP_MS = Number(args.gap || 700);
const URL = args.url || 'https://l1ngual.com/login';

// ---- OPENAI_API_KEY: env, else repo-root .env ----
function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = resolve(__dirname, '../../.env');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('OPENAI_API_KEY='));
    if (line) return line.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const API_KEY = loadApiKey();

const ttsOpts = { engine: ENGINE, apiKey: API_KEY, voice: VOICE };

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: HEADLESS,
    args: [
      // Let our in-page AudioContext start without a user gesture.
      '--autoplay-policy=no-user-gesture-required',
      // Belt-and-suspenders: auto-accept any mic prompt + provide a fake device
      // for any code path that bypasses our override.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const context = await browser.newContext();
  try {
    await context.grantPermissions(['microphone']);
  } catch (_e) {
    /* origin-scoped grant not required once getUserMedia is overridden */
  }
  await context.addInitScript(voiceHarnessInit);

  const page = await context.newPage();

  // speak(): TTS -> base64 -> play into the live mic track; wait for playback + gap.
  async function speak(text) {
    const wav = await tts(text, ttsOpts);
    const b64 = wav.toString('base64');
    const dur = await page.evaluate(
      (encoded) => window.__voiceHarness.speak(encoded),
      b64,
    );
    await page.waitForTimeout(GAP_MS);
    return dur;
  }

  if (SELF_TEST) {
    await runSelfTest(page, speak, browser);
    return;
  }

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  if (args['auto-login']) {
    await autoLogin(page);
  }

  console.log('\n=== voice-harness ready ===');
  console.log(`TTS engine: ${ENGINE}${ENGINE === 'openai' ? ` (voice=${VOICE})` : ''}`);
  console.log('In the browser: navigate to an assignment and click the mic to start voice.');
  console.log('Then type lines here — each is spoken into the live call.');
  console.log('Commands: /shot [name]  → screenshot   |   /quit → exit\n');

  if (args.turns) {
    const lines = readFileSync(resolve(process.cwd(), String(args.turns)), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const line of lines) {
      console.log(`🗣  ${line}`);
      await speak(line);
    }
    console.log('\n(turns done — browser stays open; Ctrl-C to exit)');
    await new Promise(() => {}); // keep alive
    return;
  }

  await repl(page, speak, browser);
}

async function autoLogin(page) {
  const email = process.env.STUDENT_EMAIL || 'teststudent@testing.com';
  const pw = process.env.STUDENT_PW || 'lingual123';
  try {
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', pw);
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log(`[auto-login] submitted as ${email}`);
  } catch (e) {
    console.warn(`[auto-login] failed (${e.message}) — log in manually in the browser`);
  }
}

async function repl(page, speak, browser) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'speak> ' });
  rl.prompt();
  rl.on('line', async (raw) => {
    const line = raw.trim();
    if (!line) return rl.prompt();
    if (line === '/quit' || line === '/exit') {
      await browser.close();
      rl.close();
      return process.exit(0);
    }
    if (line.startsWith('/shot')) {
      const name = line.split(/\s+/)[1] || `shot-${Date.now()}`;
      const file = join(process.cwd(), `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`📸 ${file}`);
      return rl.prompt();
    }
    try {
      const dur = await speak(line);
      console.log(`   ✓ spoke ${dur.toFixed(2)}s`);
    } catch (e) {
      console.error(`   ✗ ${e.message}`);
    }
    rl.prompt();
  });
  rl.on('close', async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  });
}

async function runSelfTest(page, speak, browser) {
  const file = 'file://' + join(__dirname, 'selftest.html');
  await page.goto(file);
  await page.waitForTimeout(500);

  const floor = await page.evaluate(() => window.__rmsPeak);
  console.log(`[self-test] silence-floor peak RMS: ${floor.toFixed(4)}`);

  console.log('[self-test] speaking a test phrase…');
  await speak('This is the voice harness self test. One two three.');

  const peak = await page.evaluate(() => window.__rmsPeak);
  console.log(`[self-test] post-speech peak RMS: ${peak.toFixed(4)}`);

  await browser.close();
  if (peak > 0.01 && peak > floor) {
    console.log('\n✅ PASS — injected audio reached getUserMedia. Pipeline works.');
    process.exit(0);
  } else {
    console.log('\n❌ FAIL — peak RMS did not rise. Audio did not flow into the track.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
