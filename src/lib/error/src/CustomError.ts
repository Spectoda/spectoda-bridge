/* eslint-disable no-restricted-imports */
import { Err } from 'neverthrow'
import { err } from 'neverthrow'

export type InferErr<$Err extends Err<never, unknown>> = $Err extends Err<
  never,
  infer $Error
>
  ? $Error
  : never

export enum ErrorShape {
  Simple,
  Compare,
  RegExp,
  UnknownError,
}

export type RegExpError<$Name extends string> = {
  shape: ErrorShape.RegExp
  name: $Name
  regexp: RegExp
  value: string
}

export const regExpError =
  <$Name extends string>(name: $Name, regexp: RegExp) =>
  (value: string): Err<never, RegExpError<$Name>> =>
    err({
      shape: ErrorShape.RegExp,
      name: name,
      regexp: regexp,
      value: value,
    })

export type InferRegExpError<$Fn extends ReturnType<typeof regExpError>> =
  InferErr<ReturnType<$Fn>>

export type SimpleError<$Name extends string> = {
  shape: ErrorShape.Simple
  name: $Name
}

export const simpleError = <$Name extends string>(
  name: $Name,
): Err<never, SimpleError<$Name>> =>
  err({
    shape: ErrorShape.Simple,
    name: name,
  })

export type InferSimpleError<$Fn extends ReturnType<typeof simpleError>> =
  InferErr<$Fn>

export type CompareError<Name extends string, Desired> = {
  shape: ErrorShape.Compare
  name: Name
  desired: Desired
  actual: unknown
}

export const compareError =
  <Name extends string, Desired>(name: Name, desired: Desired) =>
  (actual: unknown): Err<never, CompareError<Name, Desired>> =>
    err({
      shape: ErrorShape.Compare,
      name: name,
      desired: desired,
      actual: actual,
    })

export type InferCompareError<$Fn extends ReturnType<typeof compareError>> =
  InferErr<ReturnType<$Fn>>

export type UnknownError<$Name extends string> = {
  shape: ErrorShape.UnknownError
  name: $Name
  error: unknown
}

export const unknownError = <Name extends string>(
  name: Name,
  error: unknown,
): Err<never, UnknownError<Name>> =>
  err({
    shape: ErrorShape.UnknownError,
    name: name,
    error: error,
  })

export type InferUnknownError<$Fn extends ReturnType<typeof unknownError>> =
  InferErr<$Fn>
