import { createClient } from '@/lib/supabase/server'
import { getParticipantChallenges } from '@/actions/challenges'
import { getMyTeam, getMyRole, logout, createTeam, joinTeam } from '@/actions/auth'
import { getMyCoinBalance } from '@/actions/economy'
import { getActiveEvent } from '@/actions/events'
import { getMarketData } from '@/actions/market'
import { getActiveSurpriseMiniGame } from '@/actions/surprises'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import SabotageBanner from './SabotageBanner'
import SurpriseMiniGameBanner from './SurpriseMiniGameBanner'
import TargetVault from './TargetVault'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [teamRes, roleRes, balanceRes, challengesRes, eventRes, marketRes, surpriseRes] = await Promise.all([
    getMyTeam(),
    getMyRole(),
    getMyCoinBalance(),
    getParticipantChallenges(),
    getActiveEvent(),
    getMarketData(),
    getActiveSurpriseMiniGame(),
  ])

  const team = teamRes.data
  const role = roleRes.data?.role || 'participant'
  const coins = balanceRes.data?.balance ?? 0
  const challenges = challengesRes.data || []
  const activeEvent = eventRes.data
  const marketData = marketRes.data
  const surpriseGame = surpriseRes.data || null

  return (
    <div className="min-h-screen bg-[#090a0f] text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-xl tracking-wider text-white">THE HUNT</span>
            {activeEvent && (
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                activeEvent.status === 'live'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {activeEvent.status}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {team && (
              <div className="flex items-center gap-3 bg-zinc-900/80 px-3 py-1.5 rounded-xl border border-zinc-800 text-xs">
                <div className="flex flex-col">
                  <span className="text-zinc-400">Team: <strong className="text-zinc-200">{team.name}</strong></span>
                  <span className="text-zinc-500 text-[10px]">Code: <strong className="font-mono text-zinc-300">{team.team_code}</strong></span>
                </div>
                <div className="h-6 w-px bg-zinc-800" />
                <div className="flex items-center gap-1.5 font-bold text-amber-400 font-mono">
                  <span>🪙</span>
                  <span>{coins} coins</span>
                </div>
              </div>
            )}

            {/* Armory & Black Market Link */}
            <Link
              href="/market"
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 border ${
                marketData?.black_market_active
                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/80 shadow-lg shadow-amber-500/10 animate-pulse'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-800'
              }`}
            >
              <span>🛒</span>
              <span className="hidden sm:inline">Armory & Market</span>
              <span className="sm:hidden">Market</span>
              {marketData?.black_market_active && (
                <span className="text-[9px] bg-amber-400 text-zinc-950 px-1 py-0.2 rounded font-black uppercase">
                  ⚡ Flash
                </span>
              )}
            </Link>

            <Link
              href="/leaderboard"
              className="text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
            >
              <span>🏆</span>
              <span className="hidden sm:inline">Scoreboard</span>
            </Link>

            {role === 'admin' && (
              <Link
                href="/admin"
                className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/20 font-medium transition-colors"
              >
                Admin Panel ⚡
              </Link>
            )}

            <form action={logout}>
              <button
                type="submit"
                className="text-xs text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {!team ? (
          /* Team Setup Prompt */
          <div className="max-w-xl mx-auto my-12 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-2xl font-black text-white mb-2">Team Assembly Required</h2>
            <p className="text-zinc-400 text-xs mb-6 leading-relaxed">
              You must create or join a tactical team before accessing decryption terminals and unlocking fragments.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Create Team Form */}
              <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl">
                <h3 className="font-bold text-xs text-zinc-200 mb-3 uppercase tracking-wider">Create New Team</h3>
                <form
                  action={async (formData: FormData) => {
                    'use server'
                    const teamName = formData.get('team_name') as string
                    await createTeam({ team_name: teamName })
                    redirect('/dashboard')
                  }}
                  className="space-y-3"
                >
                  <input
                    name="team_name"
                    type="text"
                    required
                    placeholder="Team Name"
                    className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    className="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold rounded-lg transition-colors"
                  >
                    Found Team
                  </button>
                </form>
              </div>

              {/* Join Team Form */}
              <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl">
                <h3 className="font-bold text-xs text-zinc-200 mb-3 uppercase tracking-wider">Join Existing Team</h3>
                <form
                  action={async (formData: FormData) => {
                    'use server'
                    const teamCode = formData.get('team_code') as string
                    await joinTeam({ team_code: teamCode })
                    redirect('/dashboard')
                  }}
                  className="space-y-3"
                >
                  <input
                    name="team_code"
                    type="text"
                    required
                    maxLength={6}
                    placeholder="6-Char Team Code"
                    className="w-full px-3 py-2 text-xs font-mono uppercase bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold rounded-lg transition-colors"
                  >
                    Join with Code
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Sabotage HUD Status & Defense Banner */}
            <SabotageBanner
              sabotage={marketData?.active_sabotage || null}
              hasActiveShield={Boolean(marketData?.has_active_shield)}
            />

            {/* 5-Minute Surprise Mini-Game Flash Raid Banner */}
            {surpriseGame && (
              <SurpriseMiniGameBanner initialGame={surpriseGame} />
            )}

            {/* Master 10-Digit Target Vault */}
            <TargetVault challenges={challenges} />

            {/* Active Case Files / Challenges Grid */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-xl font-black text-white tracking-wide uppercase">
                    Case Files
                  </h1>
                  <p className="text-zinc-400 text-xs">
                    Select a case file to inspect levels and submit decryption solutions.
                  </p>
                </div>
              </div>

              {challenges.length === 0 ? (
                <div className="p-12 text-center bg-zinc-900 border border-zinc-800 rounded-xl">
                  <p className="text-zinc-400 text-sm">No case files active yet. Stay alert for kickoff.</p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {challenges.map((c: any) => {
                    const challengeId = c.id || c.challenge_id
                    const title = c.title || c.challenge_title || 'Untitled Case File'
                    const total = Number(c.total_levels) || 0
                    const solved = Number(c.solved_levels) || 0
                    const progressPct = c.progress_percentage ?? (total > 0 ? Math.round((solved / total) * 100) : 0)
                    const isFullySolved = solved >= total && total > 0

                    return (
                      <Link
                        key={challengeId}
                        href={`/challenges/${challengeId}`}
                        className={`group block p-6 rounded-2xl transition-all border shadow-lg hover:shadow-2xl hover:translate-y-[-2px] ${
                          isFullySolved
                            ? 'bg-emerald-950/10 border-emerald-900/60 hover:border-emerald-700'
                            : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded">
                            {c.category || 'General'}
                          </span>
                          <span className={`text-xs font-mono font-medium ${isFullySolved ? 'text-emerald-400 font-bold' : 'text-zinc-400'}`}>
                            {isFullySolved ? '✓ COMPLETED' : `${solved} / ${total} Solved`}
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-white group-hover:text-amber-400 transition-colors mb-2">
                          {title}
                        </h3>

                        {c.description && (
                          <p className="text-zinc-400 text-xs line-clamp-2 mb-4">
                            {c.description}
                          </p>
                        )}

                        {/* Progress Bar */}
                        <div className="w-full bg-zinc-800/80 rounded-full h-1.5 mt-auto">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              isFullySolved ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
