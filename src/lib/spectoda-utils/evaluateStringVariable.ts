import { isError } from '../../../error/index'

import { followJsonPath } from './followJsonPath'
import { Json } from './types'

const STRING_VARIABLE_REGEXP = /\{\{(.*?)\}\}/g
// eslint-disable-next-line no-useless-escape
const JSON_ACCESS_PATH_REGEXP = /[.\[\]]/

export const evaluateStringVariable = <$Json extends Json>(
  json: $Json,
  input: string,
) => {
  const matches = Array.from(input.matchAll(STRING_VARIABLE_REGEXP))

  let output = `${input}`
  let offset = 0

  for (const match of matches) {
    const path: (string | number)[] = []

    for (const part of match[1].trim().split(JSON_ACCESS_PATH_REGEXP)) {
      if (part !== '') {
        path.push(Number.isNaN(Number.parseInt(part)) ? part : +part)
      }
    }

    const result = followJsonPath(json, path)

    if (isError(result)) {
      return result
    }

    const match_start = match.index! + offset
    const match_end = match_start + match[0].length
    const replacement = `${result}`

    output = `${output.slice(0, match_start)}${replacement}${output.slice(
      match_end,
    )}`
    offset += replacement.length - match[0].length
  }

  return `${+output}` === output ? +output : output
}
