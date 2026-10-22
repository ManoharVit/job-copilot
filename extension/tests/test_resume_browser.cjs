// Offline Chromium integration test: fresh temporary profile, synthetic PDF,
// no extension grants, real accounts, backend calls, or job-portal traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const chrome = candidates.find(file => file && fs.existsSync(file));
if (!chrome) throw new Error('Chrome/Chromium is required; set CHROME_BIN to its executable.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-resume-browser-'));
try {
  const source = fs.readFileSync(path.join(__dirname, '../src/core/resume-upload.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export /gm, '');
  const bytes = Buffer.from('%PDF-1.7\nSynthetic fixture resume\n%%EOF');
  const saved = { configured:true, filename:'fixture-resume.pdf', mime_type:'application/pdf', size:bytes.length, sha256:'a'.repeat(64), content_base64:bytes.toString('base64') };
  const html = `<!doctype html><html><body><form><label for="resume">Resume/CV</label><input type="file" id="resume" accept=".pdf" style="display:none"><label for="cover_letter">Cover letter</label><input type="file" id="cover_letter"><button type="submit">Submit</button></form><pre id="result">PENDING</pre><script>
${compiled}
(async () => {
  try {
    const saved=${JSON.stringify(saved)};
    const events=[];
    for(const event of ['input','change','submit']) document.querySelector('form').addEventListener(event,()=>events.push(event));
    let loads=0;
    const load=async()=>{loads++;return saved;};
    const field=document.getElementById('resume');
    const first=await attachSavedResume(captureResumeTarget(document),load);
    if(first.attached!==1 || !(field.files instanceof FileList) || field.files.length!==1) throw Error('Native FileList not attached');
    if(field.files[0].name!==saved.filename || btoa(await field.files[0].text())!==saved.content_base64) throw Error('File bytes changed');
    if(document.getElementById('cover_letter').files.length) throw Error('Cover letter was overwritten');
    if(JSON.stringify(events)!==JSON.stringify(['input','change'])) throw Error('Unexpected native events: '+events);
    field.value='';
    const second=await attachSavedResume(captureResumeTarget(document),load);
    if(second.status!=='already_attached' || loads!==1) throw Error('Duplicate upload');
    document.getElementById('result').textContent='PASS native FileList, exact bytes, input/change, no submit, cover-letter isolation, repeat guard';
  } catch(error) { document.getElementById('result').textContent='FAIL '+error.message; }
})();
</script></body></html>`;
  const fixture = path.join(directory, 'fixture.html');
  fs.writeFileSync(fixture, html);
  const output = execFileSync(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=1500', pathToFileURL(fixture).href], {encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
  const result = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert(result?.startsWith('PASS '), result || 'Chrome fixture did not finish');
  console.log(result);
} finally { fs.rmSync(directory, {recursive:true,force:true}); }
