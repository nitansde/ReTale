import { readNovelCoverFile } from '@/lib/server/novel-cover'

export async function GET(_request: Request, context: { params: Promise<{ novelId: string }> }) {
  const { novelId: rawNovelId } = await context.params
  const novelId = rawNovelId.trim()
  if (!novelId) return new Response(null, { status: 404 })

  try {
    const cover = await readNovelCoverFile(novelId)
    if (!cover) return new Response(null, { status: 404 })
    return new Response(cover.bytes, {
      headers: {
        'Content-Type': cover.contentType,
        'Content-Length': String(cover.bytes.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Failed to read novel cover:', error)
    return new Response(null, { status: 500 })
  }
}
