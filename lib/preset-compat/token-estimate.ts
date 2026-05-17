export function estimatePresetCompatTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, '').length / 1.6))
}
