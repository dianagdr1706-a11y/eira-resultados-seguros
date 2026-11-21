/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "ioredis"],
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
