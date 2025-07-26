#!/usr/bin/env node

import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, extname } from 'path';

const DEFAULT_EXTS = ['.rs', '.ts', '.tsx', '.js', '.json', '.svg'];
const args = process.argv.slice(2);

let extensions = DEFAULT_EXTS;

const extArg = args.find(a => a.startsWith('--ext='));
if (extArg) {
  extensions = extArg
    .replace('--ext=', '')
    .split(',')
    .map(ext => ext.trim())
    .map(ext => (ext.startsWith('.') ? ext : `.${ext}`));
}

function walk(dir) {
  const files = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      files.push(...walk(p));
    } else {
      files.push(p);
    }
  }
  return files;
}

const allFiles = walk(process.cwd());

for (const file of allFiles) {
  if (!extensions.includes(extname(file))) continue;

  let content = readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, '')) // trim trailing whitespace
    .join('\n');

  // Ensure exactly one trailing newline
  content = content.replace(/\n*$/, '') + '\n';

  writeFileSync(file, content, 'utf8');
}
