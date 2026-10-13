'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { getMarketData, buyMarketItem, usePowerup, type MarketData, type MarketPowerup, type TeamInventoryItem } from '@/actions/market'

export default function MarketPage() {
  const [data, setData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'standard' | 'black_market'>('standard')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  // Target selection modal state for sabotage
  const [targetModalOpen, setTargetModalOpen] = useState(false)
  const [selectedPowerup, setSelectedPowerup] = useState<TeamInventoryItem | null>(null)
  const [selectedRivalId, setSelectedRivalId] = useState('')

  // Live countdown timer for Black Market
  const [flashSeconds, setFlashSeconds] = useState(0)

  async function loadData() {
    try {
      const res = await getMarketData()
      if (res.success && res.data) {
        setData(res.data)
        setFlashSeconds(res.data.black_market_seconds_remaining || 0)
        // If black market is active and user hasn't switched, default to black market
        if (res.data.black_market_active) {
          setTab('black_market')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Timer countdown
  useEffect(() => {
    if (flashSeconds <= 0) return
    const interval = setInterval(() => {
      setFlashSeconds((prev) => {
        if (prev <= 1) {
          loadData() // Refresh status when timer hits 0
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [flashSeconds])

  function showNotice(type: 'success' | 'error', text: string) {
    setNotice({ type, text })
    setTimeout(() => setNotice(null), 7000)
  }

  function handleBuy(item: MarketPowerup) {
    if (!data) return
    if (data.coin_balance < item.price_coins) {
      showNotice('error', `Insufficient funds! You need ${item.price_coins}🪙, but have ${data.coin_balance}🪙.`)
      return
    }

    startTransition(async () => {
      const res = await buyMarketItem({
        item_id: item.id,
        is_black_market: item.is_black_market,
      })

      if (res.success && res.data) {
        showNotice('success', `🎉 Acquired ${res.data.item_name}! New balance: ${res.data.new_balance}🪙`)
        loadData()
      } else {
        showNotice('error', res.error || 'Purchase failed.')
      }
    })
  }

  function handleUseClick(invItem: TeamInventoryItem) {
    // If offensive, open target selection modal
    if (invItem.effect_type === 'glitch_attack' || invItem.effect_type === 'time_lock') {
      setSelectedPowerup(invItem)
      setSelectedRivalId(data?.rival_teams[0]?.id || '')
      setTargetModalOpen(true)
      return
    }

    // Defensive / Utility powerup — activate immediately
    startTransition(async () => {
      const res = await usePowerup({ inventory_id: invItem.id })
      if (res.success && res.data) {
        showNotice('success', res.data.message)
        loadData()
      } else {
        showNotice('error', res.error || 'Activation failed.')
      }
    })
  }

  function handleConfirmSabotage() {
    if (!selectedPowerup || !selectedRivalId) return

    startTransition(async () => {
      const res = await usePowerup({
        inventory_id: selectedPowerup.id,
        target_team_id: selectedRivalId,
      })

      setTargetModalOpen(false)
      setSelectedPowerup(null)

      if (res.success && res.data) {
        if (res.data.deflected) {
          showNotice('error', res.data.message)
        } else {
          showNotice('success', res.data.message)
        }
        loadData()
      } else {
        showNotice('error', res.error || 'Sabotage failed.')
      }
    })
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className={`min-h-screen text-zinc-100 font-sans ${
      data?.active_sabotage?.type === 'glitch_attack'
        ? 'bg-[#0e0712] animate-pulse selection:bg-rose-500 selection:text-white'
        : 'bg-[#090a0f] selection:bg-amber-500 selection:text-black'
    }`}>
      {/* Top Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              ← Dashboard
            </Link>
            <div className="h-4 w-px bg-zinc-800" />
            <h1 className="text-sm font-black tracking-widest text-white uppercase flex items-center gap-2">
              <span>🛒</span>
              <span>Tactical Bazaar & Armory</span>
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 font-mono">
              <span>🪙</span>
              <span>{data?.coin_balance ?? 0} coins</span>
            </div>

            <Link
              href="/leaderboard"
              className="text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-lg transition-colors"
            >
              🏆 Scoreboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Notice Alert */}
        {notice && (
          <div className={`p-4 rounded-xl text-xs font-semibold border flex items-center justify-between shadow-lg ${
            notice.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
              : 'bg-red-950/70 border-red-800 text-red-200'
          }`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-zinc-400 hover:text-white">✕</button>
          </div>
        )}

        {/* ACTIVE SABOTAGE ALERT BANNER ON MY TEAM */}
        {data?.active_sabotage && (
          <div className="p-4 bg-red-950/60 border-2 border-red-600 rounded-2xl flex items-center justify-between animate-pulse shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚨</span>
              <div>
                <h2 className="text-sm font-black text-red-200 uppercase tracking-wider">
                  CRITICAL WARNING: {data.active_sabotage.name.toUpperCase()} ACTIVE ON YOUR HUD!
                </h2>
                <p className="text-xs text-red-300/80">
                  A rival operative infected your terminal with cyber distortion. Purging in{' '}
                  <strong className="font-mono text-white">{formatTime(data.active_sabotage.seconds_remaining)}</strong>.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-red-300 bg-red-900/60 px-3 py-1.5 rounded-lg border border-red-700">
              {formatTime(data.active_sabotage.seconds_remaining)}
            </span>
          </div>
        )}

        {/* GHOST SHIELD STATUS BANNER */}
        {data?.has_active_shield && (
          <div className="p-3.5 bg-cyan-950/40 border border-cyan-800/80 rounded-xl flex items-center justify-between text-xs text-cyan-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span>🛡️</span>
              <span><strong>GHOST SHIELD OPERATIONAL:</strong> Your team is protected against the next incoming sabotage strike.</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-700">
              Active Protection
            </span>
          </div>
        )}

        {/* ========================================================
            SECTION 1: TACTICAL INVENTORY (OWNED POWER-UPS)
           ======================================================== */}
        <section className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>🎒</span>
                <span>Team Tactical Inventory ({data?.inventory?.length || 0})</span>
              </h2>
              <p className="text-xs text-zinc-500">Deploy purchased equipment and offensive sabotage against rivals</p>
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500 font-mono">Scanning armory lockers...</div>
          ) : !data?.inventory || data.inventory.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No equipment stored in your team locker. Purchase power-ups below to equip your operatives.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.inventory.map((inv) => {
                const isOffensive = inv.effect_type === 'glitch_attack' || inv.effect_type === 'time_lock'
                const isShield = inv.effect_type === 'ghost_shield'
                const isOverclock = inv.effect_type === 'overclock'
                const isActive = inv.status === 'active'

                return (
                  <div
                    key={inv.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-cyan-950/20 border-cyan-800/70 shadow-cyan-950/30'
                        : isOffensive
                        ? 'bg-red-950/10 border-red-900/40 hover:border-red-700/60'
                        : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">
                            {isShield ? '🛡️' : isOffensive ? '⚡' : isOverclock ? '🚀' : '💎'}
                          </span>
                          <h3 className="text-xs font-bold text-white">{inv.name}</h3>
                        </div>
                        <span className="text-[10px] text-zinc-500 block line-clamp-1 mt-0.5">
                          {inv.description}
                        </span>
                      </div>

                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                        isActive
                          ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-700'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {isActive ? 'Active' : 'Ready'}
                      </span>
                    </div>

                    {!isActive && (
                      <button
                        onClick={() => handleUseClick(inv)}
                        disabled={isPending}
                        className={`w-full py-2 mt-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-md ${
                          isOffensive
                            ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/40'
                            : isShield
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/40'
                            : 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-900/40'
                        } disabled:opacity-50`}
                      >
                        {isOffensive ? 'Target Rival 🎯' : 'Deploy Equipment ⚡'}
                      </button>
                    )}

                    {isActive && (
                      <div className="mt-2 text-center text-[10px] font-mono text-cyan-400 bg-cyan-950/40 py-1 rounded border border-cyan-900/60">
                        Operational & Defending
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ========================================================
            SECTION 2: BAZAAR CATALOG TABS
           ======================================================== */}
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
              <button
                onClick={() => setTab('standard')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  tab === 'standard'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Standard Procurement (24/7)
              </button>

              <button
                onClick={() => setTab('black_market')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  tab === 'black_market'
                    ? 'bg-gradient-to-r from-red-600 to-rose-700 text-white shadow-lg shadow-red-950'
                    : 'text-red-400 hover:text-red-300'
                }`}
              >
                <span>🔥 Black Market</span>
                {data?.black_market_active ? (
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                ) : (
                  <span className="text-[10px] text-zinc-500 font-normal">🔒 Locked</span>
                )}
              </button>
            </div>

            {/* Black Market Flash Timer Banner */}
            {data?.black_market_active && (
              <div className="flex items-center gap-2 text-xs bg-red-950/60 border border-red-800 text-red-200 px-3.5 py-1.5 rounded-xl font-mono animate-pulse">
                <span>⏱️</span>
                <span>FLASH WINDOW CLOSING IN: <strong>{formatTime(flashSeconds)}</strong></span>
              </div>
            )}
          </div>

          {/* TAB 1: STANDARD PROCUREMENT */}
          {tab === 'standard' && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data?.standard_items?.map((item) => {
                const canAfford = (data?.coin_balance ?? 0) >= item.price_coins
                const isOffensive = item.effect_type === 'glitch_attack' || item.effect_type === 'time_lock'
                const isShield = item.effect_type === 'ghost_shield'

                return (
                  <div
                    key={item.id}
                    className="p-5 bg-zinc-900/70 border border-zinc-800 rounded-2xl flex flex-col justify-between hover:border-zinc-700 transition-all shadow-lg"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">
                            {isShield ? '🛡️' : isOffensive ? '⚡' : '💎'}
                          </span>
                          <h3 className="text-sm font-bold text-white">{item.name}</h3>
                        </div>

                        <span className="font-mono font-black text-amber-400 text-xs bg-amber-950/40 px-2 py-0.5 rounded border border-amber-900/60">
                          {item.price_coins} 🪙
                        </span>
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                        {item.description}
                      </p>
                    </div>

                    <button
                      onClick={() => handleBuy(item)}
                      disabled={isPending || !canAfford}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        canAfford
                          ? 'bg-zinc-100 hover:bg-white text-zinc-950 shadow-md'
                          : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      {canAfford ? `Purchase (${item.price_coins}🪙)` : `Insufficient Coins (${item.price_coins}🪙)`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* TAB 2: BLACK MARKET UNDERGROUND FLASH SALE */}
          {tab === 'black_market' && (
            <div>
              {!data?.black_market_active ? (
                /* Locked State */
                <div className="py-20 text-center bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-8 space-y-4">
                  <span className="text-4xl block">🔒</span>
                  <h2 className="text-lg font-black text-white tracking-widest uppercase">
                    Underground Signal Encrypted
                  </h2>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                    The Black Market opens in unannounced <strong>5-minute flash windows</strong> controlled by the event commander. Watch your notifications for incoming transmissions.
                  </p>
                </div>
              ) : (
                /* Live Black Market Flash Grid */
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-red-950/80 via-zinc-950 to-red-950/80 border border-red-800 rounded-2xl flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-black text-red-400 uppercase tracking-widest flex items-center gap-2">
                        <span>⚠️</span>
                        <span>CONTRABAND INTERCEPT ACTIVE</span>
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Classified zero-day exploits & limited discounted inventory. Window terminates in{' '}
                        <strong className="text-white font-mono">{formatTime(flashSeconds)}</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data?.black_market_items?.map((item) => {
                      const canAfford = (data?.coin_balance ?? 0) >= item.price_coins
                      const hasStock = item.stock_quantity == null || item.stock_quantity > 0

                      return (
                        <div
                          key={item.id}
                          className="p-5 bg-[#12080a] border border-red-900/60 rounded-2xl flex flex-col justify-between hover:border-red-600 transition-all shadow-xl shadow-red-950/20"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <h3 className="text-sm font-bold text-red-200">{item.name}</h3>
                                {item.stock_quantity !== null && (
                                  <span className="text-[10px] text-red-400 font-mono">
                                    Stock: {item.stock_quantity} remaining
                                  </span>
                                )}
                              </div>

                              <span className="font-mono font-black text-amber-400 text-xs bg-amber-950/50 px-2 py-0.5 rounded border border-amber-800">
                                {item.price_coins} 🪙
                              </span>
                            </div>

                            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                              {item.description}
                            </p>
                          </div>

                          <button
                            onClick={() => handleBuy(item)}
                            disabled={isPending || !canAfford || !hasStock}
                            className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                              !hasStock
                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                : canAfford
                                ? 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white shadow-lg shadow-red-950'
                                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            }`}
                          >
                            {!hasStock
                              ? 'Out of Stock'
                              : canAfford
                              ? `Snag Deal (${item.price_coins}🪙)`
                              : `Insufficient Coins (${item.price_coins}🪙)`}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ========================================================
          MODAL: TARGET RIVAL SELECTION (SABOTAGE RADAR)
         ======================================================== */}
      {targetModalOpen && selectedPowerup && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-zinc-950 border-2 border-red-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs uppercase font-extrabold text-red-400 tracking-wider">
                  Tactical Strike Radar 🎯
                </span>
                <h3 className="text-lg font-black text-white mt-0.5">
                  Deploy {selectedPowerup.name}
                </h3>
              </div>
              <button
                onClick={() => setTargetModalOpen(false)}
                className="text-zinc-500 hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Select an enemy operative team to target. If the rival team has an active{' '}
              <strong className="text-cyan-400">Ghost Shield</strong>, your attack will be absorbed!
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300">Choose Target Rival Team:</label>
              {data?.rival_teams && data.rival_teams.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {data.rival_teams.map((r) => (
                    <label
                      key={r.id}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        selectedRivalId === r.id
                          ? 'bg-red-950/40 border-red-600 text-white shadow-sm'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span className="font-bold">{r.name}</span>
                      <input
                        type="radio"
                        name="rival"
                        value={r.id}
                        checked={selectedRivalId === r.id}
                        onChange={() => setSelectedRivalId(r.id)}
                        className="accent-red-600"
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 py-3 text-center">No rival teams found registered in the event.</p>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTargetModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors"
              >
                Abort
              </button>
              <button
                type="button"
                onClick={handleConfirmSabotage}
                disabled={isPending || !selectedRivalId}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-red-900/50"
              >
                {isPending ? 'Deploying...' : 'Launch Strike 💥'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
