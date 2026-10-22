import assert from 'node:assert/strict';
import test from 'node:test';
import { requestAI } from '../src/api.js';

for (const [endpoint, field] of [
    ['generate-cover-letter', 'cover_letter'], ['generate-answer', 'answer'],
    ['tailor-resume', 'bullets'], ['humanize', 'text'], ['interview-prep', 'prep'],
]) {
    test(`${endpoint} rejects HTTP errors before exposing output to the editor`, async t => {
        const previous = globalThis.fetch;
        t.after(() => { globalThis.fetch = previous; });
        globalThis.fetch = async () => Response.json({ detail: 'AI generation unavailable' }, { status: 503 });
        await assert.rejects(requestAI(`/api/${endpoint}`, {}, field), /503.*AI generation unavailable/);
    });
}

for (const result of [null, {}, { text: '' }, { text: '[Error] unavailable' }, { text: ['wrong type'] }]) {
    test(`invalid generated text ${JSON.stringify(result)} is rejected`, async t => {
        const previous = globalThis.fetch;
        t.after(() => { globalThis.fetch = previous; });
        globalThis.fetch = async () => Response.json(result);
        await assert.rejects(requestAI('/api/humanize', { text: 'Keep my draft' }, 'text'), /draft was not changed/);
    });
}

test('valid generated output is available only after successful validation', async t => {
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; });
    let request;
    globalThis.fetch = async (url, options) => { request = [url, options]; return Response.json({ text: 'Clearer draft' }); };
    assert.deepEqual(await requestAI('/api/humanize', { text: 'Original' }, 'text'), { text: 'Clearer draft' });
    assert.equal(request[0], '/api/humanize');
    assert.deepEqual(JSON.parse(request[1].body), { text: 'Original' });
});

test('malformed rewritten bullets cannot replace the resume editor', async t => {
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; });
    globalThis.fetch = async () => Response.json({ bullets: ['valid', 42] });
    await assert.rejects(requestAI('/api/tailor-resume', {}, 'bullets'), /draft was not changed/);
});
