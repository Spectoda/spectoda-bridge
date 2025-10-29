import { expect, it, describe } from 'bun:test'
import { ProductParameterType } from '@spectoda/schemas/src/product/productParameters'

import { evaluateStringVariables } from './evaluateStringVariables'

describe('evaluateStringVariables', () => {
  const parameters = {
    CONTROLLER_LABEL: 'LN00',
    EVENT_ID: 42,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ELEMENT_ID: null as any,
  } satisfies ProductParameterType

  it('should evaluate string variables in a simple object', () => {
    const input = {
      name: '{{CONTROLLER_LABEL}}',
      id: '{{EVENT_ID}}',
    }

    evaluateStringVariables({
      data: input,
      parameters,
    })

    expect(input.name).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.id).toBe(42 as any)
  })

  it('should evaluate string variables in nested objects', () => {
    const input = {
      controller: {
        name: '{{CONTROLLER_LABEL}}',
        config: {
          id: '{{EVENT_ID}}',
        },
      },
    }

    evaluateStringVariables({
      data: input,
      parameters,
    })

    expect(input.controller.name).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.controller.config.id).toBe(42 as any)
  })

  it('should evaluate string variables in arrays', () => {
    const input = {
      items: ['{{CONTROLLER_LABEL}}', '{{EVENT_ID}}', 'static'],
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.items[0]).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.items[1]).toBe(42 as any)
    expect(input.items[2]).toBe('static')
  })

  it('should handle mixed arrays and objects', () => {
    const input = {
      elements: [
        {
          label: '{{CONTROLLER_LABEL}}',
          id: '{{EVENT_ID}}',
        },
        {
          label: '{{CONTROLLER_LABEL}}_2',
          id: 'static',
        },
      ],
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.elements[0].label).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.elements[0].id).toBe(42 as any)
    expect(input.elements[1].label).toBe('LN00_2')
    expect(input.elements[1].id).toBe('static')
  })

  it('should skip null values', () => {
    const input = {
      name: '{{CONTROLLER_LABEL}}',
      nullable: null,
      id: '{{EVENT_ID}}',
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.name).toBe('LN00')
    expect(input.nullable).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.id).toBe(42 as any)
  })

  it('should skip non-string values', () => {
    const input = {
      name: '{{CONTROLLER_LABEL}}',
      number: 123,
      boolean: true,
      id: '{{EVENT_ID}}',
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.name).toBe('LN00')
    expect(input.number).toBe(123)
    expect(input.boolean).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.id).toBe(42 as any)
  })

  it('should handle complex template structure similar to Luna example', () => {
    const input = {
      controller: {
        config: {
          controller: {
            name: '{{CONTROLLER_LABEL}}',
          },
        },
        element: {
          pixels: [
            {
              label: '{{CONTROLLER_LABEL}}',
              io: 'DIM1',
            },
            {
              label: '{{CONTROLLER_LABEL}}',
              io: 'PWM1',
            },
          ],
        },
      },
      outputs: {
        DIM1: {
          config: {
            segments: {
              NIGHT: {
                io: 'DIM1',
                id: '{{EVENT_ID}}',
              },
            },
          },
        },
      },
      scripts: {
        LUNA: {
          script: 'Luna({"id":{{EVENT_ID}}})',
        },
      },
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.controller.config.controller.name).toBe('LN00')
    expect(input.controller.element.pixels[0].label).toBe('LN00')
    expect(input.controller.element.pixels[1].label).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.outputs.DIM1.config.segments.NIGHT.id).toBe(42 as any)
    expect(input.scripts.LUNA.script).toBe('Luna({"id":42})')
  })

  it('should return error for invalid parameter reference', () => {
    const input = {
      name: '{{INVALID_PARAM}}',
    }

    const result = evaluateStringVariables({ data: input, parameters })

    expect(result).toMatchObject({
      id: 'FOLLOW_JSON_PATH.REFERENCE_INVALID',
    })
  })

  it('should handle empty objects', () => {
    const input = {}

    const result = evaluateStringVariables({ data: input, parameters })

    expect(result).toBeUndefined()
    expect(input).toEqual({})
  })

  it('should handle empty arrays', () => {
    const input = {
      items: [],
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.items).toEqual([])
  })

  it('should handle deeply nested structures', () => {
    const input = {
      level1: {
        level2: {
          level3: {
            level4: {
              name: '{{CONTROLLER_LABEL}}',
              items: [
                {
                  id: '{{EVENT_ID}}',
                },
              ],
            },
          },
        },
      },
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.level1.level2.level3.level4.name).toBe('LN00')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.level1.level2.level3.level4.items[0].id).toBe(42 as any)
  })

  it('should handle string templates with nested parameter references', () => {
    const parameters = {
      CONTROLLER_LABEL: 'LN00',
      config: {
        name: 'TestConfig',
      },
    }

    const input = {
      name: '{{CONTROLLER_LABEL}}',
      configName: '{{config.name}}',
    }

    evaluateStringVariables({ data: input, parameters })

    expect(input.name).toBe('LN00')
    expect(input.configName).toBe('TestConfig')
  })

  it('should overwrite parameters with overwrite field', () => {
    const parameters = {
      CONTROLLER_LABEL: 'LN00',
      EVENT_ID: 42,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ELEMENT_ID: null as any,
    } satisfies ProductParameterType

    const overwrite = {
      CONTROLLER_LABEL: 'OVERWRITTEN',
      EVENT_ID: 99,
    } satisfies ProductParameterType

    const input = {
      name: '{{CONTROLLER_LABEL}}',
      id: '{{EVENT_ID}}',
      element: '{{ELEMENT_ID}}',
    }

    evaluateStringVariables({
      data: input,
      parameters,
      overwrite,
    })

    expect(input.name).toBe('OVERWRITTEN')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(input.id).toBe(99 as any)
    expect(input.element).toBe('null')
  })
})
