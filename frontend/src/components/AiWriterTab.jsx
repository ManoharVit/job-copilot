import { useState, useContext } from 'react';
import { ToastContext } from '../ToastContext';

function AiWriterTab() {
    const showToast = useContext(ToastContext);

    // Form states
    const [clCompany, setClCompany] = useState('');
    const [clProduct, setClProduct] = useState('');
    const [clJd, setClJd] = useState('');
    const [clOutput, setClOutput] = useState('');
    const [clLoading, setClLoading] = useState(false);

    const [ansQ, setAnsQ] = useState('');
    const [ansJd, setAnsJd] = useState('');
    const [ansOutput, setAnsOutput] = useState('');
    const [ansLoading, setAnsLoading] = useState(false);

    const [resBullets, setResBullets] = useState('');
    const [resJd, setResJd] = useState('');
    const [resOutput, setResOutput] = useState('');
    const [resLoading, setResLoading] = useState(false);

    const [humInput, setHumInput] = useState('');
    const [humOutput, setHumOutput] = useState('');
    const [humLoading, setHumLoading] = useState(false);

    const [intJd, setIntJd] = useState('');
    const [intOutput, setIntOutput] = useState('');
    const [intLoading, setIntLoading] = useState(false);

    const exportDocument = async (text, format, docType = 'Document') => {
        if (!format || !text) return;
        try {
            showToast(`⏳ Generating ${format.toUpperCase()}...`);
            const resp = await fetch(`/api/export-doc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, format, doc_type: docType })
            });
            if (!resp.ok) throw new Error('Export failed');
            
            let filename = `export.${format}`;
            const disposition = resp.headers.get('Content-Disposition');
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                if (matches != null && matches[1]) { 
                    filename = matches[1].replace(/['"]/g, '');
                }
            }
            
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showToast(`✅ ${format.toUpperCase()} downloaded successfully!`);
        } catch (err) {
            console.error(err);
            showToast(`Failed to export ${format}`, 'error');
        }
    };

    const copyText = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Copied to clipboard!');
        });
    };

    const handleHumanizeInPlace = async (text, setter) => {
        if (!text) return;
        try {
            showToast('⏳ Humanizing...');
            const resp = await fetch(`/api/humanize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = await resp.json();
            setter(data.text || text);
            showToast('✅ Text humanized!');
        } catch (e) {
            showToast('Humanize failed', 'error');
        }
    };

    const generateCoverLetter = async () => {
        if (!clJd.trim()) { showToast('Please paste a job description', 'error'); return; }
        if (!clCompany.trim()) { showToast('Please enter the target company', 'error'); return; }
        setClLoading(true);
        try {
            const resp = await fetch(`/api/generate-cover-letter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    job_description: clJd.trim(),
                    company_name: clCompany.trim(),
                    target_product: clProduct.trim()
                })
            });
            const data = await resp.json();
            setClOutput(data.cover_letter || 'No output');
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setClLoading(false);
        }
    };

    const generateAnswer = async () => {
        if (!ansQ.trim()) { showToast('Please enter a question', 'error'); return; }
        setAnsLoading(true);
        try {
            const resp = await fetch(`/api/generate-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: ansQ.trim(), job_description: ansJd.trim() })
            });
            const data = await resp.json();
            setAnsOutput(data.answer || 'No output');
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setAnsLoading(false);
        }
    };

    const tailorResume = async () => {
        if (!resBullets.trim() || !resJd.trim()) { showToast('Please enter both bullets and job description', 'error'); return; }
        const bullets = resBullets.trim().split('\n').map(b => b.replace(/^[-*]\s*/, '').trim()).filter(b => b);
        setResLoading(true);
        try {
            const resp = await fetch(`/api/tailor-resume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bullets, job_description: resJd.trim() })
            });
            const data = await resp.json();
            setResOutput((data.bullets || []).map(b => `- ${b}`).join('\n'));
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setResLoading(false);
        }
    };

    const humanizeStandalone = async () => {
        if (!humInput.trim()) { showToast('Please paste text to humanize', 'error'); return; }
        setHumLoading(true);
        try {
            const resp = await fetch(`/api/humanize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: humInput.trim() })
            });
            const data = await resp.json();
            setHumOutput(data.text || humInput.trim());
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setHumLoading(false);
        }
    };

    const generateInterviewPrep = async () => {
        if (!intJd.trim()) { showToast('Please paste a job description', 'error'); return; }
        setIntLoading(true);
        try {
            const resp = await fetch(`/api/interview-prep`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_description: intJd.trim() })
            });
            const data = await resp.json();
            setIntOutput(data.prep || 'No output');
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setIntLoading(false);
        }
    };

    return (
        <div>
            <h2 style={{ marginBottom: '25px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                ✍️ AI Writer 
                <span style={{ fontSize: '13px', fontWeight: 'normal', background: 'rgba(233,69,96,0.1)', color: 'var(--accent)', padding: '4px 10px', borderRadius: '12px', display: 'inline-block' }}>Human-like, no AI detection</span>
            </h2>

            {/* Cover Letter Generator */}
            <div className="ai-tool-card">
                <h3>📝 Cover Letter Generator</h3>
                <p className="ai-tool-desc">Paste the job description → get a tailored, human-sounding cover letter</p>
                
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                    <input type="text" placeholder="Target Company (e.g. Acme Corp)" style={{ flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit' }} value={clCompany} onChange={e => setClCompany(e.target.value)} />
                    <input type="text" placeholder="Specific Product/Team (e.g. MLOps Platform)" style={{ flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit' }} value={clProduct} onChange={e => setClProduct(e.target.value)} />
                </div>
                <textarea className="ai-textarea" rows="5" placeholder="Paste the full job description here..." value={clJd} onChange={e => setClJd(e.target.value)}></textarea>
                
                <div style={{ textAlign: 'right' }}>
                    <button className="ai-btn" onClick={generateCoverLetter} disabled={clLoading}>
                        {clLoading ? '⏳ Generating...' : '✨ Generate Cover Letter'}
                    </button>
                </div>
                
                {clOutput && (
                    <div className="ai-output-wrapper">
                        <textarea className="ai-textarea ai-output-textarea" rows="10" value={clOutput} onChange={e => setClOutput(e.target.value)}></textarea>
                        <div className="ai-actions-row">
                            <select className="ai-input" style={{ width: 'auto', marginBottom: 0, padding: '10px', cursor: 'pointer' }} onChange={e => { exportDocument(clOutput, e.target.value, 'Cover Letter'); e.target.value = ''; }} defaultValue="">
                                <option value="" disabled>💾 Export As...</option>
                                <option value="pdf">PDF (.pdf)</option>
                                <option value="docx">Word (.docx)</option>
                                <option value="tex">LaTeX (.tex)</option>
                            </select>
                            <button className="ai-btn ai-btn-secondary" onClick={() => handleHumanizeInPlace(clOutput, setClOutput)}>🔄 Make More Human</button>
                            <button className="ai-btn" style={{ backgroundColor: 'var(--success)' }} onClick={() => copyText(clOutput)}>📋 Copy to Clipboard</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Answer Generator */}
            <div className="ai-tool-card">
                <h3>💬 Answer Generator</h3>
                <p className="ai-tool-desc">Generate answers for screening questions (e.g., &quot;Why this role?&quot;, &quot;Describe a challenge&quot;)</p>
                
                <input className="ai-input" type="text" placeholder="Enter the screening question... (e.g. Why do you want to work here?)" value={ansQ} onChange={e => setAnsQ(e.target.value)} />
                <textarea className="ai-textarea" rows="3" placeholder="(Optional) Paste job description for context..." value={ansJd} onChange={e => setAnsJd(e.target.value)}></textarea>
                
                <div style={{ textAlign: 'right' }}>
                    <button className="ai-btn" onClick={generateAnswer} disabled={ansLoading}>
                        {ansLoading ? '⏳ Generating...' : '✨ Generate Answer'}
                    </button>
                </div>
                
                {ansOutput && (
                    <div className="ai-output-wrapper">
                        <textarea className="ai-textarea ai-output-textarea" rows="5" value={ansOutput} onChange={e => setAnsOutput(e.target.value)}></textarea>
                        <div className="ai-actions-row">
                            <select className="ai-input" style={{ width: 'auto', marginBottom: 0, padding: '10px', cursor: 'pointer' }} onChange={e => { exportDocument(ansOutput, e.target.value, 'Answer'); e.target.value = ''; }} defaultValue="">
                                <option value="" disabled>💾 Export As...</option>
                                <option value="pdf">PDF (.pdf)</option>
                                <option value="docx">Word (.docx)</option>
                                <option value="tex">LaTeX (.tex)</option>
                            </select>
                            <button className="ai-btn ai-btn-secondary" onClick={() => handleHumanizeInPlace(ansOutput, setAnsOutput)}>🔄 Make More Human</button>
                            <button className="ai-btn" style={{ backgroundColor: 'var(--success)' }} onClick={() => copyText(ansOutput)}>📋 Copy to Clipboard</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Resume Tailor */}
            <div className="ai-tool-card">
                <h3>📄 Resume Bullet Tailoring</h3>
                <p className="ai-tool-desc">Paste your resume bullets + job description → get tailored bullets that match the JD</p>
                
                <div className="ai-grid-2">
                    <textarea className="ai-textarea" rows="7" placeholder="Enter resume bullets (one per line):&#10;- Built FastAPI microservice handling 2K requests/sec&#10;- Reduced query time from 12s to 0.8s using query optimization&#10;- Deployed Docker containers on AWS ECS" value={resBullets} onChange={e => setResBullets(e.target.value)}></textarea>
                    <textarea className="ai-textarea" rows="7" placeholder="Paste job description here..." value={resJd} onChange={e => setResJd(e.target.value)}></textarea>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                    <button className="ai-btn" onClick={tailorResume} disabled={resLoading}>
                        {resLoading ? '⏳ Tailoring...' : '🎯 Tailor Bullets'}
                    </button>
                </div>
                
                {resOutput && (
                    <div className="ai-output-wrapper">
                        <textarea className="ai-textarea ai-output-textarea" rows="7" value={resOutput} onChange={e => setResOutput(e.target.value)}></textarea>
                        <div className="ai-actions-row">
                            <select className="ai-input" style={{ width: 'auto', marginBottom: 0, padding: '10px', cursor: 'pointer' }} onChange={e => { exportDocument(resOutput, e.target.value, 'Tailored Bullets'); e.target.value = ''; }} defaultValue="">
                                <option value="" disabled>💾 Export As...</option>
                                <option value="pdf">PDF (.pdf)</option>
                                <option value="docx">Word (.docx)</option>
                                <option value="tex">LaTeX (.tex)</option>
                            </select>
                            <button className="ai-btn" style={{ backgroundColor: 'var(--success)' }} onClick={() => copyText(resOutput)}>📋 Copy to Clipboard</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Humanizer */}
            <div className="ai-tool-card">
                <h3>🔄 Text Humanizer</h3>
                <p className="ai-tool-desc">Paste any AI-generated text → remove AI markers so it sounds genuinely human</p>
                
                <textarea className="ai-textarea" rows="5" placeholder="Paste robotic-sounding text to humanize..." value={humInput} onChange={e => setHumInput(e.target.value)}></textarea>
                
                <div style={{ textAlign: 'right' }}>
                    <button className="ai-btn" style={{ backgroundColor: 'var(--warning)', color: '#000' }} onClick={humanizeStandalone} disabled={humLoading}>
                        {humLoading ? '⏳ Humanizing...' : '🔄 Humanize Text'}
                    </button>
                </div>
                
                {humOutput && (
                    <div className="ai-output-wrapper">
                        <textarea className="ai-textarea ai-output-textarea" rows="5" value={humOutput} onChange={e => setHumOutput(e.target.value)}></textarea>
                        <div className="ai-actions-row">
                            <select className="ai-input" style={{ width: 'auto', marginBottom: 0, padding: '10px', cursor: 'pointer' }} onChange={e => { exportDocument(humOutput, e.target.value, 'Humanized Text'); e.target.value = ''; }} defaultValue="">
                                <option value="" disabled>💾 Export As...</option>
                                <option value="pdf">PDF (.pdf)</option>
                                <option value="docx">Word (.docx)</option>
                                <option value="tex">LaTeX (.tex)</option>
                            </select>
                            <button className="ai-btn" style={{ backgroundColor: 'var(--success)' }} onClick={() => copyText(humOutput)}>📋 Copy to Clipboard</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Interview Prep */}
            <div className="ai-tool-card">
                <h3>🎯 Interview Prep</h3>
                <p className="ai-tool-desc">Paste a job description → get likely interview questions with talking points based on your profile</p>
                
                <textarea className="ai-textarea" rows="6" placeholder="Paste job description here..." value={intJd} onChange={e => setIntJd(e.target.value)}></textarea>
                
                <div style={{ textAlign: 'right' }}>
                    <button className="ai-btn" onClick={generateInterviewPrep} disabled={intLoading}>
                        {intLoading ? '⏳ Generating...' : '🎓 Generate Interview Questions'}
                    </button>
                </div>
                
                {intOutput && (
                    <div className="ai-output-wrapper">
                        <textarea className="ai-textarea ai-output-textarea" rows="12" value={intOutput} onChange={e => setIntOutput(e.target.value)}></textarea>
                        <div className="ai-actions-row">
                            <select className="ai-input" style={{ width: 'auto', marginBottom: 0, padding: '10px', cursor: 'pointer' }} onChange={e => { exportDocument(intOutput, e.target.value, 'Interview Prep'); e.target.value = ''; }} defaultValue="">
                                <option value="" disabled>💾 Export As...</option>
                                <option value="pdf">PDF (.pdf)</option>
                                <option value="docx">Word (.docx)</option>
                                <option value="tex">LaTeX (.tex)</option>
                            </select>
                            <button className="ai-btn" style={{ backgroundColor: 'var(--success)' }} onClick={() => copyText(intOutput)}>📋 Copy to Clipboard</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AiWriterTab;
