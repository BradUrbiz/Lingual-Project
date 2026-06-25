/**
 * Text -> speech, returning WAV bytes (Buffer) ready to inject into the page.
 *
 * Two engines:
 *   - openai (default): gpt-4o-mini-tts. Natural prosody -> semantic_vad detects
 *     turn boundaries cleanly. Costs a small amount per call, needs OPENAI_API_KEY.
 *   - say: macOS `say`. Free, offline, instant. Robotic, but Whisper transcribes it
 *     fine. Good for fast iteration and CI self-tests (no spend).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function openaiTTS(text, { apiKey, voice = 'alloy', model = 'gpt-4o-mini-tts' } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing (set env or repo-root .env)');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, voice, input: text, response_format: 'wav' }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function sayTTS(text) {
  const dir = mkdtempSync(join(tmpdir(), 'vh-'));
  const out = join(dir, 'out.wav');
  try {
    // 24 kHz, signed 16-bit little-endian, mono — a plain PCM WAV that
    // Web Audio's decodeAudioData() accepts without fuss.
    execFileSync('say', ['-o', out, '--file-format=WAVE', '--data-format=LEI16@24000', text]);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Resolve text -> WAV Buffer using the chosen engine, with say as a safety net. */
export async function tts(text, opts = {}) {
  const engine = opts.engine || 'openai';
  if (engine === 'say') return sayTTS(text);
  try {
    return await openaiTTS(text, opts);
  } catch (e) {
    console.warn(`[tts] OpenAI failed (${e.message}); falling back to macOS \`say\``);
    return sayTTS(text);
  }
}
