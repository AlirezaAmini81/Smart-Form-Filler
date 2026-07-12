import type { SuggestionField } from './suggestionTypes'

export type FieldSemantic =
  | 'email'
  | 'first-name'
  | 'gender'
  | 'last-name'
  | 'phone'
  | 'salutation'

type SelectOption = {
  text: string
  value: string
}

const FIELD_ALIASES: Record<FieldSemantic, readonly string[]> = {
  email: ['e mail', 'email', 'e mail adresse', 'email address', 'mail'],
  'first-name': ['first name', 'forename', 'given name', 'vorname'],
  gender: ['gender', 'geschlecht', 'sex'],
  'last-name': ['family name', 'last name', 'nachname', 'surname'],
  phone: [
    'mobil',
    'mobilnummer',
    'mobile',
    'phone',
    'phone number',
    'telefon',
    'telefonnummer',
    'telephone'
  ],
  salutation: ['anrede', 'mr', 'salutation', 'title']
}

const OPTION_ALIASES = [
  ['male', 'mannlich', 'man', 'mr', 'mister', 'herr'],
  ['female', 'weiblich', 'woman', 'ms', 'mrs', 'miss', 'frau'],
  ['divers', 'diverse', 'non binary', 'nonbinary', 'mx']
] as const

export function normalizeSemanticText(value?: string): string {
  if (!value) {
    return ''
  }

  return value
    .replace(/([a-z\p{Ll}])([A-Z\p{Lu}])/gu, '$1 $2')
    .replace(/ß/gi, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsAlias(text: string, alias: string): boolean {
  return text === alias || ` ${text} `.includes(` ${alias} `)
}

export function inferSemantics(values: Array<string | undefined>): Set<FieldSemantic> {
  const normalizedValues = values.map(normalizeSemanticText).filter(Boolean)
  const semantics = new Set<FieldSemantic>()

  for (const [semantic, aliases] of Object.entries(FIELD_ALIASES) as Array<
    [FieldSemantic, readonly string[]]
  >) {
    if (normalizedValues.some((value) => aliases.some((alias) => containsAlias(value, alias)))) {
      semantics.add(semantic)
    }
  }

  return semantics
}

function optionAliasIndex(value: string): number {
  const normalized = normalizeSemanticText(value)
  return OPTION_ALIASES.findIndex((aliases) => aliases.some((alias) => alias === normalized))
}

function hasGenderOptionSet(options: readonly string[]): boolean {
  const groups = new Set(options.map(optionAliasIndex).filter((index) => index >= 0))
  return groups.size >= 2
}

export function inferFieldSemantics(field: SuggestionField): Set<FieldSemantic> {
  if (field.kind === 'select' && field.options && hasGenderOptionSet(field.options)) {
    return new Set<FieldSemantic>(['gender', 'salutation'])
  }

  return inferSemantics([
    field.label,
    field.name,
    field.id,
    field.ariaLabel,
    field.placeholder,
    field.autocomplete,
    field.title,
    field.inputMode,
    field.type
  ])
}

export function resolveSelectOption(
  options: readonly SelectOption[],
  candidate: string
): SelectOption | null {
  const normalizedCandidate = normalizeSemanticText(candidate)
  if (!normalizedCandidate) {
    return null
  }

  const exact = options.find((option) =>
    normalizeSemanticText(option.value) === normalizedCandidate ||
    normalizeSemanticText(option.text) === normalizedCandidate
  )
  if (exact) {
    return exact
  }

  const aliasIndex = optionAliasIndex(candidate)
  if (aliasIndex < 0) {
    return null
  }

  return options.find((option) =>
    optionAliasIndex(option.value) === aliasIndex || optionAliasIndex(option.text) === aliasIndex
  ) ?? null
}

export function resolveFieldSelectValue(field: SuggestionField, candidate: string): string | null {
  if (field.kind !== 'select' || !field.options?.length) {
    return candidate
  }

  const option = resolveSelectOption(
    field.options.map((text) => ({ text, value: text })),
    candidate
  )
  return option?.text ?? null
}
