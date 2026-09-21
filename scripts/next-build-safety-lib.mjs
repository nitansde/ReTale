import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'

const UNSAFE_SEGMENTS = new Set(['data', 'backups', '.lancedb', 'logs', 'build', 'tests', 'external', 'corpora'])
const QA_IMAGE_PATTERN = /(?:^|[/\\])(?:qa|playwright|screenshots?|evidence)(?:[/\\]|[^/\\]*[-_.])[^/\\]*\.(?:png|jpe?g|webp)$/iu
const DATABASE_PATTERN = /(?:^|[/\\])[^/\\]*\.(?:db|sqlite|sqlite3)(?:(?:[.-])(?:wal|shm|journal))?$/iu
const DATABASE_SIDECAR_PATTERN = /(?:^|[/\\])[^/\\]*\.(?:wal|shm)$/iu

function readJson(filePath, label) {
  let contents
  try {
    contents = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(`[next-build-safety] Missing ${label}: ${filePath}`, { cause: error })
  }

  try {
    return JSON.parse(contents)
  } catch (error) {
    throw new Error(`[next-build-safety] Invalid JSON in ${label}: ${filePath}`, { cause: error })
  }
}

function tryReadJson(filePath, label) {
  if (!fs.existsSync(filePath)) return null
  return readJson(filePath, label)
}

function walkFiles(rootPath, predicate) {
  const files = []
  const pending = [rootPath]
  while (pending.length > 0) {
    const currentPath = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch (error) {
      throw new Error(`[next-build-safety] Cannot read build artifact directory: ${currentPath}`, { cause: error })
    }
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
      } else if (entry.isFile() && predicate(entryPath)) {
        files.push(entryPath)
      }
    }
  }
  return files.sort()
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function isContainedPath(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function canonicalizePotentialPath(candidatePath) {
  const unresolvedParts = []
  let existingPath = path.resolve(candidatePath)
  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath)
    if (parentPath === existingPath) break
    unresolvedParts.unshift(path.basename(existingPath))
    existingPath = parentPath
  }
  const canonicalExistingPath = fs.existsSync(existingPath) ? fs.realpathSync.native(existingPath) : existingPath
  return path.join(canonicalExistingPath, ...unresolvedParts)
}

function globPatternToRegExp(pattern) {
  const escaped = toPosixPath(pattern).replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`^${escaped.replaceAll('*', '[^/]*')}$`, 'u')
}

function classifyUnsafePath(resolvedPath, repoRoot) {
  const relativePath = path.relative(repoRoot, resolvedPath)
  const normalizedPath = toPosixPath(relativePath)
  if (DATABASE_PATTERN.test(normalizedPath) || DATABASE_SIDECAR_PATTERN.test(normalizedPath)) return 'database-or-sidecar'
  const segments = normalizedPath.split('/').filter(Boolean)
  const unsafeSegment = segments.find((segment) => {
    const normalizedSegment = segment.toLowerCase()
    // Dependencies such as Next ship runtime modules in their own build folders.
    // Canonical targets are checked separately, so symlinks to project build/data
    // directories still fail the scan.
    if (segments[0] === 'node_modules' && normalizedSegment === 'build') return false
    return UNSAFE_SEGMENTS.has(normalizedSegment)
  })
  if (unsafeSegment) return `repository-${unsafeSegment}`
  if (QA_IMAGE_PATTERN.test(normalizedPath)) return 'qa-image'
  return null
}

export function validateBuildSafetyConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('[next-build-safety] Build safety config must be an object')
  }
  if (config.schemaVersion !== 1) {
    throw new Error('[next-build-safety] Build safety config schemaVersion must be 1')
  }
  if (!config.routes || typeof config.routes !== 'object' || Array.isArray(config.routes) || Object.keys(config.routes).length === 0) {
    throw new Error('[next-build-safety] Build safety config routes must be a non-empty object')
  }
  for (const [route, limits] of Object.entries(config.routes)) {
    if (!route.startsWith('/') || !limits || typeof limits !== 'object' || Array.isArray(limits)) {
      throw new Error(`[next-build-safety] Invalid route budget for ${route}`)
    }
    if (!Number.isInteger(limits.rawBytes) || limits.rawBytes <= 0 || !Number.isInteger(limits.gzipBytes) || limits.gzipBytes <= 0) {
      throw new Error(`[next-build-safety] Route ${route} budgets must be positive integer byte counts`)
    }
  }
  if (!Array.isArray(config.requiredTraceAssets) || config.requiredTraceAssets.length === 0) {
    throw new Error('[next-build-safety] requiredTraceAssets must be a non-empty array')
  }
  for (const assertion of config.requiredTraceAssets) {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
      throw new Error('[next-build-safety] Each required trace asset must be an object')
    }
    const hasPath = typeof assertion.path === 'string' && assertion.path.length > 0
    const hasPattern = typeof assertion.pathPattern === 'string' && assertion.pathPattern.length > 0
    if (hasPath === hasPattern) {
      throw new Error('[next-build-safety] Each required trace asset must define exactly one of path or pathPattern')
    }
    if (!Number.isInteger(assertion.minimumManifestCount) || assertion.minimumManifestCount <= 0) {
      throw new Error('[next-build-safety] Each required trace asset minimumManifestCount must be a positive integer')
    }
    if (assertion.maximumManifestCount !== undefined) {
      if (!Number.isInteger(assertion.maximumManifestCount) || assertion.maximumManifestCount <= 0) {
        throw new Error('[next-build-safety] Each required trace asset maximumManifestCount must be a positive integer')
      }
      if (assertion.maximumManifestCount < assertion.minimumManifestCount) {
        throw new Error('[next-build-safety] Each required trace asset maximumManifestCount must be at least minimumManifestCount')
      }
    }
    if (assertion.requiredManifestPatterns !== undefined) {
      if (!Array.isArray(assertion.requiredManifestPatterns) || assertion.requiredManifestPatterns.length === 0
        || assertion.requiredManifestPatterns.some((pattern) => typeof pattern !== 'string' || pattern.length === 0)) {
        throw new Error('[next-build-safety] Each required trace asset requiredManifestPatterns must be a non-empty string array')
      }
    }
  }
  return config
}

function getGitMetadata(repoRoot) {
  function git(args) {
    try {
      return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return null
    }
  }
  return {
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
  }
}

function webpackRouteEntry(route) {
  if (route === '/') return '/page'
  return `${route.replace(/\/$/u, '')}/page`
}

function readWebpackClientReferenceManifest(manifestPath, entryName) {
  let source
  try {
    source = fs.readFileSync(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`[next-build-safety] Missing webpack client reference manifest: ${manifestPath}`, { cause: error })
  }
  const assignment = `globalThis.__RSC_MANIFEST[${JSON.stringify(entryName)}]=`
  const assignmentIndex = source.indexOf(assignment)
  if (assignmentIndex < 0) {
    throw new Error(`[next-build-safety] Missing ${entryName} entry in webpack client reference manifest: ${manifestPath}`)
  }
  const valueStart = assignmentIndex + assignment.length
  let value
  try {
    value = JSON.parse(source.slice(valueStart).replace(/;\s*$/u, ''))
  } catch (error) {
    throw new Error(`[next-build-safety] Invalid webpack client reference manifest JSON for ${entryName}: ${manifestPath}`, { cause: error })
  }
  return value
}

function loadWebpackRouteRows({ distDir, budgetConfig }) {
  const buildManifestPath = path.join(distDir, 'build-manifest.json')
  const appPathRoutesManifestPath = path.join(distDir, 'app-path-routes-manifest.json')
  const buildManifest = readJson(buildManifestPath, 'webpack build manifest')
  const appPathRoutes = readJson(appPathRoutesManifestPath, 'webpack app path routes manifest')
  if (!Array.isArray(buildManifest.rootMainFiles)) {
    throw new Error(`[next-build-safety] Invalid rootMainFiles in webpack build manifest: ${buildManifestPath}`)
  }

  return {
    source: 'webpack-client-reference-manifests',
    manifestPaths: [buildManifestPath, appPathRoutesManifestPath],
    rows: Object.keys(budgetConfig.routes ?? {}).map((route) => {
      const entryName = Object.entries(appPathRoutes).find(([, pathname]) => pathname === route)?.[0]
        ?? webpackRouteEntry(route)
      const manifestPath = path.join(
        distDir,
        'server',
        'app',
        `${entryName.replace(/^\//u, '')}_client-reference-manifest.js`,
      )
      const clientReferenceManifest = readWebpackClientReferenceManifest(manifestPath, entryName)
      const clientModules = clientReferenceManifest?.clientModules
      if (!clientModules || typeof clientModules !== 'object' || Array.isArray(clientModules)) {
        throw new Error(`[next-build-safety] Invalid clientModules for ${route} in ${manifestPath}`)
      }
      const routeChunks = Object.values(clientModules).flatMap((clientModule) => {
        if (!clientModule || !Array.isArray(clientModule.chunks)) return []
        return clientModule.chunks.filter((chunkPath) => typeof chunkPath === 'string' && chunkPath.endsWith('.js'))
      })
      return {
        route,
        firstLoadChunkPaths: [...new Set([...buildManifest.rootMainFiles, ...routeChunks])]
          .map((chunkPath) => path.join(distDir, chunkPath)),
      }
    }),
  }
}

export function scanRouteBundles({ distDir, repoRoot = path.dirname(distDir), budgetConfig }) {
  const statsPath = path.join(distDir, 'diagnostics', 'route-bundle-stats.json')
  const turbopackRows = tryReadJson(statsPath, 'Next route bundle stats')
  const bundleSource = turbopackRows === null
    ? loadWebpackRouteRows({ distDir, budgetConfig })
    : { source: 'turbopack-route-bundle-stats', manifestPaths: [statsPath], rows: turbopackRows }
  const { rows } = bundleSource
  if (!Array.isArray(rows)) {
    throw new Error(`[next-build-safety] Expected route bundle rows from ${bundleSource.manifestPaths.join(', ')}`)
  }

  const routes = []
  for (const [route, limits] of Object.entries(budgetConfig.routes ?? {})) {
    const row = rows.find((candidate) => candidate?.route === route)
    if (!row || !Array.isArray(row.firstLoadChunkPaths)) {
      throw new Error(`[next-build-safety] Missing route bundle artifacts for ${route} in ${bundleSource.manifestPaths.join(', ')}`)
    }
    const chunkPaths = [...new Set(row.firstLoadChunkPaths)].sort()
    if (chunkPaths.length === 0) {
      throw new Error(`[next-build-safety] Route ${route} has no initial JavaScript chunks in ${bundleSource.manifestPaths.join(', ')}`)
    }
    let rawBytes = 0
    let gzipBytes = 0
    const chunks = chunkPaths.map((chunkPath) => {
      const resolvedPath = path.isAbsolute(chunkPath) ? chunkPath : path.resolve(repoRoot, chunkPath)
      let contents
      try {
        contents = fs.readFileSync(resolvedPath)
      } catch (error) {
        throw new Error(`[next-build-safety] Missing initial JavaScript chunk for ${route}: ${resolvedPath}`, { cause: error })
      }
      const raw = contents.byteLength
      const gzip = gzipSync(contents, { level: 9 }).byteLength
      rawBytes += raw
      gzipBytes += gzip
      return { path: toPosixPath(path.relative(repoRoot, resolvedPath)), rawBytes: raw, gzipBytes: gzip }
    })
    const failures = []
    if (rawBytes > limits.rawBytes) failures.push(`raw ${rawBytes} > ${limits.rawBytes}`)
    if (gzipBytes > limits.gzipBytes) failures.push(`gzip ${gzipBytes} > ${limits.gzipBytes}`)
    routes.push({ route, limits, rawBytes, gzipBytes, chunks, passed: failures.length === 0, failures })
  }
  return {
    source: bundleSource.source,
    statsPath: bundleSource.source === 'turbopack-route-bundle-stats' ? statsPath : null,
    manifestPaths: bundleSource.manifestPaths,
    routes,
    passed: routes.every((route) => route.passed),
  }
}

export function scanOutputFileTraces({ distDir, repoRoot, requiredTraceAssets = [] }) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`[next-build-safety] Missing Next build directory: ${distDir}`)
  }
  const manifests = walkFiles(distDir, (filePath) => filePath.endsWith('.nft.json'))
  if (manifests.length === 0) {
    throw new Error(`[next-build-safety] No .nft.json manifests found under ${distDir}`)
  }

  const resolvedRepoRoot = path.resolve(repoRoot)
  const canonicalRepoRoot = fs.realpathSync.native(resolvedRepoRoot)
  const resolvedDistDir = path.resolve(distDir)
  const canonicalDistDir = fs.realpathSync.native(resolvedDistDir)
  const unsafePaths = []
  const resolvedEntriesByManifest = new Map()
  for (const manifestPath of manifests) {
    const manifest = readJson(manifestPath, 'NFT manifest')
    if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
      throw new Error(`[next-build-safety] Unsupported NFT manifest shape: ${manifestPath}`)
    }
    const entries = manifest.files.map((entry) => {
      const lexicalPath = path.resolve(path.dirname(manifestPath), entry)
      const canonicalPath = canonicalizePotentialPath(lexicalPath)
      return { lexicalPath, canonicalPath }
    })
    resolvedEntriesByManifest.set(manifestPath, entries)
    for (let index = 0; index < entries.length; index += 1) {
      const { lexicalPath, canonicalPath } = entries[index]
      const isBuildOutput = isContainedPath(canonicalDistDir, canonicalPath)
      const findings = []
      if (!isBuildOutput && !isContainedPath(resolvedRepoRoot, lexicalPath)) {
        findings.push({ pathKind: 'lexical', reason: 'outside-repository', targetPath: lexicalPath })
      } else if (!isBuildOutput) {
        const reason = classifyUnsafePath(lexicalPath, resolvedRepoRoot)
        if (reason) findings.push({ pathKind: 'lexical', reason, targetPath: lexicalPath })
      }
      if (!isBuildOutput && !isContainedPath(canonicalRepoRoot, canonicalPath)) {
        findings.push({ pathKind: 'canonical', reason: 'outside-repository', targetPath: canonicalPath })
      } else if (!isBuildOutput) {
        const reason = classifyUnsafePath(canonicalPath, canonicalRepoRoot)
        if (reason) findings.push({ pathKind: 'canonical', reason, targetPath: canonicalPath })
      }
      const uniqueFindings = findings.filter((finding, findingIndex) => findings.findIndex((candidate) => candidate.pathKind === finding.pathKind && candidate.reason === finding.reason && candidate.targetPath === finding.targetPath) === findingIndex)
      for (const finding of uniqueFindings) {
        unsafePaths.push({
          manifest: toPosixPath(path.relative(resolvedDistDir, manifestPath)),
          entry: manifest.files[index],
          resolvedPath: toPosixPath(path.relative(resolvedRepoRoot, finding.targetPath)),
          pathKind: finding.pathKind,
          reason: finding.reason,
        })
      }
    }
  }

  const requiredAssets = requiredTraceAssets.map((assertion) => {
    const matcher = assertion.path
      ? (entry) => entry.lexicalPath === path.resolve(resolvedRepoRoot, assertion.path) || entry.canonicalPath === canonicalizePotentialPath(path.resolve(resolvedRepoRoot, assertion.path))
      : (entry) => globPatternToRegExp(assertion.pathPattern).test(toPosixPath(path.relative(resolvedRepoRoot, entry.lexicalPath)))
    const manifestsContainingAsset = [...resolvedEntriesByManifest.entries()]
      .filter(([, entries]) => entries.some(matcher))
      .map(([manifestPath]) => toPosixPath(path.relative(distDir, manifestPath)))
      .sort()
    const minimumManifestCount = assertion.minimumManifestCount ?? 1
    const maximumManifestCount = assertion.maximumManifestCount ?? null
    const requiredManifestMatches = (assertion.requiredManifestPatterns ?? []).map((pattern) => {
      const manifestMatcher = globPatternToRegExp(pattern)
      const matchingManifests = manifestsContainingAsset.filter((manifest) => manifestMatcher.test(manifest))
      return {
        pattern,
        manifests: matchingManifests,
        passed: matchingManifests.length > 0,
      }
    })
    return {
      path: assertion.path ?? null,
      pathPattern: assertion.pathPattern ?? null,
      minimumManifestCount,
      maximumManifestCount,
      manifestCount: manifestsContainingAsset.length,
      manifests: manifestsContainingAsset,
      requiredManifestMatches,
      passed: manifestsContainingAsset.length >= minimumManifestCount
        && (maximumManifestCount === null || manifestsContainingAsset.length <= maximumManifestCount)
        && requiredManifestMatches.every((match) => match.passed),
    }
  })

  return {
    manifestCount: manifests.length,
    manifests: manifests.map((manifestPath) => toPosixPath(path.relative(distDir, manifestPath))),
    unsafePaths,
    requiredAssets,
    passed: unsafePaths.length === 0 && requiredAssets.every((asset) => asset.passed),
  }
}

export function assertSafeEvidenceDirectory(evidenceDir, repoRoot) {
  if (!evidenceDir) throw new Error('[next-build-safety] --evidence-dir is required')
  const resolvedEvidenceDir = path.resolve(evidenceDir)
  const resolvedRepoRoot = path.resolve(repoRoot)
  if (resolvedEvidenceDir === resolvedRepoRoot) {
    throw new Error('[next-build-safety] Evidence directory must not be the repository root')
  }
  const relativePath = path.relative(resolvedRepoRoot, resolvedEvidenceDir)
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`[next-build-safety] Evidence directory must stay inside the repository: ${resolvedEvidenceDir}`)
  }
  const segments = toPosixPath(relativePath).split('/')
  if (segments[0] !== 'tests' || segments[1] !== 'artifacts' || segments[2] !== 'evidence' || segments.length < 4) {
    throw new Error(`[next-build-safety] Evidence directory must be a child of tests/artifacts/evidence: ${resolvedEvidenceDir}`)
  }
  const canonicalRepoRoot = fs.realpathSync.native(resolvedRepoRoot)
  const evidenceBase = path.join(resolvedRepoRoot, 'tests', 'artifacts', 'evidence')
  fs.mkdirSync(evidenceBase, { recursive: true })
  const canonicalEvidenceBase = fs.realpathSync.native(evidenceBase)
  if (!isContainedPath(canonicalRepoRoot, canonicalEvidenceBase)) {
    throw new Error(`[next-build-safety] Canonical evidence base resolves outside the repository: ${canonicalEvidenceBase}`)
  }
  const canonicalEvidenceDir = canonicalizePotentialPath(resolvedEvidenceDir)
  if (!isContainedPath(canonicalEvidenceBase, canonicalEvidenceDir) || canonicalEvidenceBase === canonicalEvidenceDir) {
    throw new Error(`[next-build-safety] Evidence directory must resolve beneath canonical tests/artifacts/evidence: ${resolvedEvidenceDir}`)
  }
  return resolvedEvidenceDir
}

export function runBuildSafetyScan({ repoRoot, distDir, configPath, evidenceDir, now = new Date() }) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedDistDir = path.resolve(resolvedRepoRoot, distDir)
  const resolvedConfigPath = path.resolve(resolvedRepoRoot, configPath)
  const resolvedEvidenceDir = assertSafeEvidenceDirectory(evidenceDir, resolvedRepoRoot)
  const baseEvidence = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      next: readJson(path.join(resolvedRepoRoot, 'node_modules', 'next', 'package.json'), 'Next package').version,
      ci: process.env.CI ?? null,
    },
    git: getGitMetadata(resolvedRepoRoot),
    inputs: {
      distDir: toPosixPath(path.relative(resolvedRepoRoot, resolvedDistDir)),
      configPath: toPosixPath(path.relative(resolvedRepoRoot, resolvedConfigPath)),
    },
  }
  fs.mkdirSync(resolvedEvidenceDir, { recursive: true })
  const evidencePath = path.join(resolvedEvidenceDir, 'next-build-safety.json')
  try {
    const budgetConfig = validateBuildSafetyConfig(readJson(resolvedConfigPath, 'build safety config'))
    const bundleScan = scanRouteBundles({ distDir: resolvedDistDir, repoRoot: resolvedRepoRoot, budgetConfig })
    const traceScan = scanOutputFileTraces({
      distDir: resolvedDistDir,
      repoRoot: resolvedRepoRoot,
      requiredTraceAssets: budgetConfig.requiredTraceAssets,
    })
    const evidence = {
      ...baseEvidence,
      passed: bundleScan.passed && traceScan.passed,
      error: null,
      bundleScan,
      traceScan,
    }
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    return { evidence, evidencePath }
  } catch (error) {
    const evidence = {
      ...baseEvidence,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      bundleScan: null,
      traceScan: null,
    }
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    throw new Error(`${evidence.error}\n[next-build-safety] Failure evidence: ${toPosixPath(path.relative(resolvedRepoRoot, evidencePath))}`, { cause: error })
  }
}
