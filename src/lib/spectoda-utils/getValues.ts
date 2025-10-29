export const getValues = <T extends Record<string, unknown>>(obj: T) => {
  return Object.values(obj) as [(typeof obj)[keyof T]]
}
