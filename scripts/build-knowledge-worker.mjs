import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/** @param {{ repoRoot?: string, outdir?: string }} [options] */
export async function buildKnowledgeWorker({ repoRoot = process.cwd(), outdir } = {}) {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ['scripts/knowledge-worker-entry.ts'],
    outfile: path.join(outdir ?? path.join(repoRoot, '.retale-worker'), 'knowledge-worker-runtime.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    conditions: ['node'],
    // LanceDB loads platform-specific native libraries, already traced by Next.
    external: ['@lancedb/lancedb'],
    tsconfig: path.join(repoRoot, 'tsconfig.json'),
    sourcemap: 'linked',
    sourcesContent: false,
    metafile: true,
  })
  return result.metafile
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildKnowledgeWorker().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
