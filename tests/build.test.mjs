import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildCatalog, readEntries, validateEntry } from '../scripts/build.mjs';

const SHA = 'a'.repeat(64);
const good = {
  id: 'acme-lint',
  name: 'Acme Lint',
  description: 'Flags style problems before you commit.',
  version: '1.2.0',
  tags: ['lint', 'code-quality'],
  author: { name: 'Acme', url: 'https://acme.dev' },
  source: { type: 'artifact', url: 'https://cdn.acme.dev/acme-lint-1.2.0.tgz', sha256: SHA, size: 1234 },
};

test('accepts a complete artifact entry and a GitHub entry', () => {
  assert.deepEqual(validateEntry(good, 'entries/acme-lint.json'), []);
  const github = { ...good, id: 'acme-deploy', source: { type: 'github', repo: 'acme/deploy', plugin_path: 'plugin' } };
  assert.deepEqual(validateEntry(github, 'entries/acme-deploy.json'), []);
});

test('rejects mismatched file names, reserved and official ids, and unknown fields', () => {
  assert.match(validateEntry(good, 'entries/other.json').join('\n'), /must be named acme-lint\.json/);
  assert.match(validateEntry({ ...good, id: 'recursive-x' }, 'entries/recursive-x.json').join('\n'), /reserved/);
  assert.match(validateEntry(good, 'entries/acme-lint.json', new Set(['acme-lint'])).join('\n'), /Recursive Official plugin/);
  assert.match(validateEntry({ ...good, extra: 1 }, 'entries/acme-lint.json').join('\n'), /unknown field "extra"/);
});

test('rejects unsafe or incomplete sources', () => {
  const file = 'entries/acme-lint.json';
  assert.match(validateEntry({ ...good, source: { ...good.source, url: 'http://cdn.acme.dev/x.tgz' } }, file).join('\n'), /https/);
  assert.match(validateEntry({ ...good, source: { ...good.source, sha256: 'abc' } }, file).join('\n'), /sha256/);
  assert.match(validateEntry({ ...good, source: { type: 'github', repo: 'acme/deploy', plugin_path: '../x' } }, file).join('\n'), /inside the repository/);
  assert.match(validateEntry({ ...good, source: { type: 'npm' } }, file).join('\n'), /"artifact" or "github"/);
  assert.match(validateEntry({ ...good, author: {} }, file).join('\n'), /author\.name/);
});

test('builds a sorted catalog the app reads as Recursive Community', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-entries-'));
  fs.writeFileSync(path.join(dir, 'zeta.json'), JSON.stringify({ ...good, id: 'zeta' }));
  fs.writeFileSync(path.join(dir, 'acme-lint.json'), JSON.stringify(good));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const read = readEntries(dir);
  assert.equal(read.filter((item) => item.error).length, 1);
  const catalog = buildCatalog(read.filter((item) => !item.error));
  assert.equal(catalog.name, 'recursive-community');
  assert.deepEqual(catalog.plugins.map((plugin) => plugin.id), ['acme-lint', 'zeta']);
  fs.rmSync(dir, { recursive: true, force: true });
});
