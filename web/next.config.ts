import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.env.INIT_CWD ?? process.cwd(),
  },
};

export default nextConfig;
