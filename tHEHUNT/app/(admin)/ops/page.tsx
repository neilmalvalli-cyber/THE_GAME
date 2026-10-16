'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import {
  adminGetChallenges,
  adminCreateChallengeWithLevels,
  adminDeleteChallenge,
  adminGetLevels,
} from '@/actions/challenges'
import { adminAdjustBalance, adminGetAllBalances } from '@/actions/economy'
import { getActiveEvent, adminUpdateEventStatus, adminCreateDefaultEvent } from '@/actions/events'
import { adminToggleScoreboardLock } from '@/actions/leaderboard'
import { adminTriggerBlackMarket, adminCloseBlackMarket } from '@/actions/market'
import {
  adminLaunchSurpriseMiniGame,
  adminEndSurpriseMiniGame,
  getActiveSurpriseMiniGame,
  type SurpriseMiniGameData,
} from '@/actions/surprises'

interface LevelRow {
  id: string
  level_number: number
  title: string
  prompt: string
  answer: string
  points: number
  coins_reward: number
  hint_text: string
  hint_cost: number
}

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<'builder' | 'challenges' | 'teams' | 'ops' | 'event'>('builder')
  const [event, setEvent] = useState<any>(null)
  const [challenges, setChallenges] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Flash Ops & Surprise Mini-Games State
  const [activeSurprise, setActiveSurprise] = useState<SurpriseMiniGameData | null>(null)
  const [bmDuration, setBmDuration] = useState<number>(5)
  const [surpriseTitle, setSurpriseTitle] = useState('Binary Flash Raid')
  const [surpriseQuestion, setSurpriseQuestion] = useState('Decode binary: 01001000 01010101 01001110 01010100')
  const [surpriseAnswer, setSurpriseAnswer] = useState('HUNT')
  const [surpriseDuration, setSurpriseDuration] = useState(5)
  const [surprisePoints, setSurprisePoints] = useState(50)
  const [surpriseCoins, setSurpriseCoins] = useState(30)
  const [surprisePowerup, setSurprisePowerup] = useState('ghost_shield')

  // Notification Banner
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  function showNotice(type: 'success' | 'error', message: string) {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 6000)
  }

  // --- Spreadsheet Challenge Builder State ---
  const [challengeTitle, setChallengeTitle] = useState('')
  const [challengeCategory, setChallengeCategory] = useState('Crypto')
  const [challengeDesc, setChallengeDesc] = useState('')
  const [challengeFragment, setChallengeFragment] = useState('')
  const [challengeFragmentSlot, setChallengeFragmentSlot] = useState(1)

  const [levelRows, setLevelRows] = useState<LevelRow[]>([
    {
      id: 'lvl-1',
      level_number: 1,
      title: 'Level 1: Recon',
      prompt: '',
      answer: '',
      points: 100,
      coins_reward: 50,
      hint_text: '',
      hint_cost: 15,
    },
    {
      id: 'lvl-2',
      level_number: 2,
      title: 'Level 2: Infiltration',
      prompt: '',
      answer: '',
      points: 200,
      coins_reward: 75,
      hint_text: '',
      hint_cost: 25,
    },
  ])

  // --- Selected Challenge Detail (for inspection) ---
  const [viewChallengeId, setViewChallengeId] = useState<string | null>(null)
  const [viewLevels, setViewLevels] = useState<any[]>([])

  // --- Economy Management Form ---
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [econCurrency, setEconCurrency] = useState<'coins' | 'points'>('coins')
  const [econDelta, setEconDelta] = useState<number>(100)
  const [econReason, setEconReason] = useState('Admin Bonus')

  async function loadAll() {
    setLoading(true)
    try {
      const [evRes, chRes, tmRes, spRes] = await Promise.all([
        getActiveEvent(),
        adminGetChallenges(),
        adminGetAllBalances(),
        getActiveSurpriseMiniGame(),
      ])

      if (evRes.success) setEvent(evRes.data)
      if (chRes.success && chRes.data) {
        setChallenges(chRes.data)
        if (!viewChallengeId && chRes.data.length > 0) {
          setViewChallengeId(chRes.data[0].id)
        }
      }
      if (tmRes.success && tmRes.data) setTeams(tmRes.data)
      if (spRes.success) setActiveSurprise(spRes.data || null)
    } catch (err: any) {
      showNotice('error', err?.message || 'Error loading command center')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    if (viewChallengeId) {
      adminGetLevels(viewChallengeId).then((res) => {
        if (res.success && res.data) setViewLevels(res.data)
      })
    }
  }, [viewChallengeId])

  // Spreadsheet helpers
  function addLevelRow() {
    const nextNum = levelRows.length + 1
    setLevelRows([
      ...levelRows,
      {
        id: `lvl-${Date.now()}`,
        level_number: nextNum,
        title: `Level ${nextNum}`,
        prompt: '',
        answer: '',
        points: nextNum * 100,
        coins_reward: nextNum * 50,
        hint_text: '',
        hint_cost: 20,
      },
    ])
  }

  function removeLevelRow(index: number) {
    if (levelRows.length <= 1) {
      showNotice('error', 'A challenge must contain at least 1 level.')
      return
    }
    const updated = levelRows.filter((_, idx) => idx !== index).map((lvl, idx) => ({
      ...lvl,
      level_number: idx + 1,
    }))
    setLevelRows(updated)
  }

  function updateLevelRow(index: number, field: keyof LevelRow, val: any) {
    const updated = [...levelRows]
    updated[index] = { ...updated[index], [field]: val }
    setLevelRows(updated)
  }

  // Submit Challenge + All Levels at once
  function handleSaveWholeChallenge(e: React.FormEvent) {
    e.preventDefault()

    if (!challengeTitle.trim()) {
      showNotice('error', 'Please provide a challenge title.')
      return
    }

    // Validate that each level has a prompt and answer
    for (let i = 0; i < levelRows.length; i++) {
      if (!levelRows[i].prompt.trim() || !levelRows[i].answer.trim()) {
        showNotice('error', `Level ${i + 1} is missing its question prompt or answer!`)
        return
      }
    }

    startTransition(async () => {
      const res = await adminCreateChallengeWithLevels({
        title: challengeTitle,
        category: challengeCategory,
        description: challengeDesc,
        final_fragment: challengeFragment,
        fragment_order: Number(challengeFragmentSlot),
        levels: levelRows,
      })

      if (res.success) {
        showNotice('success', `🎉 Challenge "${challengeTitle}" created with ${res.data?.level_count} levels and fragment "${challengeFragment || 'none'}"!`)
        // Reset form
        setChallengeTitle('')
        setChallengeDesc('')
        setChallengeFragment('')
        setChallengeFragmentSlot(challenges.length + 2)
        setLevelRows([
          {
            id: 'lvl-1',
            level_number: 1,
            title: 'Level 1: Recon',
            prompt: '',
            answer: '',
            points: 100,
            coins_reward: 50,
            hint_text: '',
            hint_cost: 15,
          },
        ])
        await loadAll()
        setTab('challenges')
      } else {
        showNotice('error', res.error || 'Failed to save challenge.')
      }
    })
  }

  // Delete challenge
  async function handleDelete(chalId: string, title: string) {
    if (!confirm(`Are you sure you want to delete challenge "${title}" and all its levels?`)) return
    startTransition(async () => {
      const res = await adminDeleteChallenge(chalId)
      if (res.success) {
        showNotice('success', `Deleted "${title}"`)
        loadAll()
      } else {
        showNotice('error', res.error || 'Failed to delete challenge')
      }
    })
  }

  // Adjust economy
  async function handleEconSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTeamId) {
      showNotice('error', 'Please select a team')
      return
    }
    startTransition(async () => {
      const res = await adminAdjustBalance({
        team_id: selectedTeamId,
        currency: econCurrency,
        delta: Number(econDelta),
        reason: econReason,
      })
      if (res.success) {
        showNotice('success', `Balance updated! New balance: ${res.data?.new_balance}`)
        loadAll()
      } else {
        showNotice('error', res.error || 'Failed to adjust balance')
      }
    })
  }

  // Event toggle
  async function handleStatusChange(st: any) {
    if (!event) return
    startTransition(async () => {
      const res = await adminUpdateEventStatus(event.id, st)
      if (res.success) {
        showNotice('success', `Event state changed to: ${st.toUpperCase()}`)
        loadAll()
      } else {
        showNotice('error', res.error || 'Failed to update event state')
      }
    })
  }

  // Scoreboard Lock Toggle
  async function handleToggleScoreboard(locked: boolean) {
    startTransition(async () => {
      const res = await adminToggleScoreboardLock(locked)
      if (res.success) {
        showNotice('success', locked ? 'Scoreboard is now FROZEN (Hidden from participants)' : 'Scoreboard is now PUBLIC (Visible to participants)')
        loadAll()
      } else {
        showNotice('error', res.error || 'Failed to toggle scoreboard lock')
      }
    })
  }

  // Black Market Handlers
  async function handleTriggerBlackMarket(duration: number) {
    startTransition(async () => {
      const res = await adminTriggerBlackMarket(duration)
      if (res.success) {
        showNotice('success', `⚡ 5-Minute Flash Black Market launched until ${new Date(res.data?.expires_at || '').toLocaleTimeString()}!`)
        await loadAll()
      } else {
        showNotice('error', res.error || 'Failed to open black market')
      }
    })
  }

  async function handleCloseBlackMarket() {
    startTransition(async () => {
      const res = await adminCloseBlackMarket()
      if (res.success) {
        showNotice('success', 'Black Market is now CLOSED.')
        await loadAll()
      } else {
        showNotice('error', res.error || 'Failed to close black market')
      }
    })
  }

  // Surprise Mini-Game Handlers
  async function handleLaunchSurprise() {
    if (!surpriseTitle.trim() || !surpriseQuestion.trim() || !surpriseAnswer.trim()) {
      showNotice('error', 'Please fill in Title, Question, and Answer for the surprise challenge!')
      return
    }

    startTransition(async () => {
      const res = await adminLaunchSurpriseMiniGame({
        title: surpriseTitle,
        question_text: surpriseQuestion,
        question_answer: surpriseAnswer,
        duration_minutes: surpriseDuration,
        points_reward: surprisePoints,
        coins_reward: surpriseCoins,
        powerup_reward_type: surprisePowerup,
      })

      if (res.success) {
        showNotice('success', `🚀 Flash Mini-Game "${surpriseTitle}" is now LIVE on participant terminals for ${surpriseDuration} minutes!`)
        await loadAll()
      } else {
        showNotice('error', res.error || 'Failed to launch surprise mini-game')
      }
    })
  }

  async function handleEndSurprise(id: string) {
    startTransition(async () => {
      const res = await adminEndSurpriseMiniGame(id)
      if (res.success) {
        showNotice('success', 'Flash Mini-Game ended.')
        await loadAll()
      } else {
        showNotice('error', res.error || 'Failed to end surprise game')
      }
    })
  }

  const isScoreboardLocked = Boolean(event?.settings?.scoreboard_locked)

  return (
    <div className="min-h-screen bg-[#090a0f] text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* Top Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-lg tracking-wider text-amber-400">THE HUNT</span>
            <span className="text-zinc-600">/</span>
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-widest bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
              Admin Terminal
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/leaderboard"
              className="text-xs font-medium text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center gap-1.5 transition-colors"
            >
              <span>🏆</span>
              <span>Scoreboard View</span>
            </Link>

            <Link
              href="/admin"
              className="text-xs font-medium text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              Player View →
            </Link>
          </div>
        </div>
      </header>

      {/* Navigation Sub-bar */}
      <div className="border-b border-zinc-800/60 bg-zinc-900/40">
        <div className="max-w-7xl mx-auto px-4 flex gap-6 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setTab('builder')}
            className={`py-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              tab === 'builder'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>✨</span> Challenge Sheet Builder
          </button>
          <button
            onClick={() => setTab('challenges')}
            className={`py-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              tab === 'challenges'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>📚</span> Existing Challenges ({challenges.length})
          </button>
          <button
            onClick={() => setTab('teams')}
            className={`py-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              tab === 'teams'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>👥</span> Teams & Economy ({teams.length})
          </button>
          <button
            onClick={() => setTab('ops')}
            className={`py-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              tab === 'ops'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>⚡</span> Black Market & Flash Raids
            {event?.settings?.black_market_active && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setTab('event')}
            className={`py-3.5 border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              tab === 'event'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>⚙️</span> Event State & Lock
          </button>
        </div>
      </div>

      {/* Dynamic Feedback Banner */}
      {feedback && (
        <div
          className={`max-w-7xl mx-auto mx-4 my-4 p-3.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-200'
              : 'bg-red-950/80 border border-red-800 text-red-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 font-bold">✕</button>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="py-24 text-center text-zinc-500 text-sm">
            <div className="inline-block w-6 h-6 border-2 border-zinc-700 border-t-amber-400 rounded-full animate-spin mb-3" />
            <p>Syncing Command Center data...</p>
          </div>
        ) : (
          <>
            {/* ========================================================
                TAB 1: SPREADSHEET CHALLENGE BUILDER (ALL AT ONCE)
               ======================================================== */}
            {tab === 'builder' && (
              <form onSubmit={handleSaveWholeChallenge} className="space-y-8">
                {/* Challenge Header Card */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl">
                  <div className="mb-4">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <span>1. Challenge Metadata & Secret Fragment</span>
                    </h2>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      Enter the case file name, category, and the 2-digit number fragment that solving this challenge will reveal!
                    </p>
                  </div>

                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Case File / Challenge Title *
                      </label>
                      <input
                        type="text"
                        required
                        value={challengeTitle}
                        onChange={(e) => setChallengeTitle(e.target.value)}
                        placeholder="e.g. Case File 01: The Entry Point"
                        className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-sm focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Category
                      </label>
                      <select
                        value={challengeCategory}
                        onChange={(e) => setChallengeCategory(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-sm focus:outline-none focus:border-amber-400"
                      >
                        <option value="Crypto">Crypto</option>
                        <option value="Forensics">Forensics</option>
                        <option value="Web Exploitation">Web Exploitation</option>
                        <option value="Reverse Engineering">Reverse Engineering</option>
                        <option value="OSINT">OSINT</option>
                        <option value="Trivia & Logic">Trivia & Logic</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-cyan-400 mb-1.5 uppercase tracking-wider">
                        Secret Fragment (1 or 2 Digits) 📞
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        value={challengeFragment}
                        onChange={(e) => setChallengeFragment(e.target.value)}
                        placeholder="e.g. 7 or 42"
                        className="w-full px-3.5 py-2.5 bg-zinc-950 border border-cyan-800/80 rounded-xl text-cyan-300 font-mono font-bold text-sm focus:outline-none focus:border-cyan-400"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Unlocks when all levels solved (1 challenge gives 2 digits, others give 1 digit for 10 digits total)
                      </span>
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Description / Lore (Optional)
                      </label>
                      <textarea
                        rows={2}
                        value={challengeDesc}
                        onChange={(e) => setChallengeDesc(e.target.value)}
                        placeholder="Brief background or storyline briefing for this operation..."
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Fragment Slot #
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={challengeFragmentSlot}
                        onChange={(e) => setChallengeFragmentSlot(Number(e.target.value))}
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-mono focus:outline-none focus:border-amber-400"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">Sequence order: 1 to 9 (Assembles 10 digits total)</span>
                    </div>
                  </div>
                </div>

                {/* Spreadsheet Level Rows Table */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <span>2. Levels Spreadsheet Editor</span>
                        <span className="text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2 py-0.5 rounded-full font-mono">
                          {levelRows.length} {levelRows.length === 1 ? 'level' : 'levels'}
                        </span>
                      </h2>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        Add all the levels for this case file at once. Players solve them in sequential order!
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={addLevelRow}
                      className="inline-flex items-center gap-2 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl text-xs font-semibold transition-all border border-zinc-700 hover:border-zinc-600"
                    >
                      <span className="text-amber-400 text-base leading-none">+</span> Add Another Level Row
                    </button>
                  </div>

                  {/* Level Cards / Rows */}
                  <div className="space-y-4 pt-2">
                    {levelRows.map((lvl, index) => (
                      <div
                        key={lvl.id}
                        className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-4 transition-all hover:border-zinc-700 shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-900">
                          <div className="flex items-center gap-2.5">
                            <span className="w-6 h-6 rounded-md bg-amber-400 text-zinc-950 font-extrabold text-xs flex items-center justify-center">
                              {lvl.level_number}
                            </span>
                            <span className="text-xs font-bold text-white uppercase tracking-wider">
                              Level {lvl.level_number}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeLevelRow(index)}
                            className="text-zinc-500 hover:text-red-400 text-xs transition-colors p-1"
                            title="Delete this level"
                          >
                            ✕ Remove
                          </button>
                        </div>

                        <div className="grid md:grid-cols-12 gap-3">
                          {/* Level Title */}
                          <div className="md:col-span-4">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Stage Title *
                            </label>
                            <input
                              type="text"
                              required
                              value={lvl.title}
                              onChange={(e) => updateLevelRow(index, 'title', e.target.value)}
                              placeholder={`Level ${index + 1}`}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-600"
                            />
                          </div>

                          {/* Points Awarded */}
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Points 🏆
                            </label>
                            <input
                              type="number"
                              required
                              value={lvl.points}
                              onChange={(e) => updateLevelRow(index, 'points', e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-emerald-400 font-mono font-bold"
                            />
                          </div>

                          {/* Coins Awarded */}
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Coins 🪙
                            </label>
                            <input
                              type="number"
                              required
                              value={lvl.coins_reward}
                              onChange={(e) => updateLevelRow(index, 'coins_reward', e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-amber-400 font-mono font-bold"
                            />
                          </div>

                          {/* Secret Answer */}
                          <div className="md:col-span-4">
                            <label className="block text-[11px] font-bold text-amber-400 mb-1">
                              Secret Answer / Flag * (Hidden!)
                            </label>
                            <input
                              type="text"
                              required
                              value={lvl.answer}
                              onChange={(e) => updateLevelRow(index, 'answer', e.target.value)}
                              placeholder="e.g. THE_SECRET_FLAG"
                              className="w-full px-3 py-2 bg-zinc-900 border border-amber-900/50 rounded-lg text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400"
                            />
                          </div>

                          {/* Question / Prompt */}
                          <div className="md:col-span-7">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Question / Prompt / Encrypted Cipher *
                            </label>
                            <textarea
                              rows={2}
                              required
                              value={lvl.prompt}
                              onChange={(e) => updateLevelRow(index, 'prompt', e.target.value)}
                              placeholder="Write the clue, prompt, or encoded text here..."
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-600"
                            />
                          </div>

                          {/* Hint Text */}
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Intel Clue / Hint (Optional)
                            </label>
                            <textarea
                              rows={2}
                              value={lvl.hint_text}
                              onChange={(e) => updateLevelRow(index, 'hint_text', e.target.value)}
                              placeholder="Clue for teams..."
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                            />
                          </div>

                          {/* Hint Cost */}
                          <div className="md:col-span-2">
                            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                              Hint Cost (🪙)
                            </label>
                            <input
                              type="number"
                              value={lvl.hint_cost}
                              onChange={(e) => updateLevelRow(index, 'hint_cost', e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Submission Row */}
                  <div className="pt-6 border-t border-zinc-800/80 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={addLevelRow}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      + Add another level row
                    </button>

                    <button
                      type="submit"
                      disabled={isPending}
                      className="px-8 py-3 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-400/10 disabled:opacity-50 flex items-center gap-2"
                    >
                      {isPending ? (
                        <>
                          <span className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                          Publishing Challenge...
                        </>
                      ) : (
                        <>
                          <span>🚀</span> Publish Case File & All {levelRows.length} Levels
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ========================================================
                TAB 2: EXISTING CHALLENGES LIST & INSPECTION
               ======================================================== */}
            {tab === 'challenges' && (
              <div className="grid lg:grid-cols-12 gap-8">
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      Published Operations ({challenges.length})
                    </h2>
                    <button
                      onClick={() => setTab('builder')}
                      className="text-xs text-amber-400 hover:underline"
                    >
                      + Create New
                    </button>
                  </div>

                  {challenges.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setViewChallengeId(c.id)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        viewChallengeId === c.id
                          ? 'bg-amber-500/10 border-amber-500/40 text-white shadow-md'
                          : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded">
                              {c.category || 'General'}
                            </span>
                            {c.final_fragment && (
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded">
                                Fragment: {c.final_fragment}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-white mt-1.5">{c.title}</h3>
                          <span className="text-xs text-zinc-500 font-mono">
                            {c.level_count || 0} levels configured
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(c.id, c.title)
                          }}
                          className="text-zinc-600 hover:text-red-400 text-xs p-1"
                          title="Delete Challenge"
                        >
                          🗑
                        </button>
                      </div>

                      {c.description && (
                        <p className="text-zinc-500 text-xs mt-1 line-clamp-1">{c.description}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Level Detail Viewer */}
                <div className="lg:col-span-7 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                    Levels in Selected Operation
                  </h2>

                  {viewLevels.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500 text-xs">
                      No levels configured for this challenge.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {viewLevels.map((lvl) => (
                        <div
                          key={lvl.id}
                          className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between font-bold">
                            <span className="text-white text-sm">
                              {lvl.title.toLowerCase().startsWith('level') || lvl.title.toLowerCase().startsWith('stage')
                                ? lvl.title
                                : `Stage ${lvl.level_number}: ${lvl.title}`}
                            </span>
                            <span className="font-mono text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-900/60">
                              Answer: {lvl.answer}
                            </span>
                          </div>

                          <div className="p-2.5 bg-zinc-900/60 rounded text-zinc-300 font-mono text-[11px] whitespace-pre-wrap">
                            {lvl.prompt}
                          </div>

                          <div className="flex items-center gap-4 text-[10px] text-zinc-400 pt-1">
                            <span>🏆 +{lvl.points_reward ?? lvl.points} pts</span>
                            <span>🪙 +{lvl.coins_reward} coins</span>
                            {lvl.hint_text && <span>💡 Hint: {lvl.hint_text} ({lvl.hint_cost}🪙)</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================
                TAB 3: TEAMS & ECONOMY MANAGEMENT
               ======================================================== */}
            {tab === 'teams' && (
              <div className="grid lg:grid-cols-12 gap-8">
                {/* Team Standing Table */}
                <div className="lg:col-span-8 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                    Live Team Ledger ({teams.length})
                  </h2>

                  {teams.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-12 text-center">No active teams registered yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-zinc-800 text-zinc-400">
                            <th className="py-2.5">Team Name</th>
                            <th className="py-2.5 text-right">Score</th>
                            <th className="py-2.5 text-right">Coins</th>
                            <th className="py-2.5 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60 font-mono">
                          {teams.map((t) => (
                            <tr key={t.team_id} className="hover:bg-zinc-950/40 transition-colors">
                              <td className="py-3 font-sans font-bold text-white">{t.team_name}</td>
                              <td className="py-3 text-right font-bold text-emerald-400">+{t.score_total}</td>
                              <td className="py-3 text-right font-bold text-amber-400">{t.coin_balance} 🪙</td>
                              <td className="py-3 text-center">
                                <button
                                  onClick={() => setSelectedTeamId(t.team_id)}
                                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-sans"
                                >
                                  Adjust
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Direct Adjust Form */}
                <div className="lg:col-span-4 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
                    Coin & Score Grant / Deduct
                  </h2>

                  <form onSubmit={handleEconSubmit} className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-400">Target Team</label>
                      <select
                        value={selectedTeamId}
                        onChange={(e) => setSelectedTeamId(e.target.value)}
                        className="w-full mt-1 px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100"
                      >
                        <option value="">-- Choose Team --</option>
                        {teams.map((t) => (
                          <option key={t.team_id} value={t.team_id}>
                            {t.team_name} ({t.coin_balance}🪙)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-zinc-400">Currency</label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setEconCurrency('coins')}
                          className={`py-2 text-xs font-bold rounded-xl transition-colors ${
                            econCurrency === 'coins'
                              ? 'bg-amber-400 text-zinc-950'
                              : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                          }`}
                        >
                          Coins 🪙
                        </button>
                        <button
                          type="button"
                          onClick={() => setEconCurrency('points')}
                          className={`py-2 text-xs font-bold rounded-xl transition-colors ${
                            econCurrency === 'points'
                              ? 'bg-emerald-400 text-zinc-950'
                              : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                          }`}
                        >
                          Points 🏆
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-zinc-400">Delta (+ to add, - to subtract)</label>
                      <input
                        type="number"
                        required
                        value={econDelta}
                        onChange={(e) => setEconDelta(Number(e.target.value))}
                        className="w-full mt-1 px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-zinc-400">Audit Reason</label>
                      <input
                        type="text"
                        required
                        value={econReason}
                        onChange={(e) => setEconReason(e.target.value)}
                        placeholder="e.g. Surprise bonus reward"
                        className="w-full mt-1 px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isPending || !selectedTeamId}
                      className="w-full py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
                    >
                      {isPending ? 'Executing...' : 'Execute Transaction'}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* ========================================================
                TAB 4: BLACK MARKET & SURPRISE MINI-GAMES OPERATIONS
               ======================================================== */}
            {tab === 'ops' && (
              <div className="space-y-8">
                {/* 1. BLACK MARKET 5-MINUTE FLASH SALE CONTROLLER */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <span>🛒</span> 5-Minute Flash Black Market Controller
                      </h2>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        Open the underground contraband bazaar to participants for a surprise 5-minute flash window!
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase ${
                        event?.settings?.black_market_active
                          ? 'bg-amber-400/10 text-amber-300 border border-amber-500/30 animate-pulse'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        Status: {event?.settings?.black_market_active ? '⚡ FLASH SALE LIVE' : '🔒 CLOSED'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800/80 space-y-2">
                      <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        Quick Launch (5 Minutes)
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Broadcasts flash opening banner to all participant dashboards with a 5-minute countdown clock.
                      </p>
                      <button
                        onClick={() => handleTriggerBlackMarket(5)}
                        disabled={isPending}
                        className="w-full mt-2 py-2 bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-bold rounded-lg transition-colors"
                      >
                        ⚡ Open 5-Min Flash Market
                      </button>
                    </div>

                    <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800/80 space-y-2">
                      <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        Custom Duration Window
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={bmDuration}
                          onChange={(e) => setBmDuration(Number(e.target.value))}
                          className="w-20 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-white"
                        />
                        <span className="text-xs text-zinc-400">minutes</span>
                      </div>
                      <button
                        onClick={() => handleTriggerBlackMarket(bmDuration)}
                        disabled={isPending}
                        className="w-full mt-2 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-lg transition-colors border border-zinc-700"
                      >
                        Open for {bmDuration} Minutes
                      </button>
                    </div>

                    <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800/80 space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                          Emergency Shutdown
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1">
                          Immediately lock down the black market and revoke procurement terminal access.
                        </p>
                      </div>
                      <button
                        onClick={handleCloseBlackMarket}
                        disabled={isPending}
                        className="w-full py-2 bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800 text-xs font-bold rounded-lg transition-colors"
                      >
                        ⛔ Close Black Market Now
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. SURPRISE MINI-GAME FLASH RAID LAUNCHER */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <span>⚡</span> 5-Minute Surprise Mini-Game Launcher
                      </h2>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        Trigger a high-urgency pop-up cipher on participant dashboards. Grants coins, points, and bonus power-ups!
                      </p>
                    </div>

                    {activeSurprise && (
                      <div className="flex items-center gap-2 bg-amber-950/50 border border-amber-500/50 px-3 py-1.5 rounded-xl">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                        <span className="text-xs font-mono text-amber-300 font-bold">
                          Live: &quot;{activeSurprise.title}&quot;
                        </span>
                        <button
                          onClick={() => handleEndSurprise(activeSurprise.id)}
                          className="ml-2 text-[10px] text-red-400 hover:text-red-300 underline"
                        >
                          End Early
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Preset Buttons */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mr-1">
                      Quick Presets:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSurpriseTitle('Binary Flash Recon')
                        setSurpriseQuestion('Decode binary string: 01001000 01010101 01001110 01010100')
                        setSurpriseAnswer('HUNT')
                        setSurprisePoints(50)
                        setSurpriseCoins(30)
                        setSurprisePowerup('ghost_shield')
                      }}
                      className="text-[11px] px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg transition-colors"
                    >
                      Preset 1: Binary Recon (HUNT)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSurpriseTitle('Port Intelligence Flash')
                        setSurpriseQuestion('What standard default port does HTTPS TLS/SSL traffic operate on?')
                        setSurpriseAnswer('443')
                        setSurprisePoints(60)
                        setSurpriseCoins(35)
                        setSurprisePowerup('overclock')
                      }}
                      className="text-[11px] px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg transition-colors"
                    >
                      Preset 2: Port Recon (443)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSurpriseTitle('CSI Logic Cryptography')
                        setSurpriseQuestion('In hexadecimal, convert decimal 255 to hex:')
                        setSurpriseAnswer('FF')
                        setSurprisePoints(75)
                        setSurpriseCoins(40)
                        setSurprisePowerup('forensic_vision')
                      }}
                      className="text-[11px] px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg transition-colors"
                    >
                      Preset 3: Hex Math (FF)
                    </button>
                  </div>

                  {/* Form */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">
                        Mini-Game Title
                      </label>
                      <input
                        type="text"
                        value={surpriseTitle}
                        onChange={(e) => setSurpriseTitle(e.target.value)}
                        placeholder="e.g. Midnight Binary Cipher"
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">
                        Secret Answer / Decryption Key (Case-Insensitive)
                      </label>
                      <input
                        type="text"
                        value={surpriseAnswer}
                        onChange={(e) => setSurpriseAnswer(e.target.value)}
                        placeholder="e.g. HUNT"
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-amber-900/50 rounded-xl text-xs font-mono text-amber-300 font-bold"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">
                        Prompt / Riddle / Encoded Text
                      </label>
                      <textarea
                        rows={2}
                        value={surpriseQuestion}
                        onChange={(e) => setSurpriseQuestion(e.target.value)}
                        placeholder="Enter the puzzle clue that participants must crack..."
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                          Duration (min)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={surpriseDuration}
                          onChange={(e) => setSurpriseDuration(Number(e.target.value))}
                          className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                          Points 🏆
                        </label>
                        <input
                          type="number"
                          value={surprisePoints}
                          onChange={(e) => setSurprisePoints(Number(e.target.value))}
                          className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                          Coins 🪙
                        </label>
                        <input
                          type="number"
                          value={surpriseCoins}
                          onChange={(e) => setSurpriseCoins(Number(e.target.value))}
                          className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-amber-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">
                        Bonus Power-up Reward (Optional Drop)
                      </label>
                      <select
                        value={surprisePowerup}
                        onChange={(e) => setSurprisePowerup(e.target.value)}
                        className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-cyan-300"
                      >
                        <option value="">None (Coins & Points only)</option>
                        <option value="ghost_shield">🛡️ Ghost Shield (Defensive Absorber)</option>
                        <option value="glitch_attack">☣️ Glitch Attack (Offensive Sabotage)</option>
                        <option value="forensic_vision">🔍 Forensic Vision (Free Intel Hint)</option>
                        <option value="time_lock">⏳ Time Lock (Temporal Delay Strike)</option>
                        <option value="overclock">⚡ Overclock (2x Next Coin Reward)</option>
                        <option value="double_or_nothing">🎲 Double or Nothing (80 Coin Wager)</option>
                        <option value="master_key">🔑 Master Key (Classified Puzzle Bypass)</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80">
                    <button
                      type="button"
                      onClick={handleLaunchSurprise}
                      disabled={isPending}
                      className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-950 text-xs font-black uppercase tracking-wider rounded-xl shadow-lg transition-transform hover:scale-[1.01]"
                    >
                      {isPending ? 'Broadcasting Raid...' : '🚀 Launch 5-Minute Surprise Mini-Game Flash Raid'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================
                TAB 5: EVENT STATE & SCOREBOARD LOCK MANAGEMENT
               ======================================================== */}
            {tab === 'event' && (
              <div className="max-w-2xl bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white mb-1">Global Hunt Status</h2>
                  <p className="text-zinc-400 text-xs">
                    Set event to LIVE to accept answers, or PAUSED to freeze all timers and submissions.
                  </p>
                </div>

                {event && (
                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">{event.name}</div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        Current Status: <strong className="uppercase text-amber-400">{event.status}</strong>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {['live', 'paused', 'ended'].map((st) => (
                        <button
                          key={st}
                          onClick={() => handleStatusChange(st)}
                          disabled={isPending}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg uppercase transition-colors ${
                            event.status === st
                              ? 'bg-amber-400 text-zinc-950'
                              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Scoreboard Visibility Lock */}
                <div className="pt-4 border-t border-zinc-800/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>🏆</span> Scoreboard Lock / Freeze
                      </h3>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        {isScoreboardLocked
                          ? 'Current State: 🔴 LOCKED (Hidden from players with a CTFd freeze banner)'
                          : 'Current State: 🟢 PUBLIC (Live standings visible to all players)'}
                      </p>
                    </div>

                    <button
                      onClick={() => handleToggleScoreboard(!isScoreboardLocked)}
                      disabled={isPending}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        isScoreboardLocked
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                          : 'bg-red-500 hover:bg-red-400 text-white'
                      }`}
                    >
                      {isPending
                        ? 'Updating...'
                        : isScoreboardLocked
                        ? 'Unlock Scoreboard'
                        : 'Freeze Scoreboard'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
