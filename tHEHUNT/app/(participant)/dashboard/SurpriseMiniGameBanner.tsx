'use client'

import { useState, useEffect, useTransition } from 'react'
import { submitSurpriseMiniGameAnswer, type SurpriseMiniGameData } from '@/actions/surprises'

interface Props {
  initialGame: SurpriseMiniGameData | null
  onSolved?: () => void
}

export default function SurpriseMiniGameBanner({ initialGame, onSolved }: Props) {
  const [game, setGame] = useState<SurpriseMiniGameData | null>(initialGame)
  const [secondsLeft, setSecondsLeft] = useState<number>(initialGame?.seconds_remaining || 0)
  const [isOpen, setIsOpen] = useState(false)
  const [answer, setAnswer] = useState('')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  // Countdown timer
  useEffect(() => {
    if (!game || game.is_solved) return

    setSecondsLeft(game.seconds_remaining)

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          setGame(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [game])

  if (!game || game.is_solved || secondsLeft <= 0) {
    return null
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!answer.trim() || !game) return

    startTransition(async () => {
      setStatusMessage(null)
      const res = await submitSurpriseMiniGameAnswer({
        event_id: game.id,
        answer: answer.trim(),
      })

      if (res.success && res.data) {
        if (res.data.correct) {
          setStatusMessage({
            type: 'success',
            text: `🎉 CORRECT! +${res.data.points_earned} PTS & +${res.data.coins_earned} COINS AWARDED!${
              res.data.powerup_granted ? ` 🎁 Bonus Power-Up Unlocked: ${res.data.powerup_granted}` : ''
            }`,
          })
          setGame({ ...game, is_solved: true })
          if (onSolved) onSolved()
          setTimeout(() => {
            setIsOpen(false)
          }, 3500)
        } else {
          setStatusMessage({
            type: 'error',
            text: '❌ INCORRECT CIPHER! Double-check the clue and try again before time runs out!',
          })
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Submission failed. Please try again.',
        })
      }
    })
  }

  return (
    <>
      {/* URGENT TOP BANNER */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-950 via-zinc-900 to-amber-950 border-2 border-amber-500/80 p-4 shadow-2xl shadow-amber-500/20 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl animate-bounce">⚡</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                  5-MIN FLASH RAID
                </span>
                <span className="text-xs font-mono font-bold text-amber-400">
                  ⏱️ {timeFormatted} REMAINING
                </span>
              </div>
              <h3 className="text-sm font-black text-white mt-1 uppercase tracking-wide">
                {game.title}
              </h3>
              <p className="text-xs text-zinc-300 line-clamp-1">
                {game.question_text}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            <div className="text-right text-[11px] font-mono hidden md:block">
              <span className="text-emerald-400 font-bold">+{game.points_reward} PTS</span>
              <span className="text-zinc-600 mx-1.5">•</span>
              <span className="text-amber-400 font-bold">+{game.coins_reward} 🪙</span>
              {game.powerup_reward_name && (
                <>
                  <span className="text-zinc-600 mx-1.5">•</span>
                  <span className="text-cyan-400 font-bold">🎁 {game.powerup_reward_name}</span>
                </>
              )}
            </div>

            <button
              onClick={() => setIsOpen(true)}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-black uppercase tracking-wider rounded-xl shadow-lg transition-transform hover:scale-105"
            >
              Solve Flash Clue →
            </button>
          </div>
        </div>
      </div>

      {/* QUICK SOLVE MODAL */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-950 border border-amber-500/50 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚡</span>
                <h3 className="text-sm font-black text-amber-400 uppercase tracking-wider">
                  Surprise Mini-Game // Flash Raid
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs px-2 py-1 rounded"
              >
                ✕ Close
              </button>
            </div>

            {/* Countdown & Rewards Bar */}
            <div className="flex items-center justify-between bg-zinc-900/80 p-3 rounded-xl text-xs font-mono border border-zinc-800">
              <span className="text-amber-400 font-bold">⏱️ Time Left: {timeFormatted}</span>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold">+{game.points_reward} pts</span>
                <span className="text-amber-400 font-bold">+{game.coins_reward} coins</span>
                {game.powerup_reward_name && (
                  <span className="text-cyan-400 font-bold">🎁 {game.powerup_reward_name}</span>
                )}
              </div>
            </div>

            {/* Question Text */}
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                {game.title}
              </span>
              <p className="text-sm text-zinc-100 font-mono leading-relaxed whitespace-pre-wrap">
                {game.question_text}
              </p>
            </div>

            {/* Status Feedback */}
            {statusMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-bold ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-950/60 border border-emerald-500 text-emerald-300'
                    : 'bg-red-950/60 border border-red-500 text-red-300'
                }`}
              >
                {statusMessage.text}
              </div>
            )}

            {/* Submission Form */}
            {!game.is_solved && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  Decrypted Flag / Answer
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type decoded answer..."
                  className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm font-mono text-zinc-100 focus:outline-none focus:border-amber-400"
                />
                <div className="flex items-center gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3.5 py-2 text-xs text-zinc-400 hover:text-white rounded-lg border border-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !answer.trim()}
                    className="px-5 py-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-zinc-950 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                  >
                    {isPending ? 'Verifying Cipher...' : 'Submit Decryption 🚀'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
