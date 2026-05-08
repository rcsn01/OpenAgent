export type ThemeSpec = {
  name?: string
  background?: string
  foreground?: string
  accent?: string
  fontFamily?: string
  titleSize?: number
  bodySize?: number
}

export type SlidePreviewSpec = {
  title: string
  body?: string
  bullets?: readonly string[]
}

export type OverflowIssue = {
  slide: number
  field: "title" | "body" | "bullets"
  severity: "warning" | "error"
  message: string
  estimate: number
  limit: number
}

const DEFAULT_THEME: Required<ThemeSpec> = {
  name: "OpenAgent Clean",
  background: "#ffffff",
  foreground: "#172033",
  accent: "#2563eb",
  fontFamily: "Arial",
  titleSize: 34,
  bodySize: 20,
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function wrapWords(input: string, maxChars: number, maxLines: number) {
  const words = input.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
    if (lines.length >= maxLines) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}

export function normalizeTheme(input?: ThemeSpec): Required<ThemeSpec> {
  return {
    ...DEFAULT_THEME,
    ...Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined)),
  }
}

export function themeCssVariables(input?: ThemeSpec) {
  const theme = normalizeTheme(input)
  return {
    "--slide-bg": theme.background,
    "--slide-fg": theme.foreground,
    "--slide-accent": theme.accent,
    "--slide-font": theme.fontFamily,
    "--slide-title-size": `${theme.titleSize}px`,
    "--slide-body-size": `${theme.bodySize}px`,
  }
}

export function renderSlideSvg(input: { slide: SlidePreviewSpec; theme?: ThemeSpec; index?: number }) {
  const theme = normalizeTheme(input.theme)
  const width = 1280
  const height = 720
  const titleLines = wrapWords(input.slide.title, 34, 2)
  const bodyLines = wrapWords(input.slide.body ?? "", 68, 5)
  const bullets = (input.slide.bullets ?? []).slice(0, 7)
  const titleSize = Math.max(20, Math.min(theme.titleSize, 56))
  const bodySize = Math.max(14, Math.min(theme.bodySize, 32))
  const bulletStartY = 275 + bodyLines.length * (bodySize + 10)
  const label = input.index === undefined ? "" : `Slide ${input.index + 1}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${escapeXml(theme.background)}"/>
  <rect x="0" y="0" width="18" height="${height}" fill="${escapeXml(theme.accent)}"/>
  <text x="70" y="64" font-family="${escapeXml(theme.fontFamily)}" font-size="18" fill="${escapeXml(theme.accent)}">${escapeXml(label || theme.name)}</text>
  ${titleLines
    .map(
      (line, i) =>
        `<text x="70" y="${145 + i * (titleSize + 8)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${titleSize}" font-weight="700" fill="${escapeXml(theme.foreground)}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${bodyLines
    .map(
      (line, i) =>
        `<text x="84" y="${260 + i * (bodySize + 10)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${bodySize}" fill="${escapeXml(theme.foreground)}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${bullets
    .flatMap((bullet, i) => {
      const y = bulletStartY + i * (bodySize + 16)
      const lines = wrapWords(bullet, 66, 2)
      return [
        `<circle cx="91" cy="${y - 8}" r="5" fill="${escapeXml(theme.accent)}"/>`,
        ...lines.map(
          (line, lineIndex) =>
            `<text x="114" y="${y + lineIndex * (bodySize + 8)}" font-family="${escapeXml(theme.fontFamily)}" font-size="${bodySize}" fill="${escapeXml(theme.foreground)}">${escapeXml(line)}</text>`,
        ),
      ]
    })
    .join("\n  ")}
</svg>
`
}

export function checkSlideOverflow(input: { slides: readonly SlidePreviewSpec[]; theme?: ThemeSpec }) {
  const theme = normalizeTheme(input.theme)
  const titleLimit = Math.max(45, Math.round(95 - theme.titleSize))
  const bodyLimit = Math.max(240, Math.round(520 - theme.bodySize * 8))
  const bulletLimit = Math.max(260, Math.round(610 - theme.bodySize * 10))
  const issues: OverflowIssue[] = []

  input.slides.forEach((slide, index) => {
    if (slide.title.length > titleLimit) {
      issues.push({
        slide: index + 1,
        field: "title",
        severity: slide.title.length > titleLimit * 1.35 ? "error" : "warning",
        message: "Title is likely too long for the title box.",
        estimate: slide.title.length,
        limit: titleLimit,
      })
    }

    const bodyChars = (slide.body ?? "").length
    if (bodyChars > bodyLimit) {
      issues.push({
        slide: index + 1,
        field: "body",
        severity: bodyChars > bodyLimit * 1.4 ? "error" : "warning",
        message: "Body text is likely to overflow the slide body area.",
        estimate: bodyChars,
        limit: bodyLimit,
      })
    }

    const bulletChars = (slide.bullets ?? []).reduce((sum, bullet) => sum + bullet.length, 0)
    const bulletCount = slide.bullets?.length ?? 0
    if (bulletChars > bulletLimit || bulletCount > 7) {
      issues.push({
        slide: index + 1,
        field: "bullets",
        severity: bulletChars > bulletLimit * 1.35 || bulletCount > 9 ? "error" : "warning",
        message: "Bullet content is likely too dense for one slide.",
        estimate: Math.max(bulletChars, bulletCount),
        limit: bulletChars > bulletLimit ? bulletLimit : 7,
      })
    }
  })

  return {
    ok: issues.length === 0,
    issues,
  }
}
