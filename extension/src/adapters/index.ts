import { genericAdapter, detectGenericPlatform } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { workdayAdapter } from './workday';
import { ashbyAdapter } from './ashby';
import { isSelectField } from '../shared/messages';
import type { EditableField } from '../shared/messages';
import type { ATSAdapter, DegreePreference } from './types';

const adapters: readonly ATSAdapter[] = [greenhouseAdapter, leverAdapter, workdayAdapter, ashbyAdapter];

export function resolveAdapter(url: URL, document: Document): ATSAdapter {
  // A provider owning this document takes precedence over unrelated iframe widgets.
  // Do not cache: SPA steps and employer pages can add/replace their ATS iframe.
  return adapters.find(adapter => adapter.matches(url, document))
    || adapters.find(adapter => adapter.hasEmbeddedATS?.(document))
    || genericAdapter;
}

export function hasEmbeddedATS(url: URL, document: Document): boolean {
  return Boolean(resolveAdapter(url, document).hasEmbeddedATS?.(document)
    || genericAdapter.hasEmbeddedATS(document));
}

export function detectJobDescription(url: URL, document: Document): string {
  return resolveAdapter(url, document).detectJobDescription?.(document)
    ?? genericAdapter.detectJobDescription(document)
    ?? '';
}

export function detectCompany(url: URL, document: Document): string {
  return resolveAdapter(url, document).detectCompany?.(document)
    ?? genericAdapter.detectCompany(document)
    ?? '';
}

export function detectPlatform(url: URL, document: Document): string {
  const adapter = resolveAdapter(url, document);
  return adapter === genericAdapter ? detectGenericPlatform(url) : adapter.name;
}

export function detectDegreePreference(url: URL, document: Document): DegreePreference {
  return resolveAdapter(url, document).detectDegreePreference?.(document)
    ?? genericAdapter.detectDegreePreference(document)
    ?? 'master';
}

export function getTextareaWrapper(url: URL, textarea: HTMLTextAreaElement): HTMLElement | null {
  const document = textarea.ownerDocument;
  return resolveAdapter(url, document).getTextareaWrapper?.(textarea)
    ?? genericAdapter.getTextareaWrapper(textarea);
}

export function getAdapterFieldContext(field: EditableField): string | null {
  const document = field.ownerDocument;
  if (!document?.URL) return null;
  return resolveAdapter(new URL(document.URL), document).getFieldContext?.(field) ?? null;
}

export function getFieldOptions(url: URL, field: EditableField): string[] {
  if (isSelectField(field)) return Array.from(field.options, option => option.text || option.textContent || '').filter(Boolean);
  return resolveAdapter(url, field.ownerDocument).getFieldOptions?.(field) ?? [];
}

export function getFieldDegreePreference(url: URL, field: EditableField): DegreePreference {
  return resolveAdapter(url, field.ownerDocument).getFieldDegreePreference?.(field)
    ?? detectDegreePreference(url, field.ownerDocument);
}

export function usesGenericAdapter(url: URL, document: Document): boolean {
  return resolveAdapter(url, document) === genericAdapter;
}

export function getAdapterFieldDegreePreference(field: EditableField): DegreePreference | null {
  const document = field.ownerDocument;
  if (!document?.URL) return null;
  return resolveAdapter(new URL(document.URL), document).getFieldDegreePreference?.(field) ?? null;
}
