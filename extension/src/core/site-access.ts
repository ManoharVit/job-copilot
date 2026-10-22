import type { AutofillResponse, FrameIssue } from '../shared/messages';

type Frame = { frameId: number; url: string };

export function pageOrigin(address: string): string | undefined {
  try {
    const url = new URL(address);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : undefined;
  } catch { return undefined; }
}

export function isATSFrame(address: string): boolean {
  try {
    const url = new URL(address);
    if (!pageOrigin(address)) return false;
    const host = url.hostname;
    const family = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    return family('greenhouse.io') || family('lever.co') || family('jobs.ashbyhq.com')
      || family('myworkdayjobs.com') || (family('myworkdaysite.com')
        && /^\/(?:[a-z]{2,3}(?:-[a-z]{2})?\/)?recruiting(?:\/|$)/i.test(url.pathname));
  } catch { return false; }
}

// Request only the employer origin and recognized ATS frames, never unrelated
// chat/advertising frames or a wildcard. URL paths and query data stay local.
export function siteAccessOrigins(address: string, frames: Frame[]): string[] {
  const origins = new Set<string>();
  const top = pageOrigin(address);
  if (!top) return [];
  origins.add(`${top}/*`);
  for (const frame of frames) {
    const origin = pageOrigin(frame.url);
    if (origin && isATSFrame(frame.url) && origins.size < 10) origins.add(`${origin}/*`);
  }
  return [...origins];
}

export function frameIssue(error: unknown, stage: FrameIssue['stage'], frameId?: number, address = ''): FrameIssue {
  const text = error instanceof Error ? error.message : String(error);
  const code = /cannot access contents|host permission|permission.*(?:denied|required|missing)|access.*denied|not allowed to access/i.test(text)
    ? 'site_access_required'
    : /receiving end does not exist|frame.*(?:removed|not found)|no frame|tab.*closed|message port closed/i.test(text)
      ? 'frame_unavailable' : 'injection_failed';
  // Avoid returning raw Chrome errors, which may contain private URL parameters.
  return { frameId, origin: pageOrigin(address), stage, code };
}

export function autofillFailureMessage(response?: AutofillResponse): string {
  const blocked = response?.frameIssues?.filter(issue => issue.code === 'site_access_required');
  if (blocked?.length) {
    const sites = [...new Set(blocked.map(issue => issue.origin).filter(Boolean))].join(', ');
    return `Form access blocked${sites ? ` for ${sites}` : ''}. Open the Job Copilot popup and click "Autofill This Page" to allow the listed sites and fill.`;
  }
  if (response?.reason === 'no_fields') return 'No editable form found. Wait for the application to load, then retry Autofill.';
  if (response?.reason === 'autofill_failed' && response.error) return response.error;
  if (response?.reason === 'autofill_failed') return 'The form was reached, but Autofill failed. Check the local backend and retry.';
  return 'Application frame unavailable. Open Job Copilot to reconnect the form, then reload the page if needed.';
}
