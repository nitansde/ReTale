import { NextResponse } from 'next/server'
import {
  ApiRequestError,
  assertMultipartFormDataMediaType,
  createByteLimitedRequest,
  noStoreJson,
} from '@/lib/server/api-route'
import {
  createUploadedWritingSkillMaterial,
  listUploadedWritingSkillMaterials,
} from '@/lib/server/writing-skill-sources'

export const maxDuration = 3600

const MAX_MATERIAL_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_MATERIAL_BODY_SIZE_BYTES = MAX_MATERIAL_FILE_SIZE_BYTES + 256 * 1024

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return Number.POSITIVE_INFINITY
  return countMatches(text, /�/g) * 40
    + countMatches(text, /[\uE000-\uF8FF]/g) * 16
    + countMatches(text, /€/g) * 8
    + countMatches(text, /[\u0370-\u03FF\u0400-\u04FF]/g) * 8
    + countMatches(text, /[ÃÂÄÅÆ]/g) * 6
    + countMatches(text, /[鏈鐨銆锛紝鍦涓鏄]/g) * 4
}

async function decodeTextFile(file: File) {
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

export async function GET() {
  return noStoreJson({ ok: true, materials: listUploadedWritingSkillMaterials() })
}

export async function POST(request: Request) {
  try {
    assertMultipartFormDataMediaType(request)
    const limitedRequest = createByteLimitedRequest(
      request,
      MAX_MATERIAL_BODY_SIZE_BYTES,
      '蒸馏素材上传不能超过 10 MiB',
    )
    const formData = await limitedRequest.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '请选择 TXT 文件' }, { status: 400 })
    }
    if (file.size > MAX_MATERIAL_FILE_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: '蒸馏素材上传不能超过 10 MiB' }, { status: 413 })
    }
    const rawText = await decodeTextFile(file)
    const material = createUploadedWritingSkillMaterial({
      title: file.name.replace(/\.[^.]+$/, ''),
      rawText,
      byteSize: file.size,
    })
    return NextResponse.json({ ok: true, material }, { status: 201 })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : '蒸馏素材上传失败',
    }, { status: 400 })
  }
}
