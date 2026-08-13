import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';
import he from './he.json';

/**
 * A missing translation does not throw — i18next silently falls back to
 * English, so a half-translated screen looks like a working screen to whoever
 * added the key and like a bug to the person reading it. This is the only
 * thing that catches it.
 */
type Tree = { [key: string]: string | Tree };

/** Plural forms differ per language (en: one/other, he: one/two/many/other), so
 *  keys are compared with the CLDR suffix stripped. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keys(tree: Tree, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.add(path.replace(PLURAL_SUFFIX, ''));
    else for (const nested of keys(value, path)) out.add(nested);
  }
  return out;
}

const base = keys(en as Tree);

describe.each([
  ['ru', ru],
  ['he', he],
])('%s locale', (_name, locale) => {
  const translated = keys(locale as Tree);

  it('translates every English key', () => {
    expect([...base].filter((k) => !translated.has(k))).toEqual([]);
  });

  it('defines no key English does not have', () => {
    expect([...translated].filter((k) => !base.has(k))).toEqual([]);
  });
});
