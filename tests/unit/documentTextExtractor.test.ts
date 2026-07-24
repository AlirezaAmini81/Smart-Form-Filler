import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractTextFromDocument } from '../../apps/extension/src/features/import/documentTextExtractor'

async function createDocxFile(text: string): Promise<File> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`)
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`)
  zip.folder('word')?.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
      </w:body>
    </w:document>`)

  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  return new File([bytes], 'profile.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
}

describe('document text extraction', () => {
  it('extracts and normalizes TXT content locally', async () => {
    const file = new File([
      'Full name: Alice Smith\r\nEmail: alice@example.test\r\nProfessional title: Engineer'
    ], 'profile.txt', { type: 'text/plain' })

    await expect(extractTextFromDocument(file)).resolves.toMatchObject({
      fileName: 'profile.txt',
      fileType: 'txt',
      text: 'Full name: Alice Smith\nEmail: alice@example.test\nProfessional title: Engineer',
      truncated: false,
      warnings: []
    })
  })

  it('extracts raw text from a DOCX document', async () => {
    const file = await createDocxFile('Full name: Alice Smith and Email: alice@example.test')
    const result = await extractTextFromDocument(file)

    expect(result.fileType).toBe('docx')
    expect(result.text).toContain('Full name: Alice Smith')
    expect(result.text).toContain('alice@example.test')
  })

  it('rejects malformed DOCX content with a user-friendly message', async () => {
    const file = new File(['not a zip document'], 'broken.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    await expect(extractTextFromDocument(file)).rejects.toThrow('DOCX file could not be read')
  })
})
