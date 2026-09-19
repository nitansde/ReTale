import type { NextConfig } from "next";

const distDir = process.env.RETALE_NEXT_DIST_DIR?.trim() || '.next';
const tsconfigPath = process.env.RETALE_NEXT_TSCONFIG_PATH?.trim() || 'tsconfig.json';
const runtimeDataTraceExcludes = [
  './data/**/*',
  './backups/**/*',
  './dev.db',
  './dev.db-*',
  './*.db',
  './*.db-*',
  './*.sqlite',
  './*.sqlite-*',
  './.lancedb/**/*',
  './logs/**/*',
  './build/**/*',
  './tests/**/*',
  './external/**/*',
  './*.png',
];

const nextConfig: NextConfig = {
  // The draggable DevTools badge can release an expired pointer capture on touch
  // devices. Keep it out of the reader UI; runtime error overlays still work.
  devIndicators: false,
  serverExternalPackages: ['@lancedb/lancedb'],
  outputFileTracingExcludes: {
    '/*': [
      './next.config.ts',
      './scripts/typescript-runtime.mjs',
      './node_modules/typescript/**/*',
      ...runtimeDataTraceExcludes,
    ],
  },
  outputFileTracingIncludes: {
    '/api/knowledge-view': [
      './.retale-worker/knowledge-worker-runtime.mjs',
      './.retale-worker/knowledge-worker-runtime.mjs.map',
      './scripts/worker-diagnostics.mjs',
    ],
  },
  allowedDevOrigins: ['**.*'],
  experimental: {
    // Proxy buffers bodies before route handlers. Keep its cap above the largest
    // application limit (16 MiB), so bounded readers can reject oversized bodies.
    proxyClientMaxBodySize: '17mb',
  },
  distDir,
  typescript: {
    tsconfigPath,
  },
};

export default nextConfig;
