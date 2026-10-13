'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!roleData || roleData.role !== 'admin') {
    throw new Error('Forbidden')
  }

  return user
}

export async function getActiveEvent(): Promise<ActionResult<any>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .in('status', ['draft', 'ready', 'live', 'paused', 'ended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data }
}

export async function adminUpdateEventStatus(eventId: string, status: 'draft' | 'ready' | 'live' | 'paused' | 'ended'): Promise<ActionResult> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const adminDb = createAdminClient()
  const { error } = await adminDb
    .from('events')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', eventId)

  if (error) {
    return { success: false, error: error.message }
  }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'update_event_status',
    target_type: 'event',
    target_id: eventId,
    metadata: { status },
  })

  return { success: true }
}

export async function adminCreateDefaultEvent(): Promise<ActionResult<any>> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const adminDb = createAdminClient()
  const { data, error } = await adminDb
    .from('events')
    .insert({
      name: 'THE HUNT 2026',
      description: 'Official CSI NMAMIT Digital Treasure Hunt',
      status: 'live',
      starts_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data }
}
