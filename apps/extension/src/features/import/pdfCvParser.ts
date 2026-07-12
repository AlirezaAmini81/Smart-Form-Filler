import type { SuggestionSensitivity } from '../suggestions/suggestionTypes'

export type ParsedCvEntry = {
  title: string
  content: string
  long: boolean
  sensitivity: SuggestionSensitivity
}

export type ParsedCvData = {
  profileName?: string
  values: Record<string, string>
  entries: ParsedCvEntry[]
  warnings: string[]
}

type SectionDefinition = {
  title: string
  sensitivity?: SuggestionSensitivity
  aliases: string[]
}

type SectionBoundary = {
  index: number
  definition?: SectionDefinition
  inlineContent?: string
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    title: 'Professional Summary',
    aliases: [
      'professional summary',
      'summary',
      'profile',
      'personal profile',
      'about me',
      'career objective',
      'objective',
      'executive summary',
      'overview'
    ]
  },
  {
    title: 'Skills',
    aliases: [
      'skills',
      'technical skills',
      'core skills',
      'core competencies',
      'competencies',
      'expertise',
      'key skills',
      'technical expertise',
      'technical competencies',
      'tools and technologies',
      'technologies',
      'tech stack',
      'software skills'
    ]
  },
  {
    title: 'Work Experience',
    aliases: [
      'work experience',
      'professional experience',
      'employment history',
      'experience',
      'work history',
      'career history',
      'career experience',
      'professional background',
      'employment experience',
      'relevant experience'
    ]
  },
  {
    title: 'Education',
    aliases: [
      'education',
      'academic background',
      'qualifications',
      'academic qualifications',
      'academic history',
      'education and qualifications',
      'degrees'
    ]
  },
  {
    title: 'Certifications',
    aliases: [
      'certifications',
      'certification',
      'certificates',
      'professional certifications',
      'licenses',
      'licences',
      'training',
      'courses',
      'certifications and training'
    ]
  },
  {
    title: 'Projects',
    aliases: [
      'projects',
      'selected projects',
      'personal projects',
      'portfolio projects',
      'project experience',
      'academic projects'
    ]
  },
  {
    title: 'Achievements',
    aliases: [
      'achievements',
      'awards',
      'awards and achievements',
      'honors',
      'honours',
      'accomplishments',
      'key achievements'
    ]
  },
  {
    title: 'Publications',
    aliases: [
      'publications',
      'research',
      'research experience',
      'papers',
      'articles',
      'conference papers'
    ]
  },
  {
    title: 'Volunteer Experience',
    aliases: [
      'volunteer experience',
      'volunteering',
      'community work',
      'community involvement'
    ]
  },
  {
    title: 'Languages',
    aliases: ['languages', 'language skills', 'language proficiency']
  },
  {
    title: 'Interests',
    sensitivity: 'public',
    aliases: ['interests', 'hobbies', 'personal interests']
  }
]

const CONTACT_HEADING_ALIASES = new Set([
  'contact',
  'contact information',
  'personal information',
  'details',
  'personal details',
  'contact details'
])

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripListPrefix(line: string): string {
  return line
    .replace(/^[•▪◦●◆▶*]+\s*/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .trim()
}

function cleanLine(line: string): string {
  return stripListPrefix(
    line
      .replace(/[•▪◦●◆▶]/g, '•')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function headingKey(line: string): string {
  return cleanLine(line)
    .toLowerCase()
    .replace(/[|:–—-]+$/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findSectionDefinition(key: string): SectionDefinition | undefined {
  return SECTION_DEFINITIONS.find((section) => section.aliases.includes(key))
}

function parseHeadingBoundary(line: string): SectionBoundary | undefined {
  const cleaned = cleanLine(line)
  if (!cleaned || cleaned.length > 120 || /@/.test(cleaned)) {
    return undefined
  }

  const exactKey = headingKey(cleaned)
  const exactDefinition = findSectionDefinition(exactKey)
  if (exactDefinition) {
    return { index: -1, definition: exactDefinition }
  }
  if (CONTACT_HEADING_ALIASES.has(exactKey)) {
    return { index: -1 }
  }

  // Supports headings that contain their first value on the same line, for example:
  // "Skills: React, TypeScript" or "Technical Skills - Python, SQL".
  const inlineMatch = cleaned.match(/^(.{2,55}?)[\s]*[:|-][\s]*(.+)$/)
  if (!inlineMatch) {
    return undefined
  }

  const inlineHeadingKey = headingKey(inlineMatch[1])
  const definition = findSectionDefinition(inlineHeadingKey)
  if (definition) {
    return {
      index: -1,
      definition,
      inlineContent: inlineMatch[2].trim()
    }
  }
  if (CONTACT_HEADING_ALIASES.has(inlineHeadingKey)) {
    return { index: -1 }
  }

  return undefined
}

function isLikelyHeading(line: string): boolean {
  return Boolean(parseHeadingBoundary(line))
}

function compactSection(lines: string[]): string {
  const normalized = lines
    .map(cleanLine)
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized.length > 4 ? normalized.slice(0, 8_000) : ''
}

function readSections(lines: string[]): Map<string, string> {
  const boundaries: SectionBoundary[] = []

  lines.forEach((line, index) => {
    const boundary = parseHeadingBoundary(line)
    if (boundary) {
      boundaries.push({ ...boundary, index })
    }
  })

  const sections = new Map<string, string>()
  boundaries.forEach((boundary, index) => {
    if (!boundary.definition) {
      return
    }

    const nextIndex = boundaries[index + 1]?.index ?? lines.length
    const contentParts = [
      boundary.inlineContent,
      compactSection(lines.slice(boundary.index + 1, nextIndex))
    ].filter(Boolean)
    const content = contentParts.join('\n').trim()

    if (!content) {
      return
    }

    const existing = sections.get(boundary.definition.title)
    sections.set(boundary.definition.title, existing ? `${existing}\n${content}` : content)
  })

  return sections
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern)
  return match?.[1]?.trim()
}

function findEmail(text: string): string | undefined {
  return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]
}

function findPhone(text: string): string | undefined {
  const candidates = text.match(/(?:\+?\d[\d().\s-]{6,}\d)/g) ?? []
  return candidates
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
    .find((candidate) => candidate.replace(/\D/g, '').length >= 7)
}

function findLinkedIn(text: string): string | undefined {
  return text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9-_%/?=.]+/i)?.[0]
}

function findGitHub(text: string): string | undefined {
  return text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-_%]+(?:\/[A-Za-z0-9-_%]+)?/i)?.[0]
}

function findWebsite(text: string): string | undefined {
  const candidates = text.match(/(?:https?:\/\/|www\.)[^\s|]+/gi) ?? []
  return candidates.find((candidate) => !/(linkedin\.com|github\.com)/i.test(candidate))
}

function findLabeledValue(lines: string[], labels: string[]): string | undefined {
  for (const line of lines.slice(0, 30)) {
    const match = line.match(/^\s*([^:|]{2,45})\s*[:|]\s*(.+)$/)
    if (!match) {
      continue
    }
    const label = headingKey(match[1])
    if (labels.includes(label)) {
      return match[2].trim()
    }
  }
  return undefined
}

function findLocation(lines: string[]): string | undefined {
  const labeled = findLabeledValue(lines, ['location', 'city', 'address', 'based in', 'current location'])
  if (labeled) {
    return labeled
  }

  for (const line of lines.slice(0, 16)) {
    const cleaned = cleanLine(line)
    if (
      cleaned.length >= 4 &&
      cleaned.length <= 70 &&
      /,/.test(cleaned) &&
      !/@|https?:\/\/|www\.|\+?\d[\d\s().-]{6,}/.test(cleaned)
    ) {
      return cleaned
    }
  }

  return undefined
}

function findName(lines: string[]): string | undefined {
  const labeled = findLabeledValue(lines, ['name', 'full name'])
  if (labeled && labeled.length <= 70) {
    return labeled
  }

  for (const line of lines.slice(0, 10)) {
    const cleaned = cleanLine(line)
    const key = headingKey(cleaned)

    if (
      !cleaned ||
      cleaned.length > 60 ||
      /@|https?:\/\/|www\.|\d{4,}/.test(cleaned) ||
      /curriculum vitae|resume|cv|contact|profile|summary|phone|email/.test(key)
    ) {
      continue
    }

    const words = cleaned.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, '').trim().split(/\s+/)
    if (words.length >= 2 && words.length <= 5 && words.every((word) => word.length >= 1)) {
      return cleaned
    }
  }

  return undefined
}

function looksLikeContactOrLocation(line: string): boolean {
  return /@|https?:\/\/|www\.|linkedin\.com|github\.com|\+?\d[\d\s().-]{6,}/i.test(line) || /,/.test(line)
}

function findProfessionalTitle(lines: string[], profileName?: string): string | undefined {
  const labeled = findLabeledValue(lines, ['title', 'role', 'position', 'job title', 'professional title'])
  if (labeled && labeled.length <= 90) {
    return labeled
  }

  const nameIndex = profileName ? lines.findIndex((line) => cleanLine(line) === profileName) : -1
  const startIndex = nameIndex >= 0 ? nameIndex + 1 : 0
  const roleWords = /(engineer|developer|manager|analyst|designer|consultant|specialist|administrator|architect|technician|executive|coordinator|intern|officer|lead|student|researcher|scientist|marketer|accountant|sales|support|qa|tester|product|project)/i

  for (const line of lines.slice(startIndex, startIndex + 8)) {
    const cleaned = cleanLine(line)
    if (!cleaned || cleaned.length > 90 || isLikelyHeading(cleaned) || looksLikeContactOrLocation(cleaned)) {
      continue
    }
    if (roleWords.test(cleaned)) {
      return cleaned
    }
  }

  return undefined
}

function toEntry(title: string, content: string, sensitivity: SuggestionSensitivity = 'normal'): ParsedCvEntry {
  return {
    title,
    content,
    long: content.length > 100 || content.includes('\n'),
    sensitivity
  }
}

function pushUniqueEntry(entries: ParsedCvEntry[], entry: ParsedCvEntry): void {
  const key = `${entry.title.toLowerCase()}::${entry.content.trim().toLowerCase()}`
  const exists = entries.some((item) => `${item.title.toLowerCase()}::${item.content.trim().toLowerCase()}` === key)
  if (!exists) {
    entries.push(entry)
  }
}

/**
 * Deterministically turns extracted CV text into editable form-profile values.
 * It intentionally does not invent facts. The user must review before saving.
 */
export function parseCvText(rawText: string): ParsedCvData {
  const text = normalizeText(rawText)
  const lines = text.split('\n').map(cleanLine).filter(Boolean)
  const values: Record<string, string> = {}
  const entries: ParsedCvEntry[] = []
  const warnings: string[] = []

  const profileName = findName(lines)
  if (profileName) {
    values.name = profileName
  }

  const email = findLabeledValue(lines, ['email', 'e mail', 'email address']) ?? findEmail(text)
  if (email) {
    values['e-mail'] = email
  }

  const phone = findLabeledValue(lines, ['phone', 'mobile', 'telephone', 'tel', 'phone number', 'mobile number']) ?? findPhone(text)
  if (phone) {
    values.phone = phone
  }

  const location = findLocation(lines)
  if (location) {
    values.location = location
  }

  const professionalTitle = findProfessionalTitle(lines, profileName)
  if (professionalTitle) {
    values['professional-title'] = professionalTitle
  }

  const linkedIn = findLabeledValue(lines, ['linkedin', 'linkedin profile']) ?? findLinkedIn(text)
  if (linkedIn) {
    pushUniqueEntry(entries, toEntry('LinkedIn profile', linkedIn, 'public'))
  }

  const gitHub = findLabeledValue(lines, ['github', 'github profile']) ?? findGitHub(text)
  if (gitHub) {
    pushUniqueEntry(entries, toEntry('GitHub profile', gitHub, 'public'))
  }

  const website =
    findLabeledValue(lines, ['website', 'portfolio', 'personal website', 'web']) ??
    findWebsite(text)
  if (website) {
    pushUniqueEntry(entries, toEntry('Website / portfolio', website, 'public'))
  }

  const sections = readSections(lines)
  for (const definition of SECTION_DEFINITIONS) {
    const content = sections.get(definition.title)
    if (content) {
      pushUniqueEntry(entries, toEntry(definition.title, content, definition.sensitivity ?? 'normal'))
    }
  }

  // Simple fallback: if the CV has bullet-like lines near the top but no Skills heading,
  // keep them out. We prefer missing data over accidentally inventing a skills section.
  if (!profileName) {
    warnings.push('A full name was not recognized. Add or correct it before saving.')
  }

  if (!email && !phone) {
    warnings.push('No email address or phone number was recognized.')
  }

  if (entries.length === 0) {
    warnings.push('No standard CV sections were recognized. You can still edit the extracted form manually.')
  }

  return {
    profileName,
    values,
    entries,
    warnings
  }
}
