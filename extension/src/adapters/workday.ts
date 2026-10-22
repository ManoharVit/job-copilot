import { genericTextareaWrapper, hasMatchingFrame, matchesHost, readCompanyMetadata, readDescription } from './helpers';
import { associatedOptions, educationPreference, fieldLabel } from './form-fields';
import { hiringOrganization, postingDescription } from './structured-data';
import type { ATSAdapter } from './types';

const fields = '[data-automation-id^="formField-"]';
const education = '[data-automation-id^="educationSection"], fieldset[data-education-level]';

export function isWorkdayURL(url: URL): boolean {
  if (!['https:', 'http:'].includes(url.protocol)) return false;
  return matchesHost(url, 'myworkdayjobs.com')
    || (matchesHost(url, 'myworkdaysite.com') && /^\/(?:[a-z]{2,3}(?:-[a-z]{2})?\/)?recruiting(?:\/|$)/i.test(url.pathname));
}

export const workdayAdapter: ATSAdapter = {
  name: 'Workday',
  matches: isWorkdayURL,
  hasEmbeddedATS: document => hasMatchingFrame(document, isWorkdayURL)
    || Boolean(document.querySelector('[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowPageContainer"]'))
    || Boolean(document.querySelector('[data-automation-id="jobPostingDescription"]')
      && document.querySelector('[data-automation-id="jobPostingHeader"]')),
  detectCompany: document => hiringOrganization(document) || readCompanyMetadata(document),
  detectJobDescription: document => readDescription(document, [
    '[data-automation-id="jobPostingDescription"]', '[itemprop="description"]',
  ]) || postingDescription(document),
  getTextareaWrapper: textarea => textarea.closest<HTMLElement>(fields) || genericTextareaWrapper(textarea),
  getFieldContext: field => fieldLabel(field, fields, '[data-automation-id="formLabel"], label, legend'),
  getFieldOptions: associatedOptions,
  getFieldDegreePreference: field => educationPreference(field, education),
  detectDegreePreference: document => {
    const field = document.activeElement;
    if (field?.matches('input, textarea, select')) {
      const preference = educationPreference(field as HTMLInputElement, education);
      if (preference) return preference;
    }
    for (const section of document.querySelectorAll<HTMLElement>(education)) {
      for (const input of section.querySelectorAll<HTMLInputElement>('input, select')) {
        const preference = educationPreference(input, education);
        if (preference) return preference;
      }
    }
    return null;
  },
};
