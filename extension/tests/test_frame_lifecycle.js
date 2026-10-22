const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ts = require('typescript');
const { registerBackground } = require('../src/background.ts');
const { autofillFailureMessage } = require('../src/core/site-access.ts');
const { requiresManualAnswer } = require('../src/shared/messages.ts');
// Exercise the existing regression scenarios against the TypeScript source.
const content = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'content.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
function functionsBetween(start, end) {
  return content.slice(content.indexOf(start), content.indexOf(end));
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('one click fills each frame once, even when background delivery is slow', async () => {
  let fills = 0;
  let callback;
  const button = { innerHTML: 'Autofill' };
  const context = vm.createContext({
    formFields: [{}, {}],
    document: {
      getElementById: () => button,
      querySelectorAll: () => [{ contentWindow: { postMessage: () => fills++ } }]
    },
    window: { self: 1, top: 1 },
    chrome: { runtime: { sendMessage: (_message, cb) => { callback = cb; } } },
    handleAutofill: async () => { fills++; },
    detectFields: () => [{}, {}],
    showNotification: () => {},
    setTimeout: () => {},
    console
  });
  vm.runInContext(functionsBetween('  function triggerAutofill()', '  function hasEmbeddedATS()'), context);
  vm.runInContext('triggerAutofill()', context);
  // The worker delivers after injection finishes, possibly seconds later.
  fills++;
  await callback({ success: true });
  await flush();
  assert.equal(fills, 1);
  assert.equal(button.innerHTML, 'Autofill');
});

test('a disconnected background falls back locally once and resets the control', async () => {
  let fills = 0;
  const button = { innerHTML: 'Autofill' };
  const context = vm.createContext({
    formFields: [{}, {}],
    document: { getElementById: () => button, querySelectorAll: () => [] },
    window: { self: 1, top: 1 },
    chrome: { runtime: { sendMessage: () => { throw new Error('Extension context invalidated'); } } },
    handleAutofill: async () => { fills++; },
    detectFields: () => [{}, {}],
    showNotification: () => {},
    setTimeout: () => {},
    console
  });
  vm.runInContext(functionsBetween('  function triggerAutofill()', '  function hasEmbeddedATS()'), context);
  await vm.runInContext('triggerAutofill()', context);
  await flush();
  assert.equal(fills, 1);
  assert.equal(button.innerHTML, 'Autofill');
});

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.isConnected = true;
    this.offsetHeight = 80;
    this.listeners = {};
    this.classList = { contains: name => this.className.split(' ').includes(name) };
  }
  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get previousElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) - 1] || null;
  }
  hasAttribute() { return false; }
  getAttribute() { return null; }
  closest() { return null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  insertAdjacentElement(_position, child) {
    const siblings = this.parentElement.children;
    child.parentElement = this.parentElement;
    siblings.splice(siblings.indexOf(this) + 1, 0, child);
  }
  remove() {
    const siblings = this.parentElement?.children || [];
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
    this.isConnected = false;
  }
}

test('rescans preserve adjacent essay buttons and replace only a removed SPA field', () => {
  const parent = new Element('form');
  const textareas = [new Element('textarea'), new Element('textarea')];
  textareas.forEach(ta => parent.appendChild(ta));
  const context = vm.createContext({
    aiButtons: new Map(),
    document: { querySelectorAll: () => textareas, createElement: tag => new Element(tag) },
    window: { getComputedStyle: () => ({}), location: { href: 'https://example.test/jobs' } },
    URL,
    requiresManualAnswer,
    getTextareaWrapper: () => null,
    getQuestionForTextarea: () => 'Describe your testing approach'
  });
  vm.runInContext(functionsBetween('  function injectAIButtons()', '  function showNotification('), context);
  vm.runInContext('injectAIButtons()', context);
  const buttons = parent.children.filter(el => el.tagName === 'BUTTON');
  assert.equal(buttons.length, 2);
  buttons[1].innerHTML = 'Writing...';
  buttons[1].disabled = true;
  for (let scan = 0; scan < 3; scan++) vm.runInContext('injectAIButtons()', context);
  assert.deepEqual(parent.children.filter(el => el.tagName === 'BUTTON'), buttons);
  assert.equal(buttons[1].innerHTML, 'Writing...');
  assert.equal(buttons[1].disabled, true);
  textareas[0].remove();
  textareas.splice(0, 1, new Element('textarea'));
  parent.appendChild(textareas[0]);
  vm.runInContext('injectAIButtons()', context);
  assert.equal(buttons[0].isConnected, false);
  assert.equal(buttons[1].isConnected, true);
  assert.equal(parent.children.filter(el => el.tagName === 'BUTTON').length, 2);
});

test('overlapping fill requests share one operation and later clicks can fill a new step', async () => {
  let fills = 0;
  let release;
  const context = vm.createContext({
    autofillPromise: null,
    performAutofill: () => { fills++; return new Promise(resolve => { release = resolve; }); }
  });
  vm.runInContext(functionsBetween('  function handleAutofill()', '  async function performAutofill()'), context);
  const first = vm.runInContext('handleAutofill()', context);
  const second = vm.runInContext('handleAutofill()', context);
  assert.equal(first, second);
  assert.equal(fills, 1);
  release({ filledCount: 2 });
  await first;
  const nextStep = vm.runInContext('handleAutofill()', context);
  assert.equal(fills, 2);
  release({ filledCount: 1 });
  await nextStep;
});

test('an unexpected fill failure releases the guard for the next attempt', async () => {
  let attempts = 0;
  const context = vm.createContext({
    autofillPromise: null,
    performAutofill: async () => { if (++attempts === 1) throw new Error('DOM changed'); return {}; }
  });
  vm.runInContext(functionsBetween('  function handleAutofill()', '  async function performAutofill()'), context);
  await assert.rejects(vm.runInContext('handleAutofill()', context), /DOM changed/);
  await vm.runInContext('handleAutofill()', context);
  assert.equal(attempts, 2);
});

function workerHarness({ delayedInjection = false, failFrame = null } = {}) {
  const deliveries = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const frames = [{ frameId: 0, url: 'https://example.test/jobs' },
    { frameId: 7, url: 'https://job-boards.greenhouse.io/embed/job_app' }];
  let onMessage;
  const context = vm.createContext({
    console,
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(listener) { onMessage = listener; } }
      },
      scripting: {
        executeScript: async () => { if (delayedInjection) await gate; },
        insertCSS: async () => {}
      },
      webNavigation: { getAllFrames: async () => frames, onCompleted: { addListener() {} } },
      tabs: {
        onUpdated: { addListener() {} },
        sendMessage: async (_tab, _message, target) => {
          deliveries.push(target.frameId);
          if (target.frameId === failFrame) throw new Error('Receiving end does not exist');
          return { success: target.frameId === 7, reason: target.frameId === 0 ? 'no_fields' : undefined };
        }
      },
      commands: { onCommand: { addListener() {} } }
    }
  });
  registerBackground(context.chrome);
  return { deliveries, release, onMessage };
}

test('broadcast waits for late frame injection and delivery before acknowledging', async () => {
  const worker = workerHarness({ delayedInjection: true });
  let response;
  worker.onMessage({ action: 'broadcastAutofill' }, { tab: { id: 11 } }, value => { response = value; });
  await flush();
  assert.equal(response, undefined);
  assert.deepEqual(worker.deliveries, []);
  worker.release();
  await flush();
  assert.deepEqual(worker.deliveries, [0, 7]);
  assert.equal(response.success, true);
});

test('an unavailable frame does not prevent delivery to the application frame', async () => {
  const worker = workerHarness({ failFrame: 0 });
  const response = await new Promise(resolve => {
    worker.onMessage({ action: 'broadcastAutofill' }, { tab: { id: 11 } }, resolve);
  });
  await flush();
  assert.deepEqual(worker.deliveries, [0, 7]);
  assert.equal(response.success, true);
});

test('rescans request reinjection only for a new iframe or changed source', () => {
  let requests = 0;
  const frame = { src: 'https://job-boards.greenhouse.io/one' };
  const context = vm.createContext({
    captureResumeTarget: () => ({state:'none'}), ensuredFrames: new WeakMap(), formFields: [],
    document: { querySelectorAll: () => [frame], getElementById: () => ({}) },
    window: { self: 1, top: 1 },
    chrome: { runtime: { sendMessage: () => { requests++; } } },
    hasEmbeddedATS: () => false, injectAIButtons() {},
  });
  vm.runInContext(functionsBetween('  function injectButton()', '  function injectAIButtons()'), context);
  for (let scan = 0; scan < 3; scan++) vm.runInContext('injectButton()', context);
  assert.equal(requests, 1);
  frame.src = 'https://jobs.lever.co/two';
  vm.runInContext('injectButton()', context);
  assert.equal(requests, 2);
});

test('page-synthesized clicks cannot trigger autofill or AI generation', async () => {
  let fills = 0;
  const parent = new Element('form');
  const textarea = new Element('textarea');
  parent.appendChild(textarea);
  const context = vm.createContext({
    aiButtons: new Map(), ensuredFrames: new WeakMap(), formFields: [{}, {}],
    document: {
      querySelectorAll: selector => selector === 'iframe' ? [] : [textarea],
      getElementById: () => null,
      createElement: tag => new Element(tag), body: parent,
    },
    window: { self: 1, top: 1, location: { href: 'https://example.test/apply' }, getComputedStyle: () => ({}) },
    URL, hasEmbeddedATS: () => false, triggerAutofill: () => { fills++; },
    requiresManualAnswer,
    getTextareaWrapper: () => null, getQuestionForTextarea: () => 'Describe your testing approach',
    fetchAPI: () => { throw new Error('Page click reached the API'); },
  });
  vm.runInContext(functionsBetween('  function injectButton()', '  function showNotification('), context);
  vm.runInContext('injectButton()', context);
  const floating = parent.children.find(element => element.id === 'jc-autofill-btn');
  const generate = parent.children.find(element => element.className.includes('jc-ai-btn'));
  const event = { isTrusted: false, preventDefault() {}, stopPropagation() {} };
  floating.listeners.click(event);
  await generate.listeners.click(event);
  assert.equal(fills, 0);
  floating.listeners.click({ ...event, isTrusted: true });
  assert.equal(fills, 1);
});


test('eligibility questions do not get an AI button even when they mention a summary', () => {
  const parent = new Element('form');
  const textarea = new Element('textarea');
  parent.appendChild(textarea);
  const context = vm.createContext({
    aiButtons: new Map(),
    document: { querySelectorAll: () => [textarea], createElement: tag => new Element(tag) },
    window: { getComputedStyle: () => ({}), location: { href: 'https://example.test/jobs' } },
    URL, requiresManualAnswer, getTextareaWrapper: () => null,
    getQuestionForTextarea: () => 'About you: summarize your visa sponsorship requirements',
  });
  vm.runInContext(functionsBetween('  function injectAIButtons()', '  function showNotification('), context);
  vm.runInContext('injectAIButtons()', context);
  assert.equal(parent.children.filter(element => element.tagName === 'BUTTON').length, 0);
});

test('a blocked ATS frame shows recovery instructions instead of filling unrelated parent fields', async () => {
  let callback;
  let localFills=0;
  let message;
  const context=vm.createContext({
    document:{getElementById:()=>({innerHTML:''})},
    chrome:{runtime:{sendMessage:(_request,fn)=>{callback=fn;}}},
    detectFields:()=>[{},{}], handleAutofill:async()=>{localFills++;},
    showNotification:text=>{message=text;}, autofillFailureMessage,
  });
  vm.runInContext(functionsBetween('  function triggerAutofill()', '  function hasEmbeddedATS()'), context);
  vm.runInContext('triggerAutofill()',context);
  await callback({success:false,frameIssues:[{frameId:7,origin:'https://job-boards.greenhouse.io',stage:'script',code:'site_access_required'}]});
  assert.equal(localFills,0);
  assert.match(message,/Autofill This Page/);
});
