import { LiteErrorDefinition } from './other'

export type InferOutput<
  $ErrorMap,
  $Path extends string,
> = $Path extends `${infer $Left}.${infer $Right}`
  ? $Left extends keyof $ErrorMap
    ? InferOutput<$ErrorMap[$Left], $Right>
    : never
  : $Path extends keyof $ErrorMap
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $ErrorMap[$Path] extends LiteErrorDefinition<any, infer $Output>
    ? $Output
    : $ErrorMap[$Path] extends LiteErrorDefinition<never, infer $Output>
    ? $Output
    : never
  : never
