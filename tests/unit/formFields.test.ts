import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractFormFields } from '../../apps/extension/src/lib/dom/extractFormFields'
import { fillFormFields } from '../../apps/extension/src/lib/dom/fillFormFields'
import {
  mapProviderSuggestions,
  normalizeFormFields
} from '../../apps/extension/src/features/suggestions/suggestionMapping'

function makeVisible(element: HTMLElement): void {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body
  })
}

function setFormHtml(html: string): void {
  document.body.innerHTML = html
  document.querySelectorAll<HTMLElement>('input, textarea, select').forEach(makeVisible)
}

function setHidden(element: HTMLElement): void {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => null
  })
}

describe('form extraction and filling', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = 'Form test'
  })

  it('extracts text inputs and textareas with labels and stable locators', () => {
    setFormHtml(`
      <label for="first-name">First name</label>
      <input id="first-name" name="firstName" type="text" value="Ada">
      <label>Biography<textarea name="bio">Mathematician</textarea></label>
    `)

    const result = extractFormFields(document)

    expect(result.fields).toMatchObject([
      { id: 'first-name', name: 'firstName', label: 'First name', type: 'text', value: 'Ada' },
      { name: 'bio', label: 'BiographyMathematician', type: 'textarea', value: 'Mathematician' }
    ])
    expect(result.fields.every(field => field.locator.startsWith('saff-field-'))).toBe(true)
  })

  it('extracts checkbox state, radio groups, and native select options', () => {
    setFormHtml(`
      <label><input id="updates" type="checkbox" checked> Updates</label>
      <label><input type="radio" name="plan" value="basic"> Basic</label>
      <label><input type="radio" name="plan" value="pro" checked> Pro</label>
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="de">Germany</option>
        <option value="fr" selected>France</option>
      </select>
    `)

    const result = extractFormFields(document)

    expect(result.fields).toMatchObject([
      { id: 'updates', type: 'checkbox', value: 'true' },
      { name: 'plan', type: 'radio', value: '' },
      { name: 'plan', type: 'radio', value: 'true' },
      { id: 'country', type: 'select', value: 'France', options: ['Germany', 'France'] }
    ])
  })

  it('extracts a hidden native select backed by a visible ARIA combobox', () => {
    setFormHtml(`
      <label for="gender-button" id="gender_caption">Anrede <span>*</span></label>
      <div class="input_box">
        <select id="gender" name="bewerbung_form[gender]" aria-labelledby="gender_caption" style="display: none">
          <option value="">---</option>
          <option value="GENDER_MALE">Männlich</option>
          <option value="GENDER_FEMALE">Weiblich</option>
          <option value="GENDER_DIVERSE">Divers</option>
        </select>
        <span id="gender-button" role="combobox" aria-disabled="false">
          <span class="ui-selectmenu-text">---</span>
        </span>
      </div>
    `)
    setHidden(document.getElementById('gender') as HTMLSelectElement)
    makeVisible(document.getElementById('gender-button') as HTMLElement)

    const result = extractFormFields(document)

    expect(result.fields).toMatchObject([{
      id: 'gender',
      label: 'Anrede *',
      type: 'select',
      options: ['---', 'Männlich', 'Weiblich', 'Divers']
    }])
  })

  it('does not extract an unrelated hidden native select', () => {
    setFormHtml('<select id="internal"><option>Internal</option></select>')
    setHidden(document.getElementById('internal') as HTMLSelectElement)

    expect(extractFormFields(document).fields).toEqual([])
  })

  it('extracts German required labels without replacing them with helper text', () => {
    setFormHtml(`
      <label for="salutation">Anrede *</label>
      <select id="salutation"><option>männlich</option><option>weiblich</option><option>divers</option></select>
      <label for="first-name">Vorname *</label>
      <input id="first-name">
      <p>Falls dein offizieller Vorname von deinem Rufnamen abweicht, informiere bitte die*den zuständige*n Recruiter*in.</p>
      <label for="phone">Telefon *</label>
      <input id="phone" type="tel">
      <label for="email">E-Mail *</label>
      <input id="email" type="email">
      <p>Bitte prüfe, ob deine E-Mailadresse korrekt ist.</p>
    `)

    const result = extractFormFields(document)

    expect(result.fields.map((field) => field.label)).toEqual([
      'Vorname *',
      'Telefon *',
      'E-Mail *',
      'Anrede *'
    ])
  })

  it('excludes disabled controls from extraction', () => {
    setFormHtml(`
      <input id="enabled" type="text">
      <input id="disabled" type="text" disabled>
      <textarea id="disabled-textarea" disabled></textarea>
      <select id="disabled-select" disabled><option>One</option></select>
    `)

    const result = extractFormFields(document)

    expect(result.fields.map(field => field.id)).toEqual(['enabled'])
    expect(result.skipped).toBe(3)
  })

  it('fills text inputs and textareas through native setters', () => {
    setFormHtml('<input id="name"><textarea id="bio"></textarea>')
    const input = document.getElementById('name') as HTMLInputElement
    const textarea = document.getElementById('bio') as HTMLTextAreaElement
    const inputSetter = vi.spyOn(HTMLInputElement.prototype, 'value', 'set')
    const textareaSetter = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set')

    const result = fillFormFields([
      { id: 'name', value: 'Ada', approved: true },
      { id: 'bio', value: 'Programmer', approved: true }
    ])

    expect(result).toMatchObject({ filled: 2, skipped: 0 })
    expect(input.value).toBe('Ada')
    expect(textarea.value).toBe('Programmer')
    expect(inputSetter).toHaveBeenCalled()
    expect(textareaSetter).toHaveBeenCalled()
  })

  it('uses the extracted locator when a normalized id no longer matches the DOM id', () => {
    setFormHtml('<input id="first-name" value="old">')
    const [field] = extractFormFields(document).fields

    const result = fillFormFields([
      { locator: field.locator, id: 'first_name', value: 'Ada', approved: true }
    ])

    expect(result.filled).toBe(1)
    expect((document.getElementById('first-name') as HTMLInputElement).value).toBe('Ada')
  })

  it('preserves the locator through normalized and provider suggestions', () => {
    const [field] = normalizeFormFields([
      { locator: 'saff-field-42', id: 'first-name', kind: 'input' }
    ])

    const [suggestion] = mapProviderSuggestions({
      providerSuggestions: [{
        fieldId: field.id,
        suggestedValue: 'Ada',
        valueType: 'direct-copy',
        confidence: 'high',
        reasoningSummary: 'Matched profile.',
        knowledgeEntryIds: [],
        sourceIds: [],
        sensitivity: 'normal',
        requiresUserConfirmation: true,
        warnings: []
      }],
      fields: [field],
      knowledgeSnippets: [],
      activeProfileId: 'profile-1'
    })

    expect(field.id).toBe('first_name')
    expect(suggestion.fieldLocator).toBe('saff-field-42')
  })

  it('fills checkboxes, a radio group by value, and native selects', () => {
    setFormHtml(`
      <input id="terms" type="checkbox">
      <input type="radio" name="plan" value="basic" checked>
      <input type="radio" name="plan" value="pro">
      <select id="country">
        <option value="de">Germany</option>
        <option value="fr">France</option>
      </select>
    `)

    const result = fillFormFields([
      { id: 'terms', value: 'yes', approved: true },
      { name: 'plan', value: 'pro', approved: true },
      { id: 'country', value: 'France', approved: true }
    ])

    expect(result).toMatchObject({ filled: 3, skipped: 0 })
    expect((document.getElementById('terms') as HTMLInputElement).checked).toBe(true)
    expect((document.querySelector('[value="basic"]') as HTMLInputElement).checked).toBe(false)
    expect((document.querySelector('[value="pro"]') as HTMLInputElement).checked).toBe(true)
    expect((document.getElementById('country') as HTMLSelectElement).value).toBe('fr')
  })

  it('selects normalized visible text when the native option value differs', () => {
    setFormHtml(`
      <select id="salutation">
        <option value="">Bitte wählen</option>
        <option value="male">männlich</option>
        <option value="female">weiblich</option>
        <option value="diverse">divers</option>
      </select>
    `)
    const select = document.getElementById('salutation') as HTMLSelectElement

    const result = fillFormFields([
      { id: 'salutation', value: 'männlich', approved: true }
    ])

    expect(result).toMatchObject({ filled: 1, skipped: 0 })
    expect(select.value).toBe('male')
  })

  it('fills a hidden native select and synchronizes its visible selectmenu text', () => {
    setFormHtml(`
      <label for="gender-button" id="gender_caption">Anrede *</label>
      <div class="input_box">
        <select id="gender" aria-labelledby="gender_caption" style="display: none">
          <option value="">---</option>
          <option value="GENDER_MALE">Männlich</option>
          <option value="GENDER_FEMALE">Weiblich</option>
          <option value="GENDER_DIVERSE">Divers</option>
        </select>
        <span id="gender-button" role="combobox" aria-disabled="false">
          <span class="ui-selectmenu-text">---</span>
        </span>
      </div>
    `)
    const select = document.getElementById('gender') as HTMLSelectElement
    const button = document.getElementById('gender-button') as HTMLElement
    setHidden(select)
    makeVisible(button)
    const received: string[] = []
    select.addEventListener('input', (event) => received.push(event.type))
    select.addEventListener('change', (event) => received.push(event.type))

    const result = fillFormFields([
      { id: 'gender', value: 'männlich', approved: true }
    ])

    expect(result).toMatchObject({ filled: 1, skipped: 0 })
    expect(select.value).toBe('GENDER_MALE')
    expect(button.querySelector('.ui-selectmenu-text')?.textContent).toBe('Männlich')
    expect(received).toEqual(['input', 'change'])
  })

  it('does not select an unsupported native option', () => {
    setFormHtml(`
      <select id="salutation">
        <option value="">Bitte wählen</option>
        <option value="male">männlich</option>
        <option value="female">weiblich</option>
        <option value="diverse">divers</option>
      </select>
    `)
    const select = document.getElementById('salutation') as HTMLSelectElement

    const result = fillFormFields([
      { id: 'salutation', value: 'Herr', approved: true }
    ])

    expect(result).toMatchObject({ filled: 0, skipped: 1 })
    expect(select.value).toBe('')
  })

  it('does not fill disabled or rejected fields', () => {
    setFormHtml('<input id="disabled" disabled value="old"><input id="rejected" value="old">')

    const result = fillFormFields([
      { id: 'disabled', value: 'new', approved: true },
      { id: 'rejected', value: 'new', approved: false }
    ])

    expect(result).toMatchObject({ filled: 0, skipped: 2 })
    expect(result.results.map(item => item.reason)).toEqual([
      'Field is disabled',
      'Field suggestion was not approved'
    ])
    expect((document.getElementById('disabled') as HTMLInputElement).value).toBe('old')
    expect((document.getElementById('rejected') as HTMLInputElement).value).toBe('old')
  })

  it('dispatches bubbling input and change events after filling', () => {
    setFormHtml('<input id="email" type="email">')
    const received: string[] = []
    document.body.addEventListener('input', event => received.push(`${event.type}:${event.bubbles}`))
    document.body.addEventListener('change', event => received.push(`${event.type}:${event.bubbles}`))

    fillFormFields([{ id: 'email', value: 'ada@example.com', approved: true }])

    expect(received).toEqual(['input:true', 'change:true'])
  })
})
