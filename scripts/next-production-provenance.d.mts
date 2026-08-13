export interface NextProductionSourceFingerprint {
  algorithm: 'sha256'
  fingerprint: string
  inputs: string[]
}

export interface NextProductionBuildProvenance {
  schemaVersion: 1
  generatedAt: string
  source: NextProductionSourceFingerprint
}

export interface NextProductionProvenanceOptions {
  repoRoot?: string
  distDir?: string
  environment?: Record<string, string | undefined>
  source?: NextProductionSourceFingerprint
}

export const NEXT_PRODUCTION_PROVENANCE_FILE: string

export function resolveNextProductionDistDir(
  repoRoot?: string,
  environment?: Record<string, string | undefined>,
): string

export function computeNextProductionSourceFingerprint(repoRoot?: string): NextProductionSourceFingerprint

export function writeNextProductionBuildProvenance(options?: NextProductionProvenanceOptions): {
  provenance: NextProductionBuildProvenance
  provenancePath: string
}

export function assertNextProductionBuildProvenance(options?: NextProductionProvenanceOptions): {
  provenance: NextProductionBuildProvenance
  provenancePath: string
  source: NextProductionSourceFingerprint
}
