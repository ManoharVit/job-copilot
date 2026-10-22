import { frameIssue, isATSFrame, siteAccessOrigins } from './core/site-access';
import { apiRequest } from './core/api-proxy';
import { CONTENT_SCRIPT, CONTENT_CSS, API_URL, BACKEND_PERMISSION } from './shared/messages';
import type { CopilotMessage, AutofillResponse, FrameIssue } from './shared/messages';

export function registerBackground(chromeApi: typeof globalThis.chrome = globalThis.chrome, fetchApi: typeof globalThis.fetch = globalThis.fetch) {
  const chrome = chromeApi;
  const fetch = fetchApi;
chrome.runtime.onInstalled.addListener(() => {
  console.log('Job Copilot Extension Installed');
});

// Keep script, stylesheet and delivery failures distinct instead of swallowing
// Chrome's host-permission errors and reporting a successful reinjection.
async function injectFrame(tabId: number, frameId?: number, address = ''): Promise<FrameIssue[]> {
  const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
  const results = await Promise.allSettled([
    chrome.scripting.executeScript({ target, files: [CONTENT_SCRIPT] }),
    chrome.scripting.insertCSS({ target, files: [CONTENT_CSS] }),
  ]);
  return results.flatMap((result, index) => result.status === 'rejected'
    ? [frameIssue(result.reason, index === 0 ? 'script' : 'css', frameId, address)] : []);
}

async function currentFrames(tabId: number) {
  try { return await chrome.webNavigation?.getAllFrames({ tabId }) || []; }
  catch { return []; }
}

function relevantFrames(frames: chrome.webNavigation.GetAllFrameResultDetails[]) {
  const hasATS = frames.some(frame => isATSFrame(frame.url));
  return frames.filter(frame => frame.url && !frame.url.startsWith('chrome://')
    && (!hasATS || frame.frameId === 0 || isATSFrame(frame.url)));
}

async function injectAllFrames(tabId: number, frames?: chrome.webNavigation.GetAllFrameResultDetails[]) {
  const targets = frames ?? await currentFrames(tabId);
  if (!targets.length) return injectFrame(tabId);
  const results = await Promise.all(relevantFrames(targets)
    .map(frame => injectFrame(tabId, frame.frameId, frame.url)));
  return results.flat();
}

async function activeTab(sender: chrome.runtime.MessageSender) {
  if (sender.tab?.id != null) return sender.tab;
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function autofillTab(tabId: number): Promise<AutofillResponse> {
  const frames = await currentFrames(tabId);
  const issues = await injectAllFrames(tabId, frames);
  const hasATS = frames.some(frame => isATSFrame(frame.url));
  // Unrelated chat/advertising frame failures must not masquerade as ATS failures.
  const relevant = relevantFrames(frames);
  const targets = relevant.length ? relevant : [undefined];
  const results = await Promise.allSettled(targets.map(frame => frame
    ? chrome.tabs.sendMessage(tabId, { action: 'autofill' }, { frameId: frame.frameId })
    : chrome.tabs.sendMessage(tabId, { action: 'autofill' })));
  const responses: (AutofillResponse | undefined)[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') responses.push(result.value);
    else issues.push(frameIssue(result.reason, 'message', targets[index]?.frameId, targets[index]?.url));
  });
  const frameIssues = issues.filter(issue => !hasATS || issue.frameId === undefined
    || relevant.some(frame => frame.frameId === issue.frameId));
  const failedATS = frameIssues.some(issue => issue.stage !== 'css'
    && frames.some(frame => frame.frameId === issue.frameId && isATSFrame(frame.url)));
  const success = !failedATS && responses.some(response => response?.success);
  return { success, frameIssues,
    error: responses.find(response => response?.error)?.error,
    reason: success ? undefined : responses.some(response => response?.error) ? 'autofill_failed'
      : frameIssues.length ? 'frame_unavailable' : 'no_fields',
    deliveredFrames: responses.length, failedFrames: results.length - responses.length,
    resumeFailedCount: responses.reduce((sum, response) => sum + (response?.resumeFailedCount || 0), 0),
    resumeAttachedCount: responses.reduce((sum, response) => sum + (response?.resumeAttachedCount || 0), 0),
    resumeMessage: responses.find(response => response?.resumeMessage)?.resumeMessage,
    filledCount: responses.reduce((sum, response) => sum + (response?.filledCount || 0), 0),
    alreadyCorrectCount: responses.reduce((sum, response) => sum + (response?.alreadyCorrectCount || 0), 0),
    skippedCount: responses.reduce((sum, response) => sum + (response?.skippedCount || 0), 0),
    failedCount: responses.reduce((sum, response) => sum + (response?.failedCount || 0), 0),
  };
}

// When any frame finishes loading (including dynamically added Greenhouse/Lever iframes)
if (chrome.webNavigation) {
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.url && !details.url.startsWith('chrome://')) {
      injectFrame(details.tabId, details.frameId);
    }
  });
}

// When top-level tab completes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    injectAllFrames(tabId);
  }
});

chrome.runtime.onMessage.addListener((request: CopilotMessage, sender, sendResponse) => {
  if (!request || typeof request !== 'object') return false;
  if (request.action === 'fetchAPI') {
    let url: string;
    let options: RequestInit;
    try {
      [url, options] = apiRequest(request.url, request.options);
    } catch (error) {
      sendResponse({ success: false, error: String(error) });
      return false;
    }
    const performRequest = async () => {
      // A site grant for the employer/ATS does not grant the loopback host.
      if (chrome.permissions?.contains && !await chrome.permissions.contains({ origins: [BACKEND_PERMISSION] })) {
        sendResponse({ success: false, code: 'backend_permission_required',
          error: 'Local backend access is not allowed. Open Job Copilot and click "Connect local backend".' });
        return;
      }
      let response: Response;
      try { response = await fetch(url, options); }
      catch {
        sendResponse({ success: false, code: 'backend_unreachable',
          error: `Cannot reach the local backend at ${API_URL}. Open Job Copilot and click "Connect local backend"; if it still fails, check that start.sh is running and Chrome allows local network access.` });
        return;
      }
      if (!response.ok) {
        sendResponse({ success: false, code: 'backend_http_error', error: response.status === 403
          ? 'The local backend rejected this extension origin (HTTP 403). Check CORS_EXTENSION_ORIGIN in the backend configuration.'
          : `The local backend returned HTTP ${response.status}.` });
        return;
      }
      try { sendResponse({ success: true, data: await response.json() }); }
      catch { sendResponse({ success: false, code: 'backend_invalid_response', error: 'The local backend returned an invalid JSON response.' }); }
    };
    performRequest().catch(() => sendResponse({ success: false, code: 'backend_permission_check_failed',
      error: 'Could not check local backend access. Reload Job Copilot and retry "Connect local backend".' }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'inspectSiteAccess') {
    activeTab(sender).then(async tab => {
      if (tab?.id == null) return sendResponse({ success: false, origins: [], error: 'No active tab' });
      const frames = await currentFrames(tab.id);
      sendResponse({ success: true, tabId: tab.id, origins: siteAccessOrigins(tab.url || '', frames) });
    }).catch(() => sendResponse({ success: false, origins: [], error: 'Could not inspect this tab' }));
    return true;
  }

  if (request.action === 'ensureInjected') {
    activeTab(sender).then(async tab => {
      if (tab?.id == null) return sendResponse({ success: false });
      const frameIssues = await injectAllFrames(tab.id);
      sendResponse({ success: !frameIssues.some(issue => issue.stage === 'script'), frameIssues });
    }).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (request.action === 'relayToast') {
    const tabId = sender.tab?.id;
    if (tabId) {
      // Send toast specifically to top frame (frameId: 0)
      chrome.tabs.sendMessage(tabId, {
        action: 'showToast',
        message: request.message,
        toastType: request.toastType
      }, { frameId: 0 }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'broadcastAutofill') {
    const triggerTab = async () => {
      try {
        let tabId = sender.tab?.id;
        if (tabId == null) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        if (tabId == null) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        sendResponse(await autofillTab(tabId));
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    };
    triggerTab();
    return true;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'autofill') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return;
      try {
        await autofillTab(tabId);
      } catch (error) {
        console.error('Job Copilot autofill failed', error);
      }
    });
  }
});

}
