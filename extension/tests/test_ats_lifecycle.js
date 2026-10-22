const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { startContentScript } = require('../src/content.ts');

const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(t, name, address) {
  const parsed = parseHTML(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
  const document = parsed.document;
  const url = new URL(address);
  Object.defineProperty(document, 'URL', { value: url.href, writable: true });
  Object.defineProperty(document, 'baseURI', { value: url.href });
  Object.defineProperty(document, 'readyState', { value: 'complete' });
  // LinkeDOM has no layout or writable innerText; provide those browser contracts.
  const descriptor = Object.getOwnPropertyDescriptor(parsed.window.HTMLElement.prototype, 'innerText');
  Object.defineProperty(parsed.window.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }, set(text) { this.textContent = text; },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(parsed.window.HTMLElement.prototype, 'innerText', descriptor);
    else delete parsed.window.HTMLElement.prototype.innerText;
  });
  function layout() {
    for (const element of document.querySelectorAll('input, textarea')) {
      if (element.tagName === 'INPUT' && !element.type) element.type = 'text';
      Object.defineProperty(element, 'offsetHeight', { value: 80, configurable: true });
      Object.defineProperty(element, 'offsetWidth', { value: 200, configurable: true });
      Object.defineProperty(element, 'offsetParent', { value: document.body, configurable: true });
    }
  }
  layout();
  const window = {
    location: url, addEventListener() {},
    HTMLInputElement: parsed.window.HTMLInputElement,
    HTMLTextAreaElement: parsed.window.HTMLTextAreaElement,
    HTMLSelectElement: parsed.window.HTMLSelectElement,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static' }),
  };
  window.self = window;
  window.top = window;
  let listener;
  let observer;
  let held;
  let hold = false;
  let matchFailure;
  let savedResume = {configured:false};
  let resumeFailure;
  const requests = [];
  const calls = [];
  const logs = [];
  const originals = new Map();
  const globals = {
    document, window, Event: parsed.window.Event, Node: parsed.window.Node,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe(_root, options) { this.options = options; }
    },
    setTimeout(callback, delay) {
      // Advance detection and dependent-field waits; ignore hydration/toast timers.
      if (delay === 400) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    DataTransfer: class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } },
    chrome: { runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      sendMessage(message, callback) {
        assert.equal(message.action, 'fetchAPI');
        calls.push(message.url);
        const body = JSON.parse(message.options.body || '{}');
        if (message.url.endsWith('/api/resume/file')) {
          callback(resumeFailure ? {success:false,error:resumeFailure} : {success:true,data:savedResume});
        } else if (message.url.endsWith('/api/match-fields')) {
          requests.push(body);
          if (matchFailure) { callback({success:false,error:matchFailure}); return; }
          const response = {
            success: true,
            data: Object.fromEntries(body.filter(field => /name|university/i.test(field.label)).map(field =>
              [field.index, /university/i.test(field.label) ? `${field.degree_preference} university` : 'Example Candidate'])),
          };
          if (hold) held = () => callback(response); else callback(response);
        } else if (message.url.endsWith('/api/log-application')) {
          logs.push(body); callback({ success: true, data: { status: 'success' } });
        } else {
          throw new Error(`Unexpected API request: ${message.url}`);
        }
      },
    } },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  startContentScript();
  return {
    document, requests, calls, logs, layout,
    observer: () => observer,
    rescan: async () => { layout(); observer.callback([]); await flush(); },
    fill: () => new Promise(resolve => listener({ action: 'autofill' }, {}, resolve)),
    failMatches: error => { matchFailure = error; },
    resume: data => { savedResume = data; },
    failResume: error => { resumeFailure = error; },
    hold: () => { hold = true; },
    release: () => { hold = false; assert(held, 'No pending API response'); held(); },
  };
}

for (const [name, address, provider, employer] of [
  ['workday.html', 'https://tenant.wd5.myworkdayjobs.com/Careers/job/123', 'Workday', 'Example Systems'],
  ['ashby.html', 'https://jobs.ashbyhq.com/example/123/application', 'Ashby', 'Example Analytics'],
]) {
  test(`${provider} controller sends per-entry degrees and associated custom options`, async t => {
    const page = harness(t, name, address);
    await flush();
    let navigation = 0;
    for (const button of page.document.querySelectorAll('button:not(.jc-btn)')) button.addEventListener('click', () => { navigation++; });
    const result = await page.fill();
    assert.equal(result.success, true);
    const fields = page.requests[0];
    assert.equal(fields.find(field => field.name === 'school0').degree_preference, 'bachelor');
    assert.equal(fields.find(field => field.name === 'school1').degree_preference, 'master');
    assert.deepEqual(fields.find(field => field.name === 'country').options, ['Canada', 'India']);
    assert.equal(page.document.querySelector('input[name="school0"]').value, 'bachelor university');
    assert.equal(page.document.querySelector('input[name="school1"]').value, 'master university');
    assert.equal(navigation, 0);
    assert.equal(page.logs[0].platform, provider);
    assert.equal(page.logs[0].company, employer);
    assert(!page.logs[0].job_description.includes('PRIVATE_'));
  });
  test(`${provider} rescans a replaced step and keeps one Generate button per eligible essay`, async t => {
    const page = harness(t, name, address);
    await flush();
    assert.equal(page.document.querySelectorAll('.jc-ai-btn').length, 2);
    assert.equal(page.observer().options.characterData, true);
    const container = page.document.querySelector('form[data-automation-id="applyFlowPage"], form.ashby-application-form-container');
    const old = page.document.querySelector('textarea[name="technical"]');
    container.innerHTML = provider === 'Workday'
      ? '<div data-automation-id="formField-next"><span data-automation-id="formLabel">Describe a different engineering tradeoff.</span><textarea name="next"></textarea></div>'
      : '<div class="ashby-application-form-field-entry"><span class="ashby-application-form-question-title">Describe a different engineering tradeoff.</span><textarea name="next"></textarea></div>';
    assert.equal(old.isConnected, false);
    await page.rescan();
    await page.rescan();
    assert.equal(page.document.querySelectorAll('.jc-ai-btn').length, 1);
    assert(page.document.querySelector('textarea[name="next"]'));
  });
  test(`${provider} ignores a stale match when a wizard reuses a field with a new question`, async t => {
    const page = harness(t, name, address);
    await flush();
    page.hold();
    const filling = page.fill();
    await flush();
    const field = page.document.querySelector('input[name="school0"]');
    const label = field.closest('[data-automation-id^="formField-"], .ashby-application-form-field-entry').querySelector('span');
    label.firstChild.data = 'Different question on the next step';
    page.release();
    const result = await filling;
    assert.equal(field.value, '');
    assert(result.skippedCount > 0);
  });
  test(`${provider} backend failures stay failures without filling fields or logging an application`, async t => {
    const page = harness(t, name, address);
    await flush();
    page.failMatches('Local backend access is not allowed. Click Connect local backend.');
    const result = await page.fill();
    assert.equal(result.success, false);
    assert.match(result.error, /Connect local backend/);
    assert.equal(page.document.querySelector('input[name="school0"]').value, '');
    assert.equal(page.logs.length, 0);
    assert.equal(page.document.getElementById('jc-autofill-btn').innerHTML, 'Autofill');
  });
  test(`${provider} Autofill attaches the saved resume once and preserves cover-letter inputs`, async t => {
    const page = harness(t, name, address);
    await flush();
    const form = page.document.querySelector('form[data-automation-id="applyFlowPage"], form.ashby-application-form-container');
    const upload = page.document.createElement('div');
    upload.innerHTML = '<label for="resume-upload">Resume/CV</label><input type="file" id="resume-upload" name="resume" accept=".pdf"><label for="cover-upload">Cover Letter</label><input type="file" id="cover-upload" name="cover_letter">';
    form.appendChild(upload);
    const binary = '%PDF-1.7 Synthetic test resume';
    page.resume({configured:true,filename:'resume.pdf',mime_type:'application/pdf',size:binary.length,sha256:'a'.repeat(64),content_base64:btoa(binary)});
    let submissions = 0;
    form.addEventListener('submit', () => { submissions++; });
    await page.rescan();
    const first = await page.fill();
    assert.equal(first.resumeAttachedCount, 1);
    assert.equal(page.document.getElementById('resume-upload').files[0].name, 'resume.pdf');
    assert(!page.document.getElementById('cover-upload').files?.length);
    assert(!page.requests[0].some(field => field.type === 'file'));
    const second = await page.fill();
    assert.equal(second.resumeAttachedCount, 0);
    assert.equal(page.calls.filter(url => url.endsWith('/api/resume/file')).length, 1);
    assert.equal(submissions, 0);
  });
  test(`${provider} a resume-only step can be filled without calling the text matcher`, async t => {
    const page = harness(t, name, address);
    await flush();
    page.document.querySelector('form[data-automation-id="applyFlowPage"], form.ashby-application-form-container').innerHTML = '<label for="resume-only">Resume/CV</label><input type="file" id="resume-only" name="resume">';
    const binary = '%PDF-1.7 Test';
    page.resume({configured:true,filename:'resume.pdf',mime_type:'application/pdf',size:binary.length,sha256:'a'.repeat(64),content_base64:btoa(binary)});
    await page.rescan();
    assert(page.document.getElementById('jc-autofill-btn'));
    const result = await page.fill();
    assert.equal(result.resumeAttachedCount, 1);
    assert.equal(page.requests.length, 0);
  });
  test(`${provider} resume download failure stays visible while successful text filling is preserved`, async t => {
    const page = harness(t, name, address);
    await flush();
    const input = page.document.createElement('input');
    input.type = 'file'; input.name = 'resume';
    page.document.querySelector('form[data-automation-id="applyFlowPage"], form.ashby-application-form-container').appendChild(input);
    page.failResume('Synthetic resume download failed');
    await page.rescan();
    const result = await page.fill();
    assert(result.filledCount > 0);
    assert.equal(result.resumeAttachedCount, 0);
    assert.equal(result.resumeFailedCount, 1);
    assert.match(result.resumeMessage, /Synthetic resume download failed/);
  });
  test(`${provider} does not invoke the legacy skills-modal click sequence`, async t => {
    const page = harness(t, name, address);
    await flush();
    const modal = page.document.createElement('div');
    modal.innerHTML = '<h2>Add Skills</h2><input type="text" name="skills" aria-label="Skills">';
    Object.defineProperty(modal, 'offsetHeight', { value: 300 });
    Object.defineProperty(modal, 'offsetWidth', { value: 600 });
    Object.defineProperty(modal.querySelector('h2'), 'offsetHeight', { value: 40 });
    page.document.body.appendChild(modal);
    await page.rescan();
    await page.fill();
    assert(!page.calls.some(address => address.endsWith('/api/profile')));
  });

}
