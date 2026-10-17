import type { NextConfig } from "next";

const keeper = process.env.KEEPER_URL ?? "http://localhost:8790";

const config: NextConfig = {
  turbopack: { root: import.meta.dirname },
  async rewrites() {
    return [{ source: "/keeper/:path*", destination: `${keeper}/:path*` }];
  },
};

export default config;
