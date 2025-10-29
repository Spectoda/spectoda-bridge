export const validateUrl = (val: string): boolean => {
  try {
    new URL(val)
    return true
  } catch {
    return false
  }
}
