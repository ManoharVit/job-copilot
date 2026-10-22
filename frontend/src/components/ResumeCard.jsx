import { useEffect, useRef, useState } from 'react';
import { prepareResumeUpload, resumeRequest } from '../resume';

export default function ResumeCard() {
    const [saved, setSaved] = useState(null);
    const [selected, setSelected] = useState(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('Loading saved resume...');
    const picker = useRef(null);
    useEffect(() => {
        let active = true;
        resumeRequest().then(data => {
            if (active) { setSaved(data); setMessage(''); }
        }).catch(error => { if (active) setMessage(error.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const save = async () => {
        setBusy(true);
        try {
            const result = await resumeRequest('PUT', await prepareResumeUpload(selected));
            setSaved(result);
            setSelected(null);
            if (picker.current) picker.current.value = '';
            setMessage('Resume saved. Autofill will attach it to supported resume fields.');
        } catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    };
    const remove = async () => {
        setBusy(true);
        try { setSaved(await resumeRequest('DELETE')); setMessage('Saved resume removed.'); }
        catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    };

    return (
        <section className="form-section" aria-labelledby="resume-heading">
            <h3 id="resume-heading">Resume for Autofill</h3>
            <p>Choose a PDF or DOCX, up to 5 MB. It is saved locally. Clicking Autofill can send this file to the job portal when it attaches the resume.</p>
            {saved?.configured && <p><strong>{saved.filename}</strong> ({Math.ceil(saved.size / 1024)} KB)</p>}
            {saved && !saved.configured && <p>No resume saved yet.</p>}
            <div className="form-group">
                <label htmlFor="resume-file">Resume file</label>
                <input ref={picker} id="resume-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    disabled={busy || loading} onChange={event => setSelected(event.target.files?.[0] || null)} />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" disabled={busy || loading || !selected} onClick={save}>{busy ? 'Working...' : saved?.configured ? 'Replace saved resume' : 'Save resume'}</button>
                {saved?.configured && <button type="button" className="btn-secondary" disabled={busy || loading} onClick={remove}>Remove saved resume</button>}
            </div>
            <p role="status">{message}</p>
        </section>
    );
}
