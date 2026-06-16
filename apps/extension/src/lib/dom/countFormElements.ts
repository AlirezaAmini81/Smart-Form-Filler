export function countFormElements(root: Document | HTMLElement) {
  const doc = root as Document
  const inputs = doc.querySelectorAll('input').length
  const textareas = doc.querySelectorAll('textarea').length
  const selects = doc.querySelectorAll('select').length
  return { inputs, textareas, selects }
}
