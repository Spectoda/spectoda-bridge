export const VALUE_TYPES = Object.freeze({
  /** see @link [NumberSchema](../schemas/values.ts) for more details. */
  NUMBER: 29,

  /** see @link [LabelSchema](../schemas/values.ts) for more details. */
  LABEL: 31,

  /** see @link [TimestampSchema](../schemas/values.ts) for more details. */
  TIMESTAMP: 32,

  /** see @link [PercentageSchema](../schemas/values.ts) for more details. */
  PERCENTAGE: 30,

  /** see @link [DateSchema](../schemas/values.ts) for more details. */
  DATE: 28,

  /** see @link [ColorSchema](../schemas/values.ts) for more details. */
  COLOR: 26,

  /** see @link [PixelsSchema](../schemas/values.ts) for more details. */
  PIXELS: 19,

  /** see @link [BooleanSchema](../schemas/values.ts) for more details. */
  BOOLEAN: 2,

  /** see @link [NullSchema](../schemas/values.ts) for more details. */
  NULL: 1,

  /** see @link [UndefinedSchema](../schemas/values.ts) for more details. */
  UNDEFINED: 0,
})

export type ValueType = (typeof VALUE_TYPES)[keyof typeof VALUE_TYPES]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NEXT_VALUE_TYPES = Object.freeze({
  // TODO Add schema, @immakermatty what is the type, please?
  REAL: 27,
})
