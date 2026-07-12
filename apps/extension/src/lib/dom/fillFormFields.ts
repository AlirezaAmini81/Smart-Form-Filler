import { resolveFieldElement } from './fieldLocatorRegistry'
import { findSelectProxy, synchronizeSelectProxy } from './selectProxy'

// ── types ──────────────────────────────────────────────────────

// one answer from the LLM — field identifier + value to fill
export type FieldAnswer = {
  locator?: string // opaque locator returned by extraction
  id?:    string   // the field's id attribute  (use one of these to find the field)
  name?:  string   // the field's name attribute
  label?: string   // the field's label text    (fallback if id/name not found)
  value:  string   // the value to fill in
  approved: boolean // only explicitly approved answers may be applied
}

// result returned after filling
export type FillResult = {
  filled:  number           // how many fields were successfully filled
  skipped: number           // how many couldn't be found on the page
  results: {
    answer:  FieldAnswer
    success: boolean
    reason?: string         // why it was skipped, if it was
  }[]
}

// ── helper: find a DOM element by id, name, or label ──────────
function findElement(answer: FieldAnswer): HTMLElement | null {
  // 1. Resolve the opaque locator registered during extraction. This preserves
  // identity without turning normalized suggestion ids back into selectors.
  if (answer.locator) {
    const located = resolveFieldElement(answer.locator)
    if (located) return located
  }

  // 2. find by original id
  if (answer.id) {
    const el = document.getElementById(answer.id)
    if (el) return el
  }

  // 3. find by name attribute. If the suggestion pipeline only preserved an
  // original id in the name slot, also try it as an id before falling back.
  if (answer.name) {
    const namedElements = Array.from(
      document.querySelectorAll<HTMLElement>('input, textarea, select')
    ).filter(candidate =>
      (candidate as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name === answer.name
    )
    const radioMatch = namedElements.find(candidate =>
      candidate instanceof HTMLInputElement &&
      candidate.type === 'radio' &&
      candidate.value.toLowerCase() === answer.value.toLowerCase()
    )
    const el = radioMatch ?? namedElements[0]
    if (el) return el

    const byNameAsId = document.getElementById(answer.name)
    if (byNameAsId) return byNameAsId
  }

  // 4. find by label text — scan all labels and match the "for" attribute
  if (answer.label) {
    const labelLower = answer.label.toLowerCase()
    const labels = Array.from(document.querySelectorAll('label'))
    const matchedLabel = labels.find(l =>
      l.textContent?.toLowerCase().trim().includes(labelLower)
    )
    if (matchedLabel?.htmlFor) {
      const el = document.getElementById(matchedLabel.htmlFor)
      if (el) return el
    }
  }

  return null
}

// ── helper: trigger React/Vue/Angular change detection ────────
// Modern web frameworks track input values internally.
// Setting el.value directly bypasses their state — the form
// won't see the change. We fire real browser events to fix this.
function triggerChangeEvents(el: HTMLElement) {
  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype = element instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
}

function setNativeChecked(element: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
  setter?.call(element, checked)
}

function normalizeOptionText(value: string): string {
  return value
    .replace(/ß/gi, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findSelectOption(select: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const normalizedValue = normalizeOptionText(value)
  if (!normalizedValue) {
    return null
  }

  return Array.from(select.options).find((option) =>
    normalizeOptionText(option.value) === normalizedValue ||
    normalizeOptionText(option.text) === normalizedValue
  ) ?? null
}

// ── main fill function ─────────────────────────────────────────
export function fillFormFields(answers: FieldAnswer[]): FillResult {
  let filled  = 0
  let skipped = 0
  const results: FillResult['results'] = []

  for (const answer of answers) {
    if (!answer.approved) {
      skipped++
      results.push({ answer, success: false, reason: 'Field suggestion was not approved' })
      continue
    }

    const el = findElement(answer)

    if (!el) {
      skipped++
      results.push({ answer, success: false, reason: 'Field not found on page' })
      continue
    }

    const tag  = el.tagName.toLowerCase()
    const type = (el as HTMLInputElement).type?.toLowerCase() || ''

    if ((el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled) {
      skipped++
      results.push({ answer, success: false, reason: 'Field is disabled' })
      continue
    }

    // ── input ────────────────────────────────────────────────
    if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') {
        // for checkbox/radio: value "true"/"yes"/"1" = check it
        const input = el as HTMLInputElement
        const normalizedValue = answer.value.toLowerCase()
        const shouldCheck = ['true', 'yes', '1', 'on'].includes(normalizedValue) ||
          (type === 'radio' && input.value.toLowerCase() === normalizedValue)
        setNativeChecked(input, shouldCheck)
        triggerChangeEvents(el)
        filled++
        results.push({ answer, success: true })

      } else if (type === 'file') {
        // file inputs cannot be filled programmatically — browser security
        skipped++
        results.push({ answer, success: false, reason: 'File inputs cannot be filled automatically — browser security restriction' })

      } else {
        // text, email, number, tel, url, date, etc.
        setNativeValue(el as HTMLInputElement, answer.value)
        triggerChangeEvents(el)
        filled++
        results.push({ answer, success: true })
      }
    }

    // ── textarea ─────────────────────────────────────────────
    else if (tag === 'textarea') {
      setNativeValue(el as HTMLTextAreaElement, answer.value)
      triggerChangeEvents(el)
      filled++
      results.push({ answer, success: true })
    }

    // ── select ───────────────────────────────────────────────
    else if (tag === 'select') {
      const select  = el as HTMLSelectElement
      const matchedOption = findSelectOption(select, answer.value)

      if (matchedOption) {
        setNativeValue(select, matchedOption.value)
        triggerChangeEvents(el)
        const proxy = findSelectProxy(select)
        if (proxy) {
          synchronizeSelectProxy(proxy, matchedOption)
        }
        filled++
        results.push({ answer, success: true })
      } else {
        skipped++
        results.push({ answer, success: false, reason: `No matching option found for "${answer.value}"` })
      }
    }

    else {
      skipped++
      results.push({ answer, success: false, reason: `Unsupported element type: ${tag}` })
    }
  }

  return { filled, skipped, results }
}
