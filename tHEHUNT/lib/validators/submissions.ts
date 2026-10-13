import { z } from 'zod'

export const submitAnswerSchema = z.object({
  level_id: z.string().uuid('Invalid level ID'),
  answer: z.string().min(1, 'Answer is required').max(500, 'Answer too long'),
  idempotency_key: z.string().optional(),
})

export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>
