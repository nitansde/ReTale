export function buildNextProductionStartArgs(
  args: string[],
  environment?: Record<string, string | undefined>,
): string[]

export interface NextProductionBinding {
  hostname: string
  port: number
}

export function resolveNextProductionBinding(
  args: string[],
  environment?: Record<string, string | undefined>,
): NextProductionBinding

export function prepareNextProductionStart(
  args: string[],
  environment?: Record<string, string | undefined>,
  options?: {
    repoRoot?: string
    portDetection?: import('./production-port-safety.mjs').PortDetectionOptions
  },
): {
  binding: NextProductionBinding
  nextArgs: string[]
  provenance: ReturnType<typeof import('./next-production-provenance.mjs').assertNextProductionBuildProvenance>
}
