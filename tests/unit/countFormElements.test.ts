import { describe, it, expect } from 'vitest'
import { countFormElements } from '../../apps/extension/src/lib/dom/countFormElements'

describe('countFormElements', () => {
  it('counts inputs, textareas, and selects', () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = `
      <form>
        <input name="a" />
        <input name="b" />
        <textarea></textarea>
        <select><option value="1">1</option></select>
      </form>
    `
    const result = countFormElements(wrapper as unknown as Document)
    expect(result.inputs).toBe(2)
    expect(result.textareas).toBe(1)
    expect(result.selects).toBe(1)
  })
})
