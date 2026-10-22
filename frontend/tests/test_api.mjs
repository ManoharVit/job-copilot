import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJSON } from '../src/api.js';

test('HTTP failures reject instead of accepting a failed status or notes save', async t => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async () => new Response('{"detail":"Invalid status transition"}', { status: 409 });
    await assert.rejects(requestJSON('/api/applications/1', { method: 'PUT' }), /409/);
});

test('successful writes expose server data after status validation', async t => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async () => new Response('{"status":"success"}', { status: 200 });
    assert.deepEqual(await requestJSON('/api/applications/1'), { status: 'success' });
});
