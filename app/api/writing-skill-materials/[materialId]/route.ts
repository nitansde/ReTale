import { jsonError, noStoreJson } from '@/lib/server/api-route'
import { deleteUploadedWritingSkillMaterial } from '@/lib/server/writing-skill-sources'

type Context = { params: Promise<{ materialId: string }> }

export async function DELETE(_request: Request, context: Context) {
  const { materialId } = await context.params
  return deleteUploadedWritingSkillMaterial(materialId)
    ? noStoreJson({ ok: true })
    : jsonError('仅蒸馏素材不存在', 404)
}
