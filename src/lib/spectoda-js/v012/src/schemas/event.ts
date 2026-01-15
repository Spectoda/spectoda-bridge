import { z } from 'zod'

import { VALUE_TYPES } from '../constants/values'

import { IDSchema } from './primitives'
import {
  BooleanSchema,
  ColorSchema,
  LabelSchema,
  NullSchema,
  NumberSchema,
  PercentageSchema,
  PixelsSchema,
  TimestampSchema,
  UndefinedSchema,
} from './values'

const EVENT_BASE_SCHEMA = z.strictObject({
  /** Readonly string with more information about the event value */
  debug: z.string(),
  label: LabelSchema,
  timestamp: z.number(),
  id: IDSchema,
})

export type NumberEvent = z.infer<typeof NumberEventSchema>
export const NumberEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.NUMBER),
  value: NumberSchema,
})

export type LabelEvent = z.infer<typeof LabelEventSchema>
export const LabelEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.LABEL),
  value: LabelSchema,
})

export type PercentageEvent = z.infer<typeof PercentageEventSchema>
export const PercentageEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.PERCENTAGE),
  value: PercentageSchema,
})

export type TimestampEvent = z.infer<typeof TimestampEventSchema>
export const TimestampEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.TIMESTAMP),
  value: TimestampSchema,
})

export type ColorEvent = z.infer<typeof ColorEventSchema>
export const ColorEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.COLOR),
  value: ColorSchema,
})

export type PixelsEvent = z.infer<typeof PixelsEventSchema>
export const PixelsEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.PIXELS),
  value: PixelsSchema,
})

export type BooleanEvent = z.infer<typeof BooleanEventSchema>
export const BooleanEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.BOOLEAN),
  value: BooleanSchema,
})

export type NullEvent = z.infer<typeof NullEventSchema>
export const NullEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.NULL),
  value: NullSchema,
})

export type UndefinedEvent = z.infer<typeof UndefinedEventSchema>
export const UndefinedEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.literal(VALUE_TYPES.UNDEFINED),
  value: UndefinedSchema,
})

/** Event State */
export type EventState = z.infer<typeof EventStateSchema>
/** Event State */
export const EventStateSchema = z.discriminatedUnion('type', [
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
export const AnyEventSchema = EVENT_BASE_SCHEMA.extend({
  type: z.enum(VALUE_TYPES),
  value: AnyEventValueSchema,
})

export type EventInput = z.infer<typeof EventInputSchema>
export const EventInputSchema = AnyEventSchema.omit({
  debug: true,
  timestamp: true,
})
