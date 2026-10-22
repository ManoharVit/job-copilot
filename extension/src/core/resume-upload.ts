// Resume attachment is invoked only by the existing explicit Autofill action.
// Hidden native file inputs are supported; unrelated/ambiguous uploads are not.
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type SavedResume = { configured: false } | {
  configured: true; filename: string; mime_type: string; size: number;
  sha256: string; content_base64: string;
};
export interface ResumeTarget {
  state: 'none' | 'ambiguous' | 'ready';
  field?: HTMLInputElement; url?: string; context?: string; accept?: string;
}
export interface ResumeResult { status: string; attached: number; message: string }
const attempted = new WeakMap<HTMLInputElement, string>();
const positive = /\b(?:resume|cv|curriculum vitae)\b/i;
const negative = /\b(?:cover\s*letter|portfolio|transcript|certificate|certification|supporting|additional|photo|photograph|headshot|picture|passport|identity)\b/i;
const acceptedTypes = (field: HTMLInputElement) => field.getAttribute('accept') ?? field.accept ?? '';
const clean = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

function context(field: HTMLInputElement): string {
  const doc = field.ownerDocument;
  const parts = [field.name, field.id, field.getAttribute('aria-label') || '', field.getAttribute('data-automation-id') || ''];
  for (const id of (field.getAttribute('aria-labelledby') || '').split(/\s+/)) {
    if (id) parts.push(doc.getElementById(id)?.textContent || '');
  }
  const labels = new Set(Array.from(field.labels || []));
  if (field.id) for (const label of doc.querySelectorAll<HTMLLabelElement>('label[for]')) {
    if (label.getAttribute('for') === field.id) labels.add(label);
  }
  for (const label of labels) parts.push(label.textContent || '');
  // Some ATS inputs have no native label. Inspect only a small, isolated upload
  // wrapper; never borrow Resume text from another upload or the whole form.
  for (let parent = field.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
    if (parent.matches('form, body, main') || parent.querySelectorAll('input[type="file"]').length !== 1) break;
    if (parent.querySelectorAll('input:not([type="file"]):not([type="hidden"]), select, textarea').length) break;
    parts.push(parent.getAttribute('data-automation-id') || '', parent.id);
    const text = parent.textContent || '';
    if (text.length <= 500) parts.push(text);
  }
  return clean(parts.join(' ')).slice(0, 3000);
}

export function captureResumeTarget(doc: Document): ResumeTarget {
  const candidates = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(field => {
    if (!field.isConnected || field.disabled || field.getAttribute('aria-disabled') === 'true') return false;
    if (field.parentElement?.closest('[hidden], [aria-hidden="true"]')) return false;
    const label = context(field);
    return positive.test(label) && !negative.test(label);
  });
  if (!candidates.length) return { state: 'none' };
  if (candidates.length !== 1) return { state: 'ambiguous' };
  const field = candidates[0]!;
  return { state: 'ready', field, url: doc.URL, context: context(field), accept: acceptedTypes(field) };
}

export function acceptsResume(accept: string, filename: string, mime: string): boolean {
  if (!accept.trim()) return true;
  return accept.toLowerCase().split(',').map(token => token.trim()).some(token =>
    token === '*/*' || token === mime || (token.startsWith('.') && filename.toLowerCase().endsWith(token))
      || (token.endsWith('/*') && mime.startsWith(token.slice(0, -1))));
}

export async function attachSavedResume(target: ResumeTarget, load: () => Promise<SavedResume>, env = globalThis): Promise<ResumeResult> {
  const result = (status: string, message: string, attached = 0) => ({ status, message, attached });
  if (target.state === 'none') return result('no_target', '');
  if (target.state === 'ambiguous') return result('ambiguous', 'Multiple resume fields found; attach the resume manually.');
  const field = target.field!;
  const unchanged = () => field.isConnected && !field.disabled && field.type === 'file'
    && field.ownerDocument.URL === target.url && context(field) === target.context && acceptedTypes(field) === target.accept;
  if (!unchanged()) return result('stale', 'The resume field changed; click Autofill again on the current step.');
  if (field.files?.length || attempted.get(field) === target.url!) return result('already_attached', 'Resume already selected; kept the existing attachment.');
  if (typeof env.DataTransfer !== 'function' || typeof env.File !== 'function') return result('unsupported', 'Use the portal’s Attach button to select your resume.');
  try {
    const saved = await load();
    if (!saved.configured) return result('not_configured', 'No resume saved. Open Dashboard → Profile → Resume for Autofill.');
    if (!unchanged() || field.files?.length) return result('stale', 'The resume field changed; your current selection was preserved.');
    if (!acceptsResume(acceptedTypes(field), saved.filename, saved.mime_type)) return result('incompatible', 'The portal does not accept the saved resume format; attach a compatible file manually.');
    if (!saved.filename || /[\\/\x00-\x1f]/.test(saved.filename) || saved.size <= 0 || saved.size > MAX_RESUME_BYTES
        || !['application/pdf', DOCX].includes(saved.mime_type) || !/^[a-f0-9]{64}$/.test(saved.sha256)
        || typeof saved.content_base64 !== 'string' || saved.content_base64.length > 4 * Math.ceil(MAX_RESUME_BYTES / 3)) {
      return result('failed', 'The saved resume is invalid. Replace it in the dashboard.');
    }
    const binary = env.atob(saved.content_base64);
    if (binary.length !== saved.size) return result('failed', 'The saved resume size is invalid. Replace it in the dashboard.');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const file = new env.File([bytes], saved.filename, { type: saved.mime_type });
    const transfer = new env.DataTransfer();
    transfer.items.add(file);
    field.files = transfer.files;
    const attached = field.files?.[0];
    if (field.files?.length !== 1 || !attached || attached.name !== file.name || attached.size !== file.size) {
      return result('failed', 'The portal did not accept the resume attachment; use its Attach button.');
    }
    attempted.set(field, target.url!);
    field.dispatchEvent(new env.Event('input', { bubbles: true }));
    field.dispatchEvent(new env.Event('change', { bubbles: true }));
    // The portal owns its upload request. Do not click Next/Submit or claim that
    // its server accepted the document merely because FileList was populated.
    return result('attached', 'Resume attachment started. Check the portal’s upload confirmation.', 1);
  } catch (error) {
    return result('failed', error instanceof Error ? error.message : 'Could not attach the resume; use the portal’s Attach button.');
  }
}
