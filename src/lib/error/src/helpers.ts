import type { PrivateError } from './private'
import type { PublicError } from './public'

// eslint-disable-next-line func-style, @typescript-eslint/no-explicit-any
export function isError(value: unknown): value is PrivateError<any>
// eslint-disable-next-line func-style, @typescript-eslint/no-explicit-any
export function isError(value: unknown): value is PublicError<any, any>
// eslint-disable-next-line func-style
export function isError(value: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return value !== undefined && value !== null && !!(value as any)?.__ERROR__
}

// eslint-disable-next-line func-style
export function matchError<const $DesiredId extends string>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PrivateError<any>,
  desired_id: $DesiredId,
): error is PrivateError<$DesiredId>
// eslint-disable-next-line func-style
export function matchError<const $DesiredId extends string>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PublicError<any, any>,
  desired_id: $DesiredId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): error is PublicError<$DesiredId, any>
// eslint-disable-next-line func-style
export function matchError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PrivateError<any> | PublicError<any, any>,
  desired_id: string,
) {
  return error.id === desired_id
}

// eslint-disable-next-line func-style
export function matchErrors<const $DesiredIds extends string[]>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PrivateError<any>,
  desired_ids: $DesiredIds,
): error is PrivateError<$DesiredIds[number]>
// eslint-disable-next-line func-style
export function matchErrors<const $DesiredIds extends string[]>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PublicError<any, any>,
  desired_ids: $DesiredIds,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): error is PublicError<$DesiredIds[number], any>
// eslint-disable-next-line func-style
export function matchErrors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: PrivateError<any> | PublicError<any, any>,
  desired_ids: string[],
) {
  return desired_ids.includes(error.id)
}
