import { NextResponse } from 'next/server'

export function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid JSON body')
  }

  return body as Record<string, unknown>
}

export function requireNonEmptyId(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${field} is required`)
  }

  return normalized
}

export function isNotFoundErrorMessage(message: string) {
  return /not found|does not belong|not accessible/u.test(message)
}

export function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
