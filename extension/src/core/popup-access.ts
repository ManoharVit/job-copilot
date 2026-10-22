import { autofillFailureMessage } from './site-access';
import type { AutofillResponse, SiteAccessResponse } from '../shared/messages';

export interface SiteAccessController {
  // Call directly from a trusted popup click, before awaiting any other work.
  requestAccess(): Promise<boolean>;
}

// Keep site recovery independent of backend availability. Cache the displayed
// sites before a click so Chrome's permission request retains the user gesture.
export async function setupSiteAccess(doc: Document, chromeApi: typeof chrome = chrome): Promise<SiteAccessController> {
  const button = doc.getElementById('allowSitesBtn') as HTMLButtonElement;
  const status = doc.getElementById('siteAccessStatus')!;
  const list = doc.getElementById('siteAccessOrigins')!;
  let plan: SiteAccessResponse | undefined;
  let busy = false;
  button.disabled = true;

  const requestAccess = (): Promise<boolean> => {
    if (busy) return Promise.resolve(false);
    if (!plan?.success || !plan.origins.length) {
      status.textContent = 'Reopen Job Copilot on a job application to check its sites.';
      return Promise.resolve(false);
    }
    const selected = { ...plan, origins: [...plan.origins] };
    let permission: Promise<boolean>;
    try {
      // Both Allow these sites and Autofill call here within their real click.
      permission = chromeApi.permissions.request({ origins: selected.origins });
    } catch {
      status.textContent = 'Could not request access. Check Job Copilot site access in Chrome extensions.';
      return Promise.resolve(false);
    }
    busy = true;
    button.disabled = true;
    status.textContent = 'Waiting for Chrome site access...';
    return permission.then(async granted => {
      if (!granted) {
        status.textContent = 'Access was not granted. No form was filled.';
        return false;
      }
      const current: SiteAccessResponse = await chromeApi.runtime.sendMessage({ action: 'inspectSiteAccess' });
      if (!current?.success || current.tabId !== selected.tabId
          || JSON.stringify(current.origins) !== JSON.stringify(selected.origins)) {
        status.textContent = 'The application page changed. Reopen Job Copilot to check its sites.';
        return false;
      }
      const response: AutofillResponse = await chromeApi.runtime.sendMessage({ action: 'ensureInjected' });
      status.textContent = response?.success
        ? 'Site access ready. Autofill This Page can now reach the application form.'
        : autofillFailureMessage(response);
      return response?.success === true;
    }).catch(() => {
      status.textContent = 'Could not reconnect. Reload the application page and reopen Job Copilot.';
      return false;
    }).finally(() => {
      busy = false;
      button.disabled = false;
    });
  };
  button.addEventListener('click', event => {
    if (event.isTrusted && !button.disabled) void requestAccess();
  });
  try {
    const result: SiteAccessResponse = await chromeApi.runtime.sendMessage({ action: 'inspectSiteAccess' });
    if (!result?.success || !result.origins?.length) {
      status.textContent = 'Open a job application in this tab, then reopen Job Copilot.';
    } else {
      plan = result;
      list.textContent = result.origins.map(origin => origin.replace(/\/\*$/, '')).join('\n');
      status.textContent = 'Autofill This Page requests access to these sites if needed. The employer page and embedded ATS form need separate access.';
      button.disabled = false;
    }
  } catch {
    status.textContent = 'Reload Job Copilot in Chrome extensions, then reopen this popup.';
  }
  return { requestAccess };
}
