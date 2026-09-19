import { BOOK_SEARCH_QUERY_LIMIT } from '@/lib/book-search'
import { apiRequestErrorResponse, noStoreJson, noStoreJsonError } from '@/lib/server/api-route'
import { getBookSearchCapabilities, searchBook } from '@/lib/server/book-search'

export async function GET(request: Request, context: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await context.params
  const params = new URL(request.url).searchParams
  if (params.get('capabilities') === '1') {
    try {
      return noStoreJson(await getBookSearchCapabilities(novelId))
    } catch (error) {
      return apiRequestErrorResponse(error) ?? noStoreJsonError('Failed to check search availability', 500)
    }
  }
  const query = params.get('q')?.trim() ?? ''
  const mode = params.get('mode') ?? 'semantic'
  if (!novelId.trim() || !query || query.length > BOOK_SEARCH_QUERY_LIMIT) {
    return noStoreJsonError(`Provide a novelId and a query of 1–${BOOK_SEARCH_QUERY_LIMIT} characters`, 400)
  }
  if (mode !== 'semantic' && mode !== 'exact') {
    return noStoreJsonError('Search mode must be semantic or exact', 400)
  }
  try {
    return noStoreJson(await searchBook(novelId, query, mode, request.signal))
  } catch (error) {
    return apiRequestErrorResponse(error) ?? noStoreJsonError('Failed to search book', 500)
  }
}
