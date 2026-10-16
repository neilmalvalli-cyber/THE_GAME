// Build-time settings (Next.js inlines NEXT_PUBLIC_* at build time).
export const env = {
  DEV: process.env.NODE_ENV !== 'production',
  /** 'supabase' = real backend through server actions; anything else = local mock. */
  BACKEND: process.env.NEXT_PUBLIC_GAME_BACKEND === 'supabase' ? 'supabase' : 'mock',
  /** Development-only mock admin password (mock backend only). */
  MOCK_ADMIN_PASSWORD: process.env.NEXT_PUBLIC_MOCK_ADMIN_PASSWORD,
  ROUTER: process.env.NEXT_PUBLIC_ROUTER,
} as const;
