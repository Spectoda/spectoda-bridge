import { expect, it } from 'bun:test'

import { publicError } from './public'
import { setLanguage, translate } from './translate'

it('should translate publicError with no context', () => {
  const error = publicError('test.NO_CONTEXT')

  setLanguage('en')

  expect(translate(error)).toBe('Hello, World!')
})

it('should translate publicError with context', () => {
  const ctx = { name: 'Yamiteru' }
  const error = publicError('test.WITH_CONTEXT', ctx)

  setLanguage('en')

  expect(translate(error)).toBe('Hello, Yamiteru!')
})
