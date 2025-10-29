import { expect, it, describe } from 'bun:test'

import { followJsonPath } from './followJsonPath'
import { JsonObject } from './types'

describe('followJsonPath', () => {
  const testData = {
    name: 'John',
    age: 30,
    address: {
      street: '123 Main St',
      city: 'Springfield',
      coordinates: {
        lat: 39.7817,
        lng: -89.6501,
      },
    },
    hobbies: ['reading', 'swimming', 'coding'],
    items: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ],
    nullValue: null,
    emptyString: '',
    zeroValue: 0,
    falseValue: false,
  } satisfies JsonObject

  it('should return the root object when path is empty', () => {
    const result = followJsonPath(testData, [])

    expect(result).toBe(testData)
  })

  it('should access top-level properties', () => {
    expect(followJsonPath(testData, ['name'])).toBe('John')
    expect(followJsonPath(testData, ['age'])).toBe(30)
  })

  it('should access nested object properties', () => {
    expect(followJsonPath(testData, ['address', 'street'])).toBe('123 Main St')
    expect(followJsonPath(testData, ['address', 'city'])).toBe('Springfield')
  })

  it('should access deeply nested properties', () => {
    expect(followJsonPath(testData, ['address', 'coordinates', 'lat'])).toBe(
      39.7817,
    )
    expect(followJsonPath(testData, ['address', 'coordinates', 'lng'])).toBe(
      -89.6501,
    )
  })

  it('should access array elements by numeric index', () => {
    expect(followJsonPath(testData, ['hobbies', 0])).toBe('reading')
    expect(followJsonPath(testData, ['hobbies', 1])).toBe('swimming')
    expect(followJsonPath(testData, ['hobbies', 2])).toBe('coding')
  })

  it('should access array elements by string index', () => {
    expect(followJsonPath(testData, ['hobbies', '0'])).toBe('reading')
    expect(followJsonPath(testData, ['hobbies', '1'])).toBe('swimming')
    expect(followJsonPath(testData, ['hobbies', '2'])).toBe('coding')
  })

  it('should access properties of objects within arrays', () => {
    expect(followJsonPath(testData, ['items', 0, 'id'])).toBe(1)
    expect(followJsonPath(testData, ['items', 0, 'name'])).toBe('Item 1')
    expect(followJsonPath(testData, ['items', 1, 'id'])).toBe(2)
    expect(followJsonPath(testData, ['items', 2, 'name'])).toBe('Item 3')
  })

  it('should access properties of objects within arrays using string indices', () => {
    expect(followJsonPath(testData, ['items', '0', 'id'])).toBe(1)
    expect(followJsonPath(testData, ['items', '1', 'name'])).toBe('Item 2')
    expect(followJsonPath(testData, ['items', '2', 'id'])).toBe(3)
  })

  it('should handle falsy values correctly', () => {
    expect(followJsonPath(testData, ['nullValue'])).toBe(null)
    expect(followJsonPath(testData, ['emptyString'])).toBe('')
    expect(followJsonPath(testData, ['zeroValue'])).toBe(0)
    expect(followJsonPath(testData, ['falseValue'])).toBe(false)
  })

  it('should return error for non-existent properties', () => {
    const result = followJsonPath(testData, ['nonExistent'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for non-existent nested properties', () => {
    const result = followJsonPath(testData, ['address', 'nonExistent'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for array index out of bounds', () => {
    const result = followJsonPath(testData, ['hobbies', 10])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for negative array index', () => {
    const result = followJsonPath(testData, ['hobbies', -1])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for non-integer array index', () => {
    const result = followJsonPath(testData, ['hobbies', 1.5])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for invalid string array index', () => {
    const result = followJsonPath(testData, ['hobbies', 'notANumber'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error when trying to access property of null', () => {
    const result = followJsonPath(testData, ['nullValue', 'property'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error when trying to access property of undefined', () => {
    const result = followJsonPath(testData, ['undefinedValue', 'property'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error when trying to access property of primitive', () => {
    const result = followJsonPath(testData, ['name', 'length'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should handle complex mixed paths', () => {
    const complexData = {
      users: [
        {
          profile: {
            settings: {
              notifications: ['email', 'sms', 'push'],
            },
          },
        },
      ],
    }

    expect(
      followJsonPath(complexData, [
        'users',
        0,
        'profile',
        'settings',
        'notifications',
        1,
      ]),
    ).toBe('sms')
  })

  it('should handle empty arrays', () => {
    const dataWithEmptyArray = { items: [] }
    const result = followJsonPath(dataWithEmptyArray, ['items', 0])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should handle nested empty objects', () => {
    const dataWithEmptyObject = { config: {} }
    const result = followJsonPath(dataWithEmptyObject, ['config', 'setting'])

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should work with numeric property names', () => {
    const dataWithNumericKeys = {
      '123': 'numeric key',
      456: 'another numeric key',
    }

    expect(followJsonPath(dataWithNumericKeys, ['123'])).toBe('numeric key')
    expect(followJsonPath(dataWithNumericKeys, [456])).toBe(
      'another numeric key',
    )
  })

  it('should handle special characters in property names', () => {
    const dataWithSpecialKeys = {
      'key-with-dashes': 'value1',
      'key.with.dots': 'value2',
      'key with spaces': 'value3',
      'key[with]brackets': 'value4',
    }

    expect(followJsonPath(dataWithSpecialKeys, ['key-with-dashes'])).toBe(
      'value1',
    )
    expect(followJsonPath(dataWithSpecialKeys, ['key.with.dots'])).toBe(
      'value2',
    )
    expect(followJsonPath(dataWithSpecialKeys, ['key with spaces'])).toBe(
      'value3',
    )
    expect(followJsonPath(dataWithSpecialKeys, ['key[with]brackets'])).toBe(
      'value4',
    )
  })
})
