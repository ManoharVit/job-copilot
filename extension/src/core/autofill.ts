import { isRadio, radioLabel, radioMembers, hasVisibleRadioLabel, captureRadioGroup, radioGroupUnchanged } from './radio';
import { getAdapterFieldDegreePreference } from '../adapters';
import { setNativeValue } from './dom';
import { getFieldContext } from './fields';
import { isInputField, isSelectField } from '../shared/messages';
import type { EditableField, FieldMapping, AutofillCounts } from '../shared/messages';

export function canEdit(field: EditableField): boolean {
  if (field.disabled || ('readOnly' in field && field.readOnly)) return false;
  if (isInputField(field) && ['hidden', 'file', 'submit', 'button', 'image', 'reset', 'password'].includes(field.type)) return false;
  if (field.closest('[hidden], [aria-hidden="true"]')) return false;
  if (isRadio(field) && hasVisibleRadioLabel(field)) return true;
  if (typeof field.getClientRects === 'function' && field.getClientRects().length === 0) return false;
  const style = field.ownerDocument.defaultView?.getComputedStyle?.(field);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
}

export function captureTarget(element: EditableField) {
  return { element, value: element.value, checked: isInputField(element) ? element.checked : undefined,
    name: element.name, id: element.id, type: element.type, context: getFieldContext(element),
    radioGroup: isRadio(element) ? captureRadioGroup(element) : undefined,
    url: element.ownerDocument.URL, degreePreference: getAdapterFieldDegreePreference(element) };
}
export type FieldTarget = ReturnType<typeof captureTarget>;

export function targetUnchanged(snapshot: FieldTarget): boolean {
  const field = snapshot.element;
  return field.isConnected && canEdit(field) && field.ownerDocument.URL === snapshot.url
    && field.name === snapshot.name && field.id === snapshot.id && field.type === snapshot.type
    && getFieldContext(field) === snapshot.context && field.value === snapshot.value
    && getAdapterFieldDegreePreference(field) === snapshot.degreePreference
    && (!isInputField(field) || field.checked === snapshot.checked)
    && (!isRadio(field) || Boolean(snapshot.radioGroup && radioGroupUnchanged(field, snapshot.radioGroup)));
}

export function applyMapping(mapping: FieldMapping, targets: ReadonlyMap<number, FieldTarget>): AutofillCounts {
  const counts = { filledCount: 0, alreadyCorrectCount: 0, skippedCount: 0, failedCount: 0 };
  // Iterate captured targets, never construct selectors from untrusted response keys.
  for (const [index, snapshot] of targets) {
    const value = mapping[String(index)];
    if (value == null || value === '') { counts.skippedCount++; continue; }
    const field = snapshot.element;
    // A rescan, step change, user edit or detached field invalidates this mapping.
    if (!targetUnchanged(snapshot)) {
      counts.skippedCount++; continue;
    }
    const target = String(value);
    if (isSelectField(field)) {
      const selected = field.options[field.selectedIndex];
      if (selected && [selected.value, selected.text].some(text => text.toLowerCase() === target.toLowerCase())) {
        counts.alreadyCorrectCount++; continue;
      }
      if (selected?.value && !/^select\b|^choose\b/i.test(selected.text)) { counts.skippedCount++; continue; }
      const match = Array.from(field.options).find(option => !option.disabled
        && [option.value, option.text].some(text => text.toLowerCase() === target.toLowerCase()));
      if (!match) { counts.skippedCount++; continue; }
      field.value = match.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      if (field.value === match.value) counts.filledCount++; else counts.failedCount++;
    } else if (isRadio(field)) {
      const group = radioMembers(field);
      const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
      // Visible option labels take precedence over opaque internal values.
      let matches = group.filter(member => normalize(radioLabel(member)) === normalize(target));
      if (!matches.length) matches = group.filter(member => normalize(member.value) === normalize(target));
      if (matches.length !== 1 || !canEdit(matches[0]!)) { counts.skippedCount++; continue; }
      const choice = matches[0]!;
      if (choice.checked) { counts.alreadyCorrectCount++; continue; }
      if (group.some(other => other.checked)) { counts.skippedCount++; continue; }
      choice.click();
      if (choice.checked) counts.filledCount++; else counts.failedCount++;
    } else if (isInputField(field) && field.type === 'checkbox') {
      if (!['yes', 'true', '1'].includes(target.toLowerCase())) { counts.skippedCount++; continue; }
      if (field.checked) { counts.alreadyCorrectCount++; continue; }
      // click performs activation and framework events; pre-setting checked toggles it back.
      field.click();
      if (field.checked) counts.filledCount++; else counts.failedCount++;
    } else {
      if (field.value === target) { counts.alreadyCorrectCount++; continue; }
      if (field.value.trim()) { counts.skippedCount++; continue; }
      const inserted = setNativeValue(field, target);
      if (inserted && field.value === inserted) counts.filledCount++; else counts.failedCount++;
    }
  }
  return counts;
}
