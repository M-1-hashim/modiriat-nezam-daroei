import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output works on Vercel automatically and is also useful for self-hosting (Docker/VPS).
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Some backend routes use the Node.js runtime (crypto, fs, ssh2) — keep them on Node.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
