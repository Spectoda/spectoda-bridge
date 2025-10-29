import {
  ErrorFormat,
  SpectodaErrorCode,
  app,
  general,
  studio,
  unknownError,
} from '../errors/errorLibrary'

type env = 'app' | 'studio'

export const getError = (
  errorCode: SpectodaErrorCode,
  env?: env,
): ErrorFormat => {
  if (env === 'app' && errorCode in app) {
    return app[errorCode] || unknownError
  }
  if (env === 'studio' && errorCode in studio) {
    // @ts-expect-error TODO redesign error handling [DEV-4735]
    return studio[errorCode] || unknownError
  }
  if (errorCode in general) {
    return general[errorCode] || unknownError
  } else {
    return unknownError
  }
}

export const throwError = (errorCode: SpectodaErrorCode) => {
  throw new Error(errorCode)
}

export * from '../errors/errorLibrary'
export * from './SpectodaError'
