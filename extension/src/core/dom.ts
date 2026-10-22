import type { EditableField } from '../shared/messages';

export function getFieldLimit(element: EditableField) {
    if ('maxLength' in element && element.maxLength && element.maxLength > 0 && element.maxLength < 50000) {
      return element.maxLength;
    }
    let parent = element.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      const text = parent.innerText || '';
      const match = text.match(/maximum\s*(\d+)\s*characters|(\d+)\s*characters?\s*allowed|\/\s*(\d{2,4})\b/i);
      if (match) {
        const limit = parseInt(match[1] || match[2] || match[3] || '', 10);
        if (limit > 20 && limit < 5000) return limit;
      }
      parent = parent.parentElement;
    }
    return null;
  }

export function setNativeValue(element: EditableField, value: string) {
    if (!element || value == null) return;

    const isNumericInput = element.tagName && element.tagName.toLowerCase() === 'input' &&
      element.type === 'number';
    if (isNumericInput && typeof value === 'string') {
      const match = value.match(/[-+]?\d*\.?\d+/);
      if (match) {
        value = match[0];
      }
    }

    // Only prose can be shortened. Truncating emails, phones or identifiers
    // silently corrupts profile data, so incompatible scalar fields stay empty.
    const maxLen = getFieldLimit(element);
    if (maxLen && value.length > maxLen && element.tagName.toLowerCase() !== 'textarea') return;
    if (maxLen && value.length > maxLen) {
      let truncated = value.substring(0, maxLen);
      const lastPeriod = truncated.lastIndexOf('. ');
      if (lastPeriod > maxLen * 0.4) {
        truncated = truncated.substring(0, lastPeriod + 1);
      } else {
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.6) {
          truncated = truncated.substring(0, lastSpace);
        }
      }
      value = truncated.trim();
    }

    try {
      const isTextArea = element.tagName.toLowerCase() === 'textarea';
      const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');

      // Reset React's internal value tracker so React's synthetic event system doesn't swallow the change
      const tracker = '_valueTracker' in element ? element._valueTracker : undefined;
      if (tracker) {
        tracker.setValue(element.value);
      }

      if (desc && desc.set) {
        desc.set.call(element, value);
      } else {
        element.value = value;
      }
    } catch(e) {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    const isAutocomplete = element.getAttribute('role') === 'combobox' ||
                           element.hasAttribute('aria-controls') || element.hasAttribute('aria-owns') ||
                           (element.classList && element.classList.contains('select__input')) ||
                           (element.id && (element.id === 'country' || element.id.includes('location'))) ||
                           ('placeholder' in element && /search|skill|select|country|location/i.test(element.placeholder));
    if (isAutocomplete) {
      try {
        element.focus();
        const control = element.closest('.select__control, [class*="control"]');
        if (control) control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } catch(e) {}
    } else {
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // For autocomplete inputs, if a suggestion dropdown appears shortly, select matching item
    if (isAutocomplete) setTimeout(() => {
      if (!element.isConnected || element.ownerDocument.activeElement !== element || element.value !== value) return;
      const controlledId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
      const dropdown = controlledId ? element.ownerDocument.getElementById(controlledId) : element.parentElement?.querySelector<HTMLElement>('.suggestions, .dropdown-menu, [class*="suggestion"], [class*="autocomplete"], [class*="autoSuggest"], [role="listbox"], [class*="searchList"], [class*="search-list"], [class*="dropdownList"], [class*="dropdown-list"], [class*="options-list"], [class*="select-options"], [class*="select__menu"], [class*="menu-list"]');
      if (dropdown && dropdown.offsetHeight > 0) {
        const items = Array.from(dropdown.querySelectorAll<HTMLElement>('li, div, [role="option"], [class*="item"], [class*="option"], a'));
        const valLower = value.toLowerCase();
        const matchItem = items.find(it => {
          const t = (it.innerText || '').toLowerCase();
          return t && t === valLower;
        });
        if (matchItem && !matchItem.innerText.toLowerCase().includes('no matching') && !matchItem.innerText.toLowerCase().includes('no skills')) {
          matchItem.click();
        }
      }
    }, 350);
    return value;
  }
