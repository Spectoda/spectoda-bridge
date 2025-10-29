import type { Element, InputElement } from '@spectoda/schemas'
import { EnhancedControllableElement } from '@spectoda/spectoda-core'

export const isControllableElement = (
  element: Element | undefined,
): element is EnhancedControllableElement => {
  if (!element) {
    return false
  }

  return (
    (element.spectodaId !== undefined ||
      element.spectodaIdArray !== undefined) &&
    (element.controlPageIds !== undefined ||
      element.controls !== undefined ||
      element.controlPageRefs !== undefined)
  )
}

export const isInputElement = (element: Element): element is InputElement => {
  return element.type === 'input'
}

export const getSpectodaIdArrayForElement = (element: Element): number[] => {
  if (element.spectodaIdArray?.length) {
    return element.spectodaIdArray
  }
  return element.spectodaId ? [element.spectodaId] : []
}
