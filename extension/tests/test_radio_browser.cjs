// Offline browser integration: fresh profile, synthetic questionnaire, no real
// account, extension permission changes, backend/AI calls, or submission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(file => file && fs.existsSync(file));
if (!chrome) throw Error('Chrome/Chromium required; set CHROME_BIN.');
const root = path.resolve(__dirname, '../src');
const modules = {};
function compile(file) {
  const key = path.relative(root, file).replaceAll(path.sep, '/');
  if (modules[key]) return key;
  modules[key] = '/* compiling */';
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  code = code.replace(/require\("([^"]+)"\)/g, (expression, reference) => {
    if (!reference.startsWith('.')) throw Error('Unexpected external dependency: ' + reference);
    const target = path.resolve(path.dirname(file), reference);
    const resolved = [target + '.ts', path.join(target, 'index.ts')].find(file => fs.existsSync(file));
    if (!resolved) throw Error('Cannot resolve ' + reference);
    return 'require(' + JSON.stringify(compile(resolved)) + ')';
  });
  modules[key] = code;
  return key;
}
const entry = compile(path.join(root, 'content.ts'));
const loader = `const modules={${Object.entries(modules).map(([key, code]) => JSON.stringify(key) + ':function(require,module,exports){\n' + code + '\n}').join(',')}};const cache={};function require(key){if(cache[key])return cache[key].exports;const module=cache[key]={exports:{}};modules[key](require,module,module.exports);return module.exports;}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-radio-browser-'));
function question(name, heading, options, hidden = false) {
  return `<div class="question"><h3>${heading}</h3><div>${options.map((option, index) =>
    `<label><input ${hidden ? 'style="opacity:0;position:absolute"' : ''} type="radio" name="${name}" value="${index}">${option}</label>`).join('')}</div></div>`;
}
const options = ['Not much', '6 months - 1 year', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
try {
  const html = `<!doctype html><html><head><style>label{display:inline-block;margin:8px}textarea{display:block;width:400px;height:70px}</style></head><body><form>
    ${question('python', '1. How much experience do you have in Python?', options)}
    ${question('ai', '2. Do you have hands on experience with AI APIs, LLMs, vector search or RAG in a project?', options)}
    ${question('video', '3. Do you have any experience with video/media processing workflows or tools such as FFmpeg?', options, true)}
    ${question('notice', '4. What is your official notice period (as per your offer letter)', ['Served notice, available immediately','15 days','30 days','45 days','60 days','Above 60 days'])}
    <label for="location">5. What is your current location?</label><textarea id="location">Pune</textarea>
    <label for="ctc">7. What is your current annual CTC and expected CTC? (please mention: fixed CTC + variable CTC + ESOPs, if any)</label><textarea id="ctc"></textarea>
    <label for="resume">Resume/CV</label><input type="file" id="resume" style="display:none">
    <button type="submit">Submit</button></form><pre id="result">PENDING</pre><script>
    ${loader}
    let listener;const requests=[];let submits=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();submits++});
    window.chrome={runtime:{onMessage:{addListener(fn){listener=fn}},sendMessage(message,callback){
      if(message.action!=='fetchAPI'){if(callback)callback({success:true});return;}
      let data={};
      if(message.url.endsWith('/api/match-fields')){
        const fields=JSON.parse(message.options.body);requests.push(fields);
        for(const field of fields){if(field.name==='python'||field.name==='ai')data[field.index]='1-2 years';
          else if(field.name==='video')data[field.index]='Not much';
          else if(field.name==='notice')data[field.index]='15 days';
          else if(field.id==='location')data[field.index]='Pune';
          else if(field.id==='ctc')data[field.index]='Current total: 12 LPA. Expected total: 18 LPA.';}
      } else if(message.url.endsWith('/api/resume/file')) data={configured:false};
      if(callback)callback({success:true,data});
    }}};
    require(${JSON.stringify(entry)}).startContentScript();
    const fill=()=>new Promise(resolve=>listener({action:'autofill'},{},resolve));
    (async()=>{try{
      const result=await fill();
      if(!result.success||result.filledCount!==5||result.alreadyCorrectCount!==1)throw Error('Bad counts '+JSON.stringify(result));
      if(requests[0].length!==6)throw Error('Radios were not deduplicated');
      const python=requests[0].find(field=>field.name==='python');
      if(!python.label.includes('experience')||python.options.length!==6)throw Error('Missing group question/options');
      for(const [name,value] of [['python','2'],['ai','2'],['video','0'],['notice','1']]){
        if(document.querySelector('input[name="'+name+'"]:checked')?.value!==value)throw Error('Wrong selection for '+name);
      }
      if(!document.querySelector('.jc-toast')?.textContent.includes('Filled 5, Correct 1'))throw Error('Resume notice hid field result');
      if(!document.querySelector('.jc-toast')?.textContent.includes('No resume saved'))throw Error('Resume notice lost');
      document.querySelector('input[name="notice"][value="2"]').click();
      const again=await fill();
      if(again.filledCount!==0||document.querySelector('input[name="notice"]:checked').value!=='2')throw Error('User selection overwritten');
      if(submits)throw Error('Form submitted');
      document.getElementById('result').textContent='PASS real Chromium: grouped radios, opaque values, styled inputs, all four selections, CTC textarea, accurate counts, missing resume independence, user-choice preservation, no submit';
    }catch(error){document.getElementById('result').textContent='FAIL '+error.message}})();
    </script></body></html>`;
  const fixture = path.join(directory, 'fixture.html');
  fs.writeFileSync(fixture, html);
  const output = execFileSync(chrome, ['--headless','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps',
    '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${path.join(directory,'profile')}`,
    '--dump-dom','--virtual-time-budget=5000',pathToFileURL(fixture).href],
    {encoding:'utf8',timeout:25000,maxBuffer:3*1024*1024,stdio:['ignore','pipe','pipe']});
  const result = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert(result?.startsWith('PASS '),result||'Browser fixture did not finish');
  console.log(result);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
