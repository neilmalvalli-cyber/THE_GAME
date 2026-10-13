'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/types/database'

export interface MarketPowerup {
  id: string
  name: string
  description: string
  effect_type: string
  price_coins: number
  duration_seconds: number | null
  is_enabled: boolean
  is_black_market?: boolean
  stock_quantity?: number | null
  configuration: Record<string, any>
}

export interface TeamInventoryItem {
  id: string
  powerup_id: string
  name: string
  description: string
  effect_type: string
  status: 'available' | 'active' | 'consumed' | 'expired'
  purchased_at: string
  activated_at: string | null
  expires_at: string | null
  configuration: Record<string, any>
}

export interface ActiveSabotage {
  type: string
  name: string
  expires_at: string
  seconds_remaining: number
}

export interface MarketData {
  team_id: string
  coin_balance: number
  standard_items: MarketPowerup[]
  black_market_items: MarketPowerup[]
  black_market_active: boolean
  black_market_seconds_remaining: number
  inventory: TeamInventoryItem[]
  rival_teams: Array<{ id: string; name: string }>
  active_sabotage: ActiveSabotage | null
  has_active_shield: boolean
}

// ============================================================
// PARTICIPANT: Get Market & Inventory Data
// ============================================================

export async function getMarketData(): Promise<ActionResult<MarketData>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: false, error: 'Not on a team', code: 'NO_TEAM' }
  const teamId = membership.team_id

  const adminDb = createAdminClient()

  // 1. Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id, settings')
    .in('status', ['live', 'paused', 'ready'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event' }

  // 2. Get coin balance
  const { data: coins } = await adminDb.rpc('get_coin_balance', {
    p_team_id: teamId,
    p_event_id: event.id,
  })

  // 3. Check Black Market status
  const settings = (event.settings as Record<string, any>) || {}
  const bmActive = Boolean(settings.black_market_active)
  let bmSecondsRemaining = 0
  if (bmActive && settings.black_market_until) {
    const diff = (new Date(settings.black_market_until).getTime() - Date.now()) / 1000
    if (diff > 0) {
      bmSecondsRemaining = Math.floor(diff)
    } else {
      // Auto-expired
      await adminDb.from('events').update({
        settings: { ...settings, black_market_active: false }
      }).eq('id', event.id)
    }
  }

  // 4. Fetch standard powerups
  const { data: standardPowerups } = await adminDb
    .from('powerups')
    .select('*')
    .eq('event_id', event.id)
    .eq('is_enabled', true)
    .order('price_coins', { ascending: true })

  // 5. Fetch black market items
  let bmItems: MarketPowerup[] = []
  if (bmActive && bmSecondsRemaining > 0) {
    const { data: rawBM } = await adminDb
      .from('black_market_items')
      .select('*')
      .eq('event_id', event.id)
      .eq('is_enabled', true)
      .order('price_coins', { ascending: true })

    if (rawBM) {
      bmItems = rawBM.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || item.effect_description || '',
        effect_type: item.name.toLowerCase().includes('time lock')
          ? 'time_lock'
          : item.name.toLowerCase().includes('glitch')
          ? 'glitch_attack'
          : item.name.toLowerCase().includes('master key')
          ? 'master_key'
          : item.name.toLowerCase().includes('forensic')
          ? 'forensic_vision'
          : item.name.toLowerCase().includes('overclock')
          ? 'overclock'
          : 'special_contraband',
        price_coins: item.price_coins,
        duration_seconds: 180,
        is_enabled: true,
        is_black_market: true,
        stock_quantity: item.stock_quantity,
        configuration: { is_black_market: true },
      }))
    }
  }

  // 6. Fetch team's inventory
  const { data: rawInventory } = await adminDb
    .from('team_powerups')
    .select('*, powerups(name, description, effect_type, configuration)')
    .eq('team_id', teamId)
    .in('status', ['available', 'active'])
    .order('purchased_at', { ascending: false })

  const now = new Date().getTime()
  const inventory: TeamInventoryItem[] = []
  let hasActiveShield = false

  for (const item of rawInventory || []) {
    const p = item.powerups || {}
    const isExpired = item.expires_at && new Date(item.expires_at).getTime() < now
    if (isExpired && item.status === 'active') {
      // Mark expired
      await adminDb.from('team_powerups').update({ status: 'expired' }).eq('id', item.id)
      continue
    }

    if (item.status === 'active' && p.effect_type === 'ghost_shield') {
      hasActiveShield = true
    }

    inventory.push({
      id: item.id,
      powerup_id: item.powerup_id,
      name: p.name || 'Power-up',
      description: p.description || '',
      effect_type: p.effect_type || '',
      status: item.status,
      purchased_at: item.purchased_at,
      activated_at: item.activated_at,
      expires_at: item.expires_at,
      configuration: p.configuration || {},
    })
  }

  // 7. Check if this team is currently under an active sabotage attack
  const { data: activeAttacks } = await adminDb
    .from('team_powerups')
    .select('*, powerups(name, effect_type)')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  let activeSabotage: ActiveSabotage | null = null
  for (const att of activeAttacks || []) {
    const p = att.powerups || {}
    if (p.effect_type === 'glitch_attack' || p.effect_type === 'time_lock') {
      const remaining = Math.max(0, Math.floor((new Date(att.expires_at).getTime() - Date.now()) / 1000))
      activeSabotage = {
        type: p.effect_type,
        name: p.name || 'Sabotage Attack',
        expires_at: att.expires_at,
        seconds_remaining: remaining,
      }
      break
    }
  }

  // 8. Fetch list of rival teams (for sabotage targeting)
  const { data: rivals } = await adminDb
    .from('teams')
    .select('id, name')
    .eq('status', 'active')
    .neq('id', teamId)
    .order('name', { ascending: true })

  return {
    success: true,
    data: {
      team_id: teamId,
      coin_balance: coins || 0,
      standard_items: (standardPowerups || []).map(p => ({
        ...p,
        is_black_market: false,
      })),
      black_market_items: bmItems,
      black_market_active: bmActive && bmSecondsRemaining > 0,
      black_market_seconds_remaining: bmSecondsRemaining,
      inventory,
      rival_teams: rivals || [],
      active_sabotage: activeSabotage,
      has_active_shield: hasActiveShield,
    },
  }
}

// ============================================================
// PARTICIPANT: Buy Item from Market / Black Market
// ============================================================

export async function buyMarketItem(params: {
  item_id: string
  is_black_market?: boolean
}): Promise<ActionResult<{ item_name: string; new_balance: number }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: false, error: 'Not on a team' }
  const teamId = membership.team_id

  const adminDb = createAdminClient()

  // Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id, settings')
    .in('status', ['live', 'ready', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event' }

  let price = 0
  let itemName = ''
  let powerupId = params.item_id

  if (params.is_black_market) {
    // Check black market item
    const { data: bmItem } = await adminDb
      .from('black_market_items')
      .select('*')
      .eq('id', params.item_id)
      .eq('event_id', event.id)
      .single()

    if (!bmItem || !bmItem.is_enabled) {
      return { success: false, error: 'Item unavailable or sold out' }
    }

    if (bmItem.stock_quantity !== null && bmItem.stock_quantity <= 0) {
      return { success: false, error: 'Stock exhausted! Out of stock.' }
    }

    price = bmItem.price_coins
    itemName = bmItem.name

    // Map to corresponding standard powerup_id for effect handling
    const effectKey = bmItem.name.toLowerCase().includes('time lock')
      ? 'time_lock'
      : bmItem.name.toLowerCase().includes('glitch')
      ? 'glitch_attack'
      : bmItem.name.toLowerCase().includes('master key')
      ? 'master_key'
      : bmItem.name.toLowerCase().includes('forensic')
      ? 'forensic_vision'
      : 'overclock'

    const { data: mappedPowerup } = await adminDb
      .from('powerups')
      .select('id')
      .eq('event_id', event.id)
      .eq('effect_type', effectKey)
      .limit(1)
      .single()

    if (mappedPowerup) powerupId = mappedPowerup.id

    // Decrement stock if limited
    if (bmItem.stock_quantity !== null) {
      await adminDb
        .from('black_market_items')
        .update({ stock_quantity: bmItem.stock_quantity - 1 })
        .eq('id', bmItem.id)
    }
  } else {
    // Standard powerup
    const { data: powerup } = await adminDb
      .from('powerups')
      .select('*')
      .eq('id', params.item_id)
      .eq('event_id', event.id)
      .single()

    if (!powerup || !powerup.is_enabled) {
      return { success: false, error: 'Powerup not found or disabled' }
    }

    price = powerup.price_coins
    itemName = powerup.name
    powerupId = powerup.id
  }

  // Check coin balance
  const { data: currentBalance } = await adminDb.rpc('get_coin_balance', {
    p_team_id: teamId,
    p_event_id: event.id,
  })

  if ((currentBalance || 0) < price) {
    return { success: false, error: `Insufficient coins. Need ${price}🪙, you have ${currentBalance || 0}🪙.` }
  }

  // Debit coins
  const { data: ledgerEntry, error: debitError } = await adminDb
    .from('coin_ledger')
    .insert({
      event_id: event.id,
      team_id: teamId,
      delta_coins: -price,
      transaction_type: 'purchase',
      reason: `Purchased ${itemName}`,
      actor_user_id: user.id,
    })
    .select('id')
    .single()

  if (debitError) {
    return { success: false, error: 'Transaction failed: ' + debitError.message }
  }

  // Grant to inventory
  const { error: invError } = await adminDb
    .from('team_powerups')
    .insert({
      team_id: teamId,
      powerup_id: powerupId,
      status: 'available',
      purchase_ledger_id: ledgerEntry?.id || null,
    })

  if (invError) {
    return { success: false, error: 'Failed to add item to inventory: ' + invError.message }
  }

  // Recalculate balance
  const { data: newBalance } = await adminDb.rpc('get_coin_balance', {
    p_team_id: teamId,
    p_event_id: event.id,
  })

  return {
    success: true,
    data: {
      item_name: itemName,
      new_balance: newBalance || 0,
    },
  }
}

// ============================================================
// PARTICIPANT: Activate / Use Power-up (Self or Sabotage Rival)
// ============================================================

export async function usePowerup(params: {
  inventory_id: string
  target_team_id?: string
}): Promise<ActionResult<{ message: string; effect_type: string; deflected?: boolean }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: false, error: 'Not on a team' }
  const myTeamId = membership.team_id

  const adminDb = createAdminClient()

  // 1. Get the item from team's inventory
  const { data: item } = await adminDb
    .from('team_powerups')
    .select('*, powerups(*)')
    .eq('id', params.inventory_id)
    .eq('team_id', myTeamId)
    .single()

  if (!item || item.status !== 'available') {
    return { success: false, error: 'Item not found in available inventory.' }
  }

  const p = item.powerups
  if (!p) return { success: false, error: 'Powerup metadata missing.' }

  const now = new Date()

  // ==========================================
  // CASE A: OFFENSIVE / SABOTAGE (Glitch Attack, Time Lock)
  // ==========================================
  if (p.effect_type === 'glitch_attack' || p.effect_type === 'time_lock') {
    if (!params.target_team_id) {
      return { success: false, error: 'Please select a rival target team to sabotage.' }
    }
    if (params.target_team_id === myTeamId) {
      return { success: false, error: 'You cannot target your own team with sabotage!' }
    }

    const { data: targetTeam } = await adminDb
      .from('teams')
      .select('id, name')
      .eq('id', params.target_team_id)
      .single()

    if (!targetTeam) return { success: false, error: 'Target rival team not found.' }

    // Check if target team has an active Ghost Shield!
    const { data: activeShield } = await adminDb
      .from('team_powerups')
      .select('id, powerups!inner(effect_type)')
      .eq('team_id', targetTeam.id)
      .eq('status', 'active')
      .eq('powerups.effect_type', 'ghost_shield')
      .limit(1)
      .single()

    if (activeShield) {
      // 🛡️ SHIELD DEFLECTS ATTACK!
      // Consume target's shield
      await adminDb.from('team_powerups').update({ status: 'consumed' }).eq('id', activeShield.id)
      // Consume attacker's powerup
      await adminDb.from('team_powerups').update({
        status: 'consumed',
        activated_at: now.toISOString(),
      }).eq('id', item.id)

      return {
        success: true,
        data: {
          effect_type: p.effect_type,
          deflected: true,
          message: `🛡️ DEFLECTED: Team "${targetTeam.name}" deployed a Ghost Shield! Your ${p.name} was absorbed.`,
        },
      }
    }

    // 💥 SABOTAGE SUCCEEDS!
    const durationSec = p.duration_seconds || 180
    const expiresAt = new Date(Date.now() + durationSec * 1000)

    // Mark attacker's powerup as consumed
    await adminDb.from('team_powerups').update({
      status: 'consumed',
      activated_at: now.toISOString(),
    }).eq('id', item.id)

    // Apply active sabotage onto the target team!
    await adminDb.from('team_powerups').insert({
      team_id: targetTeam.id,
      powerup_id: p.id,
      status: 'active',
      activated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })

    return {
      success: true,
      data: {
        effect_type: p.effect_type,
        deflected: false,
        message: `⚡ STRIKE CONFIRMED: Successfully deployed ${p.name} against "${targetTeam.name}"! Active for ${Math.round(durationSec / 60)} minutes.`,
      },
    }
  }

  // ==========================================
  // CASE B: DEFENSIVE (Ghost Shield)
  // ==========================================
  if (p.effect_type === 'ghost_shield') {
    // Check if already has an active shield
    const { data: existingShield } = await adminDb
      .from('team_powerups')
      .select('id, powerups!inner(effect_type)')
      .eq('team_id', myTeamId)
      .eq('status', 'active')
      .eq('powerups.effect_type', 'ghost_shield')
      .limit(1)
      .single()

    if (existingShield) {
      return { success: false, error: 'Your team already has a Ghost Shield active!' }
    }

    await adminDb.from('team_powerups').update({
      status: 'active',
      activated_at: now.toISOString(),
    }).eq('id', item.id)

    return {
      success: true,
      data: {
        effect_type: p.effect_type,
        message: '🛡️ GHOST SHIELD DEPLOYED: Your team is shielded against the next enemy sabotage attack.',
      },
    }
  }

  // ==========================================
  // CASE C: BOOSTER (Overclock)
  // ==========================================
  if (p.effect_type === 'overclock') {
    const expiresAt = new Date(Date.now() + (p.duration_seconds || 600) * 1000)

    await adminDb.from('team_powerups').update({
      status: 'active',
      activated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }).eq('id', item.id)

    return {
      success: true,
      data: {
        effect_type: p.effect_type,
        message: '⚡ OVERCLOCK ACTIVATED: 2x Coin Rewards enabled for 10 minutes!',
      },
    }
  }

  // ==========================================
  // CASE D: FORENSIC VISION / MASTER KEY / WAGER
  // ==========================================
  await adminDb.from('team_powerups').update({
    status: 'consumed',
    activated_at: now.toISOString(),
  }).eq('id', item.id)

  let customMessage = `Activated ${p.name}.`
  if (p.effect_type === 'forensic_vision') {
    customMessage = '🔍 FORENSIC VISION: Tactical decryption filter unlocked! Check your active challenge terminal.'
  } else if (p.effect_type === 'master_key') {
    customMessage = '🔑 MASTER KEY: Classified override token consumed! You can now bypass 1 difficult puzzle level.'
  } else if (p.effect_type === 'double_or_nothing') {
    customMessage = '🎲 DOUBLE OR NOTHING: High-stakes wager locked in! Solve next challenge on first attempt for 80 coins.'
  }

  return {
    success: true,
    data: {
      effect_type: p.effect_type,
      message: customMessage,
    },
  }
}

// ============================================================
// ADMIN: Trigger 5-Minute Black Market Flash Sale
// ============================================================

export async function adminTriggerBlackMarket(durationMinutes: number = 5): Promise<ActionResult<{ expires_at: string }>> {
  const adminDb = createAdminClient()

  const { data: event } = await adminDb
    .from('events')
    .select('id, settings')
    .in('status', ['live', 'ready', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event' }

  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
  const currentSettings = (event.settings as Record<string, any>) || {}

  const { error } = await adminDb
    .from('events')
    .update({
      settings: {
        ...currentSettings,
        black_market_active: true,
        black_market_until: expiresAt,
      },
    })
    .eq('id', event.id)

  if (error) return { success: false, error: error.message }

  return { success: true, data: { expires_at: expiresAt } }
}

export async function adminCloseBlackMarket(): Promise<ActionResult> {
  const adminDb = createAdminClient()
  const { data: event } = await adminDb
    .from('events')
    .select('id, settings')
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event' }
  const currentSettings = (event.settings as Record<string, any>) || {}

  await adminDb
    .from('events')
    .update({
      settings: { ...currentSettings, black_market_active: false },
    })
    .eq('id', event.id)

  return { success: true }
}
