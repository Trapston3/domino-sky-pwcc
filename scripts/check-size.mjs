import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1_048_576; // 1 MB competition limit
const root = process.cwd();

let trackedOutput = '';
let sizeMode = 'tracked files';
try {
  trackedOutput = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
} catch {
  sizeMode = 'recursive fallback (git ls-files unavailable)';
}

let files = trackedOutput.split('\0').filter(Boolean);
if (files.length === 0) {
  sizeMode = 'recursive fallback (no tracked files returned)';
  const excludedDirectories = new Set([
    '.git', 'node_modules', 'dist', '.vercel', '.vite', '.cache', 'coverage',
  ]);
  const isIgnoredEnv = (name) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
  const walk = (directory, relative = '') => {
    const found = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(entry.name) || isIgnoredEnv(entry.name)) continue;
      const relativePath = relative ? path.join(relative, entry.name) : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...walk(absolutePath, relativePath));
      else if (entry.isFile()) found.push(relativePath);
    }
    return found;
  };
  files = walk(root);
}

const entries = [];
let totalBytes = 0;

for (const rel of files) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const stat = fs.statSync(full);
  if (!stat.isFile()) continue;
  totalBytes += stat.size;
  entries.push({ file: rel, bytes: stat.size });
}

entries.sort((a, b) => b.bytes - a.bytes);
const kb = (totalBytes / 1024).toFixed(1);
const mb = (totalBytes / 1_048_576).toFixed(3);

console.log(`Size check mode: ${sizeMode}`);
console.log(`Repo size: ${totalBytes} bytes (${kb} KB / ${mb} MB) across ${entries.length} files`);
console.log('Top 5 largest tracked files:');
for (const item of entries.slice(0, 5)) {
  console.log(`  ${(item.bytes / 1024).toFixed(1).padStart(7)} KB  ${item.file}`);
}

if (totalBytes > MAX_BYTES) {
  console.error(`ERROR: Tracked repo size ${totalBytes} bytes exceeds 1 MB (${MAX_BYTES} bytes) limit.`);
  process.exit(1);
}
