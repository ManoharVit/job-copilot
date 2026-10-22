import { readCompanyMetadata, matchesHost, genericTextareaWrapper, readDescription, descriptionText } from './helpers';
import type { ATSAdapter, DegreePreference } from './types';

export function detectGenericPlatform(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host.includes('linkedin')) return 'LinkedIn';
  if (host.includes('indeed')) return 'Indeed';
  if (host.includes('shine.com')) return 'Shine';
  if (host.includes('naukri')) return 'Naukri';
  if (host.includes('glassdoor')) return 'Glassdoor';
  if (host.includes('ziprecruiter')) return 'ZipRecruiter';
  if (host.includes('angel.co') || host.includes('wellfound')) return 'AngelList';
  if (host.includes('dice.com')) return 'Dice';
  if (host.includes('monster.com')) return 'Monster';
  if (host.includes('simplify.jobs')) return 'Simplify';
  if (host.includes('internshala')) return 'Internshala';
  if (host.includes('instahyre')) return 'Instahyre';
  return 'Other';
}

export function detectGenericCompany(document: Document) {
  const metadata = readCompanyMetadata(document);
  if (metadata) return metadata;

  const address = new URL(document.URL);
  if (['myworkdayjobs.com', 'myworkdaysite.com', 'jobs.ashbyhq.com'].some(domain => matchesHost(address, domain))) return '';
  const host = address.hostname.replace('www.', '').replace('jobportal.', '');
  const hostParts = host.split('.');
  if (hostParts.length >= 2) {
    const domainName = hostParts[hostParts.length - 2] || '';
    const genericSites = ['linkedin', 'indeed', 'shine', 'naukri', 'glassdoor', 'lever', 'greenhouse', 'workday', 'ziprecruiter', 'dice', 'monster', 'google'];
    if (!genericSites.includes(domainName.toLowerCase())) {
      return domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
  }

  const title = document.title;
  let company = '';
  if (title.includes(' - ')) company = (title.split(' - ').pop() || '').trim();
  else if (title.includes(' | ')) company = (title.split(' | ').pop() || '').trim();
  else company = title;

  const generic = ['find your dream', 'job portal', 'careers', 'home', 'apply now', 'job search'];
  if (generic.some(g => company.toLowerCase().includes(g))) {
    return (host.split('.')[0] || '').charAt(0).toUpperCase() + (host.split('.')[0] || '').slice(1);
  }
  return company.substring(0, 100);
}

export function detectGenericDegreePreference(document: Document): DegreePreference {
  // 1. Check if the active modal itself specifies undergraduate or postgraduate
  const activeModal = document.querySelector<HTMLElement>('[role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="drawer"]');
  const modalText = activeModal ? (activeModal.innerText || '').toLowerCase() : '';

  if (modalText.includes('post grad') || modalText.includes('postgraduate') || modalText.includes('masters')) {
    return 'master';
  }
  if (modalText.includes('under grad') || modalText.includes('undergraduate') || modalText.includes('bachelor') || modalText.includes('b.tech')) {
    return 'bachelor';
  }

  // 2. Inspect already-rendered education cards on the page (excluding the current modal)
  let pageText = (document.body.innerText || '').toLowerCase();
  if (activeModal && activeModal.innerText) {
    pageText = pageText.replace(activeModal.innerText.toLowerCase(), '');
  }

  const hasExistingMaster = pageText.includes('northeastern') ||
                            pageText.includes('m.sc') ||
                            pageText.includes('master of science') ||
                            pageText.includes('scale 4');
  const hasExistingBachelor = pageText.includes('vellore') ||
                              pageText.includes('vit') ||
                              pageText.includes('b.tech') ||
                              pageText.includes('bachelor of technology') ||
                              pageText.includes('scale 10');

  if (hasExistingMaster && !hasExistingBachelor) {
    return 'bachelor';
  }
  if (hasExistingBachelor && !hasExistingMaster) {
    return 'master';
  }

  return 'master';
}

export const genericAdapter = {
  name: 'Other',
  matches: () => true,
  hasEmbeddedATS(document: Document): boolean {
    if (document.querySelector('iframe[src*="smartrecruiters"], iframe[src*="bamboohr"]')) return true;
    const url = new URL(document.URL);
    const hasJobUrl = url.search.includes('job') || url.search.includes('apply')
      || url.pathname.includes('/job') || url.pathname.includes('/career');
    return hasJobUrl && Boolean(document.querySelector('iframe'));
  },
  detectCompany: detectGenericCompany,
  detectDegreePreference: detectGenericDegreePreference,
  detectJobDescription(document: Document): string | null {
    return readDescription(document, [
      '[class*="description"]', '[class*="job-detail"]', '[class*="jobDetail"]',
      '[class*="posting"]', '[id*="description"]', '[id*="job-detail"]',
      'article', '.job-description', '#job-description',
    ]) ?? descriptionText(document.body);
  },
  getTextareaWrapper: genericTextareaWrapper,
} satisfies ATSAdapter;
