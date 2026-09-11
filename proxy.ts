import { apiOriginProxy } from '@/lib/server/api-origin'

export const proxy = apiOriginProxy

export const config = {
  matcher: '/api/:path*',
}
