const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const tokenizePhrase = (value: string) =>
  value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const phrasePattern = (value: string) => {
  const tokens = tokenizePhrase(value)
  if (!tokens.length) return

  const prefix = /^[\p{L}\p{N}]/u.test(tokens[0]) ? "\\b" : ""
  const suffix = /[\p{L}\p{N}]$/u.test(tokens[tokens.length - 1]) ? "\\b" : ""
  return new RegExp(`${prefix}${tokens.map(escapeRegex).join("[\\s_-]*")}${suffix}`, "giu")
}

export const parseVoiceDictionary = (value: string) => {
  const seen = new Set<string>()
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export const parseVoiceCorrections = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const match = item.match(/^(.*?)\s*(?:=>|->)\s*(.+)$/)
      if (!match) return []
      const from = match[1].trim()
      const to = match[2].trim()
      if (!from || !to) return []
      return [{ from, to }]
    })

export const getVoicePromptTerms = (input: { dictionary: string; corrections: string }) => {
  const seen = new Set<string>()
  return [...parseVoiceDictionary(input.dictionary), ...parseVoiceCorrections(input.corrections).map((item) => item.to)].filter(
    (item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
  )
}

const replacePhrase = (value: string, from: string, to: string) => {
  const pattern = phrasePattern(from)
  if (!pattern) return value
  return value.replace(pattern, to)
}

export function postprocessVoiceTranscript(
  transcript: string,
  input: {
    dictionary: string
    corrections: string
  },
) {
  const trimmed = transcript.trim()
  if (!trimmed) return trimmed

  const corrected = parseVoiceCorrections(input.corrections).reduce(
    (value, item) => replacePhrase(value, item.from, item.to),
    trimmed,
  )

  return parseVoiceDictionary(input.dictionary).reduce((value, item) => replacePhrase(value, item, item), corrected)
}
