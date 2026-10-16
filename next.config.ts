import type { NextConfig } from "next";

// Supabase builds never ship answers, hints or the phone code: game/data/secrets.ts is
// swapped for an empty stub, and the server (Supabase) checks everything.
const supabase = process.env.NEXT_PUBLIC_GAME_BACKEND === "supabase";

// Other machines on the LAN may use the DEV server (npm run dev:lan) when their host is listed here,
// e.g. LAN_HOSTS=172.16.65.163 in .env.local. Production (npm run lan) needs nothing.
const lanHosts = (process.env.LAN_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: lanHosts,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: supabase ? { "@/game/data/secrets": "./game/data/secrets.stub.ts" } : {},
  },
};

export default nextConfig;
