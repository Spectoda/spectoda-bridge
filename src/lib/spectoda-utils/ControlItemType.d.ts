// TODO Replace all usage with eventControls logic

export type BaseControlItem = {
  uuid: string
  name: string
  description?: string

  // TODO: Are the following fields really needed?
  // Please refer to vodochody.ts, these fields are exported from Studio but maybe not needed?
  id?: string
  chosen?: boolean
  selected?: boolean
}

export type PercentageItem = {
  type: 'percentage'
  minValue?: number
  maxValue?: number
  isAutosendEnabled: boolean
  isMinMaxEnabled: boolean
} & BaseControlItem

export type TimestampItem = {
  type: 'timestamp'
  minValue?: number
  maxValue?: number
  isAutosendEnabled: boolean
  isMinMaxEnabled: boolean
} & BaseControlItem

export type ColorItem = {
  type: 'color'
  isAutosendEnabled: boolean
} & BaseControlItem

export type LabelItem = {
  type: 'label'
} & BaseControlItem

export type MicrophoneItem = {
  type: 'microphone'
} & BaseControlItem

export type ButtonItem = {
  type: 'button'
  sendOnRelease: boolean
} & BaseControlItem

export type ToggleItem = {
  type: 'toggle'
} & BaseControlItem

export type ControlItemType =
  | PercentageItem
  | TimestampItem
  | ColorItem
  | LabelItem
  | MicrophoneItem
  | ButtonItem
  | ToggleItem

export type controlType = ControlItemType['type']
