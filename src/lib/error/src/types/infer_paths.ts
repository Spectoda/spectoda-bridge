import { UnknownObject } from './general'
import { LiteErrorDefinition } from './other'

export type InferPaths<$ErrorMap> = {
  [$Key in keyof $ErrorMap & string]: $ErrorMap[$Key] extends UnknownObject
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $ErrorMap[$Key] extends LiteErrorDefinition<any>
      ? `${$Key}`
      : $ErrorMap[$Key] extends LiteErrorDefinition<never>
      ? `${$Key}`
      : `${$Key}.${InferPaths<$ErrorMap[$Key]>}`
    : `${$Key}`
}[keyof $ErrorMap & string]
