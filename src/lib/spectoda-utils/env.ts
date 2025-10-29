import { ZodError, ZodObject, ZodPipe } from 'zod'

let parsed_env: unknown = null

const isZodError = (error: unknown): error is ZodError => {
  return (
    error !== null &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray((error as ZodError).issues)
  )
}

const handleEnvError = (error: ZodError): never => {
  console.error('\x1b[31m%s\x1b[0m', '❌ Environment Variables Error:')
  console.error('The following environment variables are missing or invalid:')
  console.error()

  error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  })

  console.error()
  console.error(
    'Please check your .env file and ensure all required variables are set correctly.',
  )
  process.exit(1)
}

export const loadParsedEnv = <$Schema extends ZodPipe<ZodObject> | ZodObject>(
  schema: $Schema,
  fileData: Record<string, unknown> = {},
  processData: Record<string, unknown> = {},
) => {
  if (parsed_env) {
    return parsed_env as $Schema['_output']
  }

  try {
    parsed_env = schema.parse({
      ...fileData,
      ...processData,
    })

    return parsed_env as $Schema['_output']
  } catch (error) {
    if (isZodError(error)) {
      return handleEnvError(error)
    }
    throw error
  }
}
