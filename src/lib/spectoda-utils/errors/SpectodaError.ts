import { SpectodaErrorCode, general as errorLibrary } from './errorLibrary'

type SpectodaErrorMessage = {
  code?: SpectodaErrorCode
  message: string
}

export class SpectodaError extends Error {
  code?: SpectodaErrorCode

  constructor(input: SpectodaErrorCode | SpectodaErrorMessage) {
    let message: string
    let code: SpectodaErrorCode | undefined

    // When input is just a string (error code)
    if (typeof input === 'string') {
      message = errorLibrary[input]?.message || `Unknown error code: ${input}`
      code = input
    }

    // Input code is defined in error library
    else if (input.code && input.code in errorLibrary) {
      code = input.code

      const defaultMessage =
        errorLibrary[code]?.message || `Unknown error code: ${code}`

      message = defaultMessage
        ? `${defaultMessage}. ${input.message}`
        : input.message
    }

    // Unknown error code
    else {
      code = input.code
      message = input.message
    }

    super(message)
    this.name = 'SpectodaError'
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SpectodaError)
    }
  }
}
