// ── types ──────────────────────────────────────────────────────

// one answer from the LLM — field identifier + value to fill
export type FieldAnswer = {
  id?:    string   // the field's id attribute  (use one of these to find the field)
  name?:  string   // the field's name attribute
  label?: string   // the field's label text    (fallback if id/name not found)
  value:  string   // the value to fill in
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
  // 1. find by id — most reliable
  if (answer.id) {
    const el = document.getElementById(answer.id)
    if (el) return el
  }

  // 2. find by name attribute
  if (answer.name) {
    const el = document.querySelector<HTMLElement>(
      `input[name="${answer.name}"], textarea[name="${answer.name}"], select[name="${answer.name}"]`
    )
    if (el) return el
  }

  // 3. find by label text — scan all labels and match the "for" attribute
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

// ── main fill function ─────────────────────────────────────────
export function fillFormFields(answers: FieldAnswer[]): FillResult {
  let filled  = 0
  let skipped = 0
  const results: FillResult['results'] = []

  for (const answer of answers) {
    const el = findElement(answer)

    if (!el) {
      skipped++
      results.push({ answer, success: false, reason: 'Field not found on page' })
      continue
    }

    const tag  = el.tagName.toLowerCase()
    const type = (el as HTMLInputElement).type?.toLowerCase() || ''

    // ── input ────────────────────────────────────────────────
    if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') {
        // for checkbox/radio: value "true"/"yes"/"1" = check it
        const shouldCheck = ['true', 'yes', '1', 'on'].includes(answer.value.toLowerCase())
        ;(el as HTMLInputElement).checked = shouldCheck
        triggerChangeEvents(el)
        filled++
        results.push({ answer, success: true })

      } else if (type === 'file') {
        // file inputs cannot be filled programmatically — browser security
        skipped++
        results.push({ answer, success: false, reason: 'File inputs cannot be filled automatically — browser security restriction' })

      } else {
        // text, email, number, tel, url, date, etc.
        ;(el as HTMLInputElement).value = answer.value
        triggerChangeEvents(el)
        filled++
        results.push({ answer, success: true })
      }
    }

    // ── textarea ─────────────────────────────────────────────
    else if (tag === 'textarea') {
      ;(el as HTMLTextAreaElement).value = answer.value
      triggerChangeEvents(el)
      filled++
      results.push({ answer, success: true })
    }

    // ── select ───────────────────────────────────────────────
    else if (tag === 'select') {
      const select  = el as HTMLSelectElement
      const valueLower = answer.value.toLowerCase()

      // try to match by option value first, then by visible text
      const matchedOption = Array.from(select.options).find(o =>
        o.value.toLowerCase() === valueLower ||
        o.text.toLowerCase().includes(valueLower)
      )

      if (matchedOption) {
        select.value = matchedOption.value
        triggerChangeEvents(el)
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