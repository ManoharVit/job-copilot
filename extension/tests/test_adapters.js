const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const {
  resolveAdapter, hasEmbeddedATS, detectPlatform, detectCompany,
  detectJobDescription, detectDegreePreference, getTextareaWrapper,
} = require('../src/adapters/index.ts');
const { getQuestionForTextarea } = require('../src/core/fields.ts');

function page(html, address = 'https://example.test/about') {
  const url = new URL(address);
  const markup = /<html[\s>]/i.test(html) ? html
    : `<!doctype html><html>${/<body[\s>]/i.test(html) ? html : `<head></head><body>${html}</body>`}</html>`;
  const { document } = parseHTML(markup);
  // LinkeDOM has no navigation; supply the fixture's document URL and base URI.
  Object.defineProperty(document, 'URL', { value: url.href });
  Object.defineProperty(document, 'baseURI', { value: url.href });
  return { url, document };
}
function fixture(name, address) {
  return page(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), address);
}

for (const hostname of ['job-boards.greenhouse.io', 'boards.greenhouse.io', 'boards.eu.greenhouse.io']) {
  test(`recognizes the Greenhouse document at ${hostname}`, () => {
    const { url, document } = page('', `https://${hostname}/example/jobs/123`);
    assert.equal(resolveAdapter(url, document).name, 'Greenhouse');
    assert.equal(detectPlatform(url, document), 'Greenhouse');
  });
}

test('recognizes Lever job pages', () => {
  const { url, document } = page('', 'https://jobs.lever.co/acme/123/apply');
  assert.equal(resolveAdapter(url, document).name, 'Lever');
});

for (const address of [
  'https://greenhouse.io.evil.test/jobs',
  'https://notgreenhouse.io/jobs',
  'https://lever.co.evil.test/jobs',
  'https://notlever.co/jobs',
]) {
  test(`does not classify the lookalike hostname ${new URL(address).hostname} as a provider`, () => {
    const { url, document } = page('', address);
    assert.equal(resolveAdapter(url, document).name, 'Other');
    assert.equal(detectPlatform(url, document), 'Other');
  });
}

test('recognizes a Greenhouse placeholder before its iframe loads', () => {
  const { url, document } = page('<div id="grnhse_app"></div>');
  assert.equal(resolveAdapter(url, document).name, 'Greenhouse');
  assert.equal(hasEmbeddedATS(url, document), true);
});

test('re-resolves a late Greenhouse iframe and returns to generic after removal', () => {
  const { url, document } = page('');
  assert.equal(resolveAdapter(url, document).name, 'Other');
  const frame = document.createElement('iframe');
  frame.src = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123';
  document.body.appendChild(frame);
  assert.equal(resolveAdapter(url, document).name, 'Greenhouse');
  assert.equal(hasEmbeddedATS(url, document), true);
  frame.remove();
  assert.equal(resolveAdapter(url, document).name, 'Other');
});

test('retains gh_jid plus iframe detection', () => {
  const { url, document } = page('<iframe src="about:blank"></iframe>', 'https://example.test/about?gh_jid=123');
  assert.equal(resolveAdapter(url, document).name, 'Greenhouse');
});

test('recognizes protocol-relative Lever embeds', () => {
  const { url, document } = page('<iframe src="//jobs.lever.co/acme/123"></iframe>');
  assert.equal(resolveAdapter(url, document).name, 'Lever');
  assert.equal(hasEmbeddedATS(url, document), true);
});

test('a direct provider document takes precedence over a foreign embedded widget', () => {
  const { url, document } = page('<iframe src="https://boards.greenhouse.io/other"></iframe>', 'https://jobs.lever.co/acme/123');
  assert.equal(resolveAdapter(url, document).name, 'Lever');
});

test('malformed and lookalike iframe URLs do not select a provider', () => {
  const { url, document } = page('<iframe src="http://["></iframe><iframe src="https://lever.co.evil.test/a"></iframe><iframe src="javascript://boards.greenhouse.io/a"></iframe>');
  assert.equal(resolveAdapter(url, document).name, 'Other');
  assert.equal(hasEmbeddedATS(url, document), false);
});

test('Greenhouse extracts employer name and description without application answers', () => {
  const { url, document } = fixture('greenhouse.html', 'https://job-boards.greenhouse.io/acme/jobs/123');
  assert.equal(detectCompany(url, document), 'Acme Test');
  const description = detectJobDescription(url, document);
  assert(description.includes('Build reliable APIs'));
  assert(!description.includes('Describe your approach'));
  assert(!description.includes('Submit application'));
});

test('Lever skips a short posting section and reads company metadata', () => {
  const { url, document } = fixture('lever.html', 'https://jobs.lever.co/acme/123');
  assert.equal(detectCompany(url, document), 'Acme Test');
  const description = detectJobDescription(url, document);
  assert(description.includes('Design maintainable backend services'));
  assert(!description.includes('Describe a difficult bug'));
});

for (const [name, address] of [
  ['greenhouse.html', 'https://job-boards.greenhouse.io/acme/jobs/123'],
  ['lever.html', 'https://jobs.lever.co/acme/123'],
]) {
  test(`${name} keeps each textarea wrapper and question separate`, () => {
    const { url, document } = fixture(name, address);
    const textareas = [...document.querySelectorAll('textarea')];
    const wrappers = textareas.map(textarea => getTextareaWrapper(url, textarea));
    assert(wrappers.every(Boolean));
    assert.notEqual(wrappers[0], wrappers[1]);
    const original = global.document;
    global.document = document;
    try {
      assert(getQuestionForTextarea(textareas[0]).startsWith('Describe'));
      assert(getQuestionForTextarea(textareas[1]).startsWith('How do you'));
      assert(!getQuestionForTextarea(textareas[0]).includes('remote team'));
    } finally {
      global.document = original;
    }
  });
}

test('provider misses fall back to generic descriptions and preserve the 2000-character limit', () => {
  const { url, document } = page(`<article>${'A reliable software engineering role. '.repeat(100)}</article>`, 'https://jobs.lever.co/acme/123');
  assert.equal(detectJobDescription(url, document).length, 2000);
});

test('description selectors skip application forms and their field labels', () => {
  const question = 'Describe your previous role and the responsibilities you held. '.repeat(4);
  const description = 'Build and maintain reliable software with the product engineering team. '.repeat(4);
  const { url, document } = page(
    `<form class="posting-description"><div class="job-description"><label>${question}</label><textarea></textarea></div></form><article>${description}</article>`,
    'https://jobs.lever.co/acme/123',
  );
  assert.equal(detectJobDescription(url, document), description.trim());
});

test('generic company metadata and textarea wrappers remain available', () => {
  const { url, document } = page('<head><title>Engineer</title><meta property="og:site_name" content="Example Employer"></head><body><div class="input-wrapper"><textarea></textarea></div></body>');
  assert.equal(detectCompany(url, document), 'Example Employer');
  assert.equal(getTextareaWrapper(url, document.querySelector('textarea')).className, 'input-wrapper');
});

test('dedicated Workday adapter keeps platform classification and embedded detection', () => {
  const { url, document } = page('<iframe src="https://tenant.myworkdayjobs.com/job"></iframe>', 'https://tenant.myworkdayjobs.com/job');
  assert.equal(resolveAdapter(url, document).name, 'Workday');
  assert.equal(detectPlatform(url, document), 'Workday');
  assert.equal(hasEmbeddedATS(url, document), true);
});

test('generic degree preference still honors undergraduate modal context', () => {
  const { url, document } = page('<div role="dialog">Undergraduate education</div><p>Master of Science</p>');
  assert.equal(detectDegreePreference(url, document), 'bachelor');
});


test('generic body fallback excludes private form data and extension UI', () => {
  const { url, document } = page('<p>Engineering team</p><form><textarea>PRIVATE_ANSWER</textarea><label>PRIVATE_QUESTION</label></form><div contenteditable="true">PRIVATE_DRAFT</div><div class="jc-toast">PRIVATE_TOAST</div>');
  assert.equal(detectJobDescription(url, document), 'Engineering team');
});

test('description extraction excludes ARIA forms and hidden text', () => {
  const description = 'Build reliable APIs with the engineering team. '.repeat(5).trim();
  const { url, document } = page(`<article>${description}<div role="form">PRIVATE_ANSWER</div><div hidden>PRIVATE_HIDDEN</div><label>PRIVATE_LABEL</label></article>`);
  assert.equal(detectJobDescription(url, document), description);
});
