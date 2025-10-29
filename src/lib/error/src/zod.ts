import { ZodError } from 'zod'

export const encodeZodError = (error: ZodError): ZodError => {
  return {
    name: error.name,
    type: error.type,
    issues: error.issues.map((v) => v),
  } as ZodError
}
