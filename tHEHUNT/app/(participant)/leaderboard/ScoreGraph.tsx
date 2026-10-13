'use client'

import { useState, useMemo } from 'react'
import type { TeamTimelineSeries } from '@/actions/leaderboard'

interface ScoreGraphProps {
  timeline: TeamTimelineSeries[]
}

export default function ScoreGraph({ timeline }: ScoreGraphProps) {
  const [hiddenTeams, setHiddenTeams] = useState<Set<string>>(new Set())
  const [hoveredPoint, setHoveredPoint] = useState<{
    teamName: string
    score: number
    time: string
    color: string
    x: number
    y: number
  } | null>(null)

  // Dimensions
  const W = 800
  const H = 300
  const padLeft = 60
  const padRight = 30
  const padTop = 30
  const padBottom = 40

  const activeSeries = useMemo(() => {
    return timeline.filter((t) => !hiddenTeams.has(t.team_id))
  }, [timeline, hiddenTeams])

  const { minTime, maxTime, maxScore } = useMemo(() => {
    let minT = Infinity
    let maxT = -Infinity
    let maxS = 100 // minimum scale

    timeline.forEach((s) => {
      s.points.forEach((p) => {
        const t = new Date(p.time).getTime()
        if (t < minT) minT = t
        if (t > maxT) maxT = t
        if (p.score > maxS) maxS = p.score
      })
    })

    if (minT === Infinity || maxT === -Infinity || minT === maxT) {
      minT = Date.now() - 3600000
      maxT = Date.now()
    }

    // Add 10% headroom to maxScore
    maxS = Math.ceil((maxS * 1.1) / 100) * 100

    return { minTime: minT, maxTime: maxT, maxScore: maxS }
  }, [timeline])

  // Scale functions
  const scaleX = (isoTime: string) => {
    const t = new Date(isoTime).getTime()
    const pct = (t - minTime) / (maxTime - minTime || 1)
    return padLeft + pct * (W - padLeft - padRight)
  }

  const scaleY = (score: number) => {
    const pct = score / (maxScore || 1)
    return H - padBottom - pct * (H - padTop - padBottom)
  }

  const toggleTeam = (teamId: string) => {
    const next = new Set(hiddenTeams)
    if (next.has(teamId)) next.delete(teamId)
    else next.add(teamId)
    setHiddenTeams(next)
  }

  // Generate Y axis ticks
  const yTicks = [0, Math.round(maxScore * 0.25), Math.round(maxScore * 0.5), Math.round(maxScore * 0.75), maxScore]

  // Has any solves?
  const hasData = timeline.some((t) => t.points.length > 1)

  return (
    <div className="bg-zinc-950/90 border border-zinc-800/80 rounded-2xl p-5 shadow-2xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-900 pb-3">
        <div>
          <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <span>📈</span>
            <span>CTFd Progression Matrix // Score Over Time</span>
          </h2>
          <p className="text-[11px] text-zinc-500">
            Real-time score accumulation timeline. Earlier solves out-rank ties.
          </p>
        </div>

        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded border border-zinc-800">
          Tracking {timeline.length} Teams
        </span>
      </div>

      {!hasData ? (
        <div className="py-16 text-center text-xs text-zinc-500 font-mono">
          Awaiting first blood... Progression curves will trace live solves as teams crack puzzle stages.
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden w-full">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-64 sm:h-72 select-none overflow-visible"
            >
              <defs>
                <linearGradient id="gridGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#27272a" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#27272a" stopOpacity="0.05" />
                </linearGradient>
              </defs>

              {/* Background horizontal grid lines */}
              {yTicks.map((tickVal) => {
                const y = scaleY(tickVal)
                return (
                  <g key={tickVal}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={W - padRight}
                      y2={y}
                      stroke="#27272a"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      fill="#71717a"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      {tickVal}
                    </text>
                  </g>
                )
              })}

              {/* Axes lines */}
              <line
                x1={padLeft}
                y1={H - padBottom}
                x2={W - padRight}
                y2={H - padBottom}
                stroke="#3f3f46"
                strokeWidth="1.5"
              />
              <line
                x1={padLeft}
                y1={padTop}
                x2={padLeft}
                y2={H - padBottom}
                stroke="#3f3f46"
                strokeWidth="1.5"
              />

              {/* Team Progression Polylines */}
              {activeSeries.map((series) => {
                if (series.points.length === 0) return null

                const pointsStr = series.points
                  .map((p) => `${scaleX(p.time)},${scaleY(p.score)}`)
                  .join(' ')

                const lastPoint = series.points[series.points.length - 1]
                const lx = scaleX(lastPoint.time)
                const ly = scaleY(lastPoint.score)

                return (
                  <g key={series.team_id} className="transition-opacity duration-200">
                    {/* Shadow line for glowing neon effect */}
                    <polyline
                      points={pointsStr}
                      fill="none"
                      stroke={series.color}
                      strokeWidth="6"
                      strokeOpacity="0.15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Main stroke line */}
                    <polyline
                      points={pointsStr}
                      fill="none"
                      stroke={series.color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Solve step dots */}
                    {series.points.map((p, pIdx) => {
                      const px = scaleX(p.time)
                      const py = scaleY(p.score)
                      return (
                        <circle
                          key={pIdx}
                          cx={px}
                          cy={py}
                          r="3"
                          fill={series.color}
                          stroke="#090a0f"
                          strokeWidth="1.5"
                          className="cursor-pointer hover:r-5 transition-all"
                          onMouseEnter={() => {
                            setHoveredPoint({
                              teamName: series.team_name,
                              score: p.score,
                              time: new Date(p.time).toLocaleTimeString(),
                              color: series.color,
                              x: px,
                              y: py,
                            })
                          }}
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                      )
                    })}

                    {/* Leading head pulse dot */}
                    <circle cx={lx} cy={ly} r="4.5" fill={series.color} />
                  </g>
                )
              })}
            </svg>

            {/* Tooltip on hover */}
            {hoveredPoint && (
              <div
                className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-full mb-3 px-3 py-1.5 bg-zinc-900 border rounded-lg shadow-xl text-xs font-mono"
                style={{
                  left: `${(hoveredPoint.x / W) * 100}%`,
                  top: `${(hoveredPoint.y / H) * 100}%`,
                  borderColor: hoveredPoint.color,
                }}
              >
                <div className="font-bold text-white flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: hoveredPoint.color }}
                  />
                  <span>{hoveredPoint.teamName}</span>
                </div>
                <div className="text-[11px] text-emerald-400 font-bold mt-0.5">
                  +{hoveredPoint.score} pts
                </div>
                <div className="text-[9px] text-zinc-500">{hoveredPoint.time}</div>
              </div>
            )}
          </div>

          {/* Interactive Team Toggle Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-900">
            <span className="text-[10px] uppercase font-bold text-zinc-500 mr-1">Filter Lines:</span>
            {timeline.map((t) => {
              const isHidden = hiddenTeams.has(t.team_id)
              return (
                <button
                  key={t.team_id}
                  onClick={() => toggleTeam(t.team_id)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border font-mono flex items-center gap-1.5 transition-all ${
                    isHidden
                      ? 'bg-zinc-900/40 text-zinc-600 border-zinc-800 line-through'
                      : 'bg-zinc-900 text-zinc-200 border-zinc-700 hover:border-zinc-500 shadow-sm'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: isHidden ? '#52525b' : t.color }}
                  />
                  <span>{t.team_name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
