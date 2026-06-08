import type { NextConfig } from "next";

const distDir = process.env.RETALE_NEXT_DIST_DIR?.trim() || '.next';
const tsconfigPath = process.env.RETALE_NEXT_TSCONFIG_PATH?.trim() || 'tsconfig.json';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@lancedb/lancedb'],
  outputFileTracingExcludes: {
    '/*': ['./next.config.ts'],
  },
  allowedDevOrigins: ['localhost', '127.0.0.1', 'retale.example'],
  distDir,
  typescript: {
    tsconfigPath,
  },
};

export default nextConfig;
