import { genericTextareaWrapper, hasProviderFrame, matchesHost, readCompanyMetadata, readDescription } from './helpers';
import { associatedOptions, educationPreference, fieldLabel } from './form-fields';
import { hiringOrganization, postingDescription } from './structured-data';
import type { ATSAdapter } from './types';

const fields = '.ashby-application-form-field-entry, .ashby-application-form-question-container';
const education = 'fieldset[data-education-level], fieldset.ashby-education-entry, fieldset[class*="education" i], .ashby-education-entry, fieldset';

export const ashbyAdapter: ATSAdapter = {
  name: 'Ashby',
  matches: url => ['https:', 'http:'].includes(url.protocol) && matchesHost(url, 'jobs.ashbyhq.com'),
  // ashby_embed is the documented placeholder, present before the iframe loads.
  hasEmbeddedATS: document => hasProviderFrame(document, 'jobs.ashbyhq.com')
    || Boolean(document.querySelector('#ashby_embed, .ashby-application-form-container')),
  detectCompany: document => hiringOrganization(document) || readCompanyMetadata(document),
  detectJobDescription: document => readDescription(document, [
    '.ashby-job-posting-description', '.ashby-job-posting-brief-description', '[itemprop="description"]',
  ]) || postingDescription(document),
  getTextareaWrapper: textarea => textarea.closest<HTMLElement>(fields) || genericTextareaWrapper(textarea),
  getFieldContext: field => fieldLabel(field, fields, '.ashby-application-form-question-title, .ashby-application-form-field-label, label, legend'),
  getFieldOptions: associatedOptions,
  getFieldDegreePreference: field => educationPreference(field, education),
};
