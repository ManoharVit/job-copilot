import { setupBackendConnection } from '../../core/popup-backend';
import { requestBackend } from '../../core/backend-client';
import { setupSiteAccess, type SiteAccessController } from '../../core/popup-access';
import { autofillFailureMessage } from '../../core/site-access';
import type { AutofillResponse, ProfileSummary, ApplicationStats } from '../../shared/messages';

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

document.addEventListener('DOMContentLoaded', async () => {
  const loader = requiredElement('loader');
  const content = requiredElement('content');
  const errorMsg = requiredElement('errorMsg');
  const autofillBtn = requiredElement<HTMLButtonElement>('autofillBtn');

  loader.style.display = 'none';
  content.style.display = 'block';
  autofillBtn.disabled = true;
  let siteAccess: SiteAccessController | undefined;
  let backendReady = false;
  let filling = false;
  const updateButton = () => { autofillBtn.disabled = filling || !backendReady || !siteAccess; };
  void setupSiteAccess(document).then(controller => {
    siteAccess = controller;
    updateButton();
  });
  requiredElement('profileCard').style.display = 'none';
  const statsCard = document.querySelector<HTMLElement>('.stats');
  if (statsCard) statsCard.style.display = 'none';
  // Backend health and application-site access have independent status panels.
  void setupBackendConnection(document, async () => {
    backendReady = false;
    updateButton();
    const [profile, stats] = await Promise.all([
      requestBackend<ProfileSummary>('/api/profile'),
      requestBackend<ApplicationStats>('/api/stats'),
    ]);
    requiredElement('pName').textContent = profile.name || 'No Name';
    requiredElement('pEmail').textContent = profile.email || 'No Email';
    requiredElement('pPhone').textContent = profile.phone || 'No Phone';
    requiredElement('sToday').textContent = String(stats.today || 0);
    requiredElement('sTotal').textContent = String(stats.total || 0);
    errorMsg.style.display = 'none';
    requiredElement('profileCard').style.display = 'block';
    if (statsCard) statsCard.style.display = 'flex';
    backendReady = true;
    updateButton();
  });

  autofillBtn.addEventListener('click', async event => {
    if (!event.isTrusted || autofillBtn.disabled || !siteAccess) return;
    filling = true;
    updateButton();
    autofillBtn.innerText = 'Checking site access...';
    try {
      // Request the displayed employer/ATS origins while still in the click
      // gesture. activeTab alone cannot authorize a cross-origin ATS frame.
      if (!await siteAccess.requestAccess()) {
        autofillBtn.innerText = 'Site access required';
        return;
      }
      autofillBtn.innerText = 'Filling...';
      // Reuse the worker's injection and per-frame delivery path.
      const response: AutofillResponse = await chrome.runtime.sendMessage({ action: 'broadcastAutofill' });
      const count = response.filledCount || 0;
      if (response.resumeMessage) requiredElement('siteAccessStatus').textContent = response.resumeMessage;
      if (!response.success) requiredElement(response.reason === 'autofill_failed' ? 'backendStatus' : 'siteAccessStatus').textContent = autofillFailureMessage(response);
      autofillBtn.innerText = !response.success ? (response.reason === 'autofill_failed' ? 'Check backend connection' : 'Check site access / reload')
        : (response.resumeFailedCount || 0) > 0 ? `Filled ${count} · Resume failed`
        : (response.resumeAttachedCount || 0) > 0 ? `Filled ${count} · Resume attached`
        : count > 0 ? `Filled ${count} field${count > 1 ? 's' : ''}`
        : (response.alreadyCorrectCount || 0) > 0 ? 'Already filled' : 'Done';
    } catch (error) {
      autofillBtn.innerText = 'Please reload tab';
      requiredElement('backendStatus').textContent = error instanceof Error ? error.message : 'Autofill could not contact the extension worker.';
    } finally {
      filling = false;
      updateButton();
      setTimeout(() => { autofillBtn.innerText = 'Autofill This Page'; }, 2500);
    }
  });
});
