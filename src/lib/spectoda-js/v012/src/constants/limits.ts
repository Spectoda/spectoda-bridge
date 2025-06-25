type ValueLimits = Readonly<{
  NUMBER_MAX: number
  NUMBER_MIN: number

  TIMESTAMP_MAX: number
  TIMESTAMP_MIN: number

  PERCENTAGE_MAX: number
  PERCENTAGE_MIN: number
}>

/**
 * @deprecated These value limits are for internal use only and should not be used directly.
 * They define the boundaries for various value types in the Spectoda system.
 * 
 * Use the appropriate functions from the Spectoda API instead of accessing these limits directly.
 * 
 * TODO: move all CPP limits into WASM and remove CPP_EVENT_VALUE_LIMITS object
 */

export const CPP_EVENT_VALUE_LIMITS = Object.freeze({
  NUMBER_MAX: 1000000000,
  NUMBER_MIN: -100000000000,

  TIMESTAMP_MAX: 86400000,
  TIMESTAMP_MIN: -86400000,

  PERCENTAGE_MAX: 100000000,
  PERCENTAGE_MIN: -100000000,

  PIXELS_MAX: 32767,
  PIXELS_MIN: -32768,
} as const) satisfies ValueLimits

export const JS_EVENT_VALUE_LIMITS = Object.freeze({
  NUMBER_MAX: 1000000000,
  NUMBER_MIN: -100000000000,

  TIMESTAMP_MAX: 86400000,
  TIMESTAMP_MIN: -86400000,

  PERCENTAGE_MAX: 100,
  PERCENTAGE_MIN: -100,

  PIXELS_MAX: 32767,
  PIXELS_MIN: -32768,
} as const) satisfies ValueLimits
