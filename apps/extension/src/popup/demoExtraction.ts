import type { FormFieldMetadata } from '../../../../packages/shared/src/schemas'

type DemoFieldKind = FormFieldMetadata['kind']

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export const DEMO_FORM_HTML = `
<form id="demo-form">
  <label for="full_name">Full name</label>
  <input id="full_name" name="full_name" type="text" placeholder="Jane Doe" />

  <label for="email">Email address</label>
  <input id="email" name="email" type="email" placeholder="jane@example.com" />

  <label for="phone">Phone number</label>
  <input id="phone" name="phone" type="tel" placeholder="+49 555 123456" />

  <label for="company">Company</label>
  <input id="company" name="company" type="text" placeholder="Acme GmbH" />

  <label for="about">Short bio</label>
  <textarea id="about" name="about" placeholder="Brief intro"></textarea>
</form>
`.trim()

function resolveLabel(doc: Document, element: FormElement): string | undefined {
  const id = element.getAttribute('id')
  if (id) {
    const label = doc.querySelector(`label[for="${id}"]`)
    if (label?.textContent) {
      return label.textContent.trim()
    }
  }

  const wrapper = element.closest('label')
  if (wrapper?.textContent) {
    return wrapper.textContent.trim()
  }

  return undefined
}

export function extractDemoFieldsFromHtml(html: string): FormFieldMetadata[] {
  if (typeof DOMParser === 'undefined') {
    return []
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const elements = Array.from(doc.querySelectorAll('input, textarea, select'))

  return elements.map((element) => {
    const tag = element.tagName.toLowerCase()
    const kind = (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'input') as DemoFieldKind

    const field: FormFieldMetadata = {
      id: element.getAttribute('id') ?? undefined,
      name: element.getAttribute('name') ?? undefined,
      type: (element as HTMLInputElement).getAttribute('type') ?? undefined,
      kind,
      label: resolveLabel(doc, element as FormElement),
      placeholder: (element as HTMLInputElement).getAttribute('placeholder') ?? undefined,
      ariaLabel: element.getAttribute('aria-label') ?? undefined
    }

    if (kind !== 'input') {
      field.type = undefined
    }

    return field
  })
}
