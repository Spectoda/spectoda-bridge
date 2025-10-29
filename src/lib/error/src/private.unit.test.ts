import { expect, it } from 'bun:test'

import { privateError } from './private'
import { ERROR_PROPERTY } from './constants'

it('should create privateError with no ID', () => {
  const error = privateError()

  expect(error).toHaveProperty(ERROR_PROPERTY)
  expect(error.id).not.toBeDefined()
})

it('should create privateError with ID', () => {
  const error = privateError('CUSTOM_ID')

  expect(error).toHaveProperty(ERROR_PROPERTY)
  expect(error.id).toBe('CUSTOM_ID')
})
