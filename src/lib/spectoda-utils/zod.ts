import type { ZodError } from 'zod'
import type { $ZodIssue } from 'zod/v4/core'

// Type guard: checks if the issue is a union error (invalid_union)
const isUnionError = (
  issue: $ZodIssue,
): issue is $ZodIssue & { unionErrors: ZodError[] } => {
  return (
    issue.code === 'invalid_union' &&
    Array.isArray(
      (issue as $ZodIssue & { unionErrors: ZodError[] }).unionErrors,
    )
  )
}

const formatUnionError = (
  issue: $ZodIssue,
  field: string,
  path: (string | number)[],
): string[] => {
  // First try to get detailed nested errors with full paths
  const nestedErrors = (
    issue as $ZodIssue & { unionErrors: ZodError[] }
  ).unionErrors.flatMap((err: ZodError) =>
    err.issues.flatMap((nestedIssue) => formatIssue(nestedIssue, path)),
  )

  // If we have detailed nested errors, use those instead of generic types
  if (
    nestedErrors.length > 0 &&
    nestedErrors.some((error) => error.includes('.'))
  ) {
    return nestedErrors
  }

  // Fallback to simple message
  return [`Field '${field}': ${issue.message || 'Invalid union type'}`]
}

const formatIssue = (
  issue: $ZodIssue,
  parentPath: (string | number)[] = [],
): string[] => {
  // Use the issue's path if it exists, otherwise use parent path
  const path =
    issue.path.length > 0
      ? [
          ...parentPath,
          ...issue.path.filter(
            (p): p is string | number =>
              typeof p === 'string' || typeof p === 'number',
          ),
        ]
      : parentPath
  const field = path.length
    ? path.filter(Boolean).map(String).join('.')
    : 'value'

  if (isUnionError(issue)) {
    return formatUnionError(issue, field, path)
  }
  if (issue.code === 'invalid_type') {
    return [`Field '${field}' is required`]
  }
  if (issue.code === 'invalid_format') {
    if ('format' in issue && issue.format === 'email') {
      return [`Field '${field}' must be a valid email address`]
    }
    return [`Field '${field}': Invalid format - ${issue.message}`]
  }
  return [`Field '${field}': ${issue.message}`]
}

export const formatZodErrorToString = (error: ZodError): string => {
  const messages = error.issues.flatMap((issue) => formatIssue(issue))

  if (messages.length === 1) {
    return messages[0]
  }
  return 'Validation failed: ' + messages.join('; ')
}

export const formatZodErrorToArray = (error: ZodError): string[] => {
  return error.issues.flatMap((issue) => formatIssue(issue))
}
