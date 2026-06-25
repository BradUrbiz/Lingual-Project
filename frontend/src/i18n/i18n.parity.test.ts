// frontend/src/i18n/i18n.parity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './en.json';
import ko from './ko.json';

const SRC = join(__dirname, '..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|ts)$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
}

describe('i18n parity', () => {
  it('en.json and ko.json have identical key sets', () => {
    const enKeys = new Set(Object.keys(en));
    const koKeys = new Set(Object.keys(ko));
    const missingInKo = [...enKeys].filter((k) => !koKeys.has(k));
    const missingInEn = [...koKeys].filter((k) => !enKeys.has(k));
    expect({ missingInKo, missingInEn }).toEqual({ missingInKo: [], missingInEn: [] });
  });

  it('every statically-referenced t() key exists in en.json', () => {
    const enKeys = new Set(Object.keys(en));
    const missing = new Set<string>();
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
        if (!enKeys.has(m[1])) missing.add(`${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
