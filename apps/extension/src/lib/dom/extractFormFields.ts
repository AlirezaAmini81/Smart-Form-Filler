// ── types ─────────────────────────────────────────────────────

export type FormField = {
  tag:         string
  type:        string
  name:        string
  id:          string
  label:       string
  placeholder: string
  required:    boolean
  options:     string[]
}

export type ExtractionResult = {
  title:        string
  url:          string
  fields:       FormField[]
  skipped:      number       // how many fields were filtered out
}

// ── noise filter ───────────────────────────────────────────────
// words that strongly suggest a field belongs to a cookie banner,
// analytics overlay, or other non-application UI — in any language
const NOISE_KEYWORDS = [
  // cookie / consent
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy', 'tracking',
  'einwilligung', 'datenschutz', 'zustimmung',
  // analytics providers
  'youtube', 'linkedin', 'piwik', 'google analytics', 'facebook',
  'twitter', 'instagram', 'tiktok',
  // overlay/banner ids and class patterns (checked against id/name)
  'cookie-switch', 'cookies-switch', 'cookieswitch',
]

// words that appear in id or name attributes of cookie toggles
const NOISE_ID_PATTERNS = [
  'cookie', 'consent', 'gdpr', 'cookieswitch', 'cookies-switch',
]

function isNoiseField(el: HTMLElement, label: string): boolean {
  const labelLower = label.toLowerCase()
  const id         = (el.id   || '').toLowerCase()
  const name       = ((el as HTMLInputElement).name || '').toLowerCase()

  // check label text against noise keywords
  if (NOISE_KEYWORDS.some(kw => labelLower.includes(kw))) return true

  // check id and name against noise id patterns
  if (NOISE_ID_PATTERNS.some(p => id.includes(p) || name.includes(p))) return true

  // check if the element lives inside a known cookie-banner container
  const bannerAncestor = el.closest(
    '[id*="cookie"], [id*="consent"], [id*="gdpr"], ' +
    '[class*="cookie"], [class*="consent"], [class*="gdpr"], ' +
    '[role="dialog"][aria-modal="true"]'
  )
  if (bannerAncestor) return true

  return false
}

// ── label finder ───────────────────────────────────────────────
function findLabel(el: HTMLElement): string {
  // 1. <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`)
    if (label?.textContent) return label.textContent.trim()
  }
  // 2. element wrapped inside <label>
  const parentLabel = el.closest('label')
  if (parentLabel?.textContent) return parentLabel.textContent.trim()

  // 3. aria-label on the element
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel.trim()

  // 4. aria-labelledby pointing elsewhere
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const target = document.getElementById(labelledBy)
    if (target?.textContent) return target.textContent.trim()
  }

  // 5. previous sibling looks like a label
  const prev = el.previousElementSibling
  if (prev && ['LABEL', 'SPAN', 'DIV', 'P', 'LI'].includes(prev.tagName)) {
    const text = prev.textContent?.trim()
    if (text && text.length < 120) return text
  }

  // 6. nearest ancestor that has a short text node before the input
  const parent = el.parentElement
  if (parent) {
    const text = Array.from(parent.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent?.trim() || '')
      .find(t => t.length > 0 && t.length < 120)
    if (text) return text
  }

  return ''
}

// ── main extraction function ────────────────────────────────────
export function extractFormFields(root: Document): ExtractionResult {
  const fields:  FormField[] = []
  let   skipped: number      = 0

  const skipInputTypes = ['hidden', 'submit', 'button', 'reset', 'image']

  // ── inputs ─────────────────────────────────────────────────
  root.querySelectorAll('input').forEach((el) => {
    if (skipInputTypes.includes(el.type)) return

    // skip truly invisible elements (but keep checkbox/radio — they may use custom UI)
    const isCheckboxLike = el.type === 'checkbox' || el.type === 'radio'
    if (!el.offsetParent && !isCheckboxLike) return

    const label = findLabel(el)

    if (isNoiseField(el, label)) { skipped++; return }

    fields.push({
      tag:         'input',
      type:        el.type || 'text',
      name:        el.name || '',
      id:          el.id   || '',
      label,
      placeholder: el.placeholder || '',
      required:    el.required,
      options:     [],
    })
  })

  // ── textareas ──────────────────────────────────────────────
  root.querySelectorAll('textarea').forEach((el) => {
    if (!el.offsetParent) return

    const label = findLabel(el)
    if (isNoiseField(el, label)) { skipped++; return }

    fields.push({
      tag:         'textarea',
      type:        'textarea',
      name:        el.name || '',
      id:          el.id   || '',
      label,
      placeholder: el.placeholder || '',
      required:    el.required,
      options:     [],
    })
  })

  // ── selects ────────────────────────────────────────────────
  root.querySelectorAll('select').forEach((el) => {
    if (!el.offsetParent) return

    const label = findLabel(el)
    if (isNoiseField(el, label)) { skipped++; return }

    const options = Array.from(el.options)
      .map(o => o.text.trim())
      .filter(t => t.length > 0)

    fields.push({
      tag:         'select',
      type:        'select',
      name:        el.name || '',
      id:          el.id   || '',
      label,
      placeholder: '',
      required:    el.required,
      options,
    })
  })

  return {
    title:   document.title || '',
    url:     location.href,
    fields,
    skipped,
  }
}