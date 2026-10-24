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

const { getFieldContext } = require('../src/core/fields.ts');
const { getFieldOptions } = require('../src/adapters/index.ts');
const { radioMembers } = require('../src/core/radio.ts');
function noticeForm() {
  return form(`<form><div class="question"><h3>4. What is your official notice period (as per your offer letter)</h3>
    <div class="choices"><label><input type="radio" name="notice" value="0">Available immediately</label>
    <label><input type="radio" name="notice" value="1">15 days</label>
    <label><input type="radio" name="notice" value="2">30 days</label></div></div>
    <div class="question"><h3>5. Current location</h3><textarea></textarea></div></form>`);
}
function activateRadio(field) {
  field.checked = false;
  field.click = () => { for (const other of radioMembers(field)) other.checked = other === field; };
}
test('radio questions and options stay isolated from neighboring fields', () => {
  const doc = noticeForm();
  for (const field of doc.querySelectorAll('input')) {
    assert.equal(getFieldContext(field), '4. What is your official notice period (as per your offer letter)');
    assert.deepEqual(getFieldOptions(new URL(doc.URL), field), ['Available immediately', '15 days', '30 days']);
  }
});
test('radio label selects the right opaque value and is repeat-safe', () => {
  const doc = noticeForm();
  const radios = [...doc.querySelectorAll('input')];
  radios.forEach(activateRadio);
  assert.equal(applyMapping({ 0: '15 days' }, targets(radios[0])).filledCount, 1);
  assert.deepEqual(radios.map(field => field.checked), [false, true, false]);
  assert.equal(applyMapping({ 0: '15 days' }, targets(radios[0])).alreadyCorrectCount, 1);
});
test('a changed selection, label, member or disabled choice invalidates pending group mappings', () => {
  for (const mutate of [
    radios => { radios[2].checked = true; },
    radios => { radios[1].parentElement.append(' changed'); },
    radios => { radios[1].replaceWith(radios[1].cloneNode()); },
    radios => { radios[1].disabled = true; },
  ]) {
    const doc = noticeForm();
    const radios = [...doc.querySelectorAll('input')];
    radios.forEach(activateRadio);
    const captured = targets(radios[0]);
    mutate(radios);
    assert.equal(applyMapping({ 0: '15 days' }, captured).skippedCount, 1);
    assert.equal(radios[1].checked, false);
  }
});
test('an existing answer in another group does not prevent filling notice', () => {
  const doc = noticeForm();
  doc.body.insertAdjacentHTML('beforeend', '<fieldset><legend>Other question</legend><label><input type="radio" name="other" value="yes">Yes</label></fieldset>');
  const radios = [...doc.querySelectorAll('input')];
  radios.forEach(activateRadio);
  radios.at(-1).checked = true;
  assert.equal(applyMapping({ 0: '15 days' }, targets(radios[0])).filledCount, 1);
  assert.equal(radios.at(-1).checked, true);
});
test('duplicate labels and broad containers do not produce guessed selections', () => {
  const doc = form('<div><h3>First question</h3><input type="radio" name="a" value="0" aria-label="Yes"><input type="radio" name="a" value="1" aria-label="Yes"><textarea aria-label="Unrelated question"></textarea></div>');
  const radios = [...doc.querySelectorAll('input')];
  radios.forEach(activateRadio);
  assert.equal(getFieldContext(radios[0]), '');
  assert.equal(applyMapping({ 0: 'Yes' }, targets(radios[0])).skippedCount, 1);
});
test('legends and ARIA groups keep unnamed inputs in their explicit local group', () => {
  const doc = form('<fieldset><legend>Notice period</legend><label><input type="radio" value="a">15 days</label><label><input type="radio" value="b">30 days</label></fieldset><fieldset role="radiogroup" aria-label="Overall years of experience"><label><input type="radio" value="a">1-2 years</label></fieldset>');
  const radios = [...doc.querySelectorAll('input')];
  assert.equal(getFieldContext(radios[0]), 'Notice period');
  assert.equal(getFieldContext(radios[2]), 'Overall years of experience');
  assert.equal(radioMembers(radios[0]).length, 2);
  assert.equal(radioMembers(radios[2]).length, 1);
});
