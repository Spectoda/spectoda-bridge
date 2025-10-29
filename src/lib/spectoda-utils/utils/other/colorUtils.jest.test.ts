import { avgColors, minMaxColors } from './colorUtils'

// TODO Clean up color utils across whole monorepo

describe('Color manipulation functions', () => {
  const colors = ['#ff0000', '#00ff00', '#0000ff']

  test('avgColors calculates average color', () => {
    expect(avgColors(colors)).toBe('#555555')
  })

  test('minMaxColors returns min and max colors', () => {
    // TODO - validate if this should be output
    expect(minMaxColors(colors)).toEqual({ min: '#ff0000', max: '#ff0000' })
  })
})
