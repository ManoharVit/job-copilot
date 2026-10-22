const assert = require('node:assert/strict');
const test = require('node:test');
const { apiRequest } = require('../src/core/api-proxy.ts');

for (const url of ['https://attacker.example/api/profile', 'http://localhost.evil.test:8765/api/profile',
  'http://localhost:8001/api/profile', 'http://user:secret@localhost:8765/api/profile',
  'http://127.0.0.1:8765/api/profile?redirect=evil', 'http://127.0.0.1:8765/api/v1/applications']) {
  test(`proxy rejects ${url.replace('user:secret@', '')}`, () => {
    assert.throws(() => apiRequest(url, {}));
  });
}
test('proxy rejects profile writes and rebuilds fetch options', () => {
  assert.throws(() => apiRequest('http://127.0.0.1:8765/api/profile', { method: 'PUT', body: '{}' }));
  const [url, options] = apiRequest('http://127.0.0.1:8765/api/match-fields', {
    method: 'POST', body: '[]', credentials: 'include', redirect: 'follow', headers: { Authorization: 'untrusted' },
  });
  assert.equal(url, 'http://127.0.0.1:8765/api/match-fields');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
});

test('background rejects an arbitrary URL before making a network request', () => {
  const { registerBackground } = require('../src/background.ts');
  let receive;
  let calls = 0;
  const listener = { addListener() {} };
  const chrome = {
    runtime: { onInstalled: listener, onMessage: { addListener(fn) { receive = fn; } } },
    tabs: { onUpdated: listener }, commands: { onCommand: listener },
  };
  registerBackground(chrome, () => { calls++; throw new Error('Unapproved request'); });
  let response;
  receive({ action: 'fetchAPI', url: 'https://untrusted.example/', options: {} }, {}, value => { response = value; });
  assert.equal(response.success, false);
  assert.equal(calls, 0);
});

// A former backend port must never become an arbitrary local-service proxy.
test('rejects the former backend port', () => {
  assert.throws(() => apiRequest('http://127.0.0.1:8000/api/profile'));
});
