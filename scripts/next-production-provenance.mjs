import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const NEXT_PRODUCTION_PROVENANCE_FILE = '.retale-production-build.json'

const SOURCE_ROOTS = Object.freeze(['app', 'components', 'config', 'lib', 'public', 'store', 'types'])
const SOURCE_FILES = Object.freeze([
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.example',
  'hanlp_bootstrap.py',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'mdx-components.tsx',
  'middleware.ts',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'postcss.config.mjs',
  'proxy.ts',
  'tsconfig.build.json',
  'tsconfig.json',
])

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function isStrictlyContainedPath(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
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

  const canonicalExistingPath = fs.existsSync(existingPath)
    ? fs.realpathSync.native(existingPath)
    : existingPath
  return path.join(canonicalExistingPath, ...unresolvedParts)
}

function resolveContainedDistDir(repoRoot, distDir) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedDistDir = path.resolve(resolvedRepoRoot, distDir)
  const canonicalRepoRoot = canonicalizePotentialPath(resolvedRepoRoot)
  const canonicalDistDir = canonicalizePotentialPath(resolvedDistDir)
  if (!isStrictlyContainedPath(resolvedRepoRoot, resolvedDistDir)
    || !isStrictlyContainedPath(canonicalRepoRoot, canonicalDistDir)) {
    throw new Error(`[retale-production-build] Next dist directory must stay inside the repository: ${resolvedDistDir}`)
  }
  return resolvedDistDir
}

function shouldSkipProductionInput(relativePath) {
  const normalizedPath = toPosixPath(relativePath)
  if (!normalizedPath.startsWith('scripts/')) return false
  const scriptRelativePath = normalizedPath.slice('scripts/'.length)
  return scriptRelativePath === 'fixtures'
    || scriptRelativePath.startsWith('fixtures/')
    || scriptRelativePath.split('/').includes('__pycache__')
    || /\.(?:pyc|pyo)$/iu.test(scriptRelativePath)
}

function walkProductionInput(rootPath, relativeRoot, inputs) {
  if (shouldSkipProductionInput(relativeRoot)) return
  if (!fs.existsSync(rootPath)) return
  const stats = fs.lstatSync(rootPath)
  if (!stats.isDirectory()) {
    inputs.push(toPosixPath(relativeRoot))
    return
  }
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeRoot, entry.name)
    const absolutePath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      walkProductionInput(absolutePath, relativePath, inputs)
    } else if (!shouldSkipProductionInput(relativePath)) {
      inputs.push(toPosixPath(relativePath))
    }
  }
}

function listProductionInputPaths(repoRoot) {
  const inputs = []
  for (const sourceRoot of SOURCE_ROOTS) {
    walkProductionInput(path.join(repoRoot, sourceRoot), sourceRoot, inputs)
  }
  for (const sourceFile of SOURCE_FILES) {
    if (fs.existsSync(path.join(repoRoot, sourceFile))) inputs.push(sourceFile)
  }
  walkProductionInput(path.join(repoRoot, 'scripts'), 'scripts', inputs)
  return [...new Set(inputs)].sort()
}

function hashProductionInputs(repoRoot, relativePaths) {
  const hash = crypto.createHash('sha256')
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'))
    hash.update(relativePath)
    hash.update('\0')
    try {
      const stats = fs.lstatSync(absolutePath)
      if (stats.isSymbolicLink()) {
        hash.update('symlink\0')
        hash.update(fs.readlinkSync(absolutePath))
      } else if (stats.isFile()) {
        hash.update('file\0')
        hash.update(fs.readFileSync(absolutePath))
      } else {
        hash.update(`unsupported:${stats.mode}\0`)
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        hash.update('missing\0')
      } else {
        throw new Error(`[retale-production-build] Cannot read production input ${relativePath}`, { cause: error })
      }
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** @param {string} [repoRoot] @param {Record<string, string | undefined>} [environment] */
export function resolveNextProductionDistDir(repoRoot = process.cwd(), environment = process.env) {
  const configuredDistDir = environment.RETALE_NEXT_DIST_DIR?.trim() || '.next'
  return resolveContainedDistDir(repoRoot, configuredDistDir)
}

export function computeNextProductionSourceFingerprint(repoRoot = process.cwd()) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const inputs = listProductionInputPaths(resolvedRepoRoot)
  if (inputs.length === 0) {
    throw new Error('[retale-production-build] No production source inputs were found')
  }
  return {
    algorithm: 'sha256',
    fingerprint: hashProductionInputs(resolvedRepoRoot, inputs),
    inputs,
  }
}

export function writeNextProductionBuildProvenance(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd())
  const distDir = options.distDir
    ? resolveContainedDistDir(repoRoot, options.distDir)
    : resolveNextProductionDistDir(repoRoot, options.environment)
  if (!fs.existsSync(path.join(distDir, 'BUILD_ID'))) {
    throw new Error(`[retale-production-build] Successful Next build is missing BUILD_ID: ${distDir}`)
  }
  const source = options.source ?? computeNextProductionSourceFingerprint(repoRoot)
  const provenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
  }
  const provenancePath = path.join(distDir, NEXT_PRODUCTION_PROVENANCE_FILE)
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'w' })
  return { provenance, provenancePath }
}

export function assertNextProductionBuildProvenance(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd())
  const distDir = options.distDir
    ? resolveContainedDistDir(repoRoot, options.distDir)
    : resolveNextProductionDistDir(repoRoot, options.environment)
  const provenancePath = path.join(distDir, NEXT_PRODUCTION_PROVENANCE_FILE)
  let provenance
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  } catch (error) {
    throw new Error(
      `[retale-production-build] Missing or invalid production build provenance at ${provenancePath}. Run npm run build before npm run start.`,
      { cause: error },
    )
  }
  if (provenance?.schemaVersion !== 1 || provenance?.source?.algorithm !== 'sha256'
    || typeof provenance.source.fingerprint !== 'string' || !Array.isArray(provenance.source.inputs)) {
    throw new Error(`[retale-production-build] Unsupported production build provenance at ${provenancePath}. Run npm run build again.`)
  }
  const currentSource = computeNextProductionSourceFingerprint(repoRoot)
  if (provenance.source.fingerprint !== currentSource.fingerprint) {
    throw new Error('[retale-production-build] Production sources changed after the current Next build. Run npm run build before npm run start.')
  }
  return { provenance, provenancePath, source: currentSource }
}
