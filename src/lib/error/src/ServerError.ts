// TODO: refactor to HTTP_STATUS_CODES
export const ERROR_CODES = Object.freeze({
  /**
   * 400: Bad request, invalid data was passed
   * @example { name } received, but endpoint requires both { name, email }
   */
  BAD_REQUEST: 'BAD_REQUEST',

  /**
   * 401: User is not authorized to access this resource
   */
  UNAUTHORIZED: 'UNAUTHORIZED',

  /**
   * 404: Resource not found
   * @example { id: '123' } received, but resource with id 123 does not exist
   */
  NOT_FOUND: 'NOT_FOUND',

  /**
   * 405: Method not allowed
   * @example POST /api/users received, but it supports only GET
   */
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',

  /**
   * 409: Resource already exists
   * @example user with { email: 'john@example.com' } already exists
   */
  CONFLICT: 'CONFLICT',

  /**
   * 422: Data is in correct data format
   * @example { email: 'john@example' } is not a valid email
   */
  UNPROCESSABLE_CONTENT: 'UNPROCESSABLE_CONTENT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const)

export type ServerErrorCode = keyof typeof ERROR_CODES

const ERROR_CODE_TO_STATUS_MAP: Record<ServerErrorCode, number> = Object.freeze(
  {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNPROCESSABLE_CONTENT: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
  },
)

export const ERROR_MESSAGES = Object.freeze({
  UNEXPECTED_ERROR: 'An unexpected error occured',
})

type ServerErrorOptions = {
  message: string
  code?: ServerErrorCode
  validation?: {
    received: unknown
    errors: string[]
  }
}

export class ServerError extends Error {
  // TODO: Refactor to httpStatusCode
  public readonly status: number
  public readonly code?: ServerErrorOptions['code']
  public readonly message: ServerErrorOptions['message']
  public readonly validation?: ServerErrorOptions['validation']
  public readonly uniqueCode: string | undefined
  constructor(
    opts: ServerErrorOptions = {
      message: ERROR_MESSAGES.UNEXPECTED_ERROR,
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    },
  ) {
    super(opts.message)
    // TODO: Refactor to `httpStatus`
    this.code = opts.code ?? ERROR_CODES.INTERNAL_SERVER_ERROR
    this.message = opts.message ?? ERROR_MESSAGES.UNEXPECTED_ERROR
    this.status = ERROR_CODE_TO_STATUS_MAP[this.code]
    this.validation = opts.validation
    this.name = 'ServerError'
  }
}

// TODO fix workaround for `error instanceof ServerError` not working
export const isServerError = (error: unknown): error is ServerError => {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'status' in error &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error as any).name === 'ServerError'
  )
}
