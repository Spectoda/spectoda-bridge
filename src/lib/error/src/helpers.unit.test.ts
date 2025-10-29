import { expect, it } from 'bun:test'

import { privateError } from './private'
import { publicError } from './public'
import { isError, matchError, matchErrors } from './helpers'

const private_error_a = privateError('A')
const private_error_b = privateError('B')
const public_error_no_context = publicError('test.NO_CONTEXT')
const public_error_with_context = publicError('test.WITH_CONTEXT', {
  name: 'Yamiteru',
})

it('should return true if error passed into isError is error', () => {
  expect(isError(private_error_a)).toBe(true)
  expect(isError(private_error_b)).toBe(true)
  expect(isError(public_error_no_context)).toBe(true)
  expect(isError(public_error_with_context)).toBe(true)
})

it('should return false if error passed into isError is not error', () => {
  expect(isError(new Error())).toBe(false)
  expect(isError({})).toBe(false)
  expect(isError('hello')).toBe(false)
  expect(isError(1)).toBe(false)
  expect(isError(true)).toBe(false)
})

it('should return true if error passed into matchError matches the provided ID', () => {
  expect(matchError(private_error_a, 'A')).toBe(true)
  expect(matchError(private_error_b, 'B')).toBe(true)
  expect(matchError(public_error_no_context, 'test.NO_CONTEXT')).toBe(true)
  expect(matchError(public_error_with_context, 'test.WITH_CONTEXT')).toBe(true)
})

it('should return false if error passed into matchError does not match the provided ID', () => {
  expect(matchError(private_error_a, 'B')).toBe(false)
  expect(matchError(private_error_b, 'A')).toBe(false)
  expect(matchError(public_error_no_context, 'test.WITH_CONTEXT')).toBe(false)
  expect(matchError(public_error_with_context, 'test.NO_CONTEXT')).toBe(false)
})

it('should return true if error passed into matchErrors matches one of the provided IDs', () => {
  expect(matchErrors(private_error_a, ['A', 'B'])).toBe(true)
  expect(matchErrors(private_error_b, ['A', 'B'])).toBe(true)
  expect(
    matchErrors(public_error_no_context, [
      'test.NO_CONTEXT',
      'test.WITH_CONTEXT',
    ]),
  ).toBe(true)
  expect(
    matchErrors(public_error_with_context, [
      'test.NO_CONTEXT',
      'test.WITH_CONTEXT',
    ]),
  ).toBe(true)
})

it('should return false if error passed into matchErrors does not match any of the provided IDs', () => {
  expect(
    matchErrors(private_error_a, ['test.NO_CONTEXT', 'test.WITH_CONTEXT']),
  ).toBe(false)
  expect(
    matchErrors(private_error_b, ['test.NO_CONTEXT', 'test.WITH_CONTEXT']),
  ).toBe(false)
  expect(matchErrors(public_error_no_context, ['A', 'B'])).toBe(false)
  expect(matchErrors(public_error_with_context, ['A', 'B'])).toBe(false)
})
