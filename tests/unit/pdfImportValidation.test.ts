import { describe, expect, it } from 'vitest'
import { MAX_PDF_BYTES, validatePdfFile } from '../../apps/extension/src/features/import/pdfFileValidation'
import { extractTextFromPdf } from '../../apps/extension/src/features/import/pdfTextExtractor'

describe('PDF import validation', () => {
  it('accepts PDF MIME types and PDF file extensions', () => {
    expect(() => validatePdfFile(new File(['pdf'], 'profile.bin', { type: 'application/pdf' }))).not.toThrow()
    expect(() => validatePdfFile(new File(['pdf'], 'profile.PDF'))).not.toThrow()
  })

  it('rejects unsupported, empty, and oversized files', () => {
    expect(() => validatePdfFile(new File(['text'], 'profile.txt', { type: 'text/plain' }))).toThrow('choose a PDF')
    expect(() => validatePdfFile(new File([], 'empty.pdf', { type: 'application/pdf' }))).toThrow('empty')
    const oversized = new File([new Uint8Array(MAX_PDF_BYTES + 1)], 'large.pdf', { type: 'application/pdf' })
    expect(() => validatePdfFile(oversized)).toThrow('smaller than 8 MB')
  })

  it('rejects malformed PDF content without exposing parser details', async () => {
    const malformed = new File(['this is not a pdf document'], 'broken.pdf', { type: 'application/pdf' })
    await expect(extractTextFromPdf(malformed)).rejects.toThrow(/valid PDF|could not be read/)
  })
})
