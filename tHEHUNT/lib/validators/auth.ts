import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const registerSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .refine(
      (email) => {
        const lower = email.toLowerCase().trim()
        return lower.endsWith('@gmail.com') || lower.endsWith('@nmamit.in')
      },
      {
        message: 'Only @gmail.com and @nmamit.in email addresses are accepted.',
      }
    ),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  display_name: z.string().min(1, 'Display name is required').max(50, 'Display name too long'),
})

export const createTeamSchema = z.object({
  team_name: z.string().min(1, 'Team name is required').max(50, 'Team name too long'),
})

export const joinTeamSchema = z.object({
  team_code: z.string().min(1, 'Team code is required').max(20, 'Team code too long'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type JoinTeamInput = z.infer<typeof joinTeamSchema>
