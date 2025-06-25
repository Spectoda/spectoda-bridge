/* eslint-disable no-magic-numbers */
import { z } from 'zod'

import { PercentageSchema } from './values'
import { TimestampSchema } from './values'

// TODO: How to get rid of suffixes in DB?

export const PercentageSchemaWithSuffix = z
  .string()
  .regex(/^-?\d+(\.\d+)?%$/, "Must be a percentage string like '50%'")
  .superRefine((num, ctx) => {
    // Extract numeric part before the '%'
    const numericPart = typeof num === 'string' ? num.replace(/%$/, '') : num
    const parsed = Number(numericPart)

    const result = PercentageSchema.safeParse(parsed)

    if (!result.success) {
      const msg = result.error.errors[0]?.message || 'Invalid percentage'

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: msg,
      })
    }
  })

const timeWithUnitRegex = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/

const TIME_UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
}

const parseTimeWithUnitToMs = (input: string): number | null => {
  const match = input.match(timeWithUnitRegex)

  if (!match) {
    return null
  }

  const value = Number(match[1])
  const unit = match[2]

  const multiplier = TIME_UNIT_TO_MS[unit]

  if (multiplier === undefined) {
    return null
  }

  return value * multiplier
}

export const TimeStampSchemaWithSuffix = z
  .string()
  .regex(timeWithUnitRegex, "Must be a string like '6h', '10m', '3s', or '1000ms'")
  .superRefine((num, ctx) => {
    const match = typeof num === 'string' ? num.match(timeWithUnitRegex) : null

    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid timestamp format',
      })
      return
    }

    const ms = parseTimeWithUnitToMs(num)

    if (ms === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid timestamp format',
      })
      return
    }

    const result = TimestampSchema.safeParse(ms)

    if (!result.success) {
      const msg = result.error.errors[0]?.message || 'Invalid timestamp value'

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: msg,
      })
    }
  })
