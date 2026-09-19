#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBuildSafetyScan } from './next-build-safety-lib.mjs'

function readOption(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`[next-build-safety] ${name} requires a value`)
  return value
}

export function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/verify-next-build-safety.mjs --evidence-dir <tests/artifacts/evidence/name> [--dist-dir <path>] [--config <path>]')
    return
  }
  const repoRoot = process.cwd()
  const evidenceDir = readOption('--evidence-dir')
  const distDir = readOption('--dist-dir', process.env.RETALE_NEXT_DIST_DIR?.trim() || '.next')
  const configPath = readOption('--config', 'config/next-build-safety.json')
  const { evidence, evidencePath } = runBuildSafetyScan({ repoRoot, distDir, configPath, evidenceDir })
  for (const route of evidence.bundleScan.routes) {
    console.log(`[next-build-safety] ${route.route}: ${route.rawBytes}/${route.limits.rawBytes} raw, ${route.gzipBytes}/${route.limits.gzipBytes} gzip`)
  }
  console.log(`[next-build-safety] NFT manifests: ${evidence.traceScan.manifestCount}; unsafe paths: ${evidence.traceScan.unsafePaths.length}`)
  for (const asset of evidence.traceScan.requiredAssets.filter((candidate) => candidate.maximumManifestCount !== null || candidate.requiredManifestMatches.length > 0)) {
    console.log(`[next-build-safety] Trace asset ${asset.path ?? asset.pathPattern}: ${asset.manifestCount} manifest(s)${asset.maximumManifestCount === null ? '' : `, maximum ${asset.maximumManifestCount}`}`)
  }
  console.log(`[next-build-safety] Evidence: ${path.relative(repoRoot, evidencePath)}`)
  if (!evidence.passed) {
    const failures = [
      ...evidence.bundleScan.routes.flatMap((route) => route.failures.map((failure) => `${route.route}: ${failure}`)),
      ...evidence.traceScan.unsafePaths.map((entry) => `${entry.manifest}: ${entry.resolvedPath} (${entry.reason})`),
      ...evidence.traceScan.requiredAssets.flatMap((asset) => {
        const label = asset.path ?? asset.pathPattern
        return [
          ...(asset.manifestCount < asset.minimumManifestCount ? [`required trace asset missing: ${label}`] : []),
          ...(asset.maximumManifestCount !== null && asset.manifestCount > asset.maximumManifestCount
            ? [`trace asset appears in too many manifests: ${label} (${asset.manifestCount} > ${asset.maximumManifestCount})`]
            : []),
          ...asset.requiredManifestMatches
            .filter((match) => !match.passed)
            .map((match) => `trace asset ${label} missing from required manifest: ${match.pattern}`),
        ]
      }),
    ]
    throw new Error(`[next-build-safety] Verification failed:\n- ${failures.join('\n- ')}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
