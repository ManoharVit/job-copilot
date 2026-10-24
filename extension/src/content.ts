import {
  detectJobDescription as detectATSJobDescription,
  hasEmbeddedATS as detectEmbeddedATS,
  detectPlatform as detectATSPlatform,
  detectCompany as detectATSCompany,
  detectDegreePreference as detectATSDegreePreference,
  getTextareaWrapper, getFieldOptions, getFieldDegreePreference, usesGenericAdapter,
} from './adapters';
import { attachSavedResume, captureResumeTarget } from './core/resume-upload';
import type { SavedResume } from './core/resume-upload';
import { autofillFailureMessage } from './core/site-access';
import { isRadio, radioMembers } from './core/radio';
import { canEdit, captureTarget, targetUnchanged, applyMapping } from './core/autofill';
import type { FieldTarget } from './core/autofill';
import { getFieldLimit, setNativeValue } from './core/dom';
import { getQuestionForTextarea, getFieldContext } from './core/fields';
import { API_URL, requiresManualAnswer } from './shared/messages';
import type { ApiResponse, AutofillCounts, AutofillResponse, DetectedField, EditableField, FieldMapping, GeneratedAnswer, ProfileSummary, ToastType, CopilotMessage } from './shared/messages';

// Form controller: shared lifecycle with per-document ATS adapters.

export function startContentScript() {
  if (window.__jobCopilotLoaded) return;
  window.__jobCopilotLoaded = true;

  let formFields: DetectedField[] = [];
  const ensuredFrames = new WeakMap<HTMLIFrameElement, string>();
  const aiButtons = new Map<HTMLTextAreaElement, HTMLButtonElement>();
  let autofillPromise: Promise<AutofillCounts | undefined> | null = null;

  function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchAPI',
        url: `${API_URL}${endpoint}`,
        options: {
          headers: { 'Content-Type': 'application/json' },
          ...options
        }
      }, (response: ApiResponse<T> | undefined) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.success) {
          return reject(new Error(response?.error || 'Request failed'));
        }
        resolve(response.data);
      });
    });
  }

  function debounce(func: () => void, wait: number) {
    let timeout: ReturnType<typeof setTimeout>;
    return function executedFunction() {
      const later = () => {
        clearTimeout(timeout);
        func();
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function getJobDescription() {
    return detectATSJobDescription(new URL(window.location.href), document);
  }

  function detectFields() {
    const inputs = Array.from(document.querySelectorAll<EditableField>('input, select, textarea'));
    const skipTypes = ['hidden', 'file', 'submit', 'button', 'image', 'reset', 'password'];

    formFields = inputs.filter(input => {
      if (!canEdit(input)) return false;
      // One request per question, carrying every option label in its group.
      if (isRadio(input) && radioMembers(input).find(canEdit) !== input) return false;
      const tag = input.tagName.toLowerCase();
      if (tag === 'input' && skipTypes.includes(input.type.toLowerCase())) {
        return false;
      }
      if (input.disabled || ('readOnly' in input && input.readOnly)) return false;
      if (input.hasAttribute('aria-hidden') && input.getAttribute('aria-hidden') === 'true') return false;
      if (tag === 'textarea') {
        if (input.offsetHeight === 0 && input.offsetWidth === 0 && input.offsetParent === null) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(input) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        if (style && style.position === 'absolute' && (input.offsetHeight === 0 || style.height === '0px')) return false;
      }
      return true;
    }).map((field, index) => {
      field.setAttribute('data-jc-index', String(index));
      return {
        index,
        tagName: field.tagName.toLowerCase(),
        type: field.type || '',
        name: field.name || '',
        id: field.id || '',
        maxLength: ('maxLength' in field && field.maxLength > 0) ? field.maxLength : null,
        context: getFieldContext(field)
      };
    });

    return formFields;
  }

  function triggerAutofill() {
    const btn = document.getElementById('jc-autofill-btn');
    if (btn) btn.innerHTML = 'Filling...';
    const finish = async (response: AutofillResponse | undefined) => {
      try {
        if (chrome.runtime.lastError || !response?.success) {
          if (response?.reason === 'autofill_failed' || response?.frameIssues?.some(issue => issue.code === 'site_access_required')) showNotification(autofillFailureMessage(response), true);
          else if (detectFields().length > 0) await handleAutofill();
          else showNotification(autofillFailureMessage(response), true);
        }
      } catch (error) {
        console.error('Job Copilot autofill failed', error);
        showNotification('Autofill failed — reload this page and check backend status', true);
      } finally {
        if (btn) btn.innerHTML = 'Autofill';
      }
    };

    // The background worker is the single dispatch path, including this frame.
    try {
      chrome.runtime.sendMessage({ action: 'broadcastAutofill' }, finish);
    } catch (err) {
      return finish({ success: false });
    }
  }

  function hasEmbeddedATS() {
    return detectEmbeddedATS(new URL(window.location.href), document);
  }

  function injectButton() {
    // If top window detects an embedded ATS or iframes, ensure scripts are injected across all frames
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
    // Full-page mutation/scroll rescans must not request reinjection repeatedly.
    const newFrame = frames.some(frame => ensuredFrames.get(frame) !== frame.src);
    if (window.self === window.top && newFrame) {
      frames.forEach(frame => ensuredFrames.set(frame, frame.src));
      try {
        chrome.runtime.sendMessage({ action: 'ensureInjected' }, () => {
          if (chrome.runtime.lastError) {}
        });
      } catch(e) {}
    }

    const shouldInjectFloating = (formFields.length > 0) || captureResumeTarget(document).state !== 'none' || (window.self === window.top && hasEmbeddedATS());

    if (!document.getElementById('jc-autofill-btn') && shouldInjectFloating) {
      const btn = document.createElement('button');
      btn.id = 'jc-autofill-btn';
      btn.className = 'jc-btn jc-floating-btn';
      if (window.self !== window.top) {
        btn.classList.add('jc-iframe-floating-btn');
      }
      btn.innerHTML = 'Autofill';
      btn.addEventListener('click', (e) => {
        // The host page can find these DOM buttons and call click() itself.
        if (!e.isTrusted) return;
        e.preventDefault();
        triggerAutofill();
      });
      document.body.appendChild(btn);
    }

    injectAIButtons();
  }

  function injectAIButtons() {
    // SPA steps may remove a textarea while leaving its sibling button behind.
    for (const [textarea, button] of aiButtons) {
      if (!textarea.isConnected || !button.isConnected || textarea.disabled || textarea.readOnly) {
        button.remove();
        aiButtons.delete(textarea);
      }
    }
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    textareas.forEach(ta => {
      // 1. Skip hidden, invisible, or disabled/readOnly textareas
      if (ta.disabled || ta.readOnly) return;
      if (ta.hasAttribute('aria-hidden') && ta.getAttribute('aria-hidden') === 'true') return;
      if (ta.getAttribute('tabindex') === '-1' && ta.hasAttribute('aria-hidden')) return;

      const style = window.getComputedStyle ? window.getComputedStyle(ta) : null;
      if (style) {
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        if (style.position === 'absolute' && (style.height === '0px' || (style.top && style.top.startsWith('-')))) return;
      }

      // Associate each button with its exact textarea, even in flat forms.
      if (aiButtons.has(ta)) return;
      const wrapper = getTextareaWrapper(new URL(window.location.href), ta);

      const context = getQuestionForTextarea(ta);
      if (requiresManualAnswer(context)) return;
      if (!context && ta.offsetHeight < 40) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jc-btn jc-ai-btn';
      btn.innerHTML = 'Generate';
      btn.title = 'AI-generate a tailored answer';

      btn.addEventListener('click', async (e) => {
        if (!e.isTrusted) return;
        e.preventDefault();
        e.stopPropagation();
        btn.innerHTML = 'Writing...';
        btn.disabled = true;

        // Ensure we target this specific textarea
        const targetTa = ta.isConnected ? ta : (btn.previousElementSibling?.tagName === 'TEXTAREA' ? btn.previousElementSibling as HTMLTextAreaElement : ta);

        try {
          const dynamicQuestion = getQuestionForTextarea(targetTa);
          const rawContext = dynamicQuestion || context || targetTa.placeholder || targetTa.getAttribute('aria-label') || '';

          if (requiresManualAnswer(rawContext)) {
            showNotification('Eligibility and consent questions require a manual answer', 'info');
            return;
          }
          if (!rawContext) {
            showNotification('Could not detect question for this field', true);
            btn.innerHTML = 'Generate';
            btn.disabled = false;
            return;
          }

          const jd = getJobDescription();
          const maxLen = getFieldLimit(targetTa);

          const isCoverLetter = /cover.?letter/i.test(rawContext);
          const isSummary = /summary|about.?you|headline|profile/i.test(rawContext);

          let endpoint: string, body: { question?: string; job_description: string };
          if (isCoverLetter) {
            endpoint = '/api/generate-cover-letter';
            body = { job_description: jd };
          } else if (isSummary) {
            endpoint = '/api/generate-answer';
            const limitText = maxLen ? ` in under ${maxLen - 25} characters` : '';
            body = {
              question: `Write a concise 2-sentence professional profile summary highlighting my core skills and experience${limitText}.`,
              job_description: jd
            };
          } else {
            endpoint = '/api/generate-answer';
            body = { question: rawContext, job_description: jd };
          }

          const answerTarget = captureTarget(targetTa);
          const data = await fetchAPI<GeneratedAnswer>(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
          });

          const text = data.cover_letter || data.answer || '';

          if (text && !text.startsWith('[Error')) {
            if (!targetUnchanged(answerTarget)) {
              showNotification('Form changed while generating — review the current question and generate again', 'info');
              return;
            }
            setNativeValue(targetTa, text);
            showNotification('AI answer generated — review before submitting');
          } else {
            showNotification('AI generation failed — check GEMINI_API_KEY in .env', true);
          }
        } catch(err) {
          showNotification('AI generation failed — check backend status', true);
        } finally {
          btn.innerHTML = 'Generate';
          btn.disabled = false;
        }
      });

      let insertTarget: HTMLElement = ta;
      if (wrapper && wrapper.parentElement && wrapper.querySelectorAll<HTMLTextAreaElement>('textarea').length <= 1) {
        insertTarget = wrapper;
      }
      insertTarget.insertAdjacentElement('afterend', btn);
      aiButtons.set(ta, btn);
    });
  }

  function showNotification(message: string, type: ToastType = false) {
    const toast = document.createElement('div');
    const typeClass = (type === true || type === 'error') ? 'jc-error' : (type === 'info' ? 'jc-info' : 'jc-success');
    toast.className = `jc-toast ${typeClass}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('jc-fade-out');
      setTimeout(() => toast.remove(), 500);
    }, 3000);

    // Use extension messaging; page postMessage events are not authenticated.
    if (window.self !== window.top) {
      try {
        chrome.runtime.sendMessage({
          action: 'relayToast',
          message: message,
          toastType: type
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      } catch(e) {}
    }
  }

  async function handleSkillsModal() {
    const modals = Array.from(document.querySelectorAll<HTMLElement>('div, section, [role="dialog"]'));
    const modal = modals.find(el => {
      const text = (el.innerText || '').substring(0, 500);
      return el.offsetHeight > 150 &&
             el.offsetWidth > 250 &&
             (text.includes('Add Skills') || text.includes('minimum 3 skills') || text.includes('Already added'));
    });
    if (!modal) return false;

    const skillInput = modal.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (!skillInput) return false;

    let profile;
    try {
      profile = await fetchAPI<ProfileSummary>('/api/profile');
    } catch(e) {
      return false;
    }

    let skills: string[] = [];
    try {
      skills = typeof profile.skills === 'string' ? JSON.parse(profile.skills) : (profile.skills || []);
    } catch(e) {
      skills = [];
    }

    if (!skills || skills.length === 0) {
      showNotification('No skills configured in profile', 'info');
      return true;
    }

    // Extract already added skills from chips/tags and modal text
    const modalText = (modal.innerText || '').toLowerCase();
    const existingTags = Array.from(modal.querySelectorAll<HTMLElement>('div, span, button, li')).filter(el => {
      const t = el.innerText?.trim() || '';
      return (t.includes('×') || el.querySelector<HTMLElement>('svg')) && t.length < 35 && el.offsetHeight < 50;
    }).map(el => el.innerText.replace(/[×\n\r]/g, '').trim().toLowerCase());

    const unaddedSkills = skills.filter(s => {
      const sLower = s.toLowerCase();
      const inTags = existingTags.some(t => t.includes(sLower));
      const inModal = modalText.includes(`${sLower} 2y`) ||
                      modalText.includes(`${sLower} 1y`) ||
                      modalText.includes(`${sLower} 3y`) ||
                      modalText.includes(`${sLower} \n`) ||
                      modalText.includes(`${sLower}\n`);
      return !inTags && !inModal;
    });

    if (unaddedSkills.length === 0) {
      showNotification('All profile skills already added', 'info');
      return true;
    }

    let addedCount = 0;
    const skillsAdded = [];

    // Loop through unadded skills to add up to 2-3 skills per click
    for (const skill of unaddedSkills) {
      if (addedCount >= 2) break;

      // Clear previous value cleanly
      skillInput.value = '';
      skillInput.focus();
      setNativeValue(skillInput, skill);
      await new Promise(r => setTimeout(r, 450));

      const dropdown = document.querySelector<HTMLElement>('.suggestions, .dropdown-menu, [class*="suggestion"], [class*="autocomplete"], [role="listbox"], [class*="searchList"], [class*="dropdown"]');
      if (dropdown) {
        if (dropdown.innerText.toLowerCase().includes('no skills found')) {
          continue; // Skip skills not in Shine's dictionary
        }
        const items = Array.from(dropdown.querySelectorAll<HTMLElement>('li, div, [role="option"], p, span')).filter(el => {
          const t = (el.innerText || '').toLowerCase().trim();
          return t && !t.includes('no skills') && !t.includes('no matching') && !t.includes('already added') && el.offsetHeight > 0;
        });
        const match = items.find(it => it.innerText.toLowerCase().trim() === skill.toLowerCase()) || items[0];
        if (match) {
          match.click();
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Check if button became "Already Added"
      let addBtn = Array.from(modal.querySelectorAll<HTMLElement>('button, [role="button"], a')).find(b => {
        const t = (b.innerText || '').trim();
        return t === 'Add' || t === 'Already Added';
      });

      if (addBtn && addBtn.innerText.trim() === 'Already Added') {
        continue;
      }

      // Pick experience
      const expTrigger = Array.from(modal.querySelectorAll<HTMLElement>('div, button, input')).find(el => {
        const t = (el.innerText || ('placeholder' in el ? String(el.placeholder) : '') || ('value' in el ? String(el.value) : '')).toLowerCase();
        return (t.includes('select experience') || t.includes('experience')) && el !== skillInput && el.offsetHeight > 20;
      });

      if (expTrigger) {
        expTrigger.click();
        await new Promise(r => setTimeout(r, 350));
        const expDropdown = document.querySelector<HTMLElement>('[class*="dropdown"], [class*="options"], ul, [role="listbox"], [class*="menu"]');
        if (expDropdown) {
          const expItems = Array.from(expDropdown.querySelectorAll<HTMLElement>('li, div, [role="option"]'));
          const expMatch = expItems.find(it => it.innerText.includes('2') || it.innerText.toLowerCase().includes('year')) || expItems[1];
          if (expMatch) {
            expMatch.click();
            await new Promise(r => setTimeout(r, 300));
          }
        }
      }

      // Click Add
      addBtn = Array.from(modal.querySelectorAll<HTMLElement>('button, [role="button"], a')).find(b => {
        const t = (b.innerText || '').trim();
        return t === 'Add';
      });

      if (addBtn && !('disabled' in addBtn && addBtn.disabled)) {
        addBtn.click();
        addedCount++;
        skillsAdded.push(skill);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (addedCount > 0) {
      showNotification(`Added ${addedCount} skill${addedCount > 1 ? 's' : ''} (${skillsAdded.join(', ')}) — ready to Save!`, 'success');
    } else {
      const nextSkill = unaddedSkills[0] || '';
      skillInput.value = '';
      setNativeValue(skillInput, nextSkill);
      showNotification(`Next skill: ${nextSkill} — select suggestion and click Add`, 'info');
    }
    return true;
  }

  function detectDegreePreference() {
    return detectATSDegreePreference(new URL(window.location.href), document);
  }

  function handleAutofill() {
    if (!autofillPromise) {
      autofillPromise = performAutofill().finally(() => { autofillPromise = null; });
    }
    return autofillPromise;
  }

  async function performAutofill() {
    const btn = document.getElementById('jc-autofill-btn');
    if (btn) btn.innerHTML = 'Filling...';

    // The legacy skills handler assumes Shine-style controls; known ATS adapters
    // use the normal field path instead of that portal-specific click sequence.
    const isSkillsModal = usesGenericAdapter(new URL(window.location.href), document) && Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, strong, p, div')).some(el => {
      const t = el.innerText?.trim() || '';
      return (t === 'Add Skills' || t.includes('Add minimum 3 skills')) && el.offsetHeight > 0;
    });

    if (isSkillsModal) {
      const handled = await handleSkillsModal();
      if (handled) {
        if (btn) btn.innerHTML = 'Autofill';
        return;
      }
    }

    // Always detect fresh fields in the current DOM (including modals)
    detectFields();
    injectAIButtons();

    const resumeTarget = captureResumeTarget(document);
    const operationUrl = window.location.href;
    let resumeAttachedCount = 0;
    let resumeFailedCount = 0;
    let resumeMessage = '';
    let filledCount = 0;
    let alreadyCorrectCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      const degreePref = detectDegreePreference();
      const targets = new Map<number, FieldTarget>();
      const fieldsToSend = formFields.map(f => {
        const el = document.querySelector<EditableField>(`[data-jc-index="${f.index}"]`);
        if (el) targets.set(f.index, captureTarget(el));
        const options = el ? getFieldOptions(new URL(window.location.href), el) : [];
        return {
            index: f.index,
            label: f.context,
            name: f.name,
            id: f.id || (el ? el.id : ''),
            placeholder: el && 'placeholder' in el ? el.placeholder : '',
            type: f.tagName === 'input' ? f.type : f.tagName,
            tag: f.tagName,
            options,
            degree_preference: el ? getFieldDegreePreference(new URL(window.location.href), el) : degreePref
        };
      });

      if (fieldsToSend.length === 0 && resumeTarget.state === 'none') {
        showNotification('No editable fields found on this page', true);
        return { filledCount: 0, alreadyCorrectCount: 0, skippedCount: 0, failedCount: 0 };
      }

      const mapping = fieldsToSend.length ? await fetchAPI<FieldMapping>('/api/match-fields', {
        method: 'POST',
        body: JSON.stringify(fieldsToSend)
      }) : {};

      const firstCounts = applyMapping(mapping, targets);
      ({ filledCount, alreadyCorrectCount, skippedCount, failedCount } = firstCounts);

      // Only newly editable controls need a second pass. Use the same validation
      // and application path as the first pass, including checkbox/select rules.
      await new Promise(r => setTimeout(r, 400));
      const previousElements = new Set(Array.from(targets.values(), target => target.element));
      const pageUrl = operationUrl;
      if (window.location.href === pageUrl) {
        detectFields();
        const secondTargets = new Map<number, FieldTarget>();
        const secondFields = formFields.filter(field => {
          const element = document.querySelector<EditableField>(`[data-jc-index="${field.index}"]`);
          if (!element || previousElements.has(element) || !canEdit(element)) return false;
          secondTargets.set(field.index, captureTarget(element));
          return true;
        }).map(field => {
          const element = secondTargets.get(field.index)!.element;
          return { index: field.index, label: field.context, name: field.name, id: field.id,
            type: field.tagName === 'input' ? field.type : field.tagName, tag: field.tagName,
            options: getFieldOptions(new URL(window.location.href), element),
            degree_preference: getFieldDegreePreference(new URL(window.location.href), element) };
        });
        if (secondFields.length) {
          try {
            const secondMapping = await fetchAPI<FieldMapping>('/api/match-fields', {
              method: 'POST', body: JSON.stringify(secondFields)
            });
            const counts = applyMapping(secondMapping, secondTargets);
            filledCount += counts.filledCount;
            alreadyCorrectCount += counts.alreadyCorrectCount;
            skippedCount += counts.skippedCount;
            failedCount += counts.failedCount;
          } catch { failedCount += secondFields.length; }
        }
      }

      const resume = await attachSavedResume(resumeTarget, () => fetchAPI<SavedResume>('/api/resume/file'));
      resumeAttachedCount = resume.attached;
      resumeFailedCount = resume.status === 'failed' ? 1 : 0;
      resumeMessage = resume.message;

      const hasCertFields = fieldsToSend.some(f => {
        const text = (f.label || '').toLowerCase();
        return text.includes('cert') || text.includes('issuer');
      });

      const status = `Filled ${filledCount}, Correct ${alreadyCorrectCount}, Skipped ${skippedCount}, Failed ${failedCount}`;
      const detail = hasCertFields && skippedCount > 0 ? ' · Unmatched or existing answers were preserved.' : '';
      // A missing optional resume must never hide the actual field-fill result.
      showNotification(`${status}${detail}${resumeMessage ? ' · ' + resumeMessage : ''}`,
        failedCount > 0 || resumeFailedCount > 0 ? 'error' : filledCount > 0 ? 'success' : 'info');
      if (window.location.href === pageUrl && (filledCount > 0 || alreadyCorrectCount > 0 || resumeAttachedCount > 0)) await logApplication();

    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Could not connect to the local backend. Open Job Copilot and click Connect local backend.', true);
      // Preserve failure status for the worker/popup instead of reporting success
      // with zero filled fields after a rejected backend request.
      throw err;
    } finally {
      if (btn) btn.innerHTML = 'Autofill';
    }

    return { filledCount, alreadyCorrectCount, skippedCount, failedCount, resumeAttachedCount, resumeFailedCount, resumeMessage };
  }

  function detectPlatform() {
    return detectATSPlatform(new URL(window.location.href), document);
  }

  function detectCompany() {
    return detectATSCompany(new URL(window.location.href), document);
  }

  async function logApplication() {
    try {
      const company = detectCompany();
      const title = document.title;

      await fetchAPI('/api/log-application', {
        method: 'POST',
        body: JSON.stringify({
          url: window.location.href,
          title: title,
          company: company,
          timestamp: new Date().toISOString(),
          platform: detectPlatform(),
          job_description: getJobDescription()
        })
      });
    } catch (err) {
      console.error('Failed to log application', err);
    }
  }

  chrome.runtime.onMessage.addListener((request: CopilotMessage, sender, sendResponse) => {
    if (request.action === 'showToast' && window.self === window.top) {
      showNotification(request.message, request.toastType);
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'autofill') {
      const inputs = detectFields();
      injectAIButtons();

      const resumeTarget = captureResumeTarget(document);
      if ((!inputs || inputs.length === 0) && resumeTarget.state === 'none') {
        sendResponse({ success: false, reason: 'no_fields' });
        return true;
      }
      // If top frame has only <= 1 field and the page contains an iframe, defer to the child iframe
      if (window.self === window.top && inputs.length <= 1 && resumeTarget.state === 'none' && document.querySelector<HTMLElement>('iframe')) {
        sendResponse({ success: false, reason: 'deferred_to_iframe' });
        return true;
      }

      handleAutofill()
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }
  });

  const runDetection = debounce(() => {
    detectFields();
    injectButton();
  }, 400);

  // Run immediately if DOM is already ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    runDetection();
  } else {
    window.addEventListener('DOMContentLoaded', runDetection);
    window.addEventListener('load', runDetection);
  }

  // Staggered detection to catch late SPA hydration (Greenhouse, Workday, Lever)
  setTimeout(runDetection, 600);
  setTimeout(runDetection, 1500);
  setTimeout(runDetection, 3000);
  setTimeout(runDetection, 5000);

  const observer = new MutationObserver(runDetection);
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['src', 'id', 'hidden', 'aria-hidden', 'disabled', 'readonly', 'aria-label', 'aria-labelledby', 'aria-controls', 'aria-owns', 'data-automation-id'] });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['src', 'id', 'hidden', 'aria-hidden', 'disabled', 'readonly', 'aria-label', 'aria-labelledby', 'aria-controls', 'aria-owns', 'data-automation-id'] });
    });
  }

  // Also detect fields on scroll (to handle lazy-rendered or off-screen form sections)
  window.addEventListener('scroll', runDetection, { passive: true });

  // The manifest's chrome.commands shortcut dispatches through the worker once.

}
