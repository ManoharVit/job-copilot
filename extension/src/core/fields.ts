import { isRadio, radioQuestion } from './radio';
import { getAdapterFieldContext } from '../adapters';
import type { EditableField } from '../shared/messages';

export function cleanQuestionText(text: string | null | undefined) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ').substring(0, 800);
  }

export function isBoilerplateText(text: string | null | undefined) {
    if (!text) return true;
    const clean = text.trim();
    if (clean.length < 2) return true;
    // Pure punctuation/symbols (e.g. "*", "*:", "-")
    if (!/[a-zA-Z0-9]/.test(clean)) return true;
    const lower = clean.toLowerCase();
    const stripped = lower.replace(/[^a-z0-9]/g, '');
    const boilerplateWords = [
      'required', 'optional', 'requiredfield', 'optionalfield',
      'generate', 'writing', 'autofill', 'submit', 'save', 'cancel',
      'clear', 'upload', 'attach', 'browse', 'characters', 'charactersremaining',
      'charactersleft', 'maxcharacters', 'charlimit'
    ];
    if (boilerplateWords.includes(stripped)) return true;
    // Character counters / limit expressions: "0 / 500", "max 250 words", "characters remaining: 500", "(required)"
    if (/^(characters?(\s*remaining|\s*left)?|max(\s*characters|\s*words)?|\d+\s*\/\s*\d+.*|\d+\s*(words?|characters?)\s*(max|remaining|left)?)$/i.test(clean)) {
      return true;
    }
    return false;
  }

export function isValidQuestionText(text: string | null | undefined) {
    if (!text) return false;
    const clean = text.trim();
    if (clean.length < 3 || clean.length > 800) return false;
    if (isBoilerplateText(clean)) return false;
    return true;
  }

export function getQuestionForTextarea(ta: HTMLTextAreaElement | null) {
    if (!ta) return '';
    const document = ta.ownerDocument || globalThis.document;
    const adapterLabel = getAdapterFieldContext(ta);
    if (adapterLabel) return cleanQuestionText(adapterLabel);

    // 1. Direct explicit attributes
    // 1a. aria-label
    const ariaLabel = ta.getAttribute('aria-label');
    if (ariaLabel && isValidQuestionText(ariaLabel)) {
      return cleanQuestionText(ariaLabel);
    }

    // 1b. aria-labelledby
    const labelledBy = ta.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/);
      const parts = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el !== ta) {
          const t = el.innerText?.trim();
          if (t && !isBoilerplateText(t)) parts.push(t);
        }
      }
      const combined = parts.join(' ');
      if (isValidQuestionText(combined)) {
        return cleanQuestionText(combined);
      }
    }

    // 1c. label[for="id"]
    if (ta.id) {
      try {
        const labelElem = document.querySelector<HTMLElement>(`label[for="${CSS.escape(ta.id)}"]`);
        if (labelElem && labelElem !== ta) {
          const text = labelElem.innerText?.trim();
          if (isValidQuestionText(text)) {
            return cleanQuestionText(text);
          }
        }
      } catch(e) {}
    }

    // 1d. Wrapped in a <label>
    const parentLabel = ta.closest('label');
    if (parentLabel) {
      try {
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const toRemove = clone.querySelectorAll<HTMLElement>('textarea, input, select, button, .jc-btn, .jc-ai-btn');
        for (let i = 0; i < toRemove.length; i++) {
          toRemove[i]?.remove();
        }
        const text = (clone.innerText || clone.textContent)?.trim();
        if (isValidQuestionText(text)) {
          return cleanQuestionText(text);
        }
      } catch(e) {
        const text = parentLabel.innerText?.trim();
        if (isValidQuestionText(text)) {
          return cleanQuestionText(text);
        }
      }
    }

    // 2. Preceding siblings of ta (immediate heading/label/paragraph/question)
    // Walk backwards through preceding siblings of ta; stop if encountering another field.
    let sib = ta.previousElementSibling;
    const precedingSibTexts = [];
    while (sib) {
      if (sib.classList && (sib.classList.contains('jc-btn') || sib.classList.contains('jc-ai-btn'))) {
        sib = sib.previousElementSibling;
        continue;
      }
      // Stop immediately if sib is or contains another textarea or interactive input!
      if (sib.matches?.('input:not([type="hidden"]), select, textarea') || sib.querySelector?.('input:not([type="hidden"]), select, textarea')) {
        break;
      }
      const clone = sib.cloneNode(true) as HTMLElement;
      const toRemove = clone.querySelectorAll<HTMLElement>('button, .jc-btn, .jc-ai-btn, script, style, noscript');
      toRemove.forEach(el => el.remove());
      const text = (clone.innerText || clone.textContent)?.trim();
      if (text && !isBoilerplateText(text)) {
        precedingSibTexts.unshift(text);
      }
      sib = sib.previousElementSibling;
    }
    if (precedingSibTexts.length > 0) {
      const combined = precedingSibTexts.join(' ');
      if (isValidQuestionText(combined)) {
        return cleanQuestionText(combined);
      }
    }

    // 3. Search strictly upward within the immediate field container
    // Stop climbing if a parent groups multiple textareas or broad form controls
    let curr = ta.parentElement;
    for (let depth = 0; depth < 5 && curr && curr !== document.body && curr !== document.documentElement; depth++) {
      const tag = curr.tagName.toLowerCase();
      // Form / section / document root boundary: never cross!
      if (['form', 'main', 'body', 'html', 'section', 'fieldset'].includes(tag)) {
        break;
      }

      // If curr contains other textareas, it is a multi-question group/form. Stop immediately!
      const textareasInCurr = curr.querySelectorAll<HTMLElement>('textarea');
      if (textareasInCurr.length > 1) {
        break;
      }

      // Stop if container holds other interactive inputs (e.g. radio groups from another section)
      const inputsInCurr = curr.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select');
      if (inputsInCurr.length > 0) {
        break;
      }

      // 3a. Check preceding siblings of curr (e.g. <label> or <div class="header"> followed by <div class="input-wrapper"><textarea/></div>)
      let parentSib = curr.previousElementSibling;
      const parentSibTexts = [];
      while (parentSib) {
        if (parentSib.classList && (parentSib.classList.contains('jc-btn') || parentSib.classList.contains('jc-ai-btn'))) {
          parentSib = parentSib.previousElementSibling;
          continue;
        }
        // If parentSib contains a textarea or interactive input, stop immediately!
        if (parentSib.matches?.('input:not([type="hidden"]), select, textarea') || parentSib.querySelector?.('input:not([type="hidden"]), select, textarea')) {
          break;
        }
        const clone = parentSib.cloneNode(true) as HTMLElement;
        const toRemove = clone.querySelectorAll<HTMLElement>('button, .jc-btn, .jc-ai-btn, script, style, noscript');
        toRemove.forEach(el => el.remove());
        const text = (clone.innerText || clone.textContent)?.trim();
        if (text && !isBoilerplateText(text)) {
          parentSibTexts.unshift(text);
        }
        parentSib = parentSib.previousElementSibling;
      }
      if (parentSibTexts.length > 0) {
        const combined = parentSibTexts.join(' ');
        if (isValidQuestionText(combined)) {
          return cleanQuestionText(combined);
        }
      }

      // 3b. Look inside curr for explicit heading/label elements that strictly PRECEDE ta in DOM order
      const headings = Array.from(curr.querySelectorAll<HTMLElement>('label, legend, h1, h2, h3, h4, h5, h6, [class*="label"], [class*="question"], [class*="title"], [class*="header"], [class*="prompt"]'));
      const precedingHeadings = headings.filter(el => {
        if (el === ta || el.contains(ta)) return false;
        if (!el.compareDocumentPosition) return false;
        const pos = el.compareDocumentPosition(ta);
        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });

      for (const h of precedingHeadings) {
        const text = h.innerText?.trim();
        if (isValidQuestionText(text) && text.length >= 20) {
          return cleanQuestionText(text);
        }
      }

      // 3c. Extract all leading text inside curr before ta
      try {
        const clone = curr.cloneNode(true) as HTMLElement;
        const toRemove = clone.querySelectorAll<HTMLElement>('button, .jc-btn, .jc-ai-btn, script, style, noscript');
        toRemove.forEach(el => el.remove());

        // Find ta in clone and truncate any following siblings
        const cloneTas = Array.from(clone.querySelectorAll<HTMLElement>('textarea'));
        const cloneTa = cloneTas[0];
        if (cloneTas.length === 1 && cloneTa) {
          let next = cloneTa.nextSibling;
          while (next) {
            const toDel = next;
            next = next.nextSibling;
            toDel.remove();
          }
          cloneTa.remove();
        }

        const cloneText = (clone.innerText || clone.textContent)?.trim();
        if (isValidQuestionText(cloneText)) {
          return cleanQuestionText(cloneText);
        }
      } catch(e) {}

      curr = curr.parentElement;
    }

    // 4. Fallback to placeholder, name, or title
    if (ta.placeholder && isValidQuestionText(ta.placeholder)) {
      return cleanQuestionText(ta.placeholder);
    }
    if (ta.name && ta.name.trim().length > 2) {
      return cleanQuestionText(ta.name.replace(/[_\-]/g, ' '));
    }
    if (ta.title && isValidQuestionText(ta.title)) {
      return cleanQuestionText(ta.title);
    }

    return '';
  }

export function getFieldContext(field: EditableField | null) {
    if (!field) return '';
    if (isRadio(field)) return radioQuestion(field);
    const document = field.ownerDocument || globalThis.document;
    const adapterLabel = getAdapterFieldContext(field);
    if (adapterLabel) return cleanQuestionText(adapterLabel);
    if (field.tagName && field.tagName.toLowerCase() === 'textarea') {
      return getQuestionForTextarea(field as HTMLTextAreaElement);
    }

    let label = '';

    // 1. Check if wrapped in a <label>
    const parentLabel = field.closest('label');
    if (parentLabel) {
      label = parentLabel.innerText;
    }

    // 2. Check label[for] pointing to this field
    if (!label && field.id) {
      try {
        const labelElem = document.querySelector<HTMLElement>(`label[for="${CSS.escape(field.id)}"]`);
        if (labelElem) label = labelElem.innerText;
      } catch(e) {}
    }

    // 3. aria-label
    if (!label && field.getAttribute('aria-label')) {
      label = field.getAttribute('aria-label') || '';
    }

    // 3b. aria-labelledby
    if (!label && field.getAttribute('aria-labelledby')) {
      const ids = (field.getAttribute('aria-labelledby') || '').split(/\s+/);
      const parts = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el !== field) {
          const t = el.innerText?.trim();
          if (t && !isBoilerplateText(t)) parts.push(t);
        }
      }
      if (parts.length > 0) label = parts.join(' ');
    }

    // 4. Look for text in preceding sibling elements (strictly within the same container)
    if (!label) {
      let el = field.previousElementSibling;
      while (el) {
        if (el.classList && (el.classList.contains('jc-btn') || el.classList.contains('jc-ai-btn'))) {
          el = el.previousElementSibling;
          continue;
        }
        if (el.matches?.('input:not([type="hidden"]), select, textarea') || el.querySelector?.('input:not([type="hidden"]), select, textarea')) {
          break;
        }
        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length > 2 && text.length < 500 && !isBoilerplateText(text)) {
          label = text;
          break;
        }
        el = el.previousElementSibling;
      }
    }

    // 5. Check immediate parent container (strictly staying inside field container)
    if (!label) {
      let parent = field.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        const tag = parent.tagName.toLowerCase();
        if (['form', 'main', 'body', 'html', 'section', 'fieldset'].includes(tag)) break;
        const inputsInParent = parent.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea');
        if (inputsInParent.length > 1) break;

        let pSib = parent.previousElementSibling;
        while (pSib) {
          if (pSib.classList && (pSib.classList.contains('jc-btn') || pSib.classList.contains('jc-ai-btn'))) {
            pSib = pSib.previousElementSibling;
            continue;
          }
          if (pSib.matches?.('input:not([type="hidden"]), select, textarea') || pSib.querySelector?.('input:not([type="hidden"]), select, textarea')) {
            break;
          }
          const text = (pSib as HTMLElement).innerText?.trim();
          if (text && text.length > 2 && text.length < 500 && !isBoilerplateText(text)) {
            label = text;
            break;
          }
          pSib = pSib.previousElementSibling;
        }
        if (label) break;

        parent = parent.parentElement;
      }
    }

    // 6. placeholder
    if (!label && 'placeholder' in field && field.placeholder) {
      label = field.placeholder;
    }

    // 7. name attribute
    if (!label && field.name) {
      label = field.name.replace(/[_\-]/g, ' ');
    }

    // 8. title attribute
    if (!label && field.title) {
      label = field.title;
    }

    return label ? label.trim().replace(/\n/g, ' ').substring(0, 500) : '';
  }
