/* eslint-disable no-magic-numbers */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// TODO Remove all usage
// TODO Clean up color utils across whole monorepo

export const doHexColorsEqual = (hex1: string | null, hex2: string | null) => {
  if (!hex1 || !hex2) {
    return false
  }

  const rgb1 = hexToRgb(hex1)
  const rgb2 = hexToRgb(hex2)

  return rgb1.r === rgb2.r && rgb1.g === rgb2.g && rgb1.b === rgb2.b
}

export const hexToRgb = (hex: string) => {
  // TODO add neverthrow handling
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex

  const r = parseInt(cleanHex.slice(0, 2), 16)
  const g = parseInt(cleanHex.slice(2, 4), 16)
  const b = parseInt(cleanHex.slice(4, 6), 16)

  return { r, g, b }
}

export const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export const avgColors = (colors) => {
  const sum = colors.reduce(
    (acc, curr) => {
      const rgb = hexToRgb(curr)

      acc.r += rgb.r
      acc.g += rgb.g
      acc.b += rgb.b
      return acc
    },
    { r: 0, g: 0, b: 0 },
  )

  const numColors = colors.length

  return rgbToHex(
    Math.round(sum.r / numColors),
    Math.round(sum.g / numColors),
    Math.round(sum.b / numColors),
  )
}

export const minMaxColors = (colors) => {
  const minColor = colors.reduce((acc, curr) =>
    hexToRgb(curr).r + hexToRgb(curr).g + hexToRgb(curr).b <
    hexToRgb(acc).r + hexToRgb(acc).g + hexToRgb(acc).b
      ? curr
      : acc,
  )
  const maxColor = colors.reduce((acc, curr) =>
    hexToRgb(curr).r + hexToRgb(curr).g + hexToRgb(curr).b >
    hexToRgb(acc).r + hexToRgb(acc).g + hexToRgb(acc).b
      ? curr
      : acc,
  )

  return { min: minColor, max: maxColor }
}
