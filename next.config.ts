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
  './.omo/**/*',
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
    '/api/knowledge-view': [
      './node_modules/typescript/package.json',
      './node_modules/typescript/lib/typescript.js',
    ],
  },
  allowedDevOrigins: ['**.*'],
  headers() {
    return [{
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
        {
          key: 'Access-Control-Allow-Headers',
          value: 'Content-Type, Idempotency-Key, X-Retale-Base-Revision, X-Retale-Revision-Novel-Id, X-Retale-Resource-Novel-Id, X-Retale-Resource-Chapter-Id, X-Retale-Resource-Delete',
        },
        {
          key: 'Access-Control-Expose-Headers',
          value: 'ETag, X-Retale-Workspace-Revision, X-Retale-Revision-Novel-Id',
        },
      ],
    }]
  },
  distDir,
  typescript: {
    tsconfigPath,
  },
};

export default nextConfig;
