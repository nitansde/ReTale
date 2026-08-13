export interface RouteBudget {
  rawBytes: number
  gzipBytes: number
}

export interface RequiredTraceAsset {
  path?: string
  pathPattern?: string
  minimumManifestCount?: number
  maximumManifestCount?: number
  requiredManifestPatterns?: string[]
}

export interface BuildSafetyConfig {
  schemaVersion: 1
  routes: Record<string, RouteBudget>
  requiredTraceAssets: RequiredTraceAsset[]
}

export interface RouteChunkMeasurement {
  path: string
  rawBytes: number
  gzipBytes: number
}

export interface RouteBundleMeasurement {
  route: string
  limits: RouteBudget
  rawBytes: number
  gzipBytes: number
  chunks: RouteChunkMeasurement[]
  passed: boolean
  failures: string[]
}

export interface RouteBundleScan {
  source: 'turbopack-route-bundle-stats' | 'webpack-client-reference-manifests'
  statsPath: string | null
  manifestPaths: string[]
  routes: RouteBundleMeasurement[]
  passed: boolean
}

export interface UnsafeTracePath {
  manifest: string
  entry: string
  resolvedPath: string
  pathKind: 'lexical' | 'canonical'
  reason: string
}

export interface RequiredTraceAssetResult {
  path: string | null
  pathPattern: string | null
  minimumManifestCount: number
  maximumManifestCount: number | null
  manifestCount: number
  manifests: string[]
  requiredManifestMatches: Array<{
    pattern: string
    manifests: string[]
    passed: boolean
  }>
  passed: boolean
}

export interface OutputFileTraceScan {
  manifestCount: number
  manifests: string[]
  unsafePaths: UnsafeTracePath[]
  requiredAssets: RequiredTraceAssetResult[]
  passed: boolean
}

export interface BuildSafetyEvidenceBase {
  schemaVersion: number
  generatedAt: string
  environment: {
    platform: NodeJS.Platform
    arch: string
    node: string
    next: string
    ci: string | null
  }
  git: {
    commit: string | null
    branch: string | null
    dirty: boolean
  }
  inputs: {
    distDir: string
    configPath: string
  }
}

export interface SuccessfulBuildSafetyEvidence extends BuildSafetyEvidenceBase {
  passed: true
  error: null
  bundleScan: RouteBundleScan
  traceScan: OutputFileTraceScan
}

export interface FailedBuildSafetyEvidence extends BuildSafetyEvidenceBase {
  passed: false
  error: string | null
  bundleScan: RouteBundleScan | null
  traceScan: OutputFileTraceScan | null
}

export type BuildSafetyEvidence = SuccessfulBuildSafetyEvidence | FailedBuildSafetyEvidence

export function validateBuildSafetyConfig(config: unknown): BuildSafetyConfig

export function scanRouteBundles(options: {
  distDir: string
  repoRoot?: string
  budgetConfig: Pick<BuildSafetyConfig, 'routes'>
}): RouteBundleScan

export function scanOutputFileTraces(options: {
  distDir: string
  repoRoot: string
  requiredTraceAssets?: RequiredTraceAsset[]
}): OutputFileTraceScan

export function assertSafeEvidenceDirectory(evidenceDir: string, repoRoot: string): string

export function runBuildSafetyScan(options: {
  repoRoot: string
  distDir: string
  configPath: string
  evidenceDir: string
  now?: Date
}): {
  evidence: BuildSafetyEvidence
  evidencePath: string
}
