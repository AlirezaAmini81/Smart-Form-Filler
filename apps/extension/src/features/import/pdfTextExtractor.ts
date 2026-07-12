import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

const MAX_PDF_BYTES = 8 * 1024 * 1024
const MAX_PDF_PAGES = 12
const MAX_EXTRACTED_CHARACTERS = 50_000
const MIN_EXTRACTED_CHARACTERS = 40

GlobalWorkerOptions.workerSrc = workerUrl

export type PdfTextExtractionResult = {
  fileName: string
  pageCount: number
  processedPages: number
  text: string
  truncated: boolean
}

type TextItemLike = {
  str: string
  hasEOL?: boolean
}

function isTextItem(item: unknown): item is TextItemLike {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as { str?: unknown }).str === 'string'
  )
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function userFriendlyPdfError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''

  if (/password/i.test(message)) {
    return 'This PDF is password-protected. Please upload an unlocked copy.'
  }
  if (/invalid pdf|corrupt|malformed/i.test(message)) {
    return 'This file does not appear to be a valid PDF or it is corrupted.'
  }

  return 'The PDF could not be read. Try exporting it again as a text-based PDF.'
}

/**
 * Extract selectable text from a user-selected PDF entirely inside the extension.
 * The original PDF is never uploaded or stored.
 */
export async function extractTextFromPdf(file: File): Promise<PdfTextExtractionResult> {
  if (!isPdfFile(file)) {
    throw new Error('Please choose a PDF file.')
  }

  if (file.size === 0) {
    throw new Error('The selected PDF is empty.')
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error('Please choose a PDF smaller than 8 MB.')
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined

  try {
    const data = new Uint8Array(await file.arrayBuffer())
    loadingTask = getDocument({ data })
    const pdf = await loadingTask.promise
    const processedPages = Math.min(pdf.numPages, MAX_PDF_PAGES)
    const pageTexts: string[] = []
    let collectedCharacters = 0
    let truncated = pdf.numPages > MAX_PDF_PAGES

    for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''

      for (const item of content.items) {
        if (!isTextItem(item)) {
          continue
        }

        pageText += item.str
        pageText += item.hasEOL ? '\n' : ' '

        if (collectedCharacters + pageText.length >= MAX_EXTRACTED_CHARACTERS) {
          truncated = true
          break
        }
      }

      pageTexts.push(pageText)
      collectedCharacters += pageText.length

      if (truncated) {
        break
      }
    }

    const text = pageTexts
      .join('\n\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (text.length < MIN_EXTRACTED_CHARACTERS) {
      throw new Error(
        'No selectable text was found. This may be a scanned or image-only PDF; OCR is not available yet.'
      )
    }

    return {
      fileName: file.name,
      pageCount: pdf.numPages,
      processedPages,
      text,
      truncated
    }
  } catch (error) {
    if (error instanceof Error && /No selectable text|smaller than 8 MB|Please choose|empty/i.test(error.message)) {
      throw error
    }

    throw new Error(userFriendlyPdfError(error))
  } finally {
    await loadingTask?.destroy()
  }
}
