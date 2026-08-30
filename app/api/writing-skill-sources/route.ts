import { noStoreJson } from '@/lib/server/api-route'
import { getWritingSkillModelSummary } from '@/lib/server/writing-skill-model-gateway'
import { listWritingSkillMaterialSources } from '@/lib/server/writing-skill-sources'

export async function GET() {
  const { librarySources, uploadedSources } = listWritingSkillMaterialSources()
  try {
    return noStoreJson({
      ok: true,
      librarySources,
      uploadedSources,
      model: getWritingSkillModelSummary(),
    })
  } catch (error) {
    return noStoreJson({
      ok: true,
      librarySources,
      uploadedSources,
      model: null,
      modelError: error instanceof Error ? error.message : '写作技巧模型未配置',
    })
  }
}
