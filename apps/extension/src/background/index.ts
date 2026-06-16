// Background service worker (placeholder)
// Coordinates messaging between popup, content script, vault, and local LLM.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[saff] background worker installed')
})

console.log('[saff] background worker running')

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[saff] background received message', msg)
})
