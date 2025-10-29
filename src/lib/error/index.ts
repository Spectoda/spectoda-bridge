import { ok, Result } from 'neverthrow'

export { ClientError, APP_ERRORS } from './src/ClientError'

export {
  ServerError,
  ERROR_CODES,
  isServerError,
  ERROR_MESSAGES,
} from './src/ServerError'

export {
  ErrorShape,
  type RegExpError,
  type InferRegExpError,
  type SimpleError,
  type UnknownError,
  type InferSimpleError,
  type CompareError,
  type InferCompareError,
  type InferUnknownError,
  type InferErr,
  regExpError,
  simpleError,
  compareError,
  unknownError,
} from './src/CustomError'

export { ok }
export type { Result }

export {
  type PrivateError,
  type AnyPrivateError,
  privateError,
} from './src/private'
export {
  type PublicError,
  type AnyPublicError,
  publicError,
} from './src/public'
export { translate, setLanguage } from './src/translate'
export { isError, matchError, matchErrors } from './src/helpers'
export { encodeZodError } from './src/zod'
