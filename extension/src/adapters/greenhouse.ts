import { genericTextareaWrapper, hasProviderFrame, matchesHost, readCompanyMetadata, readDescription } from './helpers';
import type { ATSAdapter } from './types';

export const greenhouseAdapter: ATSAdapter = {
  name: 'Greenhouse',
  matches: url => matchesHost(url, 'greenhouse.io'),
  hasEmbeddedATS(document) {
    if (document.querySelector('#grnhse_app, #grnhse_iframe, iframe[id*="grnhse"]')) return true;
    if (hasProviderFrame(document, 'greenhouse.io')) return true;
    try {
      return new URL(document.URL).searchParams.has('gh_jid') && Boolean(document.querySelector('iframe'));
    } catch {
      return false;
    }
  },
  detectCompany(document) {
    return readCompanyMetadata(document)
      || document.title.match(/^Job Application for .+ at (.+)$/i)?.[1]?.trim()
      || null;
  },
  detectJobDescription: document => readDescription(document, [
    '#job-description', '.job-description', '#content', '[class*="description"]',
  ]),
  getTextareaWrapper: textarea => genericTextareaWrapper(textarea) || textarea.closest<HTMLElement>('.field'),
};
