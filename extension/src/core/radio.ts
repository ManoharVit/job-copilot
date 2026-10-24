import { isInputField, type EditableField } from '../shared/messages';

export function isRadio(field: EditableField): field is HTMLInputElement {
  return isInputField(field) && field.type === 'radio';
}
function text(node: Element | null): string {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim();
}
function labelledBy(node: Element): string {
  return (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map(id => text(node.ownerDocument.getElementById(id))).filter(Boolean).join(' ');
}
export function radioLabels(field: HTMLInputElement): HTMLLabelElement[] {
  const labels = new Set(Array.from(field.labels || []));
  const parent = field.closest('label');
  if (parent) labels.add(parent);
  if (field.id) for (const label of (field.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLLabelElement>('label[for]')) {
    if (label.htmlFor === field.id || label.getAttribute('for') === field.id) labels.add(label);
  }
  return [...labels];
}
export function radioLabel(field: HTMLInputElement): string {
  return (field.getAttribute('aria-label') || labelledBy(field)
    || radioLabels(field).map(text).filter(Boolean).join(' ') || field.value || '').trim();
}
export function radioMembers(field: HTMLInputElement): HTMLInputElement[] {
  const root = field.getRootNode() as Document | ShadowRoot;
  if (field.name) return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter(other => other.name === field.name && other.form === field.form);
  // Unnamed radios are never one document-wide group.
  const group = field.closest('fieldset, [role="radiogroup"]');
  if (group && !group.querySelector('input:not([type="radio"]):not([type="hidden"]), select, textarea')) {
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (radios.every(other => !other.name)) return radios;
  }
  return [field];
}
export function radioQuestion(field: HTMLInputElement): string {
  const members = radioMembers(field);
  // Find the smallest container holding the entire group. Never borrow a
  // heading from a neighboring questionnaire item or the enclosing form.
  for (let node = field.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
    if (node.matches('form, body, html, main')) break;
    if (!members.every(member => node!.contains(member))) continue;
    const controls = Array.from(node.querySelectorAll<EditableField>('input:not([type="hidden"]), select, textarea'));
    if (controls.some(control => !members.includes(control as HTMLInputElement))) break;
    if (node.matches('label')) continue;
    const explicit = node.getAttribute('aria-label') || labelledBy(node);
    if (explicit) return explicit.slice(0, 800);
    const copy = node.cloneNode(true) as HTMLElement;
    const originals = [node, ...Array.from(node.querySelectorAll('*'))];
    const clones = [copy, ...Array.from(copy.querySelectorAll('*'))];
    const labels = new Set(members.flatMap(radioLabels));
    originals.forEach((element, index) => { if (labels.has(element as HTMLLabelElement)) clones[index]?.remove(); });
    copy.querySelectorAll('input, select, textarea, button, script, style, .jc-btn, .jc-ai-btn')
      .forEach(element => element.remove());
    const question = text(copy);
    if (question.length >= 3 && question.length <= 800) return question;
    const previous = node.previousElementSibling;
    if (previous && !previous.matches('input, select, textarea, label[for]')
      && !previous.querySelector('input, select, textarea')) {
      const question = text(previous);
      if (question.length >= 3 && question.length <= 800) return question;
    }
  }
  return '';
}
export function radioOptions(field: HTMLInputElement): string[] {
  return radioMembers(field).map(radioLabel).filter(Boolean);
}
function visible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
  }
  return true;
}
export function hasVisibleRadioLabel(field: HTMLInputElement): boolean {
  return radioLabels(field).some(visible);
}
export function captureRadioGroup(field: HTMLInputElement) {
  return radioMembers(field).map(element => ({ element, name: element.name, form: element.form,
    value: element.value, label: radioLabel(element), checked: element.checked, disabled: element.disabled }));
}
export function radioGroupUnchanged(field: HTMLInputElement, captured: ReturnType<typeof captureRadioGroup>): boolean {
  const current = captureRadioGroup(field);
  return current.length === captured.length && captured.every((before, index) => {
    const after = current[index]!;
    return before.element === after.element && before.name === after.name && before.form === after.form
      && before.value === after.value && before.label === after.label && before.checked === after.checked
      && before.disabled === after.disabled;
  });
}
