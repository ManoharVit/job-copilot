const assert = require('node:assert/strict');
const test = require('node:test');
const { siteAccessOrigins, frameIssue, autofillFailureMessage } = require('../src/core/site-access.ts');
const { setupSiteAccess } = require('../src/core/popup-access.ts');
const { registerBackground } = require('../src/background.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const frames = [
  { frameId: 0, url: 'https://hyperproof.io/job-listings/?gh_jid=private-query' },
  { frameId: 7, url: 'https://job-boards.greenhouse.io/embed/job_app?token=private-token' },
  { frameId: 9, url: 'https://chat.example.test/widget' },
  { frameId: 10, url: 'https://greenhouse.io.evil.test/fake' },
];
const origins = ['https://hyperproof.io/*', 'https://job-boards.greenhouse.io/*'];

test('permission recovery lists only the employer and exact ATS origins, without query data', () => {
  assert.deepEqual(siteAccessOrigins(frames[0].url, frames), origins);
  assert.deepEqual(siteAccessOrigins('chrome://extensions', frames), []);
  assert.deepEqual(siteAccessOrigins('https://example.test/apply', [
    {frameId:1,url:'https://work.myworkdaysite.com/en-US/recruiting/company/role'},
    {frameId:2,url:'https://work.myworkdaysite.com/unrelated'},
    {frameId:3,url:'about:blank'},
    {frameId:4,url:'https://jobs.ashbyhq.com/company/job'},
  ]), ['https://example.test/*','https://work.myworkdaysite.com/*','https://jobs.ashbyhq.com/*']);
});

test('permission errors retain frame origin and stage without exposing URL parameters', () => {
  const issue = frameIssue(new Error('Cannot access contents of url "https://job-boards.greenhouse.io/embed?candidate=secret". Extension manifest must request permission to access this host.'), 'script', 7, frames[1].url);
  assert.deepEqual(issue, {frameId:7, origin:'https://job-boards.greenhouse.io',stage:'script',code:'site_access_required'});
  assert(!JSON.stringify(issue).includes('secret'));
  assert.match(autofillFailureMessage({success:false,frameIssues:[issue]}), /job-boards\.greenhouse\.io.*Autofill This Page/);
});

test('missing listeners, no fields and backend failures do not get mislabeled as permission denial', () => {
  assert.equal(frameIssue(new Error('Could not establish connection. Receiving end does not exist.'),'message').code, 'frame_unavailable');
  assert.match(autofillFailureMessage({success:false,reason:'no_fields'}), /No editable form/);
  assert.match(autofillFailureMessage({success:false,reason:'autofill_failed'}), /local backend/);
  assert.doesNotMatch(autofillFailureMessage({success:false}), /access blocked/);
});

function worker({topSuccess=false}={}) {
  let listener;
  let denied = true;
  const injections = [];
  const deliveries = [];
  const chrome = {
    runtime:{onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
    webNavigation:{getAllFrames:async()=>frames,onCompleted:{addListener(){}}},
    scripting:{
      executeScript:async request=>{
        const id=request.target.frameIds[0]; injections.push(id);
        if (denied && id===7) throw new Error('Cannot access contents of url. Extension manifest must request permission to access this host.');
      }, insertCSS:async()=>{},
    },
    tabs:{query:async()=>[{id:11,url:frames[0].url}],onUpdated:{addListener(){}},
      sendMessage:async(_id,_message,target)=>{
        deliveries.push(target.frameId);
        if (denied && target.frameId===7) throw new Error('Receiving end does not exist');
        return {success:target.frameId===7 || topSuccess,reason:target.frameId===0?'no_fields':undefined,filledCount:target.frameId===7?2:0};
      }},
    commands:{onCommand:{addListener(){}}},
  };
  registerBackground(chrome);
  return {injections,deliveries, grant(){denied=false;}, async message(action,sender={tab:{id:11,url:frames[0].url}}){
    return new Promise(resolve=>assert.equal(listener({action},sender,resolve),true));
  }};
}

test('blocked Greenhouse injection is reported even though the parent listener is reachable', async () => {
  const w=worker();
  const result=await w.message('broadcastAutofill');
  assert.equal(result.success,false);
  assert.equal(result.deliveredFrames,1);
  assert.equal(result.failedFrames,1);
  assert.deepEqual(w.injections,[0,7]);
  assert.deepEqual(w.deliveries,[0,7]);
  assert(result.frameIssues.some(issue=>issue.code==='site_access_required' && issue.frameId===7));
});

test('popup inspection and reinjection use the active tab and recover after granting ATS access', async () => {
  const w=worker();
  const result=await w.message('inspectSiteAccess',{});
  assert.deepEqual(result.origins,origins);
  assert.equal(result.tabId,11);
  assert.equal((await w.message('ensureInjected',{})).success,false);
  w.grant();
  assert.equal((await w.message('ensureInjected',{})).success,true);
  const filled=await w.message('broadcastAutofill');
  assert.equal(filled.success,true);
  assert.equal(filled.filledCount,2);
});

async function popup({grant=true,changeTab=false,reject=false}={}) {
  const elements = Object.fromEntries(['allowSitesBtn','siteAccessStatus','siteAccessOrigins'].map(id=>[id,{disabled:false,textContent:'',addEventListener(_type,fn){this.click=fn;}}]));
  let requested;
  const messages=[];
  let inspections=0;
  const chrome={
    permissions:{request(value){requested=value; return reject?Promise.reject(new Error('Chrome refused')):Promise.resolve(grant);}},
    runtime:{sendMessage:async message=>{
      messages.push(message.action);
      if(message.action==='inspectSiteAccess') return {success:true,origins,tabId:changeTab && inspections++>0?99:11};
      if(message.action==='ensureInjected') return {success:true};
      throw new Error('Unexpected action');
    }},
  };
  await setupSiteAccess({getElementById:id=>elements[id]},chrome);
  return {elements,messages,get requested(){return requested;},click(trusted=true){elements.allowSitesBtn.click({isTrusted:trusted});}};
}

test('popup requests only displayed sites synchronously in the real click, then reconnects without filling', async () => {
  const p=await popup();
  p.click(false);
  assert.equal(p.requested,undefined);
  p.click();
  // No await before Chrome permissions.request: the gesture is preserved.
  assert.deepEqual(p.requested,{origins});
  await flush();
  assert.match(p.elements.siteAccessStatus.textContent,/Site access ready/);
  assert.deepEqual(p.messages,['inspectSiteAccess','inspectSiteAccess','ensureInjected']);
  assert(!p.messages.includes('broadcastAutofill'));
});

test('declined permission does not reconnect or fill', async () => {
  const p=await popup({grant:false}); p.click(); await flush();
  assert.deepEqual(p.messages,['inspectSiteAccess']);
  assert.match(p.elements.siteAccessStatus.textContent,/not granted/);
  assert.equal(p.elements.allowSitesBtn.disabled,false);
});

test('navigation while the permission prompt is open does not reconnect a different tab', async () => {
  const p=await popup({changeTab:true}); p.click(); await flush();
  assert(!p.messages.includes('ensureInjected'));
  assert.match(p.elements.siteAccessStatus.textContent,/page changed/);
});

test('permission API rejection leaves recovery usable with an explicit error', async () => {
  const p=await popup({reject:true}); p.click(); await flush();
  assert.match(p.elements.siteAccessStatus.textContent,/Could not reconnect/);
  assert.equal(p.elements.allowSitesBtn.disabled,false);
});

test('an unrelated parent form cannot mask blocked ATS access as a successful fill', async () => {
  const w=worker({topSuccess:true});
  const result=await w.message('broadcastAutofill');
  assert.equal(result.success,false);
  assert.match(autofillFailureMessage(result), /Form access blocked/);
});

// Exercise the actual popup entrypoint, including its direct click-to-permission
// ordering. These fixtures contain no real candidate data or external requests.
async function autofillPopup(t, { grant = true, inject = true, changeTab = false, deferred = false, reject = false } = {}) {
  const previous = { document: global.document, chrome: global.chrome };
  t.after(() => { global.document = previous.document; global.chrome = previous.chrome; });
  const ids = ['loader', 'content', 'errorMsg', 'autofillBtn', 'profileCard', 'connectBackendBtn',
    'backendStatus', 'pName', 'pEmail', 'pPhone', 'sToday', 'sTotal',
    'allowSitesBtn', 'siteAccessStatus', 'siteAccessOrigins'];
  const elements = Object.fromEntries(ids.map(id => [id, {
    disabled: false, style: {}, textContent: '', innerText: '',
    addEventListener(_event, fn) { this.click = fn; },
  }]));
  const listed = ['https://www.nasuni.com/*', 'https://job-boards.greenhouse.io/*'];
  const actions = [];
  const requests = [];
  let inspections = 0;
  let completePermission;
  let ready;
  global.document = {
    getElementById: id => elements[id], querySelector: () => ({ style: {} }),
    addEventListener(_event, fn) { ready = fn; },
  };
  global.chrome = {
    permissions: {
      contains: async () => true,
      request(value) {
        requests.push(value);
        if (reject) return Promise.reject(new Error('Chrome refused'));
        if (deferred) return new Promise(resolve => { completePermission = resolve; });
        return Promise.resolve(grant);
      },
    },
    runtime: { sendMessage: async message => {
      actions.push(message.action);
      if (message.action === 'inspectSiteAccess') return {
        success: true, origins: listed, tabId: changeTab && inspections++ > 0 ? 99 : 11,
      };
      if (message.action === 'fetchAPI') return { success: true, data: { name: 'Fixture', total: 0 } };
      if (message.action === 'ensureInjected') return { success: inject };
      if (message.action === 'broadcastAutofill') return { success: true, filledCount: 2 };
      throw new Error('Unexpected popup action');
    } },
  };
  const entrypoint = require.resolve('../src/entrypoints/popup/main.ts');
  delete require.cache[entrypoint];
  require(entrypoint);
  await ready();
  await flush();
  return { elements, actions, requests, listed,
    click: (trusted = true) => elements.autofillBtn.click({ isTrusted: trusted }),
    grant: () => completePermission(true),
  };
}

test('popup Autofill requests just Nasuni and Greenhouse in the click, waits for grant, then fills', async t => {
  const p = await autofillPopup(t, { deferred: true });
  assert.equal(p.elements.autofillBtn.disabled, false);
  const filling = p.click();
  assert.deepEqual(p.requests, [{ origins: p.listed }]);
  assert(!JSON.stringify(p.requests).includes('<all_urls>'));
  assert(!p.actions.includes('ensureInjected'));
  assert(!p.actions.includes('broadcastAutofill'));
  await p.click(); // A second click while the permission prompt is open is ignored.
  assert.equal(p.requests.length, 1);
  p.grant();
  await filling;
  assert.deepEqual(p.actions.slice(-3), ['inspectSiteAccess', 'ensureInjected', 'broadcastAutofill']);
  assert.equal(p.elements.autofillBtn.innerText, 'Filled 2 fields');
  assert.equal(p.elements.autofillBtn.disabled, false);
});

for (const [scenario, options, message] of [
  ['declined site access', { grant: false }, /not granted/],
  ['permission API rejection', { reject: true }, /Could not reconnect/],
  ['changed active tab', { changeTab: true }, /page changed/],
  ['failed frame reinjection', { inject: false }, /Application frame unavailable/],
]) {
  test(`popup Autofill stops before filling after ${scenario}`, async t => {
    const p = await autofillPopup(t, options);
    await p.click();
    assert(!p.actions.includes('broadcastAutofill'));
    assert.match(p.elements.siteAccessStatus.textContent, message);
    assert.equal(p.elements.autofillBtn.disabled, false);
  });
}

test('synthetic popup Autofill clicks cannot request permissions or fill', async t => {
  const p = await autofillPopup(t);
  await p.click(false);
  assert.deepEqual(p.requests, []);
  assert(!p.actions.includes('broadcastAutofill'));
});
