export const MAX_PDF_BYTES = 8 * 1024 * 1024

export function validatePdfFile(file: File): void {
  const hasPdfType = file.type === 'application/pdf'
  const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf')

  if (!hasPdfType && !hasPdfExtension) {
    throw new Error('Please choose a PDF file.')
  }
  if (file.size === 0) {
    throw new Error('The selected PDF is empty.')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('Please choose a PDF smaller than 8 MB.')
  }
}
