#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MANIFEST_PATH = 'extension/manifest.json';
const ID_RE = /^[a-z0-9-]+$/i;
const PATH_RE = /^(features|ui-ux)\/[a-z0-9-]+\.js$/i;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const errors = [];

function fail(message) {
  errors.push(message);
}

function readManifest(text, label) {
  let manifest;

  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error.message}`);
  }

  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.extensions)
  ) {
    throw new Error(`${label}: invalid manifest structure`);
  }

  const ids = new Set();
  const paths = new Set();
  const items = [];

  manifest.extensions.forEach((item, index) => {
    if (item?.enabled !== true) return;

    const id = String(item.id || '').trim();
    const path = String(item.path || '').trim();
    const version = String(item.version || '').trim();
    const prefix = `${label} extensions[${index}]`;

    if (!ID_RE.test(id)) fail(`${prefix}: invalid id`);
    if (!VERSION_RE.test(version)) fail(`${prefix}: invalid version for ${id || '<empty>'}`);
    if (!PATH_RE.test(path)) fail(`${prefix}: invalid path for ${id || '<empty>'}`);
    if (path && id && path.split('/').pop() !== `${id}.js`) {
      fail(`${prefix}: path does not match id ${id}`);
    }
    if (ids.has(id)) fail(`${prefix}: duplicate id ${id}`);
    if (paths.has(path)) fail(`${prefix}: duplicate path ${path}`);

    ids.add(id);
    paths.add(path);
    items.push({ id, path, version });
  });

  return items;
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

const currentItems = readManifest(
  fs.readFileSync(MANIFEST_PATH, 'utf8'),
  'current'
);

for (const item of currentItems) {
  let code = '';

  try {
    code = fs.readFileSync(item.path, 'utf8');
  } catch {
    fail(`${item.id}: registered file not found: ${item.path}`);
    continue;
  }

  try {
    execFileSync(process.execPath, ['--check', item.path], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    fail(`${item.id}: JavaScript syntax check failed for ${item.path}`);
  }

  const match = code.match(/^\s*\/\/\s*@version\s+(\S+)\s*$/m);
  if (!match) {
    fail(`${item.id}: @version header not found in ${item.path}`);
    continue;
  }

  if (match[1] !== item.version) {
    fail(
      `${item.id}: file @version ${match[1]} does not match manifest ${item.version}`
    );
  }
}

const baseRef = String(process.argv[2] || '').trim();

if (baseRef && !/^0+$/.test(baseRef)) {
  try {
    const baseItems = readManifest(
      git('show', `${baseRef}:${MANIFEST_PATH}`),
      `base ${baseRef.slice(0, 12)}`
    );
    const baseById = new Map(baseItems.map(item => [item.id, item]));
    const changedPaths = new Set(
      git('diff', '--name-only', `${baseRef}...HEAD`, '--', 'features', 'ui-ux')
        .split('\n')
        .map(value => value.trim())
        .filter(Boolean)
    );

    for (const item of currentItems) {
      if (!changedPaths.has(item.path)) continue;

      const previous = baseById.get(item.id);
      if (!previous || previous.path !== item.path) continue;

      if (previous.version === item.version) {
        fail(
          `${item.id}: ${item.path} changed but manifest version stayed ${item.version}`
        );
      }
    }
  } catch (error) {
    fail(`cannot compare with base ${baseRef}: ${error.message}`);
  }
}

if (errors.length) {
  console.error('Extension version check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Extension version check passed for ${currentItems.length} enabled extensions.`);
