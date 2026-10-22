const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { CONTENT_SCRIPT, CONTENT_CSS } = require('../src/shared/messages.ts');

const output = path.join(__dirname, '..', '.output', 'chrome-mv3');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));

test('production manifest preserves frame injection, permissions and shortcut', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Job Copilot');
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], 'icons/job-copilot.png');
    assert(fs.existsSync(path.join(output, manifest.icons[size])), 'Packaged brand icon must exist');
  }
  assert.deepEqual(new Set(manifest.permissions), new Set(['activeTab', 'storage', 'scripting', 'webNavigation', 'tabs']));
  assert.equal(manifest.commands.autofill.suggested_key.mac, 'Command+Shift+F');
  assert(manifest.host_permissions.includes('http://localhost:8765/*'));
  assert(manifest.host_permissions.includes('http://127.0.0.1:8765/*'));
  const content = manifest.content_scripts.find(script => script.js.includes(CONTENT_SCRIPT));
  assert(content.matches.includes('<all_urls>'));
  assert.equal(content.all_frames, true);
  assert.equal(content.match_about_blank, true);
  assert.equal(content.run_at, 'document_end');
  assert(content.css.includes(CONTENT_CSS));
  for (const file of [CONTENT_SCRIPT, CONTENT_CSS, manifest.background.service_worker, manifest.action.default_popup]) {
    assert(fs.existsSync(path.join(output, file)), `Missing packaged asset: ${file}`);
  }
  const popup = fs.readFileSync(path.join(output, manifest.action.default_popup), 'utf8');
  const scripts = [...popup.matchAll(/<script[^>]+src="([^"]+)"/g)];
  assert(scripts.length > 0);
  assert(popup.includes('id="allowSitesBtn"'));
  assert(popup.includes('id="connectBackendBtn"'));
  assert(popup.includes('id="siteAccessOrigins"'));
  for (const [, file] of scripts) assert(fs.existsSync(path.join(output, file.replace(/^\//, ''))));
});

test('compiled worker injects the actual packaged content and CSS files', async () => {
  const injected = [];
  let onMessage;
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { onMessage = fn; } } },
    scripting: {
      executeScript: async request => { injected.push(...request.files); },
      insertCSS: async request => { injected.push(...request.files); },
    },
    webNavigation: {
      onCompleted: { addListener() {} },
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.test/jobs' }],
    },
    tabs: {
      onUpdated: { addListener() {} },
      sendMessage: async () => ({ success: true, filledCount: 2 }),
    },
    commands: { onCommand: { addListener() {} } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(output, manifest.background.service_worker), 'utf8'), { chrome, fetch, console, URL });
  const response = await new Promise(resolve => onMessage({ action: 'broadcastAutofill' }, { tab: { id: 1 } }, resolve));
  assert.equal(response.success, true);
  assert.equal(response.filledCount, 2);
  assert.deepEqual(new Set(injected), new Set([CONTENT_SCRIPT, CONTENT_CSS]));
});

test('compiled content script starts and reinjection keeps one application listener', async () => {
  const listeners = [];
  const chrome = { runtime: { id: 'test-extension', onMessage: { addListener(fn) { listeners.push(fn); } } } };
  const window = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  window.self = window;
  window.top = window;
  const document = { readyState: 'loading', body: null, addEventListener() {}, dispatchEvent() {} };
  const context = vm.createContext({
    chrome, window, document, console, Event, CustomEvent, EventTarget, AbortController,
    setTimeout() { return 1; }, clearTimeout() {},
    MutationObserver: class { observe() {} },
  });
  const content = fs.readFileSync(path.join(output, CONTENT_SCRIPT), 'utf8');
  vm.runInContext(content, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.__jobCopilotLoaded, true);
  const count = listeners.length;
  assert(count > 0);
  vm.runInContext(content, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listeners.length, count);
});
