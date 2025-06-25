import { z } from 'zod'

import { EventSchema, EventInputSchema } from '../schemas/event'
import { VALUE_TYPES } from '../constants/values'

// TODO MOve these to where the schemas are defined

/** @alias EventState */
export type Event = z.infer<typeof EventSchema>
export type EventState = Event
/** @alias EventStateInput */
export type EventInput = z.infer<typeof EventInputSchema>
export type EventStateInput = EventInput

export type NumberEvent = Extract<Event, { type: typeof VALUE_TYPES.NUMBER }>
export type LabelEvent = Extract<Event, { type: typeof VALUE_TYPES.LABEL }>
export type PercentageEvent = Extract<Event, { type: typeof VALUE_TYPES.PERCENTAGE }>
export type TimestampEvent = Extract<Event, { type: typeof VALUE_TYPES.TIMESTAMP }>
export type ColorEvent = Extract<Event, { type: typeof VALUE_TYPES.COLOR }>
export type PixelsEvent = Extract<Event, { type: typeof VALUE_TYPES.PIXELS }>
export type BooleanEvent = Extract<Event, { type: typeof VALUE_TYPES.BOOLEAN }>
export type NullEvent = Extract<Event, { type: typeof VALUE_TYPES.NULL }>
export type UndefinedEvent = Extract<Event, { type: typeof VALUE_TYPES.UNDEFINED }>
