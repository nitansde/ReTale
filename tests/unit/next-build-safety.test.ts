import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  assertSafeEvidenceDirectory,
  scanOutputFileTraces,
  scanRouteBundles,
  validateBuildSafetyConfig,
} from '../../scripts/next-build-safety-lib.mjs'

const repoRoot = process.cwd()

function fixtureRoot(name: string) {
  const testRoot = process.env.RETALE_TEST_ROOT
  if (!testRoot) throw new Error('Missing RETALE_TEST_ROOT')
  const root = path.join(testRoot, name)
  fs.mkdirSync(root, { recursive: true })
  return root
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

describe('Next build route bundle budgets', () => {
  it('deduplicates shared chunks and computes deterministic raw and gzip totals', () => {
    const root = fixtureRoot('next bundle fixture with spaces')
    const distDir = path.join(root, '.next')
    const shared = Buffer.from('shared-client-code'.repeat(20))
    const workspace = Buffer.from('workspace-client-code'.repeat(15))
    fs.mkdirSync(path.join(distDir, 'static', 'chunks'), { recursive: true })
    fs.writeFileSync(path.join(distDir, 'static', 'chunks', 'shared chunk.js'), shared)
    fs.writeFileSync(path.join(distDir, 'static', 'chunks', 'workspace.js'), workspace)
    writeJson(path.join(distDir, 'diagnostics', 'route-bundle-stats.json'), [
      {
        route: '/workspace',
        firstLoadUncompressedJsBytes: 999999,
        firstLoadChunkPaths: [
          '.next/static/chunks/shared chunk.js',
          '.next/static/chunks/workspace.js',
          '.next/static/chunks/shared chunk.js',
        ],
      },
    ])

    const result = scanRouteBundles({
      distDir,
      repoRoot: root,
      budgetConfig: {
        routes: {
          '/workspace': {
            rawBytes: shared.byteLength + workspace.byteLength,
            gzipBytes: gzipSync(shared, { level: 9 }).byteLength
              + gzipSync(workspace, { level: 9 }).byteLength,
          },
        },
      },
    })

    expect(result.passed).toBe(true)
    expect(result.routes[0].chunks).toHaveLength(2)
    expect(result.routes[0].rawBytes).toBe(shared.byteLength + workspace.byteLength)
  })

  it('fails when a required route or referenced chunk is missing', () => {
    const root = fixtureRoot('missing bundle fixture')
    const distDir = path.join(root, '.next')
    writeJson(path.join(distDir, 'diagnostics', 'route-bundle-stats.json'), [])

    expect(() => scanRouteBundles({
      distDir,
      repoRoot: root,
      budgetConfig: { routes: { '/library': { rawBytes: 1, gzipBytes: 1 } } },
    })).toThrow(/Missing route bundle artifacts for \/library/)
  })

  it('reports raw and gzip budget regressions', () => {
    const root = fixtureRoot('regressed bundle fixture')
    const distDir = path.join(root, 'nested', '.next')
    const chunkPath = path.join(distDir, 'static', 'chunks', 'large.js')
    fs.mkdirSync(path.dirname(chunkPath), { recursive: true })
    fs.writeFileSync(chunkPath, 'large-client-code'.repeat(50))
    writeJson(path.join(distDir, 'diagnostics', 'route-bundle-stats.json'), [{
      route: '/library',
      firstLoadChunkPaths: ['nested/.next/static/chunks/large.js'],
    }])

    const result = scanRouteBundles({
      distDir,
      repoRoot: root,
      budgetConfig: { routes: { '/library': { rawBytes: 1, gzipBytes: 1 } } },
    })

    expect(result.passed).toBe(false)
    expect(result.routes[0].failures).toEqual([
      expect.stringMatching(/^raw /),
      expect.stringMatching(/^gzip /),
    ])
  })

  it('derives webpack app-route chunks when Turbopack route stats are absent', () => {
    const root = fixtureRoot('webpack bundle fixture')
    const distDir = path.join(root, '.next')
    const shared = Buffer.from('webpack-shared-client-code'.repeat(20))
    const workspace = Buffer.from('webpack-workspace-client-code'.repeat(15))
    fs.mkdirSync(path.join(distDir, 'static', 'chunks', 'app', 'workspace'), { recursive: true })
    fs.writeFileSync(path.join(distDir, 'static', 'chunks', 'shared.js'), shared)
    fs.writeFileSync(path.join(distDir, 'static', 'chunks', 'app', 'workspace', 'page.js'), workspace)
    writeJson(path.join(distDir, 'build-manifest.json'), {
      rootMainFiles: ['static/chunks/shared.js'],
    })
    writeJson(path.join(distDir, 'app-path-routes-manifest.json'), {
      '/workspace/page': '/workspace',
    })
    const clientReferenceManifest = {
      clientModules: {
        '/fixture/app/workspace/page.tsx': {
          chunks: [
            '1',
            'static/chunks/shared.js',
            '2',
            'static/chunks/app/workspace/page.js',
          ],
        },
      },
    }
    const manifestPath = path.join(distDir, 'server', 'app', 'workspace', 'page_client-reference-manifest.js')
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    fs.writeFileSync(
      manifestPath,
      `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/workspace/page"]=${JSON.stringify(clientReferenceManifest)};`,
    )

    const result = scanRouteBundles({
      distDir,
      repoRoot: root,
      budgetConfig: {
        routes: {
          '/workspace': {
            rawBytes: shared.byteLength + workspace.byteLength,
            gzipBytes: gzipSync(shared, { level: 9 }).byteLength + gzipSync(workspace, { level: 9 }).byteLength,
          },
        },
      },
    })

    expect(result).toMatchObject({
      source: 'webpack-client-reference-manifests',
      statsPath: null,
      passed: true,
    })
    expect(result.routes[0].chunks).toHaveLength(2)
    expect(result.routes[0].rawBytes).toBe(shared.byteLength + workspace.byteLength)
  })
})

describe('Next output-file traces', () => {
  it('resolves entries relative to each manifest and verifies required runtime assets', () => {
    const root = fixtureRoot('trace fixture with spaces')
    const distDir = path.join(root, '.next')
    const manifestPath = path.join(distDir, 'server', 'app', 'api', 'route.js.nft.json')
    const hanlpPath = path.join(root, 'hanlp_bootstrap.py')
    const nativePath = path.join(root, 'node_modules', '@lancedb', 'lancedb-test', 'lancedb.test.node')
    fs.mkdirSync(path.dirname(nativePath), { recursive: true })
    fs.writeFileSync(hanlpPath, 'print("ok")')
    fs.writeFileSync(nativePath, 'native')
    writeJson(manifestPath, {
      version: 1,
      files: [
        path.relative(path.dirname(manifestPath), hanlpPath),
        path.relative(path.dirname(manifestPath), nativePath),
      ],
    })

    const result = scanOutputFileTraces({
      distDir,
      repoRoot: root,
      requiredTraceAssets: [
        { path: 'hanlp_bootstrap.py', minimumManifestCount: 1 },
        { pathPattern: 'node_modules/@lancedb/lancedb-*/lancedb.*.node', minimumManifestCount: 1 },
      ],
    })

    expect(result.passed).toBe(true)
    expect(result.manifestCount).toBe(1)
    expect(result.unsafePaths).toEqual([])
    expect(result.requiredAssets.every((asset) => asset.passed)).toBe(true)
  })

  it('rejects lexical targets outside the repository', () => {
    const root = fixtureRoot('external lexical trace')
    const distDir = path.join(root, '.next')
    const manifestPath = path.join(distDir, 'server', 'page.js.nft.json')
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-external-trace-'))
    const externalFile = path.join(externalRoot, 'corpus.txt')
    fs.writeFileSync(externalFile, 'external')
    writeJson(manifestPath, { version: 1, files: [path.relative(path.dirname(manifestPath), externalFile)] })
    try {
      const result = scanOutputFileTraces({ distDir, repoRoot: root })
      expect(result.passed).toBe(false)
      expect(result.unsafePaths).toContainEqual(expect.objectContaining({ pathKind: 'lexical', reason: 'outside-repository' }))
      expect(result.unsafePaths).toContainEqual(expect.objectContaining({ pathKind: 'canonical', reason: 'outside-repository' }))
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true })
    }
  })

  it('rejects an in-repository symlink to an external target', () => {
    const root = fixtureRoot('external symlink trace')
    const distDir = path.join(root, '.next')
    const manifestPath = path.join(distDir, 'server', 'page.js.nft.json')
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-external-symlink-'))
    fs.writeFileSync(path.join(externalRoot, 'asset.txt'), 'external')
    const linkPath = path.join(root, 'linked-assets')
    fs.symlinkSync(externalRoot, linkPath)
    writeJson(manifestPath, { version: 1, files: [path.relative(path.dirname(manifestPath), path.join(linkPath, 'asset.txt'))] })
    try {
      const result = scanOutputFileTraces({ distDir, repoRoot: root })
      expect(result.unsafePaths).toContainEqual(expect.objectContaining({ pathKind: 'canonical', reason: 'outside-repository' }))
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true })
    }
  })

  it('classifies canonical unsafe targets reached through safe lexical symlinks', () => {
    const root = fixtureRoot('canonical unsafe trace')
    const distDir = path.join(root, '.next')
    const manifestPath = path.join(distDir, 'server', 'page.js.nft.json')
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'control.sqlite3'), 'database')
    const linkPath = path.join(root, 'runtime-link')
    fs.symlinkSync(dataDir, linkPath)
    writeJson(manifestPath, { version: 1, files: [path.relative(path.dirname(manifestPath), path.join(linkPath, 'control.sqlite3'))] })

    const result = scanOutputFileTraces({ distDir, repoRoot: root })
    expect(result.unsafePaths).toContainEqual(expect.objectContaining({ pathKind: 'canonical', reason: 'database-or-sidecar' }))
  })

  it('allows build files inside a custom test artifact dist directory', () => {
    const root = fixtureRoot('custom dist trace')
    const distDir = path.join(root, 'tests', 'artifacts', 'runtime', 'owned', 'next dist')
    const manifestPath = path.join(distDir, 'server', 'page.js.nft.json')
    const buildFile = path.join(distDir, 'server', 'chunks', 'runtime.js')
    fs.mkdirSync(path.dirname(buildFile), { recursive: true })
    fs.writeFileSync(buildFile, 'build output')
    writeJson(manifestPath, { version: 1, files: [path.relative(path.dirname(manifestPath), buildFile)] })

    const result = scanOutputFileTraces({ distDir, repoRoot: root })
    expect(result.passed).toBe(true)
    expect(result.unsafePaths).toEqual([])
  })

  it.each([
    ['database', 'data/control.sqlite-wal', 'database-or-sidecar'],
    ['sqlite3', 'runtime/control.sqlite3', 'database-or-sidecar'],
    ['db journal', 'runtime/control.db-journal', 'database-or-sidecar'],
    ['sqlite journal', 'runtime/control.sqlite-journal', 'database-or-sidecar'],
    ['backup', 'backups/nightly/archive.txt', 'repository-backups'],
    ['lancedb', '.lancedb/table/file.bin', 'repository-.lancedb'],
    ['build runtime database', 'build/runtime/fixture/control.db', 'database-or-sidecar'],
    ['build runtime metadata', 'build/runtime/fixture/manifest.json', 'repository-build'],
    ['debug logs', 'logs/llm-debug/report.json', 'repository-logs'],
    ['test evidence', 'tests/artifacts/evidence/report.json', 'repository-tests'],
    ['tests', 'tests/fixtures/corpus.txt', 'repository-tests'],
    ['external corpus', 'external/corpora/book.txt', 'repository-external'],
    ['standalone corpus', 'corpora/reference/book.txt', 'repository-corpora'],
    ['QA image', 'qa/screenshots/workspace.png', 'qa-image'],
  ])('reports unsafe resolved %s paths', (_label, unsafeRelativePath, reason) => {
    const root = fixtureRoot(`unsafe trace ${String(_label)}`)
    const distDir = path.join(root, '.next')
    const manifestPath = path.join(distDir, 'server', 'page.js.nft.json')
    const unsafePath = path.join(root, unsafeRelativePath)
    writeJson(manifestPath, {
      version: 1,
      files: [path.relative(path.dirname(manifestPath), unsafePath)],
    })

    const result = scanOutputFileTraces({ distDir, repoRoot: root })

    expect(result.passed).toBe(false)
    expect(result.unsafePaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ resolvedPath: unsafeRelativePath, pathKind: 'lexical', reason }),
      expect.objectContaining({ resolvedPath: unsafeRelativePath, pathKind: 'canonical', reason }),
    ]))
  })

  it('fails required asset assertions and missing manifest directories', () => {
    const root = fixtureRoot('invalid trace fixture')
    const distDir = path.join(root, '.next')
    writeJson(path.join(distDir, 'server', 'page.js.nft.json'), { version: 1, files: [] })

    const result = scanOutputFileTraces({
      distDir,
      repoRoot: root,
      requiredTraceAssets: [{ path: 'scripts/knowledge-worker.mjs', minimumManifestCount: 1 }],
    })
    expect(result.passed).toBe(false)
    expect(result.requiredAssets[0].passed).toBe(false)
    expect(() => scanOutputFileTraces({ distDir: path.join(root, 'missing'), repoRoot: root }))
      .toThrow(/Missing Next build directory/)
  })

  it('caps an asset to its intended manifest and verifies the required route manifest', () => {
    const root = fixtureRoot('bounded trace asset fixture')
    const distDir = path.join(root, '.next')
    const assetPath = path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
    const workerManifest = path.join(distDir, 'server', 'app', 'api', 'knowledge-view', 'route.js.nft.json')
    fs.mkdirSync(path.dirname(assetPath), { recursive: true })
    fs.writeFileSync(assetPath, 'typescript runtime')
    writeJson(workerManifest, {
      version: 1,
      files: [path.relative(path.dirname(workerManifest), assetPath)],
    })
    writeJson(path.join(distDir, 'server', 'app', 'library', 'page.js.nft.json'), { version: 1, files: [] })
    writeJson(path.join(distDir, 'server', 'app', 'workspace', 'page.js.nft.json'), { version: 1, files: [] })

    const result = scanOutputFileTraces({
      distDir,
      repoRoot: root,
      requiredTraceAssets: [{
        path: 'node_modules/typescript/lib/typescript.js',
        minimumManifestCount: 1,
        maximumManifestCount: 1,
        requiredManifestPatterns: ['server/app/api/knowledge-view/route.js.nft.json'],
      }],
    })

    expect(result.passed).toBe(true)
    expect(result.requiredAssets[0]).toEqual(expect.objectContaining({
      manifestCount: 1,
      manifests: ['server/app/api/knowledge-view/route.js.nft.json'],
      maximumManifestCount: 1,
      requiredManifestMatches: [{
        pattern: 'server/app/api/knowledge-view/route.js.nft.json',
        manifests: ['server/app/api/knowledge-view/route.js.nft.json'],
        passed: true,
      }],
      passed: true,
    }))
  })

  it('fails when a bounded asset leaks into another route or misses its required manifest', () => {
    const root = fixtureRoot('leaked trace asset fixture')
    const distDir = path.join(root, '.next')
    const assetPath = path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js')
    const libraryManifest = path.join(distDir, 'server', 'app', 'library', 'page.js.nft.json')
    const workspaceManifest = path.join(distDir, 'server', 'app', 'workspace', 'page.js.nft.json')
    fs.mkdirSync(path.dirname(assetPath), { recursive: true })
    fs.writeFileSync(assetPath, 'typescript runtime')
    for (const manifestPath of [libraryManifest, workspaceManifest]) {
      writeJson(manifestPath, {
        version: 1,
        files: [path.relative(path.dirname(manifestPath), assetPath)],
      })
    }

    const result = scanOutputFileTraces({
      distDir,
      repoRoot: root,
      requiredTraceAssets: [{
        path: 'node_modules/typescript/lib/typescript.js',
        minimumManifestCount: 1,
        maximumManifestCount: 1,
        requiredManifestPatterns: ['server/app/api/knowledge-view/route.js.nft.json'],
      }],
    })

    expect(result.passed).toBe(false)
    expect(result.requiredAssets[0]).toEqual(expect.objectContaining({
      manifestCount: 2,
      maximumManifestCount: 1,
      requiredManifestMatches: [expect.objectContaining({ passed: false })],
      passed: false,
    }))
  })
})

describe('build safety evidence path', () => {
  it('accepts a caller-specified evidence child and rejects unsafe destinations', () => {
    expect(assertSafeEvidenceDirectory('tests/artifacts/evidence/build safety run', repoRoot))
      .toBe(path.join(repoRoot, 'tests', 'artifacts', 'evidence', 'build safety run'))
    expect(() => assertSafeEvidenceDirectory('tests/artifacts/evidence', repoRoot)).toThrow(/must be a child/)
    expect(() => assertSafeEvidenceDirectory('../outside', repoRoot)).toThrow(/inside the repository/)
  })

  it('rejects an evidence base symlink escape', () => {
    const syntheticRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-evidence-repo-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-evidence-external-'))
    fs.mkdirSync(path.join(syntheticRepo, 'tests', 'artifacts'), { recursive: true })
    fs.symlinkSync(externalRoot, path.join(syntheticRepo, 'tests', 'artifacts', 'evidence'))
    try {
      expect(() => assertSafeEvidenceDirectory(path.join(syntheticRepo, 'tests', 'artifacts', 'evidence', 'run'), syntheticRepo))
        .toThrow(/Canonical evidence base resolves outside/)
    } finally {
      fs.rmSync(syntheticRepo, { recursive: true, force: true })
      fs.rmSync(externalRoot, { recursive: true, force: true })
    }
  })

  it('rejects an evidence child symlink escape', () => {
    const syntheticRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-evidence-child-repo-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-evidence-child-external-'))
    const evidenceBase = path.join(syntheticRepo, 'tests', 'artifacts', 'evidence')
    fs.mkdirSync(evidenceBase, { recursive: true })
    fs.symlinkSync(externalRoot, path.join(evidenceBase, 'escaped-run'))
    try {
      expect(() => assertSafeEvidenceDirectory(path.join(evidenceBase, 'escaped-run'), syntheticRepo))
        .toThrow(/must resolve beneath canonical/)
    } finally {
      fs.rmSync(syntheticRepo, { recursive: true, force: true })
      fs.rmSync(externalRoot, { recursive: true, force: true })
    }
  })
})

describe('build safety config validation', () => {
  it('rejects malformed config shapes', () => {
    expect(() => validateBuildSafetyConfig({ schemaVersion: 1, routes: {}, requiredTraceAssets: [] }))
      .toThrow(/routes must be a non-empty object/)
    expect(() => validateBuildSafetyConfig({
      schemaVersion: 1,
      routes: { '/workspace': { rawBytes: 1, gzipBytes: 1 } },
      requiredTraceAssets: [{ path: 'a', pathPattern: 'b', minimumManifestCount: 1 }],
    })).toThrow(/exactly one of path or pathPattern/)
    expect(() => validateBuildSafetyConfig({
      schemaVersion: 1,
      routes: { '/workspace': { rawBytes: 1, gzipBytes: 1 } },
      requiredTraceAssets: [{ path: 'a', minimumManifestCount: 2, maximumManifestCount: 1 }],
    })).toThrow(/maximumManifestCount must be at least minimumManifestCount/)
    expect(() => validateBuildSafetyConfig({
      schemaVersion: 1,
      routes: { '/workspace': { rawBytes: 1, gzipBytes: 1 } },
      requiredTraceAssets: [{ path: 'a', minimumManifestCount: 1, requiredManifestPatterns: [] }],
    })).toThrow(/requiredManifestPatterns must be a non-empty string array/)
  })
})
