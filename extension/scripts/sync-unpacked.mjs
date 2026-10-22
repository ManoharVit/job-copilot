import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, '.output', 'chrome-mv3');
const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.name !== 'Job Copilot') {
  throw new Error('Refusing to sync an unexpected extension build');
}

// Keep the existing unpacked directory (and its Chrome extension ID). Never
// delete the root directory: it also holds the editable source and test files.
const allowed = new Set(['manifest.json', 'background.js', 'popup.html', 'content-scripts', 'chunks', 'assets', 'icons']);
const files = readdirSync(build);
for (const name of files) {
  if (!allowed.has(name)) throw new Error(`Unexpected build output: ${name}`);
}
for (const name of files.filter(name => name !== 'manifest.json')) {
  cpSync(join(build, name), join(root, name), { recursive: true });
}
// Update the manifest after all its referenced assets are available.
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Updated the existing extension/ unpacked directory. Reload Job Copilot and the application page in Chrome.');
