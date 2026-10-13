'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getChallengeLevels } from '@/actions/challenges'
import { submitAnswer } from '@/actions/submissions'
import { purchaseHint, getMyCoinBalance } from '@/actions/economy'

export default function ChallengeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const challengeId = params.id as string

  const [levels, setLevels] = useState<any[]>([])
  const [coins, setCoins] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({})
  const [hintTexts, setHintTexts] = useState<Record<string, string>>({})
  const [buyingHint, setBuyingHint] = useState<Record<string, boolean>>({})

  async function loadData() {
    try {
      const [levelsRes, coinsRes] = await Promise.all([
        getChallengeLevels(challengeId),
        getMyCoinBalance(),
      ])

      if (levelsRes.success && levelsRes.data) {
        setLevels(levelsRes.data.levels)
      }
      if (coinsRes.success && coinsRes.data) {
        setCoins(coinsRes.data.balance)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [challengeId])

  async function handleSubmitAnswer(levelId: string) {
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
          [levelId]: { success: true, message: `Correct! Level Solved! +${res.data?.points_earned || 0} pts, +${res.data?.coins_earned || 0} coins.` },
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Top Bar */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            ← Back to Terminal Grid
          </Link>

          <div className="flex items-center gap-2 font-bold text-amber-400 text-xs bg-zinc-950 px-3 py-1.5 rounded-md border border-zinc-800">
            <span>🪙</span>
            <span>{coins} coins</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-20 text-zinc-500 text-sm">Decrypting challenge data...</div>
        ) : levels.length === 0 ? (
          <div className="text-center py-20 text-zinc-500 text-sm">No levels found for this challenge.</div>
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
                  className={`border rounded-xl p-6 transition-all ${
                    isSolved
                      ? 'bg-emerald-950/20 border-emerald-900/50'
                      : isLocked
                      ? 'bg-zinc-900/40 border-zinc-900 opacity-60'
                      : 'bg-zinc-900 border-zinc-800 shadow-lg'
                  }`}
                >
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
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                          {lvl.title}
                          {isSolved && <span className="text-xs text-emerald-400 font-normal">✓ Solved</span>}
                          {isLocked && <span className="text-xs text-zinc-500 font-normal">🔒 Locked</span>}
                        </h2>
                        <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
                          <span>+{lvl.points_reward ?? lvl.points} pts</span>
                          <span>+{lvl.coins_reward} coins</span>
                        </div>
                      </div>
                    </div>

                    {lvl.hint_cost > 0 && !isLocked && !isSolved && (
                      <button
                        onClick={() => handleBuyHint(lvl.id)}
                        disabled={buyingHint[lvl.id] || !!hint}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded border border-zinc-700 transition-colors disabled:opacity-50"
                      >
                        {hint ? 'Hint Revealed' : `Unlock Hint (-${lvl.hint_cost}🪙)`}
                      </button>
                    )}
                  </div>

                  {/* Prompt */}
                  {!isLocked && (
                    <div className="my-4 p-4 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 leading-relaxed font-mono whitespace-pre-wrap">
                      {lvl.prompt}
                    </div>
                  )}

                  {/* Hint Reveal */}
                  {hint && (
                    <div className="mb-4 p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-200 text-xs">
                      💡 <strong>Intel Hint:</strong> {hint}
                    </div>
                  )}

                  {/* Submission Form */}
                  {!isLocked && !isSolved && (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={inputs[lvl.id] || ''}
                          onChange={(e) => setInputs((prev) => ({ ...prev, [lvl.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmitAnswer(lvl.id)
                          }}
                          placeholder="Type answer or flag..."
                          className="flex-1 px-3.5 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white focus:outline-none focus:border-zinc-500 font-mono"
                        />
                        <button
                          onClick={() => handleSubmitAnswer(lvl.id)}
                          disabled={submitting[lvl.id] || !inputs[lvl.id]?.trim()}
                          className="px-5 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
                        >
                          {submitting[lvl.id] ? 'Verifying...' : 'Submit'}
                        </button>
                      </div>

                      {res?.message && (
                        <div
                          className={`text-xs p-2.5 rounded-lg border ${
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
                    <p className="text-xs text-zinc-500 mt-2">Solve previous level to unlock this terminal.</p>
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
