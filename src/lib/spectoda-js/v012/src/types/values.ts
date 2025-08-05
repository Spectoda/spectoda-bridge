import { z } from 'zod'

import { VALUE_TYPES } from '../constants/values'
import { IDSchema } from '../schemas/primitives'
import {
  NumberSchema,
  LabelSchema,
  TimestampSchema,
  PercentageSchema,
  DateSchema,
  ColorSchema,
  PixelsSchema,
  BooleanSchema,
  NullSchema,
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
export type ValueTypeID = z.infer<typeof IDSchema>
export type ValueTypeIDs = ValueTypeID | ValueTypeID[]

export type ValueType = (typeof VALUE_TYPES)[keyof typeof VALUE_TYPES]

/** @alias ValueTypeID */
export type SpectodaIdType = ValueTypeID
