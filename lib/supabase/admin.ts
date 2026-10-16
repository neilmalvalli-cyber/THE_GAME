import { createClient } from '@supabase/supabase-js'

/**
 * Admin Supabase client with service_role key.
 * ONLY use in server actions and API routes.
 * This client bypasses all RLS policies.
 * NEVER import this file in client components.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL. ' +
      'These must be set in .env.local (server-side only).'
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
