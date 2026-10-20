import type { NextConfig } from "next";

const keeper = process.env.KEEPER_URL ?? "http://localhost:8790";
/** `UPTICK_EXPORT=1` builds the static site (out/) for Cloudflare Pages: no server, so no rewrite; the browser reaches the stats API at NEXT_PUBLIC_KEEPER_BASE. */
const exporting = process.env.UPTICK_EXPORT === "1";

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: import.meta.dirname },
  ...(exporting
    ? { output: "export" as const }
    : { async rewrites() { return [{ source: "/keeper/:path*", destination: `${keeper}/:path*` }]; } }),
};

export default config;
