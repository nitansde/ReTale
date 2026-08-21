import { getNovelCollection } from '@/lib/server/novel-resource-handlers'

export const maxDuration = 3600

export async function GET() {
  return getNovelCollection()
}
