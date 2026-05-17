import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@lancedb/lancedb'],
  allowedDevOrigins: ['retale.example'],
};

export default nextConfig;
