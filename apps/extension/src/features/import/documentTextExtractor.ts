import {
  validateDocumentFile,
  type SupportedDocumentType
} from './documentFileValidation'

const MAX_EXTRACTED_CHARACTERS = 50_000
const MIN_EXTRACTED_CHARACTERS = 20

export type DocumentTextExtractionResult = {
  fileName: string
  fileType: SupportedDocumentType
  text: string
  truncated: boolean
  pageCount?: number
  processedPages?: number
  warnings: string[]
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function limitExtractedText(value: string): { text: string; truncated: boolean } {
  const normalized = normalizeExtractedText(value)
  if (normalized.length <= MAX_EXTRACTED_CHARACTERS) {
    return { text: normalized, truncated: false }
  }

  return {
    text: normalized.slice(0, MAX_EXTRACTED_CHARACTERS).trimEnd(),
    truncated: true
  }
}

function ensureUsefulText(text: string, fileType: SupportedDocumentType): void {
  if (text.length >= MIN_EXTRACTED_CHARACTERS) return

  if (fileType === 'pdf') {
    throw new Error('No selectable text was found. This may be a scanned or image-only PDF; OCR is not available yet.')
  }

  throw new Error('No readable text was found in the selected document.')
}

async function extractTextFromDocx(file: File): Promise<DocumentTextExtractionResult> {
  try {
    const { default: mammoth } = await import('mammoth/mammoth.browser')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    const limited = limitExtractedText(result.value)
    ensureUsefulText(limited.text, 'docx')

    return {
      fileName: file.name,
      fileType: 'docx',
      text: limited.text,
      truncated: limited.truncated,
      warnings: result.messages.map((message) => message.message)
    }
  } catch (error) {
    if (error instanceof Error && /No readable text/i.test(error.message)) {
      throw error
    }

    throw new Error('The DOCX file could not be read. It may be corrupted or not a valid Word document.')
  }
}

async function extractTextFromTxt(file: File): Promise<DocumentTextExtractionResult> {
  try {
    const limited = limitExtractedText(await file.text())
    ensureUsefulText(limited.text, 'txt')

    return {
      fileName: file.name,
      fileType: 'txt',
      text: limited.text,
      truncated: limited.truncated,
      warnings: []
    }
  } catch (error) {
    if (error instanceof Error && /No readable text/i.test(error.message)) {
      throw error
    }

    throw new Error('The TXT file could not be read.')
  }
}

/**
 * Extract text from a supported document entirely inside the extension.
 * The original document bytes and extracted text are not persisted by this function.
 */
export async function extractTextFromDocument(file: File): Promise<DocumentTextExtractionResult> {
  const fileType = validateDocumentFile(file)

  if (fileType === 'pdf') {
    const { extractTextFromPdf } = await import('./pdfTextExtractor')
    const extracted = await extractTextFromPdf(file)
    return {
      ...extracted,
      fileType,
      warnings: []
    }
  }

  if (fileType === 'docx') {
    return extractTextFromDocx(file)
  }

  return extractTextFromTxt(file)
}
