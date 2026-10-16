// ============================================================
// THE HUNT — Application Constants
// ============================================================

// Rate limiting
export const SUBMISSION_RATE_LIMIT_SECONDS = parseInt(
  process.env.SUBMISSION_RATE_LIMIT_SECONDS || '5'
)
export const MAX_SUBMISSION_ATTEMPTS_PER_LEVEL = parseInt(
  process.env.MAX_SUBMISSION_ATTEMPTS_PER_LEVEL || '50'
)

// Leaderboard
export const LEADERBOARD_POLL_INTERVAL_MS = 30_000 // 30 seconds

// UI
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'THE HUNT'
export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION || 'CSI NMAMIT Digital Treasure Hunt'

// Answer normalisation
export function normalizeAnswer(answer: string, mode: string): string {
  const trimmed = answer.trim()
  switch (mode) {
    case 'exact':
      return trimmed
    case 'case_insensitive':
      return trimmed.toLowerCase()
    case 'trimmed_case_insensitive':
      return trimmed.toLowerCase().replace(/\s+/g, ' ')
    default:
      return trimmed.toLowerCase().replace(/\s+/g, ' ')
  }
}

// Generate a random team code (6 uppercase alphanumeric)
export function generateTeamCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Excluded confusable chars: I, O, 0, 1
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Hash an answer for storage in submissions (not for security — for auditing)
export function hashAnswerForAudit(answer: string): string {
  // Simple hash for audit trail — not cryptographic
  let hash = 0
  for (let i = 0; i < answer.length; i++) {
    const char = answer.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32bit integer
  }
  return `audit_${Math.abs(hash).toString(36)}`
}
