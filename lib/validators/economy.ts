import { z } from 'zod'

export const adjustBalanceSchema = z.object({
  team_id: z.string().uuid('Invalid team ID'),
  currency: z.enum(['points', 'coins']),
  delta: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().min(1, 'Reason is required').max(500),
})

export const purchasePowerupSchema = z.object({
  powerup_id: z.string().uuid('Invalid powerup ID'),
  idempotency_key: z.string().uuid('Invalid idempotency key'),
})

export const purchaseHintSchema = z.object({
  level_id: z.string().uuid('Invalid level ID'),
})

export const buyMarketItemSchema = z.object({
  item_id: z.string().uuid('Invalid item ID'),
  idempotency_key: z.string().uuid('Invalid idempotency key'),
})

export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>
export type PurchasePowerupInput = z.infer<typeof purchasePowerupSchema>
export type PurchaseHintInput = z.infer<typeof purchaseHintSchema>
export type BuyMarketItemInput = z.infer<typeof buyMarketItemSchema>
