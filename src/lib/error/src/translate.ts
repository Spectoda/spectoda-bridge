import { ERROR_MAP, LANGUAGES } from './constants'
import { FullErrorDefinition } from './define'
import type { PublicError } from './public'
import { InferContext } from './types/infer_context'
import { InferOutput } from './types/infer_output'
import { ErrorMap, Language } from './types/references'

let local_language: Language = LANGUAGES[0]

export const setLanguage = (language: Language) => {
  local_language = language
}

export const translate = <$Id extends string>(
  error: PublicError<$Id, InferContext<ErrorMap, $Id>>,
) => {
  const path = error.id.split('.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let context: Record<string, any> = ERROR_MAP

  for (let i = 0; i < path.length; ++i) {
    context = context[path[i] as keyof ErrorMap]
  }

  return (
    context as FullErrorDefinition<Language, InferContext<ErrorMap, $Id>>
  )(error.context)[local_language] as InferOutput<ErrorMap, $Id>
}
