import { expect, it, describe } from 'bun:test'

import { evaluateStringVariable } from './evaluateStringVariable'
import { JsonObject } from './types'

describe('evaluateStringVariable', () => {
  const testParameters = {
    CONTROLLER_LABEL: 'LN00',
    EVENT_ID: 42,
    ELEMENT_ID: null,
    nested: {
      value: 'nested_value',
      deep: {
        property: 'deep_property',
      },
    },
    array: ['item1', 'item2', 'item3'],
  } satisfies JsonObject

  it('should replace single variable with simple key', () => {
    const result = evaluateStringVariable(
      testParameters,
      '{{CONTROLLER_LABEL}}',
    )

    expect(result).toBe('LN00')
  })

  it('should replace single variable in string with text', () => {
    const result = evaluateStringVariable(
      testParameters,
      'Controller: {{CONTROLLER_LABEL}}',
    )

    expect(result).toBe('Controller: LN00')
  })

  it('should replace multiple variables in a string', () => {
    const result = evaluateStringVariable(
      testParameters,
      'Controller: {{CONTROLLER_LABEL}}, Event: {{EVENT_ID}}',
    )

    expect(result).toBe('Controller: LN00, Event: 42')
  })

  it('should replace nested object properties', () => {
    const result = evaluateStringVariable(testParameters, '{{nested.value}}')

    expect(result).toBe('nested_value')
  })

  it('should replace deep nested properties', () => {
    const result = evaluateStringVariable(
      testParameters,
      '{{nested.deep.property}}',
    )

    expect(result).toBe('deep_property')
  })

  it('should replace array elements by index', () => {
    const result = evaluateStringVariable(testParameters, '{{array[1]}}')

    expect(result).toBe('item2')
  })

  it('should handle null values', () => {
    const result = evaluateStringVariable(testParameters, '{{ELEMENT_ID}}')

    expect(result).toBe('null')
  })

  it('should handle numeric values', () => {
    const result = evaluateStringVariable(testParameters, '{{EVENT_ID}}')

    expect(result).toBe(42)
  })

  it('should return string unchanged if no variables present', () => {
    const result = evaluateStringVariable(testParameters, 'No variables here')

    expect(result).toBe('No variables here')
  })

  it('should handle empty string', () => {
    const result = evaluateStringVariable(testParameters, '')

    expect(result).toBe('')
  })

  it('should handle whitespace in variable names', () => {
    const result = evaluateStringVariable(
      testParameters,
      '{{ CONTROLLER_LABEL }}',
    )

    expect(result).toBe('LN00')
  })

  it('should handle multiple occurrences of same variable', () => {
    const result = evaluateStringVariable(
      testParameters,
      '{{CONTROLLER_LABEL}}-{{CONTROLLER_LABEL}}',
    )

    expect(result).toBe('LN00-LN00')
  })

  it('should return error for invalid path', () => {
    const result = evaluateStringVariable(testParameters, '{{invalid.path}}')

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should return error for invalid array index', () => {
    const result = evaluateStringVariable(testParameters, '{{array[10]}}')

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should handle mixed text and variables', () => {
    const result = evaluateStringVariable(
      testParameters,
      'Label: {{CONTROLLER_LABEL}}, ID: {{EVENT_ID}}, Value: {{nested.value}}',
    )

    expect(result).toBe('Label: LN00, ID: 42, Value: nested_value')
  })

  it('should handle complex template from Luna example', () => {
    const lunaParams = {
      EVENT_ID: 123,
      CONTROLLER_LABEL: 'LUNA01',
    }

    const result = evaluateStringVariable(
      lunaParams,
      'Luna({"id":{{EVENT_ID}}})',
    )

    expect(result).toBe('Luna({"id":123})')
  })

  it('should handle nested bracket notation', () => {
    const result = evaluateStringVariable(testParameters, '{{nested[value]}}')

    expect(result).toBe('nested_value')
  })

  it('should handle multiple variable types in one string', () => {
    const result = evaluateStringVariable(
      testParameters,
      '{{CONTROLLER_LABEL}}: {{nested.value}} [{{array[0]}}]',
    )

    expect(result).toBe('LN00: nested_value [item1]')
  })

  it('should handle complex nested access', () => {
    const complexData = {
      config: {
        segments: {
          NIGHT: {
            id: 'segment_123',
          },
        },
      },
    }

    const result = evaluateStringVariable(
      complexData,
      '{{config.segments.NIGHT.id}}',
    )

    expect(result).toBe('segment_123')
  })
})
