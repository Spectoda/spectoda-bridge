type ValueLimits = Readonly<{
  NUMBER_MAX: number
  NUMBER_MIN: number

  TIMESTAMP_MAX: number
  TIMESTAMP_MIN: number

  PERCENTAGE_MAX: number
  PERCENTAGE_MIN: number

  PIXELS_MAX: number
  PIXELS_MIN: number

  BOOLEAN_MAX: number
  BOOLEAN_MIN: number

  VALUEADDRESS_MAX: number
  VALUEADDRESS_MIN: number

  DATE_MAX: number
  DATE_MIN: number
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
  // NUMBER limits (signed31_t) - from types.h
  NUMBER_MAX: 1073741823,
  NUMBER_MIN: -1073741824,

  // TIMESTAMP limits (signed28_t) - from types.h
  TIMESTAMP_MAX: 86400000,
  TIMESTAMP_MIN: -86400000,

  // PERCENTAGE limits (signed28_t) - from types.h
  PERCENTAGE_MAX: 100000000,
  PERCENTAGE_MIN: -100000000,

  // PIXELS limits (signed16_t) - from types.h
  PIXELS_MAX: 32767,
  PIXELS_MIN: -32768,

  // BOOLEAN limits (unsigned1_t) - from types.h
  BOOLEAN_MAX: 1,
  BOOLEAN_MIN: 0,

  // VALUEADDRESS limits (unsigned16_t) - from types.h
  VALUEADDRESS_MAX: 16384, // 0x4000
  VALUEADDRESS_MIN: 0,

  // DATE limits (unsigned27_t) - from types.h
  DATE_MAX: 99991231,
  DATE_MIN: 19700101,
} as const) satisfies ValueLimits

export const JS_EVENT_VALUE_LIMITS = Object.freeze({
  // NUMBER limits - JavaScript safe values (same as CPP for compatibility)
  NUMBER_MAX: 1073741823,
  NUMBER_MIN: -1073741824,

  // TIMESTAMP limits - practical day limits for JavaScript usage
  TIMESTAMP_MAX: 86400000,
  TIMESTAMP_MIN: -86400000,

  // PERCENTAGE limits - JavaScript user-friendly floating point scale (-100.000000 to 100.000000)
  PERCENTAGE_MAX: 100.0,
  PERCENTAGE_MIN: -100.0,

  // PIXELS limits (same as CPP)
  PIXELS_MAX: 32767,
  PIXELS_MIN: -32768,

  // BOOLEAN limits (same as CPP)
  BOOLEAN_MAX: 1,
  BOOLEAN_MIN: 0,

  // VALUEADDRESS limits (same as CPP)
  VALUEADDRESS_MAX: 16384,
  VALUEADDRESS_MIN: 0,

  // DATE limits (same as CPP)
  DATE_MAX: 99991231,
  DATE_MIN: 19700101,
} as const) satisfies ValueLimits
