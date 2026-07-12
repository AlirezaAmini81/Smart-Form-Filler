function isComboboxProxy(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  const role = element.getAttribute('role')
  return role === 'combobox' && element.getAttribute('aria-disabled') !== 'true'
}

function addCandidate(candidates: Set<HTMLElement>, element: Element | null): void {
  if (isComboboxProxy(element)) {
    candidates.add(element)
  }
}

export function findSelectProxy(select: HTMLSelectElement): HTMLElement | null {
  const candidates = new Set<HTMLElement>()

  if (select.id) {
    addCandidate(candidates, select.ownerDocument.getElementById(`${select.id}-button`))
  }

  const labelledByIds = (select.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
  labelledByIds.forEach((id) => {
    const label = select.ownerDocument.getElementById(id)
    if (label instanceof HTMLLabelElement && label.htmlFor) {
      addCandidate(candidates, select.ownerDocument.getElementById(label.htmlFor))
    }
  })

  addCandidate(candidates, select.nextElementSibling)
  select.parentElement
    ?.querySelectorAll<HTMLElement>('[role="combobox"]')
    .forEach((candidate) => addCandidate(candidates, candidate))

  return [...candidates].find((candidate) => candidate.offsetParent !== null) ?? null
}

export function isExtractableSelect(select: HTMLSelectElement): boolean {
  return select.offsetParent !== null || findSelectProxy(select) !== null
}

export function synchronizeSelectProxy(proxy: HTMLElement, option: HTMLOptionElement): void {
  const textTarget = proxy.querySelector<HTMLElement>(
    '.ui-selectmenu-text, [data-select-text], [data-selected-text]'
  )
  if (textTarget) {
    textTarget.textContent = option.text
  }
}
