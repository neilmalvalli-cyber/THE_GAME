import type { NextConfig } from "next";

// Supabase builds never ship answers, hints or the phone code: game/data/secrets.ts is
// swapped for an empty stub, and the server (Supabase) checks everything.
const supabase = process.env.NEXT_PUBLIC_GAME_BACKEND === "supabase";

const nextConfig: NextConfig = {
  devIndicators: false,
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
