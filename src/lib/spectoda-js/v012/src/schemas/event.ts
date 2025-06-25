import { z } from 'zod'

import { VALUE_TYPES } from '../constants/values'

import { IDSchema } from './primitives'
import { NumberSchema, LabelSchema } from './values'
import {
  TimestampSchema,
  PercentageSchema,
  ColorSchema,
  PixelsSchema,
  BooleanSchema,
  NullSchema,
  UndefinedSchema,
} from './values'

const EventBaseSchema = z
  .object({
    /** Readonly string with more information about the event value */
    debug: z.string(),
    label: LabelSchema,
    timestamp: z.number(),
    id: IDSchema,
  })
  .strict()

export const NumberEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.NUMBER),
  value: NumberSchema,
})

export const LabelEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.LABEL),
  value: LabelSchema,
})

export const PercentageEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.PERCENTAGE),
  value: PercentageSchema,
})

export const TimestampEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.TIMESTAMP),
  value: TimestampSchema,
})

export const ColorEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.COLOR),
  value: ColorSchema,
})

export const PixelsEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.PIXELS),
  value: PixelsSchema,
})

export const BooleanEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.BOOLEAN),
  value: BooleanSchema,
})

export const NullEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.NULL),
  value: NullSchema,
})

export const UndefinedEventSchema = EventBaseSchema.extend({
  type: z.literal(VALUE_TYPES.UNDEFINED),
  value: UndefinedSchema,
})

export const EventSchema = z.discriminatedUnion('type', [
  NumberEventSchema,
  LabelEventSchema,
  PercentageEventSchema,
  TimestampEventSchema,
  ColorEventSchema,
  PixelsEventSchema,
  BooleanEventSchema,
  NullEventSchema,
  UndefinedEventSchema,
])

export const AnyEventValueSchema = z.union([
  NumberSchema,
  LabelSchema,
  PercentageSchema,
  TimestampSchema,
  ColorSchema,
  PixelsSchema,
  BooleanSchema,
  NullSchema,
  UndefinedSchema,
])

export type AnyEvent = z.infer<typeof AnyEventSchema>
export const AnyEventSchema = EventBaseSchema.extend({
  type: z.nativeEnum(VALUE_TYPES),
  value: AnyEventValueSchema,
})

export const EventInputSchema = AnyEventSchema.omit({
  debug: true,
  timestamp: true,
})
