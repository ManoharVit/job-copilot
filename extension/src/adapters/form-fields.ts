import type { DegreePreference } from './types';
import { isInputField, type EditableField } from '../shared/messages';

function labelText(label: HTMLElement): string | null {
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('input, select, textarea, button, script, style, [role="listbox"], .jc-btn, .jc-toast')
    .forEach(node => node.remove());
  const text = (copy.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length >= 3 && text.length <= 800 ? text : null;
}

export function fieldLabel(field: EditableField, wrappers: string, labels: string): string | null {
  const document = field.ownerDocument;
  const aria = field.getAttribute('aria-label')?.trim();
  if (aria && aria.length >= 3 && aria.length <= 800) return aria;
  const ids = (field.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  const labelled = ids.map(id => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
  const explicit = labelled.map(labelText).filter(Boolean).join(' ');
  if (explicit && explicit.length <= 800) return explicit;
  // Native labels take precedence over provider wrappers and hints.
  for (const label of Array.from(field.labels || [])) {
    const text = labelText(label);
    if (text) return text;
  }
  const wrapper = field.closest<HTMLElement>(wrappers);
  if (!wrapper) return null;
  // A broad group must not donate a neighboring field's label.
  const controls = wrapper.querySelectorAll('input:not([type="hidden"]), select, textarea');
  if (controls.length !== 1 || controls[0] !== field) return null;
  for (const label of wrapper.querySelectorAll<HTMLElement>(labels)) {
    const linked = label.getAttribute('for');
    if (linked && linked !== field.id) continue;
    const text = labelText(label);
    if (text) return text;
  }
  return null;
}

function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
}

export function associatedOptions(field: EditableField): string[] {
  if (field.getAttribute('role') !== 'combobox') return [];
  // Both aria-controls and aria-owns may be present (composite combobox or portal popup).
  const rawIds = `${field.getAttribute('aria-controls') || ''} ${field.getAttribute('aria-owns') || ''}`;
  const ids = Array.from(new Set(rawIds.split(/\s+/).filter(Boolean)));
  const values = new Set<string>();
  for (const id of ids) {
    const list = field.ownerDocument.getElementById(id);
    if (!list || !visible(list)) continue;
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      if (!visible(option) || option.closest('[aria-disabled="true"], [disabled]')) continue;
      const text = (option.getAttribute('aria-label') || option.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 800) values.add(text);
      if (values.size === 500) return [...values];
    }
  }
  return [...values];
}

export function degreeFromText(text: string): DegreePreference | null {
  const master = /\b(?:master(?:'s|s)?|post[\s-]?grad(?:uate|uation)?)\b|\bm\.?s\.?(?:c\.?)?(?=\s|$)/i.test(text);
  const bachelor = /\b(?:bachelor(?:'s|s)?|under[\s-]?grad(?:uate|uation)?)\b|\bb\.?(?:tech|sc)\.?(?=\s|$)/i.test(text);
  return master === bachelor ? null : master ? 'master' : 'bachelor';
}

export function educationPreference(field: EditableField, groups: string): DegreePreference | null {
  const group = field.closest<HTMLElement>(groups);
  if (!group) return null;
  // If matched group is a generic fieldset without explicit education level or class, verify education context
  if (group.tagName === 'FIELDSET' && !group.hasAttribute('data-education-level') && !/education/i.test(group.className || '') && !/education/i.test(group.id || '')) {
    const legend = group.querySelector('legend');
    if (legend && !/education|academic|degree|qualification|school|university|college/i.test(legend.textContent || '')) {
      return null;
    }
  }
  const explicit = group.getAttribute('data-education-level');
  if (explicit === 'master' || explicit === 'bachelor') return explicit;
  const heading = group.querySelector<HTMLElement>('legend, [data-automation-id="educationSectionTitle"], h2, h3, h4');
  const preference = degreeFromText(heading?.textContent || '');
  if (preference) return preference;
  // A candidate's existing degree selection is local to this education entry.
  for (const control of group.querySelectorAll<EditableField>('input, select')) {
    if (isInputField(control) && (control.type === 'radio' || control.type === 'checkbox') && !control.checked) continue;
    const hint = `${control.name} ${control.id} ${control.getAttribute('aria-label') || ''}`;
    if (!/degree|qualification/i.test(hint)) continue;
    const label = (isInputField(control) && (control.labels?.[0]?.textContent || control.closest('label')?.textContent)) || '';
    const value = control.tagName === 'SELECT'
      ? (control as HTMLSelectElement).selectedOptions?.[0]?.textContent || control.value : control.value;
    const level = degreeFromText(value || '') || degreeFromText(label);
    if (level) return level;
  }
  return null;
}
