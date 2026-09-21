import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { assertPortAvailable, assertPortReleased, detectListeningPids } from '../../scripts/production-port-safety.mjs'
import {
  buildNextProductionStartArgs,
  prepareNextProductionStart,
  resolveNextProductionBinding,
} from '../../scripts/next-production-start.mjs'
import {
  assertNextProductionBuildProvenance,
  computeNextProductionSourceFingerprint,
  NEXT_PRODUCTION_PROVENANCE_FILE,
  resolveNextProductionDistDir,
  writeNextProductionBuildProvenance,
} from '../../scripts/next-production-provenance.mjs'
import {
  buildNextProductionBuildArgs,
  runNextProductionBuild,
} from '../../scripts/next-production-build.mjs'

const repoRoot = process.cwd()

function productionFixture(name: string) {
  const testRoot = process.env.RETALE_TEST_ROOT
  if (!testRoot) throw new Error('Missing RETALE_TEST_ROOT')
  const root = path.join(testRoot, name)
  fs.mkdirSync(path.join(root, 'app'), { recursive: true })
  fs.mkdirSync(path.join(root, '.next'), { recursive: true })
  fs.writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n')
  fs.writeFileSync(path.join(root, '.next', 'BUILD_ID'), 'fixture-build\n')
  return root
}

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
    expect(buildNextProductionStartArgs(['-Hlocalhost'], {})).toEqual(['start', '-Hlocalhost'])
  })

  it('resolves the effective CLI, environment, and default bindings', () => {
    expect(resolveNextProductionBinding([], {})).toEqual({ hostname: '127.0.0.1', port: 3000 })
    expect(resolveNextProductionBinding([], { RETALE_PRODUCTION_HOST: ' ', PORT: ' ' }))
      .toEqual({ hostname: '127.0.0.1', port: 3000 })
    expect(resolveNextProductionBinding([], { RETALE_PRODUCTION_HOST: '10.0.0.5', PORT: '4100' }))
      .toEqual({ hostname: '10.0.0.5', port: 4100 })
    expect(resolveNextProductionBinding(['--hostname=192.168.1.8', '--port', '4200'], { PORT: '4100' }))
      .toEqual({ hostname: '192.168.1.8', port: 4200 })
    expect(resolveNextProductionBinding(['-H', 'localhost', '-p', '4300'], {}))
      .toEqual({ hostname: 'localhost', port: 4300 })
    expect(resolveNextProductionBinding(['-Hlocalhost', '-p4300'], {}))
      .toEqual({ hostname: 'localhost', port: 4300 })
    expect(resolveNextProductionBinding(['-Hfirst.example', '--hostname=second.example', '-p4100', '--port=4200'], {}))
      .toEqual({ hostname: 'second.example', port: 4200 })
  })

  it('rejects invalid ports before attempting listener detection', () => {
    const fixture = productionFixture('invalid production port fixture')
    writeNextProductionBuildProvenance({ repoRoot: fixture })
    const execute = () => { throw new Error('listener detection should not run') }
    expect(() => prepareNextProductionStart(['--port', '0'], {}, { repoRoot: fixture, portDetection: { execFileSync: execute } }))
      .toThrow(/between 1 and 65535/)
    expect(() => prepareNextProductionStart([], { PORT: 'not-a-port' }, { repoRoot: fixture, portDetection: { execFileSync: execute } }))
      .toThrow(/Invalid production port/)
  })

  it('runs the occupied-port preflight before the real start wrapper can spawn Next', () => {
    const fixture = productionFixture('occupied production port fixture')
    writeNextProductionBuildProvenance({ repoRoot: fixture })
    const execute = () => Buffer.from('987\n')
    expect(() => prepareNextProductionStart(
      ['--hostname', '127.0.0.1', '--port', '4400'],
      {},
      { repoRoot: fixture, portDetection: { execFileSync: execute } },
    )).toThrow(/Refusing to use 127\.0\.0\.1:4400; listener PID\(s\): 987/)
    expect(() => prepareNextProductionStart(
      ['-Hlocalhost', '-p4400'],
      {},
      { repoRoot: fixture, portDetection: { execFileSync: execute } },
    )).toThrow(/Refusing to use localhost:4400; listener PID\(s\): 987/)
  })
})

describe('production build provenance', () => {
  it('uses webpack by default while preserving an explicit bundler selection', () => {
    expect(buildNextProductionBuildArgs([])).toEqual(['build', '--webpack'])
    expect(buildNextProductionBuildArgs(['--profile'])).toEqual(['build', '--webpack', '--profile'])
    expect(buildNextProductionBuildArgs(['--webpack'])).toEqual(['build', '--webpack'])
    expect(buildNextProductionBuildArgs(['--turbopack'])).toEqual(['build', '--turbopack'])
    expect(buildNextProductionBuildArgs(['--turbo', '--debug'])).toEqual(['build', '--turbo', '--debug'])
  })

  it('accepts unchanged tracked inputs and invalidates changed or new production inputs', () => {
    const fixture = productionFixture('production provenance fixture')
    const first = writeNextProductionBuildProvenance({ repoRoot: fixture })

    expect(first.provenancePath).toBe(path.join(fixture, '.next', NEXT_PRODUCTION_PROVENANCE_FILE))
    expect(assertNextProductionBuildProvenance({ repoRoot: fixture }).source.fingerprint)
      .toBe(first.provenance.source.fingerprint)

    fs.writeFileSync(path.join(fixture, 'app', 'page.tsx'), 'export default function Page() { return <main>changed</main> }\n')
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/sources changed/)

    fs.writeFileSync(path.join(fixture, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
    fs.mkdirSync(path.join(fixture, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'lib', 'new-runtime.ts'), 'export const runtime = true\n', { flag: 'wx' })
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/sources changed/)
  })

  it('rejects missing provenance and ignores test-only changes', () => {
    const fixture = productionFixture('production provenance test-only fixture')
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/Missing or invalid/)

    const written = writeNextProductionBuildProvenance({ repoRoot: fixture })
    fs.mkdirSync(path.join(fixture, 'tests'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'tests', 'example.test.ts'), 'throw new Error("test only")\n')
    expect(computeNextProductionSourceFingerprint(fixture).fingerprint).toBe(written.provenance.source.fingerprint)
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).not.toThrow()
  })

  it('allows missing contained dist dirs but rejects symlink escapes', () => {
    const fixture = productionFixture('canonical production dist fixture')
    expect(resolveNextProductionDistDir(fixture, { RETALE_NEXT_DIST_DIR: 'nested/future-dist' }))
      .toBe(path.join(fixture, 'nested', 'future-dist'))

    const testRoot = process.env.RETALE_TEST_ROOT
    if (!testRoot) throw new Error('Missing RETALE_TEST_ROOT')
    const outside = path.join(testRoot, 'outside-production-dist')
    fs.mkdirSync(outside, { recursive: true })
    fs.symlinkSync(outside, path.join(fixture, 'dist-link'), process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => resolveNextProductionDistDir(fixture, {
      RETALE_NEXT_DIST_DIR: 'dist-link/not-created-yet',
    })).toThrow(/must stay inside the repository/)

    const existingOutsideDist = path.join(outside, 'existing')
    fs.mkdirSync(existingOutsideDist)
    fs.writeFileSync(path.join(existingOutsideDist, 'BUILD_ID'), 'outside\n')
    expect(() => writeNextProductionBuildProvenance({
      repoRoot: fixture,
      environment: { RETALE_NEXT_DIST_DIR: 'dist-link/existing' },
    })).toThrow(/must stay inside the repository/)
    expect(fs.existsSync(path.join(existingOutsideDist, NEXT_PRODUCTION_PROVENANCE_FILE))).toBe(false)
  })

  it('invalidates changes to build-time environment files and production scripts', () => {
    const fixture = productionFixture('production provenance build inputs fixture')
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(fixture, '.env.production'), 'NEXT_PUBLIC_RELEASE=first\n')
    fs.writeFileSync(path.join(fixture, 'scripts', 'runtime-helper.mjs'), 'export const release = "first"\n')
    writeNextProductionBuildProvenance({ repoRoot: fixture })

    fs.writeFileSync(path.join(fixture, '.env.production'), 'NEXT_PUBLIC_RELEASE=second\n')
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/sources changed/)

    fs.writeFileSync(path.join(fixture, '.env.production'), 'NEXT_PUBLIC_RELEASE=first\n')
    fs.writeFileSync(path.join(fixture, 'scripts', 'runtime-helper.mjs'), 'export const release = "second"\n')
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/sources changed/)
  })

  it('ignores generated script artifacts while detecting new production scripts', () => {
    const fixture = productionFixture('filtered production script inputs fixture')
    const written = writeNextProductionBuildProvenance({ repoRoot: fixture })

    fs.mkdirSync(path.join(fixture, 'scripts', '__pycache__'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture, 'scripts', '__pycache__', 'helper.cpython-314.pyc'),
      Buffer.from([0, 1, 2]),
    )
    fs.writeFileSync(path.join(fixture, 'scripts', 'standalone-cache.pyo'), Buffer.from([3, 4, 5]))
    fs.mkdirSync(path.join(fixture, 'scripts', 'fixtures'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'scripts', 'fixtures', 'smoke.txt'), 'test only\n')

    expect(computeNextProductionSourceFingerprint(fixture).fingerprint)
      .toBe(written.provenance.source.fingerprint)
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).not.toThrow()

    fs.writeFileSync(path.join(fixture, 'scripts', 'new-runtime-helper.mjs'), 'export const runtime = true\n')
    expect(computeNextProductionSourceFingerprint(fixture).fingerprint)
      .not.toBe(written.provenance.source.fingerprint)
    expect(() => assertNextProductionBuildProvenance({ repoRoot: fixture })).toThrow(/sources changed/)
  })

  it('checks provenance before listener detection', () => {
    const fixture = productionFixture('production provenance preflight fixture')
    const execute = () => { throw new Error('listener detection should not run') }
    expect(() => prepareNextProductionStart([], {}, {
      repoRoot: fixture,
      portDetection: { execFileSync: execute },
    })).toThrow(/Run npm run build/)
  })

  it('fingerprints this repository including available dirty production sources', () => {
    const source = computeNextProductionSourceFingerprint(repoRoot)
    expect(source.inputs).toContain('package.json')
    expect(source.inputs).toContain('scripts/knowledge-worker.mjs')
    expect(source.inputs).toContain('scripts/next-production-build.mjs')
    // `.env.local` is intentionally ignored and may only exist on a developer
    // machine; provenance must include it when present without requiring it in CI.
    if (fs.existsSync(path.join(repoRoot, '.env.local'))) {
      expect(source.inputs).toContain('.env.local')
    } else {
      expect(source.inputs).not.toContain('.env.local')
    }
    expect(source.inputs).toContain('app/workspace/page.tsx')
    expect(source.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('writes provenance only after a successful build and rejects failed builds', async () => {
    const fixture = productionFixture('production build wrapper fixture')
    const successfulSpawnCalls: string[][] = []
    const buildWorker = vi.fn(async () => ({}))
    const successfulSpawn = (_command: string, args: readonly string[]) => {
      expect(buildWorker).toHaveBeenCalledWith({ repoRoot: fixture })
      successfulSpawnCalls.push([...args])
      const child = new EventEmitter() as ChildProcess
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    }
    await expect(runNextProductionBuild([], { repoRoot: fixture, spawn: successfulSpawn, buildWorker })).resolves.toEqual(
      expect.objectContaining({ provenancePath: path.join(fixture, '.next', NEXT_PRODUCTION_PROVENANCE_FILE) }),
    )
    expect(successfulSpawnCalls).toHaveLength(1)
    expect(successfulSpawnCalls[0].slice(1)).toEqual(['build', '--webpack'])

    fs.rmSync(path.join(fixture, '.next', NEXT_PRODUCTION_PROVENANCE_FILE))
    const uncalledSpawn = vi.fn()
    await expect(runNextProductionBuild([], {
      repoRoot: fixture, spawn: uncalledSpawn,
      buildWorker: async () => { throw new Error('worker compilation failed') },
    })).rejects.toThrow('worker compilation failed')
    expect(uncalledSpawn).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(fixture, '.next', NEXT_PRODUCTION_PROVENANCE_FILE))).toBe(false)
    const failedSpawn = () => {
      const child = new EventEmitter() as ChildProcess
      queueMicrotask(() => child.emit('exit', 1, null))
      return child
    }
    await expect(runNextProductionBuild([], { repoRoot: fixture, spawn: failedSpawn, buildWorker })).rejects.toThrow(/next build failed/)
    expect(fs.existsSync(path.join(fixture, '.next', NEXT_PRODUCTION_PROVENANCE_FILE))).toBe(false)
  })
})
