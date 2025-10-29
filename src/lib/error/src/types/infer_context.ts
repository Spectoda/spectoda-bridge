import { InferContextErrorDefinition, NoContextErrorDefinition } from './other'

export type InferContext<
  $ErrorMap,
  $Path extends string,
> = $Path extends `${infer $Left}.${infer $Right}`
  ? $Left extends keyof $ErrorMap
    ? InferContext<$ErrorMap[$Left], $Right>
    : never
  : $Path extends keyof $ErrorMap
  ? $ErrorMap[$Path] extends NoContextErrorDefinition
    ? never
    : $ErrorMap[$Path] extends InferContextErrorDefinition<infer $Context>
    ? $Context
    : never
  : never
