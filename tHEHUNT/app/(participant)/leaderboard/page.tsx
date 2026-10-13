'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { getLeaderboard, adminToggleScoreboardLock, type LeaderboardResult } from '@/actions/leaderboard'

import ScoreGraph from './ScoreGraph'

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  async function loadData() {
    setLoading(true)
    const res = await getLeaderboard()
    if (res.success && res.data) {
      setData(res.data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleToggleLock(targetState: boolean) {
    startTransition(async () => {
      const res = await adminToggleScoreboardLock(targetState)
      if (res.success) {
        await loadData()
      } else {
        alert(res.error || 'Failed to toggle lock')
      }
    })
  }

  return (
    <div className="min-h-screen bg-[#090a0f] text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors">
              <span>←</span>
              <span>Back to Dashboard</span>
            </Link>
            <span className="text-zinc-700">|</span>
            <span className="font-extrabold text-sm tracking-wider text-amber-400">
              {data?.event_name || 'THE HUNT'} // SCOREBOARD
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={loading}
              className="text-xs px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-800 transition-colors"
            >
              {loading ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Admin Control Bar (if current user is admin) */}
        {data?.is_admin && (
          <div className="mb-8 p-4 bg-amber-950/20 border border-amber-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">⚡</span>
              <div>
                <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  Admin Scoreboard Visibility Control
                </div>
                <div className="text-xs text-zinc-400">
                  Status: {data.locked ? (
                    <strong className="text-red-400">FROZEN / HIDDEN from participants</strong>
                  ) : (
                    <strong className="text-emerald-400">PUBLIC to all participants</strong>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => handleToggleLock(!data.locked)}
              disabled={isPending}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                data.locked
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                  : 'bg-red-500 hover:bg-red-400 text-white'
              }`}
            >
              {isPending
                ? 'Updating...'
                : data.locked
                ? '🔓 Unlock Scoreboard (Make Public)'
                : '🔒 Freeze Scoreboard (Hide from Players)'}
            </button>
          </div>
        )}

        {/* FROZEN / LOCKED STATE for participants */}
        {data?.locked && !data?.is_admin ? (
          <div className="max-w-xl mx-auto my-16 p-10 bg-zinc-900/60 border border-zinc-800 rounded-3xl text-center shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-3xl">
              🔒
            </div>
            <h2 className="text-xl font-black text-white tracking-wide uppercase mb-2">
              Scoreboard Frozen
            </h2>
            <p className="text-zinc-400 text-xs leading-relaxed max-w-md mx-auto">
              The live rankings have been frozen by the Hunt Directors. Final scores and winner standings will be officially unveiled at the conclusion of the event.
            </p>
            <div className="mt-6 pt-6 border-t border-zinc-800/80">
              <Link
                href="/dashboard"
                className="text-xs font-bold text-amber-400 hover:text-amber-300 underline"
              >
                Return to Active Case Files →
              </Link>
            </div>
          </div>
        ) : (
          /* CTFd STYLE LEADERBOARD */
          <div className="space-y-8">
            {/* Title */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight uppercase">
                  CTFd Operational Leaderboard
                </h1>
                <p className="text-zinc-400 text-xs mt-1">
                  Live scores updated in real time. Ties broken by earliest solve timestamp.
                </p>
              </div>

              {data?.locked && data?.is_admin && (
                <span className="text-xs px-3 py-1 bg-red-950/60 border border-red-800 text-red-300 rounded-full font-mono">
                  🔒 FROZEN (Viewing as Admin)
                </span>
              )}
            </div>

            {/* CTFd Interactive Score-over-Time Timeline Graph */}
            <ScoreGraph timeline={data?.timeline || []} />

            {/* Top 3 Podium Cards */}
            {data?.teams && data.teams.length >= 3 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                {/* 2nd Place */}
                <div className="p-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl text-center order-2 md:order-1 flex flex-col justify-between">
                  <div>
                    <span className="text-2xl">🥈</span>
                    <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mt-1">2nd Place</div>
                    <h3 className="text-lg font-black text-white mt-1">{data.teams[1].team_name}</h3>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/80">
                    <span className="text-xl font-black text-emerald-400 font-mono">+{data.teams[1].score} pts</span>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{data.teams[1].solves_count} solves • {data.teams[1].coins}🪙</div>
                  </div>
                </div>

                {/* 1st Place (Champion) */}
                <div className="p-6 bg-amber-500/5 border border-amber-500/40 rounded-2xl text-center order-1 md:order-2 shadow-xl shadow-amber-500/5 flex flex-col justify-between">
                  <div>
                    <span className="text-3xl">👑</span>
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mt-1">1st Place • Lead</div>
                    <h3 className="text-xl font-black text-white mt-1">{data.teams[0].team_name}</h3>
                  </div>
                  <div className="mt-4 pt-3 border-t border-amber-500/20">
                    <span className="text-2xl font-black text-amber-400 font-mono">+{data.teams[0].score} pts</span>
                    <div className="text-xs text-zinc-400 mt-0.5">{data.teams[0].solves_count} solves • {data.teams[0].coins}🪙</div>
                  </div>
                </div>

                {/* 3rd Place */}
                <div className="p-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl text-center order-3 flex flex-col justify-between">
                  <div>
                    <span className="text-2xl">🥉</span>
                    <div className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mt-1">3rd Place</div>
                    <h3 className="text-lg font-black text-white mt-1">{data.teams[2].team_name}</h3>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/80">
                    <span className="text-xl font-black text-emerald-400 font-mono">+{data.teams[2].score} pts</span>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{data.teams[2].solves_count} solves • {data.teams[2].coins}🪙</div>
                  </div>
                </div>
              </div>
            )}

            {/* Full Table */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
              {data?.teams.length === 0 ? (
                <div className="py-16 text-center text-zinc-500 text-xs">
                  No scores recorded yet. Once teams submit flags, they will appear here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/40 text-zinc-400 uppercase font-bold tracking-wider">
                        <th className="py-3 px-4 w-16 text-center">Rank</th>
                        <th className="py-3 px-4">Team</th>
                        <th className="py-3 px-4 text-center">Solves</th>
                        <th className="py-3 px-4 text-right">Coins</th>
                        <th className="py-3 px-4 text-right">Total Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {data?.teams.map((t) => (
                        <tr
                          key={t.team_id}
                          className={`hover:bg-zinc-800/30 transition-colors ${
                            t.rank === 1 ? 'bg-amber-500/[0.03]' : ''
                          }`}
                        >
                          <td className="py-3.5 px-4 text-center font-bold font-mono">
                            {t.rank === 1 ? (
                              <span className="text-amber-400 font-black">#1</span>
                            ) : t.rank === 2 ? (
                              <span className="text-zinc-300 font-bold">#2</span>
                            ) : t.rank === 3 ? (
                              <span className="text-amber-600 font-bold">#3</span>
                            ) : (
                              <span className="text-zinc-500 font-medium">#{t.rank}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-white text-sm">
                            {t.team_name}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-zinc-300">
                            {t.solves_count}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-400">
                            {t.coins} 🪙
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-black text-base text-emerald-400">
                            +{t.score}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
