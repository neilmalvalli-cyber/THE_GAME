'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { ActiveSabotage } from '@/actions/market'

interface Props {
  sabotage: ActiveSabotage | null
  hasActiveShield: boolean
}

export default function SabotageBanner({ sabotage, hasActiveShield }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number>(sabotage?.seconds_remaining || 0)

  useEffect(() => {
    if (!sabotage) return

    setSecondsLeft(sabotage.seconds_remaining)

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [sabotage])

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`

  const isGlitch = sabotage?.type === 'glitch_attack'
  const isTimeLock = sabotage?.type === 'time_lock'

  return (
    <>
      {/* Glitch Overlay Effect if infected with glitch_attack */}
      {isGlitch && secondsLeft > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-[radial-gradient(#ff005510_1px,transparent_1px)] [background-size:16px_16px] mix-blend-screen opacity-70 animate-pulse border-4 border-red-500/30" />
      )}

      {/* Active Sabotage Warning Banner */}
      {sabotage && secondsLeft > 0 ? (
        <div
          className={`relative overflow-hidden rounded-2xl p-4 border shadow-2xl transition-all ${
            isGlitch
              ? 'bg-gradient-to-r from-red-950 via-zinc-950 to-red-950 border-red-500/80 shadow-red-500/20'
              : 'bg-gradient-to-r from-amber-950 via-zinc-950 to-amber-950 border-amber-500/80 shadow-amber-500/20'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl animate-spin text-red-500">
                {isGlitch ? '☣️' : '⏳'}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                    RIVAL SABOTAGE DETECTED
                  </span>
                  <span className="text-xs font-mono font-bold text-red-400">
                    ⏱️ {timeFormatted} ACTIVE
                  </span>
                </div>
                <h3 className="text-sm font-black text-white mt-1 uppercase tracking-wide">
                  {sabotage.name} ({isGlitch ? 'HUD Visual Distortion' : 'Progress Freeze Lock'})
                </h3>
                <p className="text-xs text-zinc-300">
                  {isGlitch
                    ? 'A rival team has jammed your tactical HUD with chromatic interference!'
                    : 'A rival team has deployed a temporal freeze on your puzzle terminal!'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/market"
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-amber-500/40 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
              >
                <span>🛡️</span>
                <span>Get Ghost Shield in Market →</span>
              </Link>
            </div>
          </div>
        </div>
      ) : hasActiveShield ? (
        /* Shield Defense Indicator */
        <div className="rounded-xl p-3 bg-cyan-950/40 border border-cyan-500/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-cyan-300 font-bold">
            <span className="text-base">🛡️</span>
            <span>GHOST SHIELD DEPLOYED: Active radar cloaking will absorb next incoming rival sabotage!</span>
          </div>
          <Link href="/market" className="text-cyan-400 hover:underline text-[11px] font-mono">
            Armory Status →
          </Link>
        </div>
      ) : null}
    </>
  )
}
