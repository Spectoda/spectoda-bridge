import { privateError } from '@spectoda/error'

import { Json } from './types'

export const followJsonPath = <
  $Json extends Json,
  $Path extends (string | number)[],
>(
  json: $Json,
  path: $Path,
) => {
  let reference: unknown = json

  for (let i = 0; i < path.length; ++i) {
    if (reference === null || reference === undefined) {
      return privateError('FOLLOW_JSON_PATH.REFERENCE_INVALID')
    }

    if (typeof reference !== 'object') {
      return privateError('FOLLOW_JSON_PATH.REFERENCE_INVALID')
    }

    const key = path[i]

    if ((reference as Record<string, unknown>)[key] === undefined) {
      return privateError('FOLLOW_JSON_PATH.REFERENCE_INVALID')
    }

    reference = (reference as Record<string, unknown>)[key]
  }

  return reference as Json
}
