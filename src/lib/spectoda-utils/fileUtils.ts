export const safeJSONParse = <T>(value: unknown): T | unknown => {
  try {
    if (typeof value !== 'string') {
      return value
    }
    return JSON.parse(value) as T
  } catch {
    return value
  }
}

export const safeJSONParseValidObject = (
  value: unknown,
): Record<string, unknown> => {
  const unknownParsedValue = safeJSONParse(value)

  if (typeof unknownParsedValue === 'object' && unknownParsedValue !== null) {
    return unknownParsedValue as Record<string, unknown>
  }
  return {}
}

export const safePrettifyJSONString = (value: string | null | undefined) => {
  try {
    if (!value) {
      return ''
    }
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export const fileToBlob = async (file: File) =>
  new Blob([new Uint8Array(await file.arrayBuffer())], {
    type: file.type,
  })

export const prettifyFilename = (name: string) => {
  return name.replace(/(\.tgbl)|(\.zip)$/, '')
}
