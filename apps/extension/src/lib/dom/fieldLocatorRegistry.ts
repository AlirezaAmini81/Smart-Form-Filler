const elementLocators = new WeakMap<HTMLElement, string>()
const locatedElements = new Map<string, HTMLElement>()
let nextLocator = 1

export function registerFieldElement(element: HTMLElement): string {
  const existing = elementLocators.get(element)
  if (existing) {
    locatedElements.set(existing, element)
    return existing
  }

  const locator = `saff-field-${nextLocator++}`
  elementLocators.set(element, locator)
  locatedElements.set(locator, element)
  return locator
}

export function resolveFieldElement(locator: string): HTMLElement | null {
  const element = locatedElements.get(locator)
  if (!element || !element.isConnected) {
    locatedElements.delete(locator)
    return null
  }
  return element
}
