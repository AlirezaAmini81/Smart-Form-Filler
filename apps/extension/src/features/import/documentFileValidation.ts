export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

export type SupportedDocumentType = 'pdf' | 'docx' | 'txt'

const DOCUMENT_MIME_TYPES: Record<SupportedDocumentType, ReadonlySet<string>> = {
  pdf: new Set(['application/pdf']),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  txt: new Set(['text/plain'])
}

const DOCUMENT_EXTENSIONS: Record<SupportedDocumentType, string> = {
  pdf: '.pdf',
  docx: '.docx',
  txt: '.txt'
}

export const DOCUMENT_FILE_ACCEPT = [
  'application/pdf',
  '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
  'text/plain',
  '.txt'
].join(',')

function typeFromFileName(fileName: string): SupportedDocumentType | null {
  const normalizedName = fileName.toLowerCase()
  const match = (Object.entries(DOCUMENT_EXTENSIONS) as Array<[SupportedDocumentType, string]>)
    .find(([, extension]) => normalizedName.endsWith(extension))

  return match?.[0] ?? null
}

function typeFromMimeType(mimeType: string): SupportedDocumentType | null {
  if (!mimeType) return null

  const match = (Object.entries(DOCUMENT_MIME_TYPES) as Array<[SupportedDocumentType, ReadonlySet<string>]>)
    .find(([, acceptedTypes]) => acceptedTypes.has(mimeType.toLowerCase()))

  return match?.[0] ?? null
}

export function detectDocumentType(file: Pick<File, 'name' | 'type'>): SupportedDocumentType | null {
  return typeFromFileName(file.name) ?? typeFromMimeType(file.type)
}

export function validateDocumentFile(file: File): SupportedDocumentType {
  const documentType = detectDocumentType(file)

  if (!documentType) {
    throw new Error('Please choose a PDF, DOCX, or TXT file.')
  }
  if (file.size === 0) {
    throw new Error('The selected document is empty.')
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error('Please choose a document smaller than 8 MB.')
  }

  return documentType
}
