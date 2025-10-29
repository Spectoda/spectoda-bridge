// import { rollbar } from './rollbar'
import { UnknownObject } from './types/general'
import { InferContext } from './types/infer_context'
import { PathsWithContext } from './types/paths_with_context'
import { PathsWithNoContext } from './types/paths_with_no_context'
import { ErrorMap } from './types/references'

export type PublicError<
  $Id extends string,
  $Context extends UnknownObject | void,
> = {
  __ERROR__: true
  id: $Id
  context: $Context
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPublicError = PublicError<any, any>

// eslint-disable-next-line func-style
export function publicError<$Id extends PathsWithNoContext<ErrorMap>>(
  id: $Id,
): PublicError<$Id, never>
// eslint-disable-next-line func-style
export function publicError<$Id extends PathsWithContext<ErrorMap>>(
  id: $Id,
  context: InferContext<ErrorMap, $Id>,
): PublicError<$Id, InferContext<ErrorMap, $Id>>
// eslint-disable-next-line func-style
export function publicError(
  id: string,
  context?: UnknownObject,
): PublicError<string, UnknownObject | void> {
  return {
    __ERROR__: true,
    id: id,
    context: context,
  }
}

// eslint-disable-next-line func-style
function fatal<$Id extends PathsWithNoContext<ErrorMap>>(
  id: $Id,
): PublicError<$Id, never>
// eslint-disable-next-line func-style
function fatal<$Id extends PathsWithContext<ErrorMap>>(
  id: $Id,
  context: InferContext<ErrorMap, $Id>,
): PublicError<$Id, InferContext<ErrorMap, $Id>>
// eslint-disable-next-line func-style
function fatal(
  id: string,
  context?: UnknownObject,
): PublicError<string, UnknownObject | void> {
  const target: { stack?: string } = {}

  Error.captureStackTrace(target, fatal)

  // rollbar.error('public', id, context, target.stack)

  return {
    __ERROR__: true,
    id: id,
    context: context,
  }
}

publicError.fatal = fatal
