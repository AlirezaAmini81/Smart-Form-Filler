import { describe, expect, it } from 'vitest'
import {
  detectDocumentType,
  MAX_DOCUMENT_BYTES,
  validateDocumentFile
} from '../../apps/extension/src/features/import/documentFileValidation'

describe('document import validation', () => {
  it('detects PDF, DOCX, and TXT by extension or MIME type', () => {
    expect(detectDocumentType(new File(['pdf'], 'profile.PDF'))).toBe('pdf')
    expect(detectDocumentType(new File(['docx'], 'profile.bin', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }))).toBe('docx')
    expect(detectDocumentType(new File(['text'], 'profile.txt'))).toBe('txt')
  })

  it('rejects unsupported, empty, and oversized documents', () => {
    expect(() => validateDocumentFile(new File(['data'], 'profile.rtf'))).toThrow('PDF, DOCX, or TXT')
    expect(() => validateDocumentFile(new File([], 'empty.txt', { type: 'text/plain' }))).toThrow('empty')

    const oversized = new File(
      [new Uint8Array(MAX_DOCUMENT_BYTES + 1)],
      'large.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    )
    expect(() => validateDocumentFile(oversized)).toThrow('smaller than 8 MB')
  })
})
