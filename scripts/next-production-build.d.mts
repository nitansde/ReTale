import type { ChildProcess } from 'node:child_process'
import type { NextProductionBuildProvenance } from './next-production-provenance.mjs'

export function buildNextProductionBuildArgs(args?: string[]): string[]

export function runNextProductionBuild(
  args?: string[],
  options?: {
    repoRoot?: string
    environment?: Record<string, string | undefined>
    spawn?: (
      command: string,
      args: readonly string[],
      options: { cwd: string; env: Record<string, string | undefined>; stdio: 'inherit' },
    ) => Pick<ChildProcess, 'once' | 'kill' | 'exitCode' | 'signalCode' | 'killed'>
  },
): Promise<{
  provenance: NextProductionBuildProvenance
  provenancePath: string
}>
