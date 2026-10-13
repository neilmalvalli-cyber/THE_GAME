'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getActiveSabotage, type ActiveSabotage } from '@/actions/market'

interface Props {
  sabotage: ActiveSabotage | null
  hasActiveShield: boolean
  onStatusChange?: (sabotage: ActiveSabotage | null) => void
}

export default function SabotageBanner({ sabotage: initialSabotage, hasActiveShield: initialShield, onStatusChange }: Props) {
  const [sabotage, setSabotage] = useState<ActiveSabotage | null>(initialSabotage)
  const [hasShield, setHasShield] = useState<boolean>(initialShield)
  const [secondsLeft, setSecondsLeft] = useState<number>(initialSabotage?.seconds_remaining || 0)

  // Sync when initial prop changes
  useEffect(() => {
    setSabotage(initialSabotage)
    setSecondsLeft(initialSabotage?.seconds_remaining || 0)
    setHasShield(initialShield)
  }, [initialSabotage, initialShield])

  // Real-time polling to detect sabotage launched while on page
  useEffect(() => {
    let mounted = true
    const checkStatus = async () => {
      try {
        const res = await getActiveSabotage()
        if (!mounted) return
        if (res.success && res.data) {
          const newSabotage = res.data.active_sabotage
          setSabotage(newSabotage)
          setHasShield(res.data.has_active_shield)
          setSecondsLeft(newSabotage?.seconds_remaining || 0)
          if (onStatusChange) onStatusChange(newSabotage)
        }
      } catch (e) {
        // Silently catch polling errors
      }
    }

    const interval = setInterval(checkStatus, 3500)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [onStatusChange])

  // Countdown clock timer
  useEffect(() => {
    if (!sabotage || secondsLeft <= 0) return

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          setSabotage(null)
          if (onStatusChange) onStatusChange(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [sabotage, secondsLeft, onStatusChange])

  const isGlitch = sabotage?.type === 'glitch_attack' && secondsLeft > 0
  const isTimeLock = sabotage?.type === 'time_lock' && secondsLeft > 0

  // Apply body-wide classes for cyber glitch and freeze effects
  useEffect(() => {
    if (typeof document === 'undefined') return

    if (isGlitch) {
      document.body.classList.add('glitch-attack-active')
    } else {
      document.body.classList.remove('glitch-attack-active')
    }

    if (isTimeLock) {
      document.body.classList.add('time-lock-active')
    } else {
      document.body.classList.remove('time-lock-active')
    }

    return () => {
      document.body.classList.remove('glitch-attack-active')
      document.body.classList.remove('time-lock-active')
    }
  }, [isGlitch, isTimeLock])

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`

  return (
    <>
      {/* ============================================================
          CASE A: GLITCH ATTACK — HIGH INTENSITY CYBER CORRUPTION
         ============================================================ */}
      {isGlitch && (
        <>
          {/* Full Screen Glitch & Scanline Overlay */}
          <div className="glitch-attack-screen">
            <div className="glitch-scanline" />
            <div className="glitch-slice" />
            <div className="absolute top-2 left-4 z-50 text-[10px] font-mono text-red-500 font-bold bg-black/90 px-3 py-1.5 border border-red-500/70 rounded-lg shadow-lg shadow-red-500/20 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>⚠️ SYSTEM TAMPER DETECTED // FREQUENCY JAMMED // DURATION: {timeFormatted}</span>
            </div>
          </div>

          {/* Glitch Sabotage Banner */}
          <div className="relative overflow-hidden rounded-2xl p-5 border-2 border-red-500 bg-gradient-to-r from-red-950/90 via-black to-red-950/90 shadow-2xl shadow-red-500/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl animate-bounce text-red-500">
                  ☣️
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full animate-pulse">
                      ACTIVE RIVAL SABOTAGE
                    </span>
                    <span className="text-xs font-mono font-black text-red-400 bg-red-950/80 px-2 py-0.5 rounded border border-red-700">
                      ⏱️ {timeFormatted} REMAINING
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-white mt-1 uppercase tracking-wide glitch-jitter-active">
                    ☣️ GLITCH ATTACK IN EFFECT // HUD CORRUPTED!
                  </h3>
                  <p className="text-xs text-red-200/90 mt-0.5 font-mono">
                    A rival operative flooded your tactical feed with chromatic tearing and visual noise.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/market"
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-amber-500/40 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-lg"
                >
                  <span>🛡️</span>
                  <span>Armory Defense →</span>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============================================================
          CASE B: TIME LOCK — FULL DASHBOARD CRYO-STASIS FREEZE
          "timelock means the entire dashboard is frozen, no challenges
          open, nothing to type and all that nothing works."
         ============================================================ */}
      {isTimeLock && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 frozen-glass animate-in fade-in duration-300">
          <div className="relative max-w-xl w-full p-8 bg-zinc-950/95 border-2 border-cyan-400 rounded-3xl shadow-2xl shadow-cyan-500/30 text-center space-y-6">
            {/* Glowing Ice Icon */}
            <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-cyan-500/10 border-2 border-cyan-400 text-4xl shadow-inner animate-pulse">
              <span>🧊</span>
              <span className="absolute -bottom-2 -right-2 text-2xl">🔒</span>
            </div>

            <div>
              <div className="inline-block px-3 py-1 bg-cyan-950 border border-cyan-500/50 text-cyan-300 text-xs font-mono font-black uppercase tracking-widest rounded-full mb-3">
                CRYO-STASIS LOCKDOWN ACTIVE
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight uppercase">
                Terminal Completely Frozen
              </h2>
              <p className="text-zinc-300 text-xs mt-2 leading-relaxed max-w-md mx-auto">
                A rival operative detonated a <strong className="text-cyan-300">Time Lock EMP</strong> on your tactical terminal! All case files, level decryptions, typing fields, and action buttons are frozen.
              </p>
            </div>

            {/* Huge Glowing Lockdown Timer */}
            <div className="p-4 bg-cyan-950/60 border border-cyan-400/40 rounded-2xl max-w-xs mx-auto">
              <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest block font-bold mb-1">
                Stasis Thaw Countdown
              </span>
              <span className="text-4xl font-black font-mono text-cyan-200 tracking-wider">
                {timeFormatted}
              </span>
            </div>

            {/* Status note */}
            <div className="text-[11px] text-zinc-400 font-mono space-y-1">
              <div>🚫 Case files & challenge terminals locked</div>
              <div>🚫 Typing inputs and solution submissions disabled</div>
              <div>💡 Tip: Deploy a <strong className="text-amber-400">Ghost Shield</strong> in the Armory to deflect future rival strikes!</div>
            </div>

            <div className="pt-2 border-t border-zinc-800">
              <Link
                href="/market"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-cyan-500/20"
              >
                <span>🛒 Visit Armory & Market →</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          CASE C: GHOST SHIELD DEPLOYED INDICATOR
         ============================================================ */}
      {!sabotage && hasShield && (
        <div className="rounded-xl p-3 bg-cyan-950/40 border border-cyan-500/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-cyan-300 font-bold">
            <span className="text-base">🛡️</span>
            <span>GHOST SHIELD DEPLOYED: Active radar cloaking will absorb next incoming rival sabotage!</span>
          </div>
          <Link href="/market" className="text-cyan-400 hover:underline text-[11px] font-mono">
            Armory Status →
          </Link>
        </div>
      )}
    </>
  )
}
