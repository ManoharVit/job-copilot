export async function requestJSON(url, options) {
    const response = await fetch(url, options);
    // fetch resolves for HTTP errors; callers must not commit failed writes to UI state.
    if (!response.ok) {
        let detail;
        try { detail = (await response.json()).detail; } catch { /* Non-JSON error. */ }
        const message = typeof detail === 'string' ? `: ${detail.slice(0, 300)}` : '';
        throw new Error(`Request failed (${response.status})${message}`);
    }
    return response.json();
}


export async function requestAI(endpoint, payload, field) {
    const data = await requestJSON(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const result = data?.[field];
    const valid = field === 'bullets'
        ? Array.isArray(result) && result.length > 0 && result.every(item => typeof item === 'string' && item.trim())
        : typeof result === 'string' && result.trim() && !result.startsWith('[Error');
    if (!valid) throw new Error('AI returned no usable output. Your draft was not changed.');
    return data;
}
