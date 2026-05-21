import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@lancedb/lancedb'],
  allowedDevOrigins: ['localhost', '127.0.0.1', 'retale.example'],
};

export default nextConfig;
