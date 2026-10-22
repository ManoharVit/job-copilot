import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareResumeUpload, resumeRequest, MAX_RESUME_BYTES } from '../src/resume.js';

test('resume encoding preserves file bytes and filename', async () => {
    const file = new File([new Uint8Array([37,80,68,70,45,255,0,10])], 'candidate.pdf', {type:'application/pdf'});
    const result = await prepareResumeUpload(file);
    assert.equal(result.filename, 'candidate.pdf');
    assert.deepEqual([...Buffer.from(result.content_base64,'base64')], [37,80,68,70,45,255,0,10]);
});
for (const file of [{name:'resume.exe',size:10}, {name:'resume.pdf',size:MAX_RESUME_BYTES+1}, {name:'resume.docx',size:0}]) {
    test(`invalid resume ${file.name} (${file.size} bytes) is rejected before reading it`, async () => {
        await assert.rejects(prepareResumeUpload({...file,arrayBuffer(){throw new Error('Should not read');}}), /PDF or DOCX/);
    });
}
test('resume saves use the dedicated endpoint, separate from profile updates', async t => {
    const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
    let request;
    globalThis.fetch=async(url,options)=>{request={url,options};return Response.json({configured:true,filename:'resume.pdf'});};
    await resumeRequest('PUT',{filename:'resume.pdf',content_base64:'JVBERg=='});
    assert.equal(request.url,'/api/resume');assert.equal(request.options.method,'PUT');
    assert.deepEqual(JSON.parse(request.options.body),{filename:'resume.pdf',content_base64:'JVBERg=='});
});
test('server validation errors remain visible to the resume picker', async t => {
    const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
    globalThis.fetch=async()=>Response.json({detail:'Choose a valid PDF or DOCX resume'},{status:422});
    await assert.rejects(resumeRequest('PUT',{}),/Choose a valid PDF or DOCX/);
});
