import { countFormElements } from '../lib/dom/countFormElements'
import { extractFormFields  } from '../lib/dom/extractFormFields'
import { fillFormFields     } from '../lib/dom/fillFormFields'
import type { FieldAnswer   } from '../lib/dom/fillFormFields'

console.log('[saff] content script loaded on', location.href)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log('[saff] content script received message', msg)

  // ── count form elements ────────────────────────────────────
  if (msg?.type === 'ANALYZE_PAGE') {
    try {
      const counts = countFormElements(document)
      sendResponse({
        title:     document.title || '',
        url:       location.href,
        inputs:    counts.inputs,
        textareas: counts.textareas,
        selects:   counts.selects,
      })
    } catch (e) {
      sendResponse({ error: String(e) })
    }
    return true
  }

  // ── extract full field details ─────────────────────────────
  if (msg?.type === 'EXTRACT_FIELDS') {
    try {
      const result = extractFormFields(document)
      console.log('[saff] EXTRACT_FIELDS result', result)
      sendResponse(result)
    } catch (e) {
      sendResponse({ error: String(e) })
    }
    return true
  }

  // ── fill form fields with LLM answers ─────────────────────
  if (msg?.type === 'FILL_FIELDS') {
    try {
      const answers = msg.answers as FieldAnswer[]
      const result  = fillFormFields(answers)
      console.log('[saff] FILL_FIELDS result', result)
      sendResponse(result)
    } catch (e) {
      sendResponse({ error: String(e) })
    }
    return true
  }
})