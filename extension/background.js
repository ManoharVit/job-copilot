chrome.runtime.onInstalled.addListener(() => {
  console.log('Job Copilot Extension Installed');
});

// Service worker allows background tasks to track tabs or relay messages if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('Page loaded', tab.url);
  }
});



chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchAPI') {
        fetch(request.url, request.options)
            .then(res => {
                if (!res.ok) {
                    return res.text().then(text => Promise.reject(`Error ${res.status}: ${text}`));
                }
                return res.json();
            })
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.toString() }));
        return true; // Keep the message channel open for async response
    }
});
