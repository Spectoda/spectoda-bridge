export const formatTnglObjectValue = (
  object_value: Record<string, unknown>,
): string => {
  const entries = Object.entries(object_value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')

  return `{ ${entries} }`
}
