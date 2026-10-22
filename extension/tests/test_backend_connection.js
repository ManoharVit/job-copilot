const assert=require('node:assert/strict');
const test=require('node:test');
const {registerBackground}=require('../src/background.ts');
const {API_URL,BACKEND_PERMISSION}=require('../src/shared/messages.ts');
const {setupBackendConnection}=require('../src/core/popup-backend.ts');
const {requestBackend}=require('../src/core/backend-client.ts');
const {autofillFailureMessage}=require('../src/core/site-access.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
assert.equal(BACKEND_PERMISSION, 'http://127.0.0.1:8765/*');

function worker({allowed=true,response,networkError=false}={}) {
  let receive;
  let fetches=0;
  const listener={addListener(){}};
  const chrome={runtime:{onInstalled:listener,onMessage:{addListener(fn){receive=fn;}}},
    tabs:{onUpdated:listener},commands:{onCommand:listener},
    permissions:{contains:async request=>{assert.deepEqual(request,{origins:[BACKEND_PERMISSION]});return allowed;}},
  };
  registerBackground(chrome,async(url,options)=>{
    fetches++;assert(url.startsWith(API_URL+'/api/'));
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    if(networkError)throw new TypeError('Failed to fetch');
    return response || Response.json({total:0});
  });
  return {get fetches(){return fetches;}, request:()=>new Promise(resolve=>receive({action:'fetchAPI',url:API_URL+'/api/stats',options:{}},{},resolve))};
}

test('the worker identifies a withheld loopback grant before issuing any fetch', async()=>{
  const w=worker({allowed:false});const response=await w.request();
  assert.equal(response.success,false);assert.equal(response.code,'backend_permission_required');
  assert.match(response.error,/Connect local backend/);assert.equal(w.fetches,0);
});
test('a permitted worker sends requests only to the IPv4 loopback API',async()=>{
  const w=worker();const response=await w.request();
  assert.equal(response.success,true);assert.deepEqual(response.data,{total:0});assert.equal(w.fetches,1);
});
test('network refusal has a distinct actionable error instead of Failed to fetch',async()=>{
  const response=await worker({networkError:true}).request();
  assert.equal(response.code,'backend_unreachable');assert.match(response.error,/127\.0\.0\.1:8765/);
  assert.match(response.error,/Connect local backend/);assert.doesNotMatch(response.error,/TypeError/);
});
test('origin rejection is reported separately from network and permission errors',async()=>{
  const response=await worker({response:Response.json({detail:'Origin is not allowed'},{status:403})}).request();
  assert.equal(response.code,'backend_http_error');assert.match(response.error,/CORS_EXTENSION_ORIGIN/);
});
test('server failures preserve HTTP status without exposing response bodies',async()=>{
  const response=await worker({response:new Response('PRIVATE_BACKEND_BODY',{status:500})}).request();
  assert.match(response.error,/HTTP 500/);assert(!JSON.stringify(response).includes('PRIVATE_BACKEND_BODY'));
});
test('invalid JSON is reported as an invalid backend response',async()=>{
  const response=await worker({response:new Response('not JSON',{status:200})}).request();
  assert.equal(response.code,'backend_invalid_response');
});

test('popup backend client uses the worker and surfaces its permission error',async()=>{
  let message;
  const chrome={runtime:{sendMessage:async value=>{message=value;return {success:false,error:'Click Connect local backend'};}}};
  await assert.rejects(requestBackend('/api/stats',chrome),/Connect local backend/);
  assert.deepEqual(message,{action:'fetchAPI',url:API_URL+'/api/stats',options:{}});
});
test('popup backend client exposes successful worker data',async()=>{
  assert.deepEqual(await requestBackend('/api/stats',{runtime:{sendMessage:async()=>({success:true,data:{total:3}})}}),{total:3});
});

async function popup({allowed=false,grant=true,readyError}={}) {
  let requested;
  let reads=0;
  const elements=Object.fromEntries(['connectBackendBtn','backendStatus'].map(id=>[id,{disabled:false,textContent:'',addEventListener(_name,fn){this.click=fn;}}]));
  const chrome={permissions:{contains:async()=>allowed,request(value){requested=value;allowed=grant;return Promise.resolve(grant);}}};
  await setupBackendConnection({getElementById:id=>elements[id]},async()=>{reads++;if(readyError)throw new Error(readyError);},chrome);
  return {elements,get requested(){return requested;},get reads(){return reads;},click(trusted=true){elements.connectBackendBtn.click({isTrusted:trusted});}};
}
test('missing loopback access remains separate from an employer/ATS grant',async()=>{
  const p=await popup();assert.equal(p.reads,0);assert.match(p.elements.backendStatus.textContent,/not allowed/);
});
test('backend connection requests exactly loopback access from a trusted click',async()=>{
  const p=await popup();p.click(false);assert.equal(p.requested,undefined);
  p.click();assert.deepEqual(p.requested,{origins:[BACKEND_PERMISSION]});
  await flush();assert.equal(p.reads,1);assert.match(p.elements.backendStatus.textContent,/Connected to http:\/\/127\.0\.0\.1:8765/);
});
test('denying loopback access does not fetch profile data',async()=>{
  const p=await popup({grant:false});p.click();await flush();
  assert.equal(p.reads,0);assert.match(p.elements.backendStatus.textContent,/not granted/);
});
test('backend granted but unreachable remains an error and allows a retry',async()=>{
  const p=await popup({allowed:true,readyError:'Cannot reach the local backend'});
  assert.match(p.elements.backendStatus.textContent,/Cannot reach/);
  p.click();await flush();assert.equal(p.elements.connectBackendBtn.disabled,false);
});
test('a successful existing backend grant loads popup data without another prompt',async()=>{
  const p=await popup({allowed:true});assert.equal(p.reads,1);assert.equal(p.requested,undefined);
});
test('autofill failure messages retain backend instructions rather than suggesting ATS permissions',()=>{
  assert.match(autofillFailureMessage({success:false,reason:'autofill_failed',error:'Click Connect local backend'}),/Connect local backend/);
});
