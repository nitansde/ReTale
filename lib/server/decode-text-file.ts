function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return Number.POSITIVE_INFINITY

  const replacementChars = countMatches(text, /�/g)
  const privateUseChars = countMatches(text, /[\uE000-\uF8FF]/g)
  const suspiciousLatinChars = countMatches(text, /[ÃÂÄÅÆ]/g)
  const suspiciousCjkMojibakeChars = countMatches(text, /[鏈鐨銆锛紝鍦涓鏄]/g)
  const euroChars = countMatches(text, /€/g)
  const greekOrCyrillicChars = countMatches(text, /[\u0370-\u03FF\u0400-\u04FF]/g)

  return replacementChars * 40
    + privateUseChars * 16
    + euroChars * 8
    + greekOrCyrillicChars * 8
    + suspiciousLatinChars * 6
    + suspiciousCjkMojibakeChars * 4
}

export async function decodeTextFile(file: File) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const candidates = [{ text: utf8, score: scoreDecodedText(utf8) }]

  try {
    const gb18030 = new TextDecoder('gb18030', { fatal: false }).decode(buffer)
    candidates.push({ text: gb18030, score: scoreDecodedText(gb18030) })
  } catch {
    // Some runtimes may not expose gb18030. UTF-8 remains available.
  }

  candidates.sort((left, right) => left.score - right.score)
  return candidates[0]?.text ?? utf8
}
