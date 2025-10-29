// TODO implement proper error handling

export class ClientError extends Error {
  public readonly code: string
  public readonly level: 'error' | 'warning' | 'info'
  public readonly shouldLogout?: boolean
  public readonly context?: Record<string, unknown>

  constructor(options: {
    message: string
    code: string
    level: 'error' | 'warning' | 'info'
    shouldLogout?: boolean
    context?: Record<string, unknown>
  }) {
    super(options.message)
    this.name = 'ClientError'
    this.code = options.code
    this.level = options.level
    this.shouldLogout = options.shouldLogout
    this.context = options.context
  }
}

export const APP_ERRORS = {
  MISSING_SELECTED_NETWORK: {
    code: 'MISSING_SELECTED_NETWORK',
    message: 'No network selected',
    level: 'error',
    shouldLogout: true,
  },
  // Add other application errors here
} as const
