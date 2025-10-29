import { UnknownObject } from './general'

export type LiteErrorDefinition<
  $Context extends UnknownObject = never,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $Output = any,
> = (context: $Context) => Record<string, $Output>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NoContextErrorDefinition = () => Record<string, any>

export type ContextErrorDefinition = (
  context: UnknownObject,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Record<string, any>

export type InferContextErrorDefinition<
  $Context extends UnknownObject = never,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = (context: $Context) => Record<string, any>
