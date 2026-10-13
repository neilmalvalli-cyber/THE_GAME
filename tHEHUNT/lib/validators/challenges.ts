import { z } from 'zod'

export const challengeSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  display_order: z.number().int().min(0).default(0),
  status: z.enum(['draft', 'published', 'paused', 'archived']).default('draft'),
  final_fragment: z.string().max(10).optional(),
  fragment_order: z.number().int().min(0).optional(),
})

export const levelSchema = z.object({
  challenge_id: z.string().uuid(),
  level_number: z.number().int().min(1),
  title: z.string().min(1, 'Title is required').max(200),
  prompt: z.string().max(5000).default(''),
  answer: z.string().min(1, 'Answer is required').max(500),
  answer_mode: z.enum(['exact', 'case_insensitive', 'trimmed_case_insensitive']).default('trimmed_case_insensitive'),
  hint_text: z.string().max(1000).optional(),
  hint_cost: z.number().int().min(0).default(0),
  points_reward: z.number().int().min(0).default(100),
  coins_reward: z.number().int().min(0).default(10),
  status: z.enum(['draft', 'published', 'paused']).default('draft'),
  release_at: z.string().datetime().optional(),
  deadline_at: z.string().datetime().optional(),
  max_attempts: z.number().int().min(1).optional(),
})

export type ChallengeInput = z.infer<typeof challengeSchema>
export type LevelInput = z.infer<typeof levelSchema>
