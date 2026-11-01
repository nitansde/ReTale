import { NextResponse } from 'next/server'
import { decodeTextFile } from '@/lib/server/decode-text-file'
import {
  ApiRequestError,
  apiErrorResponse,
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
    const formData = await limitedRequest.formData().catch((error: unknown) => {
      if (error instanceof ApiRequestError) throw error
      throw new ApiRequestError(400, 'Invalid multipart form data')
    })
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
    return apiErrorResponse(error, '蒸馏素材上传失败')
  }
}
