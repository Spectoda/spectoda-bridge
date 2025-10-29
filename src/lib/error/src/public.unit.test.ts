import { expect, it } from 'bun:test'

import { ERROR_PROPERTY } from './constants'
import { publicError } from './public'

it('should create publicError with no context', () => {
  const error = publicError('test.NO_CONTEXT')

  expect(error).toHaveProperty(ERROR_PROPERTY)
  expect(error.id).toBe('test.NO_CONTEXT')
  expect(error.context).not.toBeDefined()
})

it('should create publicError with context', () => {
  const ctx = { name: 'Yamiteru' }
  const error = publicError('test.WITH_CONTEXT', ctx)

  expect(error).toHaveProperty(ERROR_PROPERTY)
  expect(error.id).toBe('test.WITH_CONTEXT')
  expect(error.context).toBe(ctx)
})
