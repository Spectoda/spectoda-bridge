import { Parameter, ParameterValue } from '@spectoda/schemas'

import { formatTnglObjectValue } from './formatTnglObjectValue'

export const getTnglHeader = (
  project_parameters: Parameter,
  network_parameters: ParameterValue,
) => {
  let tngl_header = ''

  for (const key in project_parameters) {
    let value = network_parameters?.[key] ?? project_parameters[key].value

    if (typeof value === 'object' && value !== null) {
      value = formatTnglObjectValue(value)
    }

    tngl_header += `#define ${key} ${value}\n`
  }

  return tngl_header
}
