const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const {
  resolveAdapter, hasEmbeddedATS, detectPlatform, detectCompany, detectJobDescription,
  getTextareaWrapper, getFieldDegreePreference, getFieldOptions,
} = require('../src/adapters/index.ts');
const { getFieldContext, getQuestionForTextarea } = require('../src/core/fields.ts');
const { captureTarget, targetUnchanged } = require('../src/core/autofill.ts');
const { degreeFromText } = require('../src/adapters/form-fields.ts');

function page(html = '', address = 'https://example.test/about') {
  const markup = /<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(markup);
  const url = new URL(address);
  Object.defineProperty(document, 'URL', { value: url.href, writable: true });
  Object.defineProperty(document, 'baseURI', { value: url.href });
  return { document, url };
}
function fixture(name, address) {
  return page(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), address);
}

for (const [address, expected] of [
  ['https://tenant.wd5.myworkdayjobs.com/en-US/Careers/job/123', 'Workday'],
  ['https://TENANT.WD1.MYWORKDAYJOBS.COM./job/123', 'Workday'],
  ['https://wd3.myworkdaysite.com/recruiting/tenant/careers/job/123', 'Workday'],
  ['https://wd1.myworkdaysite.com/en-US/recruiting/tenant/careers/job/123', 'Workday'],
  ['https://jobs.ashbyhq.com/example/123/application', 'Ashby'],
]) {
  test(`selects ${expected} on ${new URL(address).hostname}`, () => {
    const { url, document } = page('', address);
    assert.equal(resolveAdapter(url, document).name, expected);
    assert.equal(detectPlatform(url, document), expected);
  });
}
for (const address of [
  'https://myworkdayjobs.com.evil.test/job', 'https://notmyworkdayjobs.com/job',
  'https://workday.example.test/job', 'https://myworkdaysite.com/recruiting-fake',
  'https://myworkdaysite.com/employee', 'https://jobs.ashbyhq.com.evil.test/job',
  'https://notashbyhq.com/job', 'https://app.ashbyhq.com/job',
  'ftp://tenant.myworkdayjobs.com/job',
]) {
  test(`does not classify the non-provider URL ${address}`, () => {
    const { url, document } = page('', address);
    assert.equal(resolveAdapter(url, document).name, 'Other');
    assert.equal(detectPlatform(url, document), 'Other');
  });
}
for (const [source, provider] of [
  ['https://tenant.myworkdayjobs.com/en-US/Careers', 'Workday'],
  ['//wd2.myworkdaysite.com/recruiting/tenant/careers', 'Workday'],
  ['//wd1.myworkdaysite.com/es/recruiting/tenant/careers', 'Workday'],
  ['//jobs.ashbyhq.com/example/123', 'Ashby'],
]) {
  test(`re-resolves a late ${provider} iframe, source change and removal`, () => {
    const { url, document } = page();
    const frame = document.createElement('iframe');
    frame.src = 'https://example.test/widget';
    document.body.appendChild(frame);
    assert.equal(resolveAdapter(url, document).name, 'Other');
    frame.src = source;
    assert.equal(resolveAdapter(url, document).name, provider);
    assert.equal(hasEmbeddedATS(url, document), true);
    frame.remove();
    assert.equal(resolveAdapter(url, document).name, 'Other');
  });
}

test('recognizes the documented Ashby placeholder before an iframe exists', () => {
  const { url, document } = page('<div id="ashby_embed" data-jid="example-id" data-tab="application"></div>');
  assert.equal(resolveAdapter(url, document).name, 'Ashby');
  assert.equal(hasEmbeddedATS(url, document), true);
});
test('recognizes a Workday candidate-flow container on a custom employer origin', () => {
  const { url, document } = page('<main data-automation-id="applyFlowPage"></main>');
  assert.equal(resolveAdapter(url, document).name, 'Workday');
});
test('direct Ashby ownership wins over an unrelated Workday embed', () => {
  const { url, document } = page('<iframe src="https://tenant.myworkdayjobs.com/job"></iframe>', 'https://jobs.ashbyhq.com/example/123');
  assert.equal(resolveAdapter(url, document).name, 'Ashby');
});
test('iframe detection rejects lookalikes, invalid URLs and non-recruiting Workday pages', () => {
  const { url, document } = page('<iframe src="https://notmyworkdayjobs.com/a"></iframe><iframe src="https://jobs.ashbyhq.com.evil.test/a"></iframe><iframe src="http://["></iframe><iframe src="https://wd1.myworkdaysite.com/employee"></iframe>');
  assert.equal(resolveAdapter(url, document).name, 'Other');
  assert.equal(hasEmbeddedATS(url, document), false);
});

for (const [name, address, employer, description] of [
  ['workday.html', 'https://tenant.wd5.myworkdayjobs.com/Careers/job/123', 'Example Systems', 'Workday-fixture'],
  ['ashby.html', 'https://jobs.ashbyhq.com/example/123/application', 'Example Analytics', 'Ashby-fixture'],
]) {
  test(`${name} extracts employer metadata and a sanitized provider description`, () => {
    const { url, document } = fixture(name, address);
    assert.equal(detectCompany(url, document), employer);
    const text = detectJobDescription(url, document);
    assert(text.includes(description));
    assert(!text.includes('PRIVATE_'));
    assert(!text.includes('Describe a'));
  });
  test(`${name} keeps vendor labels and each essay wrapper separate`, () => {
    const { url, document } = fixture(name, address);
    const technical = document.querySelector('textarea[name="technical"]');
    const team = document.querySelector('textarea[name="team"]');
    assert(getQuestionForTextarea(technical).startsWith('Describe'));
    assert(getQuestionForTextarea(team).startsWith('How do you'));
    assert(!getQuestionForTextarea(technical).includes('remote team'));
    assert.notEqual(getTextareaWrapper(url, technical), getTextareaWrapper(url, team));
    assert.equal(getFieldContext(document.querySelector('input[name="school0"]')), 'University');
  });
  test(`${name} resolves degree preferences per entry instead of per page`, () => {
    const { url, document } = fixture(name, address);
    assert.equal(getFieldDegreePreference(url, document.querySelector('input[name="school0"]')), 'bachelor');
    assert.equal(getFieldDegreePreference(url, document.querySelector('input[name="school1"]')), 'master');
  });
  test(`${name} invalidates a response when the education entry changes degree level`, () => {
    const { document } = fixture(name, address);
    const field = document.querySelector('input[name="school0"]');
    const captured = captureTarget(field);
    const entry = field.closest('fieldset');
    entry.setAttribute('data-education-level', 'master');
    entry.querySelector('legend').textContent = 'Master education';
    assert.equal(getFieldContext(field), captured.context);
    assert.equal(targetUnchanged(captured), false);
  });
  test(`${name} reads only associated, enabled, visible combobox options`, () => {
    const { url, document } = fixture(name, address);
    const unrelated = document.createElement('div');
    unrelated.innerHTML = '<div role="listbox"><div role="option">Unrelated first item</div></div>';
    document.body.prepend(unrelated);
    assert.deepEqual(getFieldOptions(url, document.querySelector('input[name="country"]')), ['Canada', 'India']);
  });
  test(`${name} invalidates a response after a reused wizard field changes its label`, () => {
    const { document } = fixture(name, address);
    const textarea = document.querySelector('textarea[name="technical"]');
    const captured = captureTarget(textarea);
    const label = textarea.closest('[data-automation-id^="formField-"], .ashby-application-form-field-entry').querySelector('span');
    label.firstChild.data = 'Explain a different requirement on the next step.';
    assert.equal(targetUnchanged(captured), false);
  });
}

test('explicit ARIA labels take precedence over provider wrapper hints', () => {
  const { document } = page('<div data-automation-id="formField-question"><span data-automation-id="formLabel">Neighboring hint</span><textarea aria-label="Describe the intended question"></textarea></div>', 'https://tenant.myworkdayjobs.com/job');
  assert.equal(getQuestionForTextarea(document.querySelector('textarea')), 'Describe the intended question');
});
test('provider wrapper labels do not cross grouped controls', () => {
  const { document } = page('<div data-automation-id="formField-question"><span data-automation-id="formLabel">Foreign question</span><input name="other"><textarea name="intended_question"></textarea></div>', 'https://tenant.myworkdayjobs.com/job');
  assert(!getQuestionForTextarea(document.querySelector('textarea')).includes('Foreign question'));
});
test('metadata fallback does not invent a company from a provider domain or title', () => {
  for (const address of ['https://tenant.myworkdayjobs.com/job', 'https://jobs.ashbyhq.com/example/123']) {
    const { url, document } = page('<title>Backend Engineer</title><meta property="og:site_name" content="Workday">', address);
    assert.equal(detectCompany(url, document), '');
  }
});
test('native select options remain available through the registry', () => {
  const { url, document } = page('<select><option>Select one</option><option>Canada</option></select>', 'https://jobs.ashbyhq.com/example/123');
  assert.deepEqual(getFieldOptions(url, document.querySelector('select')), ['Select one', 'Canada']);
});
for (const [text, preference] of [['Master of Science', 'master'], ['Postgraduate', 'master'], ['Bachelor of Technology', 'bachelor'], ['Undergraduate education', 'bachelor'], ['Master or Bachelor', null], ['MS', 'master'], ['M.S.', 'master'], ['M.Sc.', 'master'], ['B.Tech', 'bachelor'], ['B.Sc.', 'bachelor']]) {
  test(`reads explicit degree context: ${text}`, () => assert.equal(degreeFromText(text), preference));
}

test('malformed structured data is ignored while valid metadata still works', () => {
  const { url, document } = page('<script type="application/ld+json">{bad</script><meta property="og:site_name" content="Example Employer">', 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), 'Example Employer');
});
test('multiple unrelated JobPosting records are not treated as the current vacancy', () => {
  const data = [{ '@type': 'JobPosting', url: '/other', hiringOrganization: { name: 'Wrong employer' } }, { '@type': 'JobPosting', url: '/another', hiringOrganization: { name: 'Also wrong' } }];
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), '');
});
test('structured data disambiguates the current vacancy by URL', () => {
  const data = [{ '@type': 'JobPosting', url: '/other', hiringOrganization: { name: 'Wrong employer' } }, { '@type': 'JobPosting', url: '/example/123', hiringOrganization: { name: 'Correct employer' } }];
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), 'Correct employer');
});
test('structured description fallback strips markup without creating elements or requests', () => {
  const data = { '@type': 'JobPosting', description: '<p>Build APIs &amp; reliable data services. '.repeat(8) + '</p><img src="https://untrusted.example/pixel"><form>PRIVATE_ANSWER</form><script>PRIVATE_SCRIPT</script>' };
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data).replaceAll('</script>', '<\\/script>')}</script>`, 'https://jobs.ashbyhq.com/example/123');
  const text = detectJobDescription(url, document);
  assert(text.includes('APIs & reliable'));
  assert(!text.includes('PRIVATE_'));
  assert.equal(document.querySelector('img'), null);
  assert(text.length <= 2000);
});


test('oversized structured-data blocks are skipped in favor of bounded valid metadata', () => {
  const valid = { '@type': 'JobPosting', hiringOrganization: { name: 'Bounded employer' } };
  const { url, document } = page(`<script type="application/ld+json">${' '.repeat(50_001)}</script><script type="application/ld+json">${JSON.stringify(valid)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), 'Bounded employer');
});
test('deeply nested metadata cannot monopolize traversal', () => {
  let data = { '@type': 'JobPosting', hiringOrganization: { name: 'Too deeply nested' } };
  for (let depth = 0; depth < 120; depth++) data = { mainEntity: data };
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), '');
});
test('aria-owns can reference a late list and hidden lists stay out of matching', () => {
  const { url, document } = page('<input role="combobox" aria-owns="late-list">', 'https://jobs.ashbyhq.com/example/123');
  const field = document.querySelector('input');
  assert.deepEqual(getFieldOptions(url, field), []);
  const list = document.createElement('div');
  list.id = 'late-list';
  list.setAttribute('role', 'listbox');
  list.innerHTML = '<div role="option">Canada</div><div role="option">Canada</div>';
  document.body.appendChild(list);
  assert.deepEqual(getFieldOptions(url, field), ['Canada']);
  list.hidden = true;
  assert.deepEqual(getFieldOptions(url, field), []);
});
test('existing degree choices only affect their own Workday education entry', () => {
  const { url, document } = page('<fieldset data-automation-id="educationSection-0"><legend>Education</legend><input name="degree" value="Bachelor of Science"><input name="school"></fieldset><fieldset data-automation-id="educationSection-1"><legend>Education</legend><input name="degree" value="Master of Science"><input name="school"></fieldset>', 'https://tenant.myworkdayjobs.com/job');
  const schools = document.querySelectorAll('input[name="school"]');
  assert.equal(getFieldDegreePreference(url, schools[0]), 'bachelor');
  assert.equal(getFieldDegreePreference(url, schools[1]), 'master');
});


test('paired Workday posting markers identify a custom-domain posting', () => {
  const { url, document } = page('<h1 data-automation-id="jobPostingHeader">Engineer</h1><div data-automation-id="jobPostingDescription">Description</div>');
  assert.equal(resolveAdapter(url, document).name, 'Workday');
});
test('a lone description marker is not a Workday signature', () => {
  const { url, document } = page('<div data-automation-id="jobPostingDescription">Description</div>');
  assert.equal(resolveAdapter(url, document).name, 'Other');
});

test('associatedOptions reads both aria-controls and aria-owns and prioritizes option aria-label', () => {
  const { url, document } = page('<input role="combobox" aria-controls="controls-list" aria-owns="owns-list"><div id="controls-list" role="listbox"><div role="option" aria-label="United States of America">USA</div></div><div id="owns-list" role="listbox"><div role="option">Canada</div></div>', 'https://jobs.ashbyhq.com/example/123');
  const field = document.querySelector('input');
  assert.deepEqual(getFieldOptions(url, field), ['United States of America', 'Canada']);
});

test('unchecked degree radio buttons are ignored in favor of the checked selection', () => {
  const { url, document } = page('<fieldset data-automation-id="educationSection-0"><legend>Education</legend><input type="radio" name="degree" value="Bachelor of Science"><input type="radio" name="degree" value="Master of Science" checked><input name="school"></fieldset>', 'https://tenant.myworkdayjobs.com/job');
  const school = document.querySelector('input[name="school"]');
  assert.equal(getFieldDegreePreference(url, school), 'master');
});

test('unrelated non-education fieldsets do not donate false degree preferences', () => {
  const { url, document } = page('<fieldset><legend>Work Authorization</legend><input name="degree_met" value="Bachelor of Science"><input name="authorized"></fieldset>', 'https://jobs.ashbyhq.com/example/123');
  const field = document.querySelector('input[name="authorized"]');
  assert.equal(getFieldDegreePreference(url, field), 'master');
});

test('structured data matches vacancy URLs with trailing slash discrepancies', () => {
  const data = [{ '@type': 'JobPosting', url: '/example/123/', hiringOrganization: { name: 'Normalized URL Employer' } }];
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  assert.equal(detectCompany(url, document), 'Normalized URL Employer');
});

test('structured description decodes numeric and typographical entities', () => {
  const data = { '@type': 'JobPosting', description: '<p>You&#39;ll build reliable data pipelines with high availability. '.repeat(5) + 'We require a Master&#x27;s degree or equivalent experience.</p>' };
  const { url, document } = page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://jobs.ashbyhq.com/example/123');
  const text = detectJobDescription(url, document);
  assert(text.includes("You'll build"));
  assert(text.includes("Master's degree"));
});
