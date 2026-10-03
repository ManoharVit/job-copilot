chrome.runtime.onInstalled.addListener(() => {
  console.log('Job Copilot Extension Installed');
});

// Service worker allows background tasks to track tabs or relay messages if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('Page loaded', tab.url);
  }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'autofill') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'autofill' });
            }
        });
    }
});
