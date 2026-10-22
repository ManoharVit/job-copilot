import { genericTextareaWrapper, hasProviderFrame, matchesHost, readCompanyMetadata, readDescription } from './helpers';
import type { ATSAdapter } from './types';

export const leverAdapter: ATSAdapter = {
  name: 'Lever',
  matches: url => matchesHost(url, 'lever.co'),
  hasEmbeddedATS: document => hasProviderFrame(document, 'lever.co'),
  detectCompany: readCompanyMetadata,
  detectJobDescription: document => readDescription(document, [
    '.posting-description', '.posting-page .section-wrapper', '[class*="posting"]', '.job-description',
  ]),
  getTextareaWrapper: textarea => genericTextareaWrapper(textarea) || textarea.closest<HTMLElement>('.application-field'),
};
