import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../backend/static/legacy.html', import.meta.url), 'utf8');
for (const [name, next, args, property] of [
    ['updateStatus', 'updateNotes', [1, 'interview'], 'status'],
    ['updateNotes', 'deleteApplication', [1, 'new notes'], 'notes'],
]) {
    test(`served legacy dashboard preserves persisted data when ${name} fails`, async () => {
        const original = { id: 1, status: 'applied', notes: 'saved notes' };
        let notifications = 0;
        const context = vm.createContext({
            allApplications: [original], API_BASE: '',
            fetch: async () => ({ ok: false, status: 409 }),
            showToast: () => { notifications++; }, renderTable() {}, console: { error() {} },
        });
        const start = html.indexOf(`        async function ${name}(`);
        const end = html.indexOf(`        async function ${next}(`, start);
        assert(start > 0 && end > start);
        vm.runInContext(html.slice(start, end), context);
        await context[name](...args);
        assert.equal(original[property], property === 'status' ? 'applied' : 'saved notes');
        assert.equal(notifications, 1);
    });
}
