// TODO de-duplicate fileUtils

export const safeJSONParse = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value as unknown
  }
}

export const safePrettifyJSONString = (value: string) => {
  try {
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
