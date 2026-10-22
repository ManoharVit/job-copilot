const assert=require('node:assert/strict');
const test=require('node:test');
const {parseHTML}=require('linkedom');
const {captureResumeTarget,attachSavedResume,acceptsResume}=require('../src/core/resume-upload.ts');
const {apiRequest}=require('../src/core/api-proxy.ts');
const {API_URL}=require('../src/shared/messages.ts');
const bytes=Buffer.from('%PDF-1.7\nSynthetic resume\n%%EOF');
const saved={configured:true,filename:'resume.pdf',mime_type:'application/pdf',size:bytes.length,sha256:'a'.repeat(64),content_base64:bytes.toString('base64')};
class Transfer {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
function page(markup='<input type="file" name="resume" accept=".pdf">'){
 const {document,window}=parseHTML(`<html><body><form>${markup}<button type="submit">Submit</button></form></body></html>`);
 Object.defineProperty(document,'URL',{value:'https://jobs.example.test/apply',writable:true});
 return {document,field:document.querySelector('input[type=file]'),env:{DataTransfer:Transfer,File,Event:window.Event,atob}};
}
function load(value=saved){return async()=>value;}

test('resume detection isolates CV from cover letter, generic and supporting attachments',()=>{
 const p=page('<input type=file name=cover_letter><input type=file name=attachment><input type=file name=resume>');
 assert.equal(captureResumeTarget(p.document).field.name,'resume');
 for(const name of ['cover_letter','portfolio','transcript','supporting_documents','attachment','resume_photo']){
  assert.equal(captureResumeTarget(page(`<input type=file name="${name}">`).document).state,'none');
 }
});
test('hidden native resume inputs can be attached while disabled/unrendered sections are excluded',()=>{
 assert.equal(captureResumeTarget(page('<input type=file name=resume style="display:none">').document).state,'ready');
 assert.equal(captureResumeTarget(page('<input type=file name=resume disabled>').document).state,'none');
 assert.equal(captureResumeTarget(page('<section hidden><input type=file name=resume></section>').document).state,'none');
});
test('ARIA-labelled CV upload widgets are recognized without guessing generic file inputs',()=>{
 const p=page('<h3 id=cv-label>Resume/CV</h3><input type=file name=file aria-labelledby=cv-label>');
 assert.equal(captureResumeTarget(p.document).state,'ready');
});
test('multiple clear resume controls require manual selection and do not read the saved resume',async()=>{
 const p=page('<input type=file name=resume_english><input type=file name=resume_french>');
 const result=await attachSavedResume(captureResumeTarget(p.document),async()=>{throw new Error('Must not fetch')},p.env);
 assert.equal(result.status,'ambiguous');
});
test('attachment reconstructs exact bytes, fires input/change and does not submit the form',async()=>{
 const p=page();const events=[];
 for(const name of ['input','change','submit'])p.document.querySelector('form').addEventListener(name,()=>events.push(name));
 const result=await attachSavedResume(captureResumeTarget(p.document),load(),p.env);
 assert.equal(result.attached,1);assert.deepEqual(events,['input','change']);
 assert.equal(p.field.files[0].name,'resume.pdf');
 assert.deepEqual(Buffer.from(await p.field.files[0].arrayBuffer()),bytes);
});
test('existing manually selected files are preserved without loading a saved resume',async()=>{
 const p=page();const manual=new File(['manual'],'manual.pdf');p.field.files=[manual];
 const result=await attachSavedResume(captureResumeTarget(p.document),async()=>{throw new Error('Must not fetch')},p.env);
 assert.equal(result.status,'already_attached');assert.equal(p.field.files[0],manual);
});
test('repeated Autofill does not upload again after the portal consumes/clears the same native input',async()=>{
 const p=page();let loads=0;const fetch=async()=>{loads++;return saved;};
 await attachSavedResume(captureResumeTarget(p.document),fetch,p.env);
 p.field.files=[];p.field.parentElement.appendChild(p.document.createElement('span')).textContent='resume.pdf';
 const again=await attachSavedResume(captureResumeTarget(p.document),fetch,p.env);
 assert.equal(again.status,'already_attached');assert.equal(loads,1);
});
test('missing saved resume explains the one-time dashboard setup',async()=>{
 const p=page();const result=await attachSavedResume(captureResumeTarget(p.document),load({configured:false}),p.env);
 assert.equal(result.status,'not_configured');assert.match(result.message,/Dashboard/);assert(!p.field.files?.length);
});
test('accept restrictions are honored for extensions, MIME types and wildcards',()=>{
 for(const accept of ['.pdf','application/pdf','application/*','*/*',''])assert(acceptsResume(accept,'resume.pdf','application/pdf'));
 for(const accept of ['.docx','image/*','text/plain'])assert(!acceptsResume(accept,'resume.pdf','application/pdf'));
});
test('an incompatible resume is skipped without setting the input',async()=>{
 const p=page('<input type=file name=resume accept=.docx>');
 assert.equal((await attachSavedResume(captureResumeTarget(p.document),load(),p.env)).status,'incompatible');assert(!p.field.files?.length);
});
test('navigation, detached inputs and relabelled inputs invalidate a pending attachment',async()=>{
 for(const change of [p=>{p.document.URL+='?next';},p=>p.field.remove(),p=>{p.field.name='cover_letter';}]){
  const p=page();const target=captureResumeTarget(p.document);
  const result=await attachSavedResume(target,async()=>{change(p);return saved;},p.env);
  assert.equal(result.status,'stale');assert(!p.field.files?.length);
 }
});
test('a manual selection made while the backend is pending wins',async()=>{
 const p=page();const manual=new File(['manual'],'manual.pdf');
 const result=await attachSavedResume(captureResumeTarget(p.document),async()=>{p.field.files=[manual];return saved;},p.env);
 assert.equal(result.status,'stale');assert.equal(p.field.files[0],manual);
});
test('invalid binary metadata is rejected before assigning a file',async()=>{
 for(const value of [{...saved,size:100000},{...saved,sha256:'invalid'},{...saved,filename:'../resume.pdf'},{...saved,content_base64:'!bad!'}]){
  const p=page();assert.equal((await attachSavedResume(captureResumeTarget(p.document),load(value),p.env)).status,'failed');assert(!p.field.files?.length);
 }
});
test('unsupported browsers request manual attachment without fetching resume contents',async()=>{
 const p=page();const result=await attachSavedResume(captureResumeTarget(p.document),async()=>{throw new Error('Must not fetch')},{...p.env,DataTransfer:undefined});
 assert.equal(result.status,'unsupported');
});
test('resume access through the worker is read-only and stays on the existing backend origin',()=>{
 assert.equal(apiRequest(API_URL+'/api/resume/file',{})[0],API_URL+'/api/resume/file');
 for(const method of ['POST','PUT','DELETE'])assert.throws(()=>apiRequest(API_URL+'/api/resume/file',{method}));
 assert.throws(()=>apiRequest(API_URL+'/api/resume',{method:'PUT'}));
});

test('an external native label associates a generically named upload with Resume/CV',()=>{
 const p=page('<label for="generic-upload">Resume/CV</label><input type=file id="generic-upload" name="file">');
 assert.equal(captureResumeTarget(p.document).state,'ready');
});
