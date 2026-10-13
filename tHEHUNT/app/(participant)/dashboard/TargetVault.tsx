'use client'

import { useMemo } from 'react'
import type { ChallengeProgress } from '@/lib/types/database'

interface Props {
  challenges: ChallengeProgress[]
}

export default function TargetVault({ challenges }: Props) {
  // Sort challenges by fragment_order or display_order
  const sortedChallenges = useMemo(() => {
    return [...challenges].sort((a, b) => {
      const ordA = a.fragment_order ?? a.display_order ?? 999
      const ordB = b.fragment_order ?? b.display_order ?? 999
      return ordA - ordB
    })
  }, [challenges])

  // Flatten out all digits into the Master 10-Digit sequence
  const { masterDigits, totalDigitsCount, unlockedDigitsCount } = useMemo(() => {
    const digits: Array<{
      char: string | null
      challengeId: string
      challengeTitle: string
      slotIndex: number
      isUnlocked: boolean
    }> = []

    let unlockedCount = 0

    sortedChallenges.forEach((c) => {
      const isUnlocked = Boolean(c.final_fragment)
      const fragStr = c.final_fragment ? String(c.final_fragment) : ''
      const len = c.fragment_length || (fragStr ? fragStr.length : 1)

      for (let i = 0; i < len; i++) {
        const char = isUnlocked ? fragStr[i] || '?' : null
        if (char && char !== '?') unlockedCount++

        digits.push({
          char,
          challengeId: c.id || c.challenge_id,
          challengeTitle: c.title || c.challenge_title,
          slotIndex: c.fragment_order || 1,
          isUnlocked,
        })
      }
    })

    return {
      masterDigits: digits,
      totalDigitsCount: digits.length || 10,
      unlockedDigitsCount: unlockedCount,
    }
  }, [sortedChallenges])

  const allUnlocked = unlockedDigitsCount === totalDigitsCount && totalDigitsCount > 0

  return (
    <div className="bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-cyan-900/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden space-y-6">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-80" />

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/60 border border-cyan-500/40 flex items-center justify-center text-xl shadow-inner">
            📞
          </div>
          <div>
            <h2 className="text-sm font-black tracking-widest uppercase text-cyan-400 flex items-center gap-2">
              <span>Master 10-Digit Target Vault</span>
              <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono">
                {totalDigitsCount} Digits Total
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Solve case files to unlock fragments. Exactly one file yields 2 digits, all others yield 1 digit.
            </p>
          </div>
        </div>

        {/* Progress Badge */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="text-[11px] font-mono text-zinc-300 bg-zinc-950/80 px-3 py-1.5 rounded-xl border border-zinc-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>
              <strong className="text-cyan-400 font-bold">{unlockedDigitsCount}</strong> / {totalDigitsCount} Digits Decrypted
            </span>
          </div>
        </div>
      </div>

      {/* MASTER 10-DIGIT DIAL / READOUT */}
      <div className="p-4 bg-zinc-950/90 rounded-2xl border border-zinc-800/80 space-y-3">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
          <span>Reconstructed Target Sequence:</span>
          <span>
            {Math.round((unlockedDigitsCount / (totalDigitsCount || 1)) * 100)}% Complete
          </span>
        </div>

        {/* Big Digit Boxes */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 py-2">
          {masterDigits.map((digit, idx) => (
            <div
              key={idx}
              className="flex flex-col items-center"
            >
              <div
                className={`w-9 h-12 sm:w-11 sm:h-14 rounded-xl flex items-center justify-center font-mono text-xl sm:text-2xl font-black transition-all ${
                  digit.isUnlocked && digit.char
                    ? 'bg-cyan-500/20 text-cyan-300 border-2 border-cyan-400 shadow-lg shadow-cyan-500/20 scale-105'
                    : 'bg-zinc-900/80 text-zinc-600 border border-zinc-800'
                }`}
              >
                {digit.isUnlocked && digit.char ? digit.char : '•'}
              </div>
              <span className="text-[9px] font-mono text-zinc-600 mt-1">
                #{idx + 1}
              </span>
            </div>
          ))}
        </div>

        {/* Sleek Progress bar */}
        <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-500"
            style={{ width: `${(unlockedDigitsCount / (totalDigitsCount || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* INDIVIDUAL CASE FILE FRAGMENT CARDS */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
          <span>Decryption Case Slots</span>
          <span className="text-[10px] font-mono text-zinc-500">
            {sortedChallenges.filter((c) => Boolean(c.final_fragment)).length} of {sortedChallenges.length} Cases Complete
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sortedChallenges.map((c, index) => {
            const isUnlocked = Boolean(c.final_fragment)
            const fragStr = c.final_fragment ? String(c.final_fragment) : ''
            const fragLen = c.fragment_length || (fragStr ? fragStr.length : 1)
            const chars = isUnlocked ? fragStr.split('') : Array(fragLen).fill('•')

            return (
              <div
                key={c.id || c.challenge_id || index}
                className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                  isUnlocked
                    ? 'bg-cyan-950/30 border-cyan-500/50 shadow-md shadow-cyan-500/5'
                    : 'bg-zinc-950/60 border-zinc-800/80 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-2">
                  <span className="font-bold text-zinc-300">
                    SLOT {c.fragment_order || index + 1}
                  </span>
                  <span className="text-[9px] text-zinc-500">
                    {fragLen === 2 ? '2-DIGIT' : '1-DIGIT'}
                  </span>
                </div>

                {/* Fragment Char Display */}
                <div className="flex items-center justify-center gap-1.5 my-1">
                  {chars.map((ch, chIdx) => (
                    <span
                      key={chIdx}
                      className={`w-8 h-10 flex items-center justify-center rounded-lg font-mono text-base font-black transition-all ${
                        isUnlocked
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/60 shadow-inner'
                          : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                      }`}
                    >
                      {ch}
                    </span>
                  ))}
                </div>

                <div className="mt-2 pt-2 border-t border-zinc-900 text-center">
                  <div className="text-[10px] text-zinc-300 font-medium truncate" title={c.title || c.challenge_title}>
                    {c.title || c.challenge_title}
                  </div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">
                    {isUnlocked ? (
                      <span className="text-emerald-400 font-bold">✓ Decrypted</span>
                    ) : (
                      <span>{c.solved_levels || 0}/{c.total_levels || 0} levels</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ALL UNLOCKED VICTORY BANNER */}
      {allUnlocked && (
        <div className="p-4 bg-emerald-950/80 border-2 border-emerald-400/80 rounded-2xl text-center space-y-2 shadow-2xl animate-pulse">
          <div className="text-2xl">🎯🏆</div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            ALL 10 FRAGMENTS DECRYPTED // MASTER CODE COMPLETE!
          </h3>
          <div className="text-2xl font-mono font-black text-emerald-300 tracking-[0.3em] py-1">
            {masterDigits.map((d) => d.char).join('')}
          </div>
          <p className="text-xs text-emerald-200/80 max-w-lg mx-auto">
            Dial this reconstructed master telephone number & state your team code to confirm operational triumph!
          </p>
        </div>
      )}
    </div>
  )
}
