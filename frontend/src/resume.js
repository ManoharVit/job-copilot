export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export async function prepareResumeUpload(file) {
    if (!file || !/\.(pdf|docx)$/i.test(file.name) || !file.size || file.size > MAX_RESUME_BYTES) {
        throw new Error('Choose a PDF or DOCX resume, up to 5 MB.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return { filename: file.name, content_base64: btoa(parts.join('')) };
}

export async function resumeRequest(method = 'GET', body) {
    const response = await fetch('/api/resume', {
        method, cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Resume request failed (${response.status}).`);
    return result;
}
