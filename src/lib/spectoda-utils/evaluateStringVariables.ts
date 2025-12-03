import { isError, privateError } from '../../../error/index'
import { ProductParameterType } from '@spectoda/schemas/src/product/productParameters'

import { Json, JsonObject } from './types'
import { followJsonPath } from './followJsonPath'
import { evaluateStringVariable } from './evaluateStringVariable'

export const evaluateStringVariables = <$Json extends Json>(props: {
  data: $Json
  parameters: ProductParameterType
  overwrite?: ProductParameterType
}) => {
  props.overwrite ??= {}

  const { data } = props
  const parameters = { ...props.parameters, ...props.overwrite }

  // TODO: use linked list for better performance
  const queue: string[][] = [[]]

  do {
    const path = queue.shift()

    if (path === undefined) {
      return privateError('EVALUATE_STRING_VARIABLES.PATH_INVALID')
    }

    const value = followJsonPath(data, path)

    if (isError(value)) {
      return value
    }

    const type = typeof value

    if (value === null || value === undefined) {
      continue
    } else if (type === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; ++i) {
          queue.push([...path, `${i}`])
        }
      } else {
        for (const key in value as JsonObject) {
          queue.push([...path, key])
        }
      }
    } else if (type === 'string') {
      const ref = followJsonPath(data, path.slice(0, -1))

      if (isError(ref)) {
        return ref
      }

      if (ref === null || ref === undefined) {
        return privateError('EVALUATE_STRING_VARIABLES.REF_INVALID')
      }

      if (typeof ref !== 'object') {
        return privateError('EVALUATE_STRING_VARIABLES.REF_NOT_OBJECT')
      }

      const parent_path = path.at(-1)

      if (parent_path === undefined) {
        return privateError('EVALUATE_STRING_VARIABLES.PARENT_PATH_INVALID')
      }

      const current_value = (ref as Record<string, unknown>)[parent_path]

      if (typeof current_value !== 'string') {
        return privateError('EVALUATE_STRING_VARIABLES.CHILD_REF_NOT_STRING')
      }

      const evaluated = evaluateStringVariable(parameters, current_value)

      if (isError(evaluated)) {
        return evaluated
      }

      ;(ref as Record<string, unknown>)[parent_path as string] = evaluated
    }
  } while (queue.length)
}
