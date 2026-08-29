import { noStoreJson } from '@/lib/server/api-route'
import { listWritingSkillMaterialSources } from '@/lib/server/writing-skill-sources'

export async function GET() {
  const { librarySources, uploadedSources } = listWritingSkillMaterialSources()
  return noStoreJson({ ok: true, librarySources, uploadedSources })
}
