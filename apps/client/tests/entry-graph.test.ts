import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The login must stay small on a phone network: what main.ts pulls in with static imports may
 * not reach the 3D engine, the voice client, the lobby, the game screen or the English
 * dictionaries (those are chunks loaded on demand, see src/prefetch.ts).
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Static, non-type imports of one source file: relative paths and package names. */
function imports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  for (const m of code.matchAll(/^\s*export\s+(?!type\b)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of imports(f)) {
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      if (spec.endsWith('.css')) continue;
      todo.push(resolve(dirname(f), spec.replace(/\.js$/, '.ts')));
    }
  }
  return { files, packages };
}

describe('entry chunk', () => {
  const { files, packages } = staticGraph(resolve(SRC, 'main.ts'));
  const rel = [...files].map((f) => f.slice(SRC.length + 1));

  it('has no 3D engine and no voice client', () => {
    expect([...packages].filter((p) => p === 'three' || p.startsWith('three/') || p === 'livekit-client')).toEqual([]);
  });

  it('leaves lobby, game screen, stations, 3D view and English dictionaries to their own chunks', () => {
    const lazy = rel.filter((f) => /^(screens\/(game|lobby)\.ts|stations\/|widgets\/(periscope3d|recog-render)\.ts|widgets\/sea3d\/|voice\/sfu\.ts|i18n\/(en-|dict-en))/.test(f));
    expect(lazy).toEqual([]);
  });

  it('is really walked (sanity)', () => {
    expect(rel).toContain('screens/auth.ts');
    expect(rel).toContain('i18n/index.ts');
  });
});
