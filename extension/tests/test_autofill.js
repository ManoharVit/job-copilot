const assert = require('node:assert/strict');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { captureTarget, applyMapping, canEdit } = require('../src/core/autofill.ts');
function form(html) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  Object.defineProperty(document, 'URL', { value: 'https://example.test/apply', writable: true });
  global.document = document;
  global.window = window;
  global.Event = window.Event;
  return document;
}
function targets(field) { return new Map([[0, captureTarget(field)]]); }
test('late response never writes into a replacement with the same index', () => {
  const doc = form('<textarea name="email" data-jc-index="0" aria-label="Email"></textarea>');
  const original = doc.querySelector('textarea');
  const captured = targets(original);
  original.remove();
  const replacement = doc.createElement('textarea');
  replacement.setAttribute('data-jc-index', '0');
  doc.body.appendChild(replacement);
  assert.equal(applyMapping({ 0: 'candidate@example.test' }, captured).skippedCount, 1);
  assert.equal(replacement.value, '');
});
test('rescan index reassignment cannot redirect a captured mapping', () => {
  const doc = form('<textarea data-jc-index="0" aria-label="Email"></textarea><textarea data-jc-index="1" aria-label="Name"></textarea>');
  const [email, name] = [...doc.querySelectorAll('textarea')];
  const captured = targets(email);
  email.setAttribute('data-jc-index', '1');
  name.setAttribute('data-jc-index', '0');
  applyMapping({ 0: 'candidate@example.test' }, captured);
  assert.equal(email.value, 'candidate@example.test');
  assert.equal(name.value, '');
});
test('user edits, relabeled fields and URL changes invalidate pending mappings', () => {
  for (const mutate of [field => { field.value = 'User draft'; },
    field => field.setAttribute('aria-label', 'Different question'),
    field => { field.ownerDocument.URL = 'https://example.test/next'; }]) {
    const doc = form('<textarea aria-label="Name"></textarea>');
    const field = doc.querySelector('textarea');
    const captured = targets(field);
    mutate(field);
    const before = field.value;
    assert.equal(applyMapping({ 0: 'Candidate' }, captured).skippedCount, 1);
    assert.equal(field.value, before);
  }
});
test('checkbox activation clicks once without pre-setting checked', () => {
  const doc = form('<input type="checkbox" aria-label="Does not expire">');
  const checkbox = doc.querySelector('input');
  checkbox.checked = false;
  let clicks = 0;
  checkbox.click = () => { clicks++; checkbox.checked = !checkbox.checked; };
  const result = applyMapping({ 0: 'Yes' }, targets(checkbox));
  assert.equal(clicks, 1);
  assert.equal(checkbox.checked, true);
  assert.equal(result.filledCount, 1);
});
test('hidden and password inputs are never eligible on either fill pass', () => {
  const doc = form('<input type="hidden"><input type="password"><div hidden><input type="text"></div>');
  for (const field of doc.querySelectorAll('input')) assert.equal(canEdit(field), false);
});

test('radio mapping preserves an existing selection in the same group', () => {
  const doc = form('<input type="radio" name="choice" value="yes"><input type="radio" name="choice" value="no">');
  const [yes, no] = [...doc.querySelectorAll('input')];
  yes.checked = false;
  no.checked = true;
  yes.click = () => { throw new Error('Must preserve the existing choice'); };
  assert.equal(applyMapping({ 0: 'Yes' }, targets(yes)).skippedCount, 1);
  assert.equal(no.checked, true);
});
