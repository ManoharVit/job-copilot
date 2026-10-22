const assert = require('node:assert/strict');
const test = require('node:test');
const { setNativeValue } = require('../src/core/dom.ts');

class Input {
  constructor() {
    this.tagName = 'INPUT';
    this.type = 'text';
    this.inputMode = '';
    this.placeholder = '';
    this.id = '';
    this.maxLength = -1;
    this.events = [];
    this._value = '';
    this.classList = { contains: () => false };
  }
  get value() { return this._value; }
  set value(value) { this._value = value; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  dispatchEvent(event) { this.events.push(event.type); }
}
class Textarea extends Input {
  constructor() { super(); this.tagName = 'TEXTAREA'; }
}

global.window = { HTMLInputElement: Input, HTMLTextAreaElement: Textarea };
global.document = { querySelector: () => null };

function withoutDropdownTimer(t) {
  const original = global.setTimeout;
  global.setTimeout = () => 0;
  t.after(() => { global.setTimeout = original; });
}

test('native setter updates React tracking and dispatches form events', t => {
  withoutDropdownTimer(t);
  const input = new Input();
  input.value = 'Old value';
  let tracked;
  input._valueTracker = { setValue: value => { tracked = value; } };
  setNativeValue(input, 'New value');
  assert.equal(tracked, 'Old value');
  assert.equal(input.value, 'New value');
  assert.deepEqual(input.events, ['input', 'change', 'blur']);
});

test('numeric compensation accepts the numeric value while text retains its units', t => {
  withoutDropdownTimer(t);
  const numeric = new Input();
  numeric.type = 'number';
  const text = new Input();
  setNativeValue(numeric, '11.5 LPA');
  setNativeValue(text, '11.5 LPA');
  assert.equal(numeric.value, '11.5');
  assert.equal(text.value, '11.5 LPA');
});

test('generated textarea answers respect the field limit and word boundaries', t => {
  withoutDropdownTimer(t);
  const textarea = new Textarea();
  textarea.maxLength = 24;
  setNativeValue(textarea, 'I build reliable APIs and data pipelines.');
  assert.equal(textarea.value, 'I build reliable APIs');
  assert(textarea.value.length <= textarea.maxLength);
});

test('numeric keyboard hints do not truncate international telephone numbers', t => {
  withoutDropdownTimer(t);
  const phone = new Input();
  phone.type = 'tel';
  phone.inputMode = 'numeric';
  setNativeValue(phone, '+44 1234 567890');
  assert.equal(phone.value, '+44 1234 567890');
});
test('overlong scalar identifiers are left empty instead of silently truncated', t => {
  withoutDropdownTimer(t);
  const email = new Input();
  email.type = 'email';
  email.maxLength = 8;
  setNativeValue(email, 'candidate@example.test');
  assert.equal(email.value, '');
});
test('unrelated dropdown options are not clicked by an ordinary text setter', t => {
  let timers = 0;
  const original = global.setTimeout;
  global.setTimeout = () => { timers++; return 0; };
  t.after(() => { global.setTimeout = original; });
  setNativeValue(new Input(), 'Candidate');
  assert.equal(timers, 0);
});
