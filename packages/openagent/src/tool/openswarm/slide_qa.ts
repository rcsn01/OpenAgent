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
  name: "OpenAgent Editorial",
  background: "#101418",
  foreground: "#F4F1EA",
  accent: "#35D0BA",
  fontFamily: "Aptos",
  titleSize: 44,
  bodySize: 22,
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

function hasVisualTheme(input?: ThemeSpec) {
  return !!input && Object.keys(input).some((key) => key !== "name" && input[key as keyof ThemeSpec] !== undefined)
}

export function inferTheme(input?: { task?: string; title?: string; theme?: ThemeSpec }) {
  if (hasVisualTheme(input?.theme)) return normalizeTheme(input?.theme)
  const text = `${input?.task ?? ""} ${input?.title ?? ""} ${input?.theme?.name ?? ""}`.toLowerCase()
  if (/(dark|ai|agent|cli|code|developer|deepseek|kimi|technical|platform)/.test(text)) {
    return normalizeTheme({
      ...input?.theme,
      name: input?.theme?.name ?? "Editorial Tech",
      background: "#0B1117",
      foreground: "#F6F2E8",
      accent: /(comparison| vs |versus)/.test(text) ? "#8B5CF6" : "#35D0BA",
      fontFamily: "Aptos",
      titleSize: 46,
      bodySize: 21,
    })
  }
  return normalizeTheme(input?.theme)
}

export function themeCssVariables(input?: ThemeSpec) {
  const theme = inferTheme({ theme: input })
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
  const theme = inferTheme({ theme: input.theme, title: input.slide.title })
  const width = 1280
  const height = 720
  const isDivider = !input.slide.body && !(input.slide.bullets?.length)
  const titleLines = wrapWords(input.slide.title, isDivider ? 22 : 32, isDivider ? 3 : 2)
  const bodyLines = wrapWords(input.slide.body ?? "", 62, 5)
  const bullets = (input.slide.bullets ?? []).slice(0, 8)
  const titleSize = Math.max(24, Math.min(theme.titleSize, isDivider ? 64 : 54))
  const bodySize = Math.max(15, Math.min(theme.bodySize, 30))
  const bulletStartY = 285 + bodyLines.length * (bodySize + 12)
  const label = input.index === undefined ? "" : `Slide ${input.index + 1}`
  const accent = escapeXml(theme.accent)
  const background = escapeXml(theme.background)
  const foreground = escapeXml(theme.foreground)
  const font = escapeXml(theme.fontFamily)

  if (isDivider) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  <rect x="68" y="74" width="92" height="6" rx="3" fill="${accent}"/>
  <text x="68" y="118" font-family="${font}" font-size="18" font-weight="700" fill="${accent}">${escapeXml(label || theme.name)}</text>
  <text x="940" y="600" font-family="${font}" font-size="170" font-weight="700" opacity="0.10" fill="${foreground}">${escapeXml(String((input.index ?? 0) + 1).padStart(2, "0"))}</text>
  ${titleLines
    .map(
      (line, i) =>
        `<text x="68" y="${300 + i * (titleSize + 12)}" font-family="${font}" font-size="${titleSize}" font-weight="800" fill="${foreground}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  <rect x="68" y="642" width="1144" height="1" fill="${accent}" opacity="0.45"/>
</svg>
`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  <rect x="48" y="50" width="1184" height="620" rx="24" fill="${foreground}" opacity="0.06"/>
  <rect x="70" y="72" width="78" height="6" rx="3" fill="${accent}"/>
  <text x="70" y="116" font-family="${font}" font-size="17" font-weight="700" fill="${accent}">${escapeXml(label || theme.name)}</text>
  ${titleLines
    .map(
      (line, i) =>
        `<text x="70" y="${178 + i * (titleSize + 8)}" font-family="${font}" font-size="${titleSize}" font-weight="800" fill="${foreground}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${bodyLines
    .map(
      (line, i) =>
        `<text x="82" y="${262 + i * (bodySize + 12)}" font-family="${font}" font-size="${bodySize}" fill="${foreground}" opacity="0.86">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${bullets
    .flatMap((bullet, i) => {
      const priorLines = bullets
        .slice(0, i)
        .reduce((sum, prior) => sum + wrapWords(prior, 58, 2).length, 0)
      const y = bulletStartY + i * 20 + priorLines * (bodySize + 10)
      const lines = wrapWords(bullet, 58, 2)
      return [
        `<rect x="82" y="${y - 23}" width="1010" height="${Math.max(42, lines.length * (bodySize + 10) + 14)}" rx="14" fill="${foreground}" opacity="${i === 0 ? "0.11" : "0.045"}"/>`,
        `<circle cx="108" cy="${y - 8}" r="5" fill="${accent}"/>`,
        ...lines.map(
          (line, lineIndex) =>
            `<text x="130" y="${y + lineIndex * (bodySize + 8)}" font-family="${font}" font-size="${bodySize}" fill="${foreground}">${escapeXml(line)}</text>`,
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
