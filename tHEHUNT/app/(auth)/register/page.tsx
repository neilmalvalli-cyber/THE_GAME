'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { register } from '@/actions/auth'

export default function RegisterPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await register({
        display_name: displayName,
        email,
        password,
      })

      if (!res.success) {
        setError(res.error || 'Failed to create account')
        setLoading(false)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Unexpected error')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4 font-sans text-zinc-100">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">JOIN THE HUNT</h1>
          <p className="text-zinc-400 text-sm">Create your participant operative identity</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Display Name / Codename
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. CipherOne"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1 flex items-center justify-between">
              <span>Email Address</span>
              <span className="text-[10px] text-zinc-500 normal-case font-normal">(@gmail.com or @nmamit.in)</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operative@gmail.com or usn@nmamit.in"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-zinc-500 transition-colors"
            />
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Instant activation — no email verification needed.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Password (min 6 characters)
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-sm focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating Identity...' : 'Register'}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-zinc-500">
          Already registered?{' '}
          <Link href="/login" className="text-zinc-300 hover:text-white underline">
            Sign In here
          </Link>
        </div>
      </div>
    </div>
  )
}
