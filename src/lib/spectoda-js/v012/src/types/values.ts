import type { z } from 'zod'

import type { VALUE_TYPES } from '../constants/values'
import type { IDSchema } from '../schemas/primitives'
import type {
  BooleanSchema,
  ColorSchema,
  DateSchema,
  LabelSchema,
  NullSchema,
  NumberSchema,
  PercentageSchema,
  PixelsSchema,
  TimestampSchema,
  UndefinedSchema,
} from '../schemas/values'

export type ValueTypeNumber = z.infer<typeof NumberSchema>
export type ValueTypeLabel = z.infer<typeof LabelSchema>
export type ValueTypeTimestamp = z.infer<typeof TimestampSchema>
export type ValueTypePercentage = z.infer<typeof PercentageSchema>
export type ValueTypeDate = z.infer<typeof DateSchema>
export type ValueTypeColor = z.infer<typeof ColorSchema>
export type ValueTypePixels = z.infer<typeof PixelsSchema>
export type ValueTypeBoolean = z.infer<typeof BooleanSchema>
export type ValueTypeNull = z.infer<typeof NullSchema>
export type ValueTypeUndefined = z.infer<typeof UndefinedSchema>

export type SpectodaIdType = z.infer<typeof IDSchema>
export type SpectodaIdsType = SpectodaIdType | SpectodaIdType[]

export type ValueType = (typeof VALUE_TYPES)[keyof typeof VALUE_TYPES]
