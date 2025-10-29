// import { rollbar } from './rollbar'

export type PrivateError<$Id extends string | void> = {
  __ERROR__: true
  id: $Id
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPrivateError = PrivateError<any>

// eslint-disable-next-line func-style
export function privateError(): PrivateError<void>
// eslint-disable-next-line func-style
export function privateError<$Id extends string>(id: $Id): PrivateError<$Id>
// eslint-disable-next-line func-style
export function privateError(id?: string): PrivateError<string | void> {
  return {
    __ERROR__: true,
    id: id,
  }
}

// eslint-disable-next-line func-style
function fatal(): PrivateError<void>
// eslint-disable-next-line func-style
function fatal<$Id extends string>(id: $Id): PrivateError<$Id>
// eslint-disable-next-line func-style
function fatal(id?: string): PrivateError<string | void> {
  const target: { stack?: string } = {}

  Error.captureStackTrace(target, fatal)

  // rollbar.error('private', id, target.stack)

  return {
    __ERROR__: true,
    id: id,
  }
}

privateError.fatal = fatal
