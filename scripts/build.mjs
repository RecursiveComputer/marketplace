#!/usr/bin/env node
/**
 * Validate every entries/<id>.json and build community.json, the catalog the
 * Recursive app reads as its built-in "Recursive Community" marketplace.
 *
 *   node scripts/build.mjs                      # validate and write dist/community.json
 *   node scripts/build.mjs --check              # validate only
 *   node scripts/build.mjs --verify-downloads   # also download each package and check its size and sha256
 *
 * Exits 1 with one line per problem. No dependencies: runs on stock Node 22.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFICIAL_FEED = process.env.RECURSIVE_OFFICIAL_FEED || 'https://releases.recursive.computer/registry/v1/recursive.json';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ALLOWED_KEYS = new Set([
  'id', 'name', 'description', 'version', 'icon', 'color', 'category', 'tags',
  'author', 'homepage', 'min_recursive_version', 'provides', 'source',
]);
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Problems with one entry, as strings. `reserved` holds ids that belong to Recursive's own plugins. */
export function validateEntry(entry, file, reserved = new Set()) {
  const problems = [];
  const at = (message) => problems.push(`${file}: ${message}`);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [`${file}: must be a JSON object`];
  for (const key of Object.keys(entry)) if (!ALLOWED_KEYS.has(key)) at(`unknown field "${key}"`);

  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) at('"id" must be lowercase letters, digits and dashes');
  else {
    if (path.basename(file) !== `${entry.id}.json`) at(`file must be named ${entry.id}.json`);
    if (entry.id === 'recursive' || entry.id.startsWith('recursive-')) at('ids starting with "recursive" are reserved');
    if (reserved.has(entry.id)) at(`"${entry.id}" is a Recursive Official plugin; pick another id`);
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) at('"name" is required');
  if (typeof entry.description !== 'string' || !entry.description.trim()) at('"description" is required');
  else if (entry.description.length > 300) at('"description" is longer than 300 characters');
  if (entry.version !== undefined && (typeof entry.version !== 'string' || !SEMVER.test(entry.version))) at('"version" must be semver');
  if (entry.min_recursive_version !== undefined && (typeof entry.min_recursive_version !== 'string' || !SEMVER.test(entry.min_recursive_version))) {
    at('"min_recursive_version" must be semver');
  }
  if (entry.homepage !== undefined && !isHttps(entry.homepage)) at('"homepage" must be an https URL');
  if (entry.tags !== undefined) {
    if (!Array.isArray(entry.tags) || entry.tags.length > 10) at('"tags" must be a list of at most 10');
    else for (const tag of entry.tags) if (typeof tag !== 'string' || tag.length > 32 || !TAG_PATTERN.test(tag)) at(`tag "${tag}" must be lowercase words joined by dashes`);
  }
  if (entry.provides !== undefined && (!Array.isArray(entry.provides) || !entry.provides.every((item) => typeof item === 'string'))) {
    at('"provides" must be a list of strings');
  }
  const author = entry.author;
  if (!author || typeof author !== 'object' || typeof author.name !== 'string' || !author.name.trim()) at('"author.name" is required');
  else if (author.url !== undefined && !isHttps(author.url)) at('"author.url" must be an https URL');

  const source = entry.source;
  if (!source || typeof source !== 'object') at('"source" is required');
  else if (source.type === 'artifact') {
    if (!isHttps(source.url)) at('artifact "url" must be https');
    if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) at('artifact "sha256" must be 64 lowercase hex characters');
    if (!Number.isInteger(source.size) || source.size <= 0 || source.size > MAX_PACKAGE_BYTES) at('artifact "size" must be the package size in bytes');
    for (const key of Object.keys(source)) if (!['type', 'url', 'sha256', 'size'].includes(key)) at(`unknown source field "${key}"`);
  } else if (source.type === 'github') {
    if (typeof source.repo !== 'string' || !REPO_PATTERN.test(source.repo)) at('github "repo" must be owner/name');
    if (source.plugin_path !== undefined && (typeof source.plugin_path !== 'string' || source.plugin_path.startsWith('/') || source.plugin_path.split('/').includes('..'))) {
      at('github "plugin_path" must stay inside the repository');
    }
    for (const key of Object.keys(source)) if (!['type', 'repo', 'plugin_path'].includes(key)) at(`unknown source field "${key}"`);
  } else at('"source.type" must be "artifact" or "github"');
  return problems;
}

export function readEntries(dir = path.join(ROOT, 'entries')) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = path.join('entries', name);
      try {
        return { file, entry: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) };
      } catch (error) {
        return { file, error: `${file}: not valid JSON (${error.message})` };
      }
    });
}

export function buildCatalog(entries) {
  return {
    schemaVersion: 1,
    name: 'recursive-community',
    displayName: 'Recursive Community',
    description: 'Plugins from other publishers, reviewed by the Recursive team.',
    plugins: entries.map(({ entry }) => entry).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function reservedIds() {
  const response = await fetch(OFFICIAL_FEED, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not read the Recursive Official feed (${response.status}) to check for id collisions.`);
  const feed = await response.json();
  return new Set((Array.isArray(feed.plugins) ? feed.plugins : []).map((plugin) => plugin.id).filter(Boolean));
}

async function verifyDownload({ file, entry }) {
  const { source } = entry;
  if (source?.type !== 'artifact') return [];
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) return [`${file}: downloading the package returned ${response.status}`];
    const bytes = Buffer.from(await response.arrayBuffer());
    const problems = [];
    if (bytes.length !== source.size) problems.push(`${file}: package is ${bytes.length} bytes, entry says ${source.size}`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== source.sha256) problems.push(`${file}: package sha256 is ${digest}, entry says ${source.sha256}`);
    return problems;
  } catch (error) {
    return [`${file}: could not download the package (${error.message})`];
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const read = readEntries();
  const problems = read.filter((item) => item.error).map((item) => item.error);
  const reserved = await reservedIds();
  const valid = read.filter((item) => !item.error);
  for (const item of valid) problems.push(...validateEntry(item.entry, item.file, reserved));
  if (args.has('--verify-downloads')) {
    for (const item of valid) problems.push(...await verifyDownload(item));
  }
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`${valid.length} ${valid.length === 1 ? 'entry' : 'entries'} valid`);
  if (args.has('--check')) return;
  const out = path.join(ROOT, 'dist', 'community.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(buildCatalog(valid), null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
