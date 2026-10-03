// content.js — Job Copilot Chrome Extension

(function() {
  if (window.__jobCopilotLoaded) return;
  window.__jobCopilotLoaded = true;

  const API_URL = 'http://localhost:8000';
  let formFields = [];
  
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function getFieldContext(field) {
    let label = '';
    
    // 1. Check if wrapped in a <label>
    const parentLabel = field.closest('label');
    if (parentLabel) {
      label = parentLabel.innerText;
    }
    
    // 2. Check label[for] pointing to this field
    if (!label && field.id) {
      try {
        const labelElem = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        if (labelElem) label = labelElem.innerText;
      } catch(e) {}
    }
    
    // 3. aria-label
    if (!label && field.getAttribute('aria-label')) {
      label = field.getAttribute('aria-label');
    }
    
    // 4. Look for text in preceding sibling elements (common ATS pattern)
    if (!label) {
      let el = field.previousElementSibling;
      for (let i = 0; i < 3 && el; i++) {
        const text = el.innerText?.trim();
        if (text && text.length > 2 && text.length < 200) {
          label = text;
          break;
        }
        el = el.previousElementSibling;
      }
    }
    
    // 5. Check parent/grandparent for label text (Talismatic, Workday, etc.)
    if (!label) {
      let parent = field.parentElement;
      for (let i = 0; i < 4 && parent; i++) {
        // Look for label-like children of this parent (before the field)
        const labelLike = parent.querySelector('label, .label, [class*="label"], [class*="question"], h3, h4, strong, p, span.title, [class*="title"]');
        if (labelLike && labelLike !== field && !labelLike.contains(field)) {
          const text = labelLike.innerText?.trim();
          if (text && text.length > 2 && text.length < 200) {
            label = text;
            break;
          }
        }
        // If parent itself has short text that isn't just the input value
        const parentText = parent.innerText?.trim();
        if (parentText && parentText.length > 3 && parentText.length < 200 && parentText !== field.value) {
          // Extract just the first line (the label, not the entire parent content)
          const firstLine = parentText.split('\n')[0].trim();
          if (firstLine.length > 2 && firstLine.length < 150) {
            label = firstLine;
            break;
          }
        }
        parent = parent.parentElement;
      }
    }
    
    // 6. placeholder
    if (!label && field.placeholder) {
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
    
    return label ? label.trim().replace(/\n/g, ' ').substring(0, 200) : '';
  }

  // Grab job description text from page for AI context
  function getJobDescription() {
    const selectors = [
      '[class*="description"]', '[class*="job-detail"]', '[class*="jobDetail"]',
      '[class*="posting"]', '[id*="description"]', '[id*="job-detail"]',
      'article', '.job-description', '#job-description'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.length > 100) {
          return el.innerText.substring(0, 2000);
        }
      } catch(e) {}
    }
    return document.body.innerText.substring(0, 2000);
  }

  function detectFields() {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    const skipTypes = ['hidden', 'file', 'submit', 'button', 'image', 'reset'];
    
    formFields = inputs.filter(input => {
      if (input.tagName.toLowerCase() === 'input' && skipTypes.includes(input.type.toLowerCase())) {
        return false;
      }
      return !input.disabled && !input.readOnly;
    }).map((field, index) => {
      field.setAttribute('data-jc-index', index);
      return {
        index,
        tagName: field.tagName.toLowerCase(),
        type: field.type || '',
        name: field.name || '',
        id: field.id || '',
        context: getFieldContext(field)
      };
    });
    
    return formFields;
  }

  function injectButton() {
    if (document.getElementById('jc-autofill-btn')) return;
    if (formFields.length < 1) return;

    const btn = document.createElement('button');
    btn.id = 'jc-autofill-btn';
    btn.className = 'jc-btn jc-floating-btn';
    btn.innerHTML = '✨ Autofill';
    btn.addEventListener('click', handleAutofill);
    document.body.appendChild(btn);

    // Inject AI generate buttons next to textareas
    injectAIButtons();
  }

  // Add "✍️ AI Generate" buttons next to textarea fields
  function injectAIButtons() {
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(ta => {
      if (ta.dataset.jcAiBtn) return;
      ta.dataset.jcAiBtn = 'true';

      const context = getFieldContext(ta);
      if (!context && ta.offsetHeight < 40) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'jc-ai-wrapper';
      wrapper.style.cssText = 'position:relative;display:inline-block;width:100%;';
      
      const btn = document.createElement('button');
      btn.className = 'jc-btn jc-ai-btn';
      btn.innerHTML = '✍️ Generate';
      btn.title = 'AI-generate a human-like answer';
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.innerHTML = '⏳ Writing...';
        btn.disabled = true;

        try {
          const question = context || ta.placeholder || 'Tell us about yourself';
          const jd = getJobDescription();
          
          const isCoverLetter = /cover.?letter|why.*(role|company|position|interest)|about.?you|motivation/i.test(question);
          
          let endpoint, body;
          if (isCoverLetter) {
            endpoint = '/api/generate-cover-letter';
            body = { job_description: jd };
          } else {
            endpoint = '/api/generate-answer';
            body = { question, job_description: jd };
          }

          const resp = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          if (!resp.ok) throw new Error('API error');
          const data = await resp.json();
          const text = data.cover_letter || data.answer || '';
          
          if (text) {
            setNativeValue(ta, text);
            showNotification('✅ AI answer generated — review before submitting');
          }
        } catch(err) {
          showNotification('❌ AI failed — is backend running?', true);
        } finally {
          btn.innerHTML = '✍️ Generate';
          btn.disabled = false;
        }
      });

      // Insert button after the textarea
      ta.insertAdjacentElement('afterend', btn);
    });
  }

  function showNotification(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `jc-toast ${isError ? 'jc-error' : 'jc-success'}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('jc-fade-out');
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  }

  function setNativeValue(element, value) {
    try {
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else {
        element.value = value;
      }
    } catch(e) {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function handleAutofill() {
    const btn = document.getElementById('jc-autofill-btn');
    if (btn) btn.innerHTML = '⏳ Filling...';
    
    try {
      const fieldsToSend = formFields.map(f => {
        const el = document.querySelector(`[data-jc-index="${f.index}"]`);
        let options = [];
        if (el && el.tagName.toLowerCase() === 'select') {
            options = Array.from(el.options).map(o => o.text).filter(t => t);
        }
        return {
            index: f.index,
            label: f.context,
            name: f.name,
            placeholder: el ? (el.placeholder || '') : '',
            type: f.tagName === 'input' ? f.type : f.tagName,
            tag: f.tagName,
            options
        };
      });

      const response = await fetch(`${API_URL}/api/match-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldsToSend)
      });

      if (!response.ok) throw new Error('Failed to match fields');
      
      const mapping = await response.json();
      let filledCount = 0;
      let alreadyCorrectCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const [indexStr, value] of Object.entries(mapping)) {
        if (value == null || value === '') {
           skippedCount++;
           continue;
        }
        
        const field = document.querySelector(`[data-jc-index="${indexStr}"]`);
        if (!field) {
           failedCount++;
           continue;
        }

        const targetValue = String(value);

        if (field.tagName.toLowerCase() === 'select') {
          const currentText = field.options[field.selectedIndex]?.text || "";
          const currentVal = field.options[field.selectedIndex]?.value || "";
          
          if (currentText.toLowerCase() === targetValue.toLowerCase() || currentVal.toLowerCase() === targetValue.toLowerCase()) {
              alreadyCorrectCount++;
              continue;
          }
          if (field.selectedIndex > 0 && currentVal !== "" && currentVal.toLowerCase() !== "select") {
              skippedCount++;
              continue;
          }

          const options = Array.from(field.options);
          let match = options.find(o => 
            o.value.toLowerCase() === targetValue.toLowerCase() || 
            o.text.toLowerCase() === targetValue.toLowerCase()
          );
          if (!match) {
            match = options.find(o => o.text.toLowerCase().includes(targetValue.toLowerCase()));
          }
          if (match) {
            field.selectedIndex = match.index;
            field.dispatchEvent(new Event('change', { bubbles: true }));
            if (field.selectedIndex === match.index) {
                filledCount++;
            } else {
                failedCount++;
            }
          } else {
             failedCount++;
          }
        } else if (field.type === 'checkbox' || field.type === 'radio') {
          const shouldCheck = ['true', '1', 'yes'].includes(targetValue.toLowerCase()) || field.value === targetValue;
          if (field.checked === shouldCheck) {
             alreadyCorrectCount++;
             continue;
          }
          if (field.checked && !shouldCheck) {
             skippedCount++;
             continue;
          }
          if (shouldCheck) {
            field.checked = true;
            field.dispatchEvent(new Event('change', { bubbles: true }));
            if (field.checked) filledCount++;
            else failedCount++;
          }
        } else {
          if (field.value === targetValue) {
             alreadyCorrectCount++;
             continue;
          }
          if (field.value && field.value.trim() !== '') {
             skippedCount++;
             continue;
          }
          setNativeValue(field, targetValue);
          if (field.value === targetValue) {
             filledCount++;
          } else {
             failedCount++;
          }
        }
      }

      if (filledCount > 0) {
        showNotification(`✅ Filled ${filledCount}, Correct ${alreadyCorrectCount}, Skipped ${skippedCount}`);
      } else if (alreadyCorrectCount > 0) {
        showNotification(`✅ Fields were already filled correctly`);
      } else {
        showNotification(`⚠️ No fields filled. Skipped: ${skippedCount}, Failed: ${failedCount}`, true);
      }
      await logApplication();
      
    } catch (err) {
      console.error(err);
      showNotification('❌ Error — is backend running at localhost:8000?', true);
    } finally {
      if (btn) btn.innerHTML = '✨ Autofill';
    }
  }

  function detectPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('linkedin')) return 'LinkedIn';
    if (host.includes('indeed')) return 'Indeed';
    if (host.includes('naukri')) return 'Naukri';
    if (host.includes('glassdoor')) return 'Glassdoor';
    if (host.includes('lever.co')) return 'Lever';
    if (host.includes('greenhouse')) return 'Greenhouse';
    if (host.includes('workday')) return 'Workday';
    if (host.includes('ziprecruiter')) return 'ZipRecruiter';
    if (host.includes('angel.co') || host.includes('wellfound')) return 'AngelList';
    if (host.includes('dice.com')) return 'Dice';
    if (host.includes('monster.com')) return 'Monster';
    if (host.includes('simplify.jobs')) return 'Simplify';
    if (host.includes('internshala')) return 'Internshala';
    if (host.includes('instahyre')) return 'Instahyre';
    return 'Other';
  }

  function detectCompany() {
    // Try meta tags first
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite && ogSite.content) return ogSite.content;

    // Try structured data
    const appName = document.querySelector('meta[name="application-name"]');
    if (appName && appName.content) return appName.content;

    // Try extracting from hostname
    const host = window.location.hostname.replace('www.', '').replace('jobportal.', '');
    const hostParts = host.split('.');
    if (hostParts.length >= 2) {
      const domainName = hostParts[hostParts.length - 2];
      // Don't use generic job board names as company — use them as platform
      const genericSites = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'lever', 'greenhouse', 'workday', 'ziprecruiter', 'dice', 'monster', 'google'];
      if (!genericSites.includes(domainName.toLowerCase())) {
        return domainName.charAt(0).toUpperCase() + domainName.slice(1);
      }
    }

    // Fallback to page title parsing
    const title = document.title;
    let company = '';
    if (title.includes(' - ')) company = title.split(' - ').pop().trim();
    else if (title.includes(' | ')) company = title.split(' | ').pop().trim();
    else company = title;
    
    // Filter out generic phrases
    const generic = ['find your dream', 'job portal', 'careers', 'home', 'apply now', 'job search'];
    if (generic.some(g => company.toLowerCase().includes(g))) {
      return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
    }
    return company.substring(0, 100);
  }

  async function logApplication() {
    try {
      const company = detectCompany();
      const title = document.title;

      await fetch(`${API_URL}/api/log-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'autofill') {
      handleAutofill().then(() => sendResponse({ success: true }));
      return true;
    }
  });

  const runDetection = debounce(() => {
    detectFields();
    injectButton();
  }, 1000);

  window.addEventListener('load', runDetection);
  
  const observer = new MutationObserver(runDetection);
  observer.observe(document.body, { childList: true, subtree: true });

  // Keyboard shortcut: Ctrl+Shift+F to autofill
  document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
          e.preventDefault();
          handleAutofill();
      }
  });

})();
