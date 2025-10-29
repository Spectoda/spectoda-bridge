export const roundTo = (number: number, decimals = 2): number => {
  // eslint-disable-next-line no-magic-numbers
  return Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

export const convertRange = (
  value: number,
  oldMin: number,
  oldMax: number,
  newMin: number,
  newMax: number,
) => {
  return newMin + (newMax - newMin) * ((value - oldMin) / (oldMax - oldMin))
}
