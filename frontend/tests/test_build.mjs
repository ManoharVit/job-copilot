import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, '../../backend/static');

test('production dashboard bundle in backend/static is valid and complete', () => {
    const indexPath = path.join(staticDir, 'index.html');
    assert.ok(fs.existsSync(indexPath), 'backend/static/index.html must exist');

    const html = fs.readFileSync(indexPath, 'utf8');
    assert.ok(html.includes('id="root"'), 'index.html must contain root element');

    // Validate script and stylesheet asset references
    const assetMatches = Array.from(html.matchAll(/(?:src|href)="(\/static\/assets\/[^"]+)"/g));
    assert.ok(assetMatches.length >= 2, 'index.html must reference at least one JS and one CSS asset');

    for (const match of assetMatches) {
        const urlPath = match[1];
        const filename = path.basename(urlPath);
        const diskPath = path.join(staticDir, 'assets', filename);
        assert.ok(fs.existsSync(diskPath), `Referenced asset ${urlPath} must exist on disk at ${diskPath}`);
        const stat = fs.statSync(diskPath);
        assert.ok(stat.size > 0, `Asset ${filename} must not be empty`);
    }
});

test('legacy dashboard is preserved at backend/static/legacy.html', () => {
    const legacyPath = path.join(staticDir, 'legacy.html');
    assert.ok(fs.existsSync(legacyPath), 'backend/static/legacy.html must exist');
    const legacyHtml = fs.readFileSync(legacyPath, 'utf8');
    assert.ok(legacyHtml.includes('id="dashboard-tab"'), 'legacy.html must contain dashboard tab');
});
