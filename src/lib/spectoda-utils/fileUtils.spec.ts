import {
  fileToBlob,
  prettifyFilename,
  safeJSONParse,
  safeJSONParseValidObject,
  safePrettifyJSONString,
} from './fileUtils' // Replace with the actual file path

describe('safeJSONParse', () => {
  it('should parse valid JSON strings', () => {
    const jsonString = '{"key": "value"}'

    expect(safeJSONParse(jsonString)).toEqual({ key: 'value' })
  })

  it('should return the original value if it is not a string', () => {
    const value = { key: 'value' }

    expect(safeJSONParse(value)).toBe(value)
  })

  it('should return the original value for invalid JSON strings', () => {
    const invalidJson = '{"key": "value"'

    expect(safeJSONParse(invalidJson)).toBe(invalidJson)
  })
})

describe('safeJSONParseValidObject', () => {
  it('should return a parsed object for valid JSON', () => {
    const jsonString = '{"key": "value"}'

    expect(safeJSONParseValidObject(jsonString)).toEqual({ key: 'value' })
  })

  it('should return an empty object for non-object JSON', () => {
    const jsonString = '"not an object"'

    expect(safeJSONParseValidObject(jsonString)).toEqual({})
  })

  it('should return an empty object for invalid JSON', () => {
    const invalidJson = '{"key": "value"'

    expect(safeJSONParseValidObject(invalidJson)).toEqual({})
  })
})

describe('safePrettifyJSONString', () => {
  it('should prettify a valid JSON string', () => {
    const jsonString = '{"key":"value"}'
    const prettyString = `{
  "key": "value"
}`

    expect(safePrettifyJSONString(jsonString)).toBe(prettyString)
  })

  it('should return an empty string for null or undefined', () => {
    expect(safePrettifyJSONString(null)).toBe('')
    expect(safePrettifyJSONString(undefined)).toBe('')
  })

  it('should return the original value for invalid JSON strings', () => {
    const invalidJson = '{"key": "value"'

    expect(safePrettifyJSONString(invalidJson)).toBe(invalidJson)
  })
})

describe('fileToBlob', () => {
  it('should convert a File to a Blob', async () => {
    const file = new File(['Hello, world!'], 'hello.txt', {
      type: 'text/plain',
    })
    const blob = await fileToBlob(file)

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/plain')
  })
})

describe('prettifyFilename', () => {
  it('should remove .tgbl or .zip from filenames', () => {
    expect(prettifyFilename('example.tgbl')).toBe('example')
    expect(prettifyFilename('example.zip')).toBe('example')
  })

  it('should not modify filenames without .tgbl or .zip', () => {
    expect(prettifyFilename('example.txt')).toBe('example.txt')
  })
})
