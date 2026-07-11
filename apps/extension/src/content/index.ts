import { countFormElements } from '../lib/dom/countFormElements'
import { extractFormFields } from '../lib/dom/extractFormFields'
import { fillFormFields } from '../lib/dom/fillFormFields'
import type { FieldAnswer } from '../lib/dom/fillFormFields'
import type { SuggestedFieldValue } from '../../../../packages/shared/src/schemas'

const OVERLAY_ID = 'saff-suggestion-overlay'
const STYLE_ID = 'saff-suggestion-style'
const CONFIDENCE_ORDER = ['low', 'medium', 'high'] as const

function confidenceRank(confidence: string): number {
  const index = CONFIDENCE_ORDER.indexOf(confidence as (typeof CONFIDENCE_ORDER)[number])
  return index >= 0 ? index : 0
}

function confidenceLabel(rank: number): string {
  return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.length - 1, Math.max(0, rank))]
}

function confidenceScore(confidence: string): number {
  const rank = confidenceRank(confidence)
  if (rank >= 2) {
    return 0.9
  }
  if (rank === 1) {
    return 0.6
  }
  return 0.2
}

function removeOverlay() {
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) {
    existing.remove()
  }
}

function ensureOverlayStyles() {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 320px;
      max-height: 80vh;
      overflow: hidden;
      z-index: 2147483647;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(14, 116, 144, 0.2), 0 0 24px rgba(16, 185, 129, 0.35);
      font-family: "Space Grotesk", "IBM Plex Sans", "Segoe UI", sans-serif;
      color: #0f172a;
      animation: saffGlow 1.8s ease-in-out infinite;
    }
    @keyframes saffGlow {
      0% { box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(14, 116, 144, 0.18), 0 0 20px rgba(16, 185, 129, 0.28); }
      50% { box-shadow: 0 26px 50px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(14, 116, 144, 0.32), 0 0 32px rgba(16, 185, 129, 0.45); }
      100% { box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(14, 116, 144, 0.18), 0 0 20px rgba(16, 185, 129, 0.28); }
    }
    #${OVERLAY_ID} .saff-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    #${OVERLAY_ID} .saff-body {
      padding: 12px 14px;
      overflow-y: auto;
      max-height: 50vh;
    }
    #${OVERLAY_ID} .saff-filter {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px;
      background: #f8fafc;
      font-size: 11px;
      color: #475569;
    }
    #${OVERLAY_ID} .saff-filter strong {
      color: #0f172a;
      font-weight: 600;
    }
    #${OVERLAY_ID} .saff-item {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 10px;
      display: flex;
      gap: 8px;
      background: #ffffff;
    }
    #${OVERLAY_ID} .saff-item.disabled {
      opacity: 0.5;
    }
    #${OVERLAY_ID} .saff-label {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    #${OVERLAY_ID} .saff-value {
      font-size: 12px;
      color: #334155;
      word-break: break-word;
    }
    #${OVERLAY_ID} .saff-meta {
      margin-top: 6px;
      font-size: 11px;
      color: #64748b;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    #${OVERLAY_ID} .saff-badge {
      border-radius: 999px;
      border: 1px solid #e2e8f0;
      padding: 2px 6px;
      font-weight: 600;
      text-transform: capitalize;
      background: #f8fafc;
      color: #0f172a;
    }
    #${OVERLAY_ID} .saff-footer {
      padding: 12px 14px;
      border-top: 1px solid #e2e8f0;
      display: grid;
      gap: 8px;
      background: #f8fafc;
    }
    #${OVERLAY_ID} button {
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: #ffffff;
    }
    #${OVERLAY_ID} button.primary {
      background: #0f172a;
      color: #ffffff;
      border-color: #0f172a;
    }
    #${OVERLAY_ID} .saff-status {
      font-size: 11px;
      color: #64748b;
    }
  `.trim()
  document.head.appendChild(style)
}

function showSuggestionsOverlay(suggestions: SuggestedFieldValue[], minConfidence: number = 0) {
  removeOverlay()
  ensureOverlayStyles()

  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID

  const header = document.createElement('div')
  header.className = 'saff-header'
  header.textContent = 'Suggestions'

  const body = document.createElement('div')
  body.className = 'saff-body'

  const status = document.createElement('div')
  status.className = 'saff-status'
  status.textContent = 'Select suggestions to apply.'

  const checkboxes: HTMLInputElement[] = []
  const items: Array<{ element: HTMLDivElement; checkbox: HTMLInputElement; rank: number }> = []

  const filter = document.createElement('div')
  filter.className = 'saff-filter'

  const filterLabel = document.createElement('div')
  filterLabel.innerHTML = `Min confidence: <strong>${confidenceLabel(minConfidence)}</strong>`

  const filterInput = document.createElement('input')
  filterInput.type = 'range'
  filterInput.min = '0'
  filterInput.max = '2'
  filterInput.step = '1'
  filterInput.value = String(minConfidence)
  filterInput.setAttribute('aria-label', 'Minimum confidence')

  filter.appendChild(filterLabel)
  filter.appendChild(filterInput)
  body.appendChild(filter)

  suggestions.forEach((suggestion, index) => {
    const item = document.createElement('div')
    item.className = 'saff-item'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = Boolean(suggestion.suggestedValue)
    checkbox.disabled = !suggestion.suggestedValue
    checkboxes.push(checkbox)

    if (!suggestion.suggestedValue) {
      item.classList.add('disabled')
    }

    const content = document.createElement('div')
    const label = document.createElement('div')
    label.className = 'saff-label'
    label.textContent = suggestion.fieldLabel ?? suggestion.fieldName ?? suggestion.fieldId

    const value = document.createElement('div')
    value.className = 'saff-value'
    value.textContent = suggestion.suggestedValue ?? 'No suggestion'

    const meta = document.createElement('div')
    meta.className = 'saff-meta'
    const confidence = document.createElement('span')
    confidence.className = 'saff-badge'
    confidence.textContent = `${suggestion.confidence} (${confidenceScore(suggestion.confidence).toFixed(2)})`
    meta.appendChild(confidence)

    content.appendChild(label)
    content.appendChild(value)
    content.appendChild(meta)

    item.appendChild(checkbox)
    item.appendChild(content)
    body.appendChild(item)

    checkbox.dataset.index = String(index)
    items.push({ element: item, checkbox, rank: confidenceRank(suggestion.confidence) })
  })

  const applyConfidenceFilter = (rank: number) => {
    items.forEach((item) => {
      const visible = item.rank >= rank
      item.element.style.display = visible ? 'flex' : 'none'
      if (!visible) {
        item.checkbox.checked = false
      }
    })
  }

  applyConfidenceFilter(minConfidence)
  filterInput.addEventListener('input', () => {
    const rank = Number(filterInput.value)
    filterLabel.innerHTML = `Min confidence: <strong>${confidenceLabel(rank)}</strong>`
    applyConfidenceFilter(rank)
  })

  const footer = document.createElement('div')
  footer.className = 'saff-footer'

  const applyButton = document.createElement('button')
  applyButton.className = 'primary'
  applyButton.textContent = 'Apply selected'
  applyButton.onclick = () => {
    const selectedAnswers: FieldAnswer[] = []

    checkboxes.forEach((checkbox) => {
      if (!checkbox.checked) {
        return
      }
      const index = Number(checkbox.dataset.index)
      const suggestion = suggestions[index]
      if (!suggestion?.suggestedValue) {
        return
      }
      selectedAnswers.push({
        id: suggestion.fieldId ?? undefined,
        name: suggestion.fieldName ?? undefined,
        label: suggestion.fieldLabel ?? undefined,
        value: suggestion.suggestedValue
      })
    })

    if (selectedAnswers.length === 0) {
      status.textContent = 'No suggestions selected.'
      return
    }

    const result = fillFormFields(selectedAnswers)
    status.textContent = `Filled ${result.filled} field(s), skipped ${result.skipped}.`
  }

  const cancelButton = document.createElement('button')
  cancelButton.textContent = 'Close'
  cancelButton.onclick = () => removeOverlay()

  footer.appendChild(applyButton)
  footer.appendChild(cancelButton)
  footer.appendChild(status)

  overlay.appendChild(header)
  overlay.appendChild(body)
  overlay.appendChild(footer)

  document.body.appendChild(overlay)
}

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

  // ── overlay: show suggestions ─────────────────────────────
  if (msg?.type === 'SHOW_SUGGESTIONS_OVERLAY') {
    try {
      const suggestions = Array.isArray(msg.suggestions) ? (msg.suggestions as SuggestedFieldValue[]) : []
      const minConfidence = typeof msg.minConfidence === 'number' ? msg.minConfidence : 0
      showSuggestionsOverlay(suggestions, minConfidence)
      sendResponse({ ok: true })
    } catch (e) {
      sendResponse({ error: String(e) })
    }
    return true
  }

  if (msg?.type === 'HIDE_SUGGESTIONS_OVERLAY') {
    removeOverlay()
    sendResponse({ ok: true })
    return true
  }
})