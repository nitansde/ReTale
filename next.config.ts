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
  './.sisyphus/**/*',
  './tests/**/*',
  './external/**/*',
  './*.png',
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['@lancedb/lancedb'],
  outputFileTracingExcludes: {
    '/*': ['./next.config.ts', ...runtimeDataTraceExcludes],
  },
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/typescript/package.json',
      './node_modules/typescript/lib/typescript.js',
    ],
  },
  allowedDevOrigins: ['localhost', '127.0.0.1', 'retale.example'],
  distDir,
  typescript: {
    tsconfigPath,
  },
};

export default nextConfig;
