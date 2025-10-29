import { ERROR_MAP, LANGUAGES } from '../constants'

export type ErrorMap = typeof ERROR_MAP

export type Language = (typeof LANGUAGES)[number]
