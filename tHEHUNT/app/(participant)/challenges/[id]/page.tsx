'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getChallengeLevels } from '@/actions/challenges'
import { submitAnswer } from '@/actions/submissions'
import { purchaseHint, getMyCoinBalance } from '@/actions/economy'
import { getActiveSabotage, type ActiveSabotage } from '@/actions/market'
import SabotageBanner from '@/app/(participant)/dashboard/SabotageBanner'

export default function ChallengeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const challengeId = params.id as string

  const [challengeTitle, setChallengeTitle] = useState<string>('')
  const [levels, setLevels] = useState<any[]>([])
  const [coins, setCoins] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({})
  const [hintTexts, setHintTexts] = useState<Record<string, string>>({})
  const [buyingHint, setBuyingHint] = useState<Record<string, boolean>>({})
  const [sabotage, setSabotage] = useState<ActiveSabotage | null>(null)
  const [hasShield, setHasShield] = useState<boolean>(false)

  async function loadData() {
    try {
      const [levelsRes, coinsRes, sabotageRes] = await Promise.all([
        getChallengeLevels(challengeId),
        getMyCoinBalance(),
        getActiveSabotage(),
      ])

      if (levelsRes.success && levelsRes.data) {
        setLevels(levelsRes.data.levels)
        setChallengeTitle(levelsRes.data.challenge?.title || 'Case File Terminal')
        if (levelsRes.data.active_sabotage) {
          setSabotage(levelsRes.data.active_sabotage)
        }
      }
      if (coinsRes.success && coinsRes.data) {
        setCoins(coinsRes.data.balance)
      }
      if (sabotageRes.success && sabotageRes.data) {
        setSabotage(sabotageRes.data.active_sabotage)
        setHasShield(sabotageRes.data.has_active_shield)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [challengeId])

  const isTimeLocked = sabotage?.type === 'time_lock' && (sabotage.seconds_remaining || 0) > 0
  const isGlitch = sabotage?.type === 'glitch_attack' && (sabotage.seconds_remaining || 0) > 0

  async function handleSubmitAnswer(levelId: string) {
    if (isTimeLocked) return

    const answer = inputs[levelId]?.trim()
    if (!answer) return

    setSubmitting((prev) => ({ ...prev, [levelId]: true }))
    setResults((prev) => ({ ...prev, [levelId]: { success: false, message: '' } }))

    try {
      const res = await submitAnswer({
        level_id: levelId,
        answer,
      })

      if (res.success && res.data?.correct) {
        setResults((prev) => ({
          ...prev,
          [levelId]: { success: true, message: `✓ Correct! Level Solved! +${res.data?.points_earned || 0} pts, +${res.data?.coins_earned || 0} coins.` },
        }))
        // Refresh levels to unlock next level
        await loadData()
      } else {
        setResults((prev) => ({
          ...prev,
          [levelId]: { success: false, message: res.error || (res.data?.already_solved ? 'Already solved by your team' : 'Incorrect answer') },
        }))
      }
    } catch (err: any) {
      setResults((prev) => ({
        ...prev,
        [levelId]: { success: false, message: err?.message || 'Submission error' },
      }))
    } finally {
      setSubmitting((prev) => ({ ...prev, [levelId]: false }))
    }
  }

  async function handleBuyHint(levelId: string) {
    if (isTimeLocked) return

    setBuyingHint((prev) => ({ ...prev, [levelId]: true }))
    try {
      const res = await purchaseHint({ level_id: levelId })
      if (res.success && res.data?.hint_text) {
        setHintTexts((prev) => ({ ...prev, [levelId]: res.data!.hint_text }))
        await loadData()
      } else {
        alert(res.error || 'Could not purchase hint')
      }
    } catch (err: any) {
      alert(err?.message || 'Error purchasing hint')
    } finally {
      setBuyingHint((prev) => ({ ...prev, [levelId]: false }))
    }
  }

  return (
    <div className={`min-h-screen font-sans ${isGlitch ? 'bg-[#0b030f]' : 'bg-zinc-950'} text-zinc-100`}>
      {/* Sabotage HUD (Time Lock full-screen cryo freeze & Glitch scanlines) */}
      <SabotageBanner
        sabotage={sabotage}
        hasActiveShield={hasShield}
        onStatusChange={(newSabotage: ActiveSabotage | null) => setSabotage(newSabotage)}
      />

      {/* Top Bar */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors font-medium"
          >
            ← Back to Dashboard
          </Link>

          <div className="flex items-center gap-3">
            {isTimeLocked && (
              <span className="text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/50 px-2.5 py-1 rounded-full uppercase animate-pulse">
                🧊 Time Lock Active // Terminals Frozen
              </span>
            )}
            {isGlitch && (
              <span className="text-[10px] font-mono font-bold bg-red-950 text-red-300 border border-red-500/50 px-2.5 py-1 rounded-full uppercase animate-pulse">
                ☣️ Glitch Attack Active // HUD Corrupted
              </span>
            )}
            <div className="flex items-center gap-2 font-bold text-amber-400 text-xs bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
              <span>🪙</span>
              <span>{coins} coins</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`max-w-4xl mx-auto px-4 py-8 space-y-6 ${isTimeLocked ? 'time-lock-frozen-panel pointer-events-none select-none' : ''}`}>
        {challengeTitle && (
          <div className="border-b border-zinc-800/80 pb-4">
            <h1 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
              <span>{challengeTitle}</span>
              {isGlitch && <span className="text-red-500 animate-pulse text-sm">[CORRUPTED]</span>}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Solve sequentially to decrypt case file fragments and extract key digits.
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-zinc-500 text-sm font-mono">
            Decrypting tactical terminal data...
          </div>
        ) : levels.length === 0 ? (
          <div className="text-center py-20 text-zinc-500 text-sm">
            No published levels found for this challenge.
          </div>
        ) : (
          <div className="space-y-6">
            {levels.map((lvl) => {
              const isLocked = !lvl.is_unlocked
              const isSolved = lvl.is_solved
              const res = results[lvl.id]
              const hint = hintTexts[lvl.id] || lvl.hint_text

              return (
                <div
                  key={lvl.id}
                  className={`border rounded-2xl p-6 transition-all relative overflow-hidden ${
                    isTimeLocked
                      ? 'bg-cyan-950/20 border-cyan-500/30'
                      : isSolved
                      ? 'bg-emerald-950/20 border-emerald-900/50'
                      : isLocked
                      ? 'bg-zinc-900/40 border-zinc-900 opacity-60'
                      : isGlitch
                      ? 'bg-zinc-900 border-red-500/40 shadow-lg shadow-red-500/10'
                      : 'bg-zinc-900 border-zinc-800 shadow-lg'
                  }`}
                >
                  {/* Cryo Stasis Freeze Overlay per card if Time Locked */}
                  {isTimeLocked && (
                    <div className="absolute inset-0 bg-cyan-950/85 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center p-4 text-center">
                      <span className="text-2xl animate-pulse">🧊🔒</span>
                      <span className="text-xs font-mono font-black text-cyan-300 uppercase tracking-widest mt-1">
                        LEVEL TERMINAL FROZEN
                      </span>
                      <span className="text-[10px] text-cyan-200/80 font-mono mt-0.5">
                        Time Lock EMP in effect. Inputs & decryption blocked.
                      </span>
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                        isSolved
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : isLocked
                          ? 'bg-zinc-800 text-zinc-500'
                          : 'bg-zinc-800 text-white'
                      }`}>
                        {lvl.level_number}
                      </span>
                      <div>
                        <h2 className={`text-base font-bold text-white flex items-center gap-2 ${isGlitch ? 'glitch-active-text' : ''}`}>
                          {lvl.title}
                          {isSolved && <span className="text-xs text-emerald-400 font-normal">✓ Solved</span>}
                          {isLocked && <span className="text-xs text-zinc-500 font-normal">🔒 Locked</span>}
                        </h2>
                        <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5 font-mono">
                          <span>+{lvl.points_reward ?? lvl.points} pts</span>
                          <span>+{lvl.coins_reward} coins</span>
                        </div>
                      </div>
                    </div>

                    {lvl.hint_cost > 0 && !isLocked && !isSolved && (
                      <button
                        onClick={() => handleBuyHint(lvl.id)}
                        disabled={isTimeLocked || buyingHint[lvl.id] || !!hint}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          isTimeLocked
                            ? 'bg-cyan-950/40 border-cyan-500/30 text-cyan-400 cursor-not-allowed opacity-50'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700 disabled:opacity-50'
                        }`}
                      >
                        {isTimeLocked ? '🔒 FROZEN' : hint ? 'Hint Revealed' : `Unlock Hint (-${lvl.hint_cost}🪙)`}
                      </button>
                    )}
                  </div>

                  {/* Prompt */}
                  {!isLocked && (
                    <div className={`my-4 p-4 rounded-xl text-sm leading-relaxed font-mono whitespace-pre-wrap ${
                      isGlitch
                        ? 'bg-red-950/20 border border-red-500/30 text-red-200'
                        : 'bg-zinc-950 border border-zinc-800 text-zinc-200'
                    }`}>
                      {lvl.prompt}
                    </div>
                  )}

                  {/* Hint Reveal */}
                  {hint && (
                    <div className="mb-4 p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-amber-200 text-xs">
                      💡 <strong>Intel Hint:</strong> {hint}
                    </div>
                  )}

                  {/* Submission Form */}
                  {!isLocked && !isSolved && (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          disabled={isTimeLocked}
                          readOnly={isTimeLocked}
                          value={isTimeLocked ? '' : (inputs[lvl.id] || '')}
                          onChange={(e) => {
                            if (isTimeLocked) return
                            setInputs((prev) => ({ ...prev, [lvl.id]: e.target.value }))
                          }}
                          onKeyDown={(e) => {
                            if (isTimeLocked) {
                              e.preventDefault()
                              return
                            }
                            if (e.key === 'Enter') handleSubmitAnswer(lvl.id)
                          }}
                          placeholder={
                            isTimeLocked
                              ? '🧊 TERMINAL FROZEN BY TIME LOCK — TYPING DISABLED'
                              : isGlitch
                              ? '⚠️ SIGNAL NOISE 89% — ENTER DECRYPTION KEY...'
                              : 'Type answer or flag...'
                          }
                          className={`flex-1 px-3.5 py-2.5 text-sm rounded-xl font-mono transition-all ${
                            isTimeLocked
                              ? 'bg-cyan-950/40 border border-cyan-500/40 text-cyan-300 placeholder:text-cyan-500/60 cursor-not-allowed'
                              : isGlitch
                              ? 'bg-zinc-950 border border-red-500 text-white focus:outline-none focus:border-red-400'
                              : 'bg-zinc-950 border border-zinc-800 text-white focus:outline-none focus:border-zinc-500'
                          }`}
                        />
                        <button
                          onClick={() => handleSubmitAnswer(lvl.id)}
                          disabled={isTimeLocked || submitting[lvl.id] || !inputs[lvl.id]?.trim()}
                          className={`px-5 py-2.5 font-bold text-sm rounded-xl transition-all ${
                            isTimeLocked
                              ? 'bg-cyan-950 border border-cyan-500/40 text-cyan-300 cursor-not-allowed opacity-50'
                              : 'bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-50'
                          }`}
                        >
                          {isTimeLocked ? '🔒 FROZEN' : submitting[lvl.id] ? 'Verifying...' : 'Submit'}
                        </button>
                      </div>

                      {res?.message && (
                        <div
                          className={`text-xs p-2.5 rounded-xl border ${
                            res.success
                              ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                              : 'bg-red-950/50 border-red-800 text-red-300'
                          }`}
                        >
                          {res.message}
                        </div>
                      )}
                    </div>
                  )}

                  {isLocked && (
                    <p className="text-xs text-zinc-500 mt-2 font-mono">Solve previous level to unlock this terminal.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
