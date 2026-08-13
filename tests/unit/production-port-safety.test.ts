import { describe, expect, it } from 'vitest'
import { assertPortAvailable, assertPortReleased, detectListeningPids } from '../../scripts/production-port-safety.mjs'
import { buildNextProductionStartArgs } from '../../scripts/next-production-start.mjs'

function commandError(fields: { status?: number; code?: string }) {
  return Object.assign(new Error('lsof failed'), fields)
}

describe('production port detection', () => {
  it('treats lsof status 1 as no listener', () => {
    const execute = () => { throw commandError({ status: 1 }) }
    expect(detectListeningPids(3000, { execFileSync: execute })).toEqual([])
  })

  it('fails closed when lsof is unavailable', () => {
    const execute = () => { throw commandError({ code: 'ENOENT' }) }
    expect(() => detectListeningPids(3000, { execFileSync: execute })).toThrow(/lsof is unavailable/)
  })

  it('fails closed on unexpected lsof failures', () => {
    const execute = () => { throw commandError({ status: 2 }) }
    expect(() => detectListeningPids(3000, { execFileSync: execute })).toThrow(/lsof failed while checking port 3000/)
  })

  it('rejects occupied preflight and post-cleanup ports', () => {
    const execute = () => Buffer.from('123\n456\n')
    expect(() => assertPortAvailable('127.0.0.1', 3000, { execFileSync: execute })).toThrow(/123, 456/)
    expect(() => assertPortReleased(3000, { execFileSync: execute })).toThrow(/remained occupied/)
  })
})

describe('production start binding', () => {
  it('defaults to loopback and permits explicit trusted-network overrides', () => {
    expect(buildNextProductionStartArgs([], {})).toEqual(['start', '--hostname', '127.0.0.1'])
    expect(buildNextProductionStartArgs([], { RETALE_PRODUCTION_HOST: '10.0.0.5' })).toEqual(['start', '--hostname', '10.0.0.5'])
    expect(buildNextProductionStartArgs(['--hostname', '192.168.1.8'], {})).toEqual(['start', '--hostname', '192.168.1.8'])
  })
})
