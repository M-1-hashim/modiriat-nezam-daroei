import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output works on Vercel automatically and is also useful for self-hosting (Docker/VPS).
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ssh2 و mysql2 از ماژول‌های Native Node.js استفاده می‌کنند که Turbopack نمی‌تواند آن‌ها را به‌درستی bundle کند.
  // با قرار دادن آن‌ها در serverExternalPackages، Next.js آن‌ها را به‌عنوان وابستگی خارجی در نظر می‌گیرد و
  // در ران‌تایم Node.js به‌صورت require() بارگذاری می‌کند.
  serverExternalPackages: ["ssh2", "mysql2"],
  // حداکثر حجم بدنه برای server actions (چاپ فاکتور/رسید و upload فایل backup)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
