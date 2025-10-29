/* eslint-disable no-magic-numbers */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck TODO USE `useTypedEvents` from `spectoda-core` instead
/** @deprecated use `useTypedEvents` from `spectoda-core` instead */

/**
 * File without proper types. scheduled for refactoring and the introduction of explicit * types to improve maintainability and reduce potential errors.
 *
 * TODO: Defined types for better type safety.
 * TODO: Review function, remove legacy code and simplify.
 */

import { useEffect, useState, useMemo } from 'react'
import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { spectoda, VALUE_TYPE } from '@spectoda/spectoda-core'

import { avgColors, minMaxColors } from './utils/other/colorUtils'
import { useSpectodaFirebaseStore } from './DEPRECATED_store'

const BROADCAST_ID = 255
const TOGG_VALUE_LOW = 50
const TOGG_VALUE_HIGH = 100

/** @deprecated use types from spectoda-js instead */
type BaseEvent = {
  id: number
  label: string
  identifier: number // label converted to a number
  timestamp: number
  meta: EventMeta
}

/** @deprecated use types from spectoda-js instead */
type TimestampEvent = {
  type: typeof VALUE_TYPE.TIMESTAMP
  value: number
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type LabelEvent = {
  type: typeof VALUE_TYPE.LABEL
  value: string
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type PercentageEvent = {
  type: typeof VALUE_TYPE.PERCENTAGE
  value: number
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type NumberEvent = {
  type: typeof VALUE_TYPE.NUMBER
  value: number
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type ValueArrayEvent = {
  type: typeof VALUE_TYPE.VALUE_ARRAY
  value: unknown
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type ColorEvent = {
  type: typeof VALUE_TYPE.COLOR
  value: string
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type TripleEvent = {
  type: typeof VALUE_TYPE.TRIPLE
  value: unknown
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type PixelsEvent = {
  type: typeof VALUE_TYPE.PIXELS
  value: number
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type ValueAddressEvent = {
  type: typeof VALUE_TYPE.VALUE_ADDRESS
  value: number
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type BoolEvent = {
  type: typeof VALUE_TYPE.BOOL
  value: boolean
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type NullEvent = {
  type: typeof VALUE_TYPE.NULL
  value: null
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
type UndefinedEvent = {
  type: typeof VALUE_TYPE.UNDEFINED
  value: undefined
} & BaseEvent

/** @deprecated use types from spectoda-js instead */
export type SpectodaEvent =
  | TimestampEvent
  | LabelEvent
  | PercentageEvent
  | NumberEvent
  | ValueArrayEvent
  | ColorEvent
  | TripleEvent
  | PixelsEvent
  | ValueAddressEvent
  | BoolEvent
  | NullEvent
  | UndefinedEvent

/** @deprecated use types from spectoda-js instead */
export type EventMeta = {
  [key: string]: unknown
}

const throttling = false

const mapAllTimestampsUnder0 = (state: unknown) => {
  let maxTimestamp = 0

  // find max timestamp
  for (const key of Object.keys(state)) {
    if (state[key].timestamp) {
      maxTimestamp = Math.max(maxTimestamp, state[key].timestamp)
    }
  }

  // subtract max timestamp from all timestamps
  for (const key of Object.keys(state)) {
    if (state[key].timestamp) {
      state[key].timestamp = state[key].timestamp - maxTimestamp
    }
  }

  return state
}

/**
 * @deprecated `useTypedEvents` from `spectoda-core` instead
 */
export const useEventStore = create(
  subscribeWithSelector(
    persist(
      (set, getState) => ({
        getEvent(label: string, id: number) {
          // if timstamp of 255 id is newer that the timestamp of the event, return the 255 event
          const event255 =
            getState()[`${window?.NETWORK_HOME_NAME}_${BROADCAST_ID}_${label}`]
          const event =
            getState()[`${window?.NETWORK_HOME_NAME}_${id}_${label}`]

          if (!event255?.timestamp) {
            return event
          }
          if (!event?.timestamp) {
            return event255
          }

          if (event?.timestamp >= event255?.timestamp) {
            return event
          } else {
            return event255
          }
        },
        mapEventsUnder0() {
          set((state) => {
            return {
              ...mapAllTimestampsUnder0(state),
            }
          })
        },
        setState(newState) {
          set((state) => {
            return {
              ...newState,
            }
          })
        },
      }),
      {
        name: 'event-store-v0',
        storage: {
          getItem: (name) => {
            const str = localStorage.getItem(name) as string

            return {
              state: {
                ...mapAllTimestampsUnder0(JSON.parse(str).state),
              },
            }
          },
          setItem: (name, newValue) => {
            const str = JSON.stringify({
              state: {
                ...newValue.state,
              },
            })

            localStorage.setItem(name, str)
          },
          removeItem: (name) => localStorage.removeItem(name),
        },
      },
    ),
  ),
)
// could be useful
/** @deprecated `useTypedEvents` from `spectoda-core` instead */
export const useSpectodaGroup = (
  eventName: string,
  ids: number[],
  noAverage = false,
) => {
  if (!Array.isArray(ids)) {
    ids = [ids]
  }

  let events = useEventStore((state) => {
    if (ids.includes(BROADCAST_ID)) {
      // get ids of all devices in useSpectodaStore

      return useSpectodaFirebaseStore
        .getState()
        .getIdsForAllDevices()
        .map((id) => {
          // @ts-ignore
          return state[`${window?.NETWORK_HOME_NAME}_${id}_${eventName}`]
        })
    } else {
      // @ts-ignore
      return ids.map(
        (id) => state[`${window?.NETWORK_HOME_NAME}_${id}_${eventName}`],
      )
    }
  })

  const event255 = useEventStore(
    (state) =>
      // @ts-ignore
      state[`${window?.NETWORK_HOME_NAME}_${BROADCAST_ID}_${eventName}`],
  )

  const setGroup = (args: unknown) => {
    // @ts-ignore
    useEventStore.setState((state) => {
      for (const id of ids) {
        state[`${window?.NETWORK_HOME_NAME}_${id}_${eventName}`] = {
          ...args,
          id,
          label: eventName,
        }
      }
    })
  }

  const newEvents = events.map((event) => {
    if (!event255?.timestamp_utc) {
      return event
    }
    if (!event?.timestamp_utc) {
      return event255
    }

    if (event?.timestamp >= event255?.timestamp) {
      return event
    } else {
      return event255
    }
  })

  events = newEvents

  // calculate avg event value, ingore null values
  if (
    events?.length > 0 &&
    typeof events[0] === 'string' &&
    events[0].startsWith('#')
  ) {
    return {
      events,
      avg: avgColors(events),
      ...minMaxColors(events),
      setGroup,
    }
  }

  const avg =
    events.reduce(
      (acc, curr) => (typeof curr?.value === 'number' ? acc + curr.value : acc),
      0,
    ) / events.length

  // calculate min, ignore null values
  const min = events.reduce(
    (acc, curr) =>
      typeof curr?.value === 'number' && curr.value < acc ? curr.value : acc,
    Infinity,
  )
  // calculate max, ignore null values
  const max = events.reduce(
    (acc, curr) =>
      typeof curr?.value === 'number' && curr.value > acc ? curr.value : acc,
    -Infinity,
  )

  // there could be any metadata, so we need to collect it all into one object
  // TODO make metadata extentable for calculations for groups.. Currently only "used for isMixed"

  let meta = {
    isMixed: false,
  }

  // loop though all events and collect all meta values into one object
  for (const event of events) {
    if (event?.meta) {
      meta = { ...meta, ...event.meta }
    }
  }

  meta.isMixed = meta.isMixed
    ? meta.isMixed
    : typeof min === 'number' &&
      typeof max === 'number' &&
      min >= 0 &&
      min <= 100 &&
      min >= 0 &&
      max <= 100 &&
      min !== max

  return { events, avg, min, max, setGroup, meta }
}

/**
 * @deprecated `useTypedEvents` from `spectoda-core` instead
 */
export const readEvent = (label: string, id: number) => {
  const updatedDevices: Record<string, unknown> = useEventStore.getState()

  const event255Key = `${window?.NETWORK_HOME_NAME}_${BROADCAST_ID}_${label}`
  const eventKey = `${window?.NETWORK_HOME_NAME}_${id}_${label}`

  const event255 = updatedDevices[event255Key]
  const event = updatedDevices[eventKey]

  if (!event255?.timestamp) {
    return event
  }
  if (!event?.timestamp) {
    return event255
  }

  return event?.timestamp >= event255?.timestamp ? event : event255
}

/**
 * @deprecated `useTypedEvents` from `spectoda-core` instead
 */
export const useSpectodaEventsUpdater = () => {
  useEffect(() => {
    const unsubSpectoda = spectoda.on(
      'eventstateupdates',
      (events: SpectodaEvent[]) => {
        const updatedDevices: Record<string, unknown> = useEventStore.getState()

        // todo remove redundant getEvent/readEvent method
        const getEvent = (label: string, id: number) => {
          const event255Key = `${window?.NETWORK_HOME_NAME}_${BROADCAST_ID}_${label}`
          const eventKey = `${window?.NETWORK_HOME_NAME}_${id}_${label}`

          const event255 = updatedDevices[event255Key]
          const event = updatedDevices[eventKey]

          if (!event255?.timestamp) {
            return event
          }
          if (!event?.timestamp) {
            return event255
          }

          return event?.timestamp >= event255?.timestamp ? event : event255
        }

        for (const event of events) {
          updatedDevices[
            `${window?.NETWORK_HOME_NAME}_${event.id}_${event.label}`
          ] = event

          switch (event.label) {
            case 'toggl': {
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg1`] =
                {
                  ...event,
                  label: 'togg1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg2`] =
                {
                  ...event,
                  label: 'togg2',
                }

              break
            }
            case 'brigh': {
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  label: 'toggl',
                  value: 100,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_brig1`] =
                {
                  ...event,
                  label: 'brig1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_brig2`] =
                {
                  ...event,
                  label: 'brig2',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg1`] =
                {
                  ...event,
                  label: 'togg1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg2`] =
                {
                  ...event,
                  label: 'togg2',
                }

              break
            }
            case 'brig1': {
              const togg2 = getEvent('togg2', event.id)
              const brig2 = getEvent('brig2', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg1`] =
                {
                  ...event,
                  label: 'togg1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  label: 'toggl',
                  value: togg2?.value > 0 ? TOGG_VALUE_HIGH : TOGG_VALUE_LOW,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_brigh`] =
                {
                  ...event,
                  label: 'brigh',
                  value: (event?.value + (brig2?.value || 0)) / 2,
                  meta: {
                    isMixed: true,
                  },
                }

              break
            }
            case 'brig2': {
              const togg1 = getEvent('togg1', event.id)
              const brig1 = getEvent('brig1', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg2`] =
                {
                  ...event,
                  label: 'togg2',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  label: 'toggl',
                  value: togg1?.value > 0 ? TOGG_VALUE_HIGH : TOGG_VALUE_LOW,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_brigh`] =
                {
                  ...event,
                  label: 'brigh',
                  value: (event?.value + (brig1?.value || 0)) / 2,
                  meta: {
                    isMixed: true,
                  },
                }

              break
            }
            case 'togg1': {
              const togg2 = getEvent('togg2', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  id: togg2.id,
                  label: 'toggl',
                  value: (event?.value + (togg2?.value || 0)) / 2,
                }

              break
            }
            case 'togg2': {
              const togg1 = getEvent('togg1', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  id: togg1.id,
                  label: 'toggl',
                  value: (event?.value + (togg1?.value || 0)) / 2,
                }

              break
            }
            case 'tempe': {
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_temp1`] =
                {
                  ...event,
                  label: 'temp1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_temp2`] =
                {
                  ...event,
                  label: 'temp2',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg1`] =
                {
                  ...event,
                  label: 'togg1',
                  value: 100,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg2`] =
                {
                  ...event,
                  label: 'togg2',
                  value: 100,
                }

              break
            }
            case 'temp1': {
              const temp2 = getEvent('temp2', event.id)
              const togg2 = getEvent('togg2', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg1`] =
                {
                  ...event,
                  value: 100,
                  label: 'togg1',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  label: 'toggl',
                  value: togg2?.value > 0 ? TOGG_VALUE_HIGH : TOGG_VALUE_LOW,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_tempe`] =
                {
                  ...event,
                  label: 'tempe',
                  value: (event?.value + (temp2?.value || 0)) / 2,
                  meta: {
                    isMixed: true,
                  },
                }

              break
            }
            case 'temp2': {
              const temp1 = getEvent('temp1', event.id)
              const togg1 = getEvent('togg1', event.id)

              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_togg2`] =
                {
                  ...event,
                  value: 100,
                  label: 'togg2',
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_toggl`] =
                {
                  ...event,
                  label: 'toggl',
                  value: togg1?.value > 0 ? TOGG_VALUE_HIGH : TOGG_VALUE_LOW,
                }
              updatedDevices[`${window?.NETWORK_HOME_NAME}_${event.id}_tempe`] =
                {
                  ...event,
                  label: 'tempe',
                  value: (event?.value + (temp1?.value || 0)) / 2,
                  meta: {
                    isMixed: true,
                  },
                }

              break
            }
            default:
            // Handle other cases as needed
          }
        }

        useEventStore.getState().setState(updatedDevices)
      },
    )

    return () => {
      unsubSpectoda()
    }
  }, [])

  return null
}

/**
 * @deprecated use `useTypedEvents` from `spectoda-core` instead
 */
export const useSpectodaGroupPercentageEvent = (
  eventName: string,
  deviceIds: number[] | number,
  options?: { noAverage?: boolean },
) => {
  if (!Array.isArray(deviceIds)) {
    deviceIds = [deviceIds]
  }

  const { events, avg, max, min, meta } = useSpectodaGroup(
    eventName,
    deviceIds,
    options?.noAverage || false,
  )
  const [tempValue, setTempValue] = useState(avg)

  const emitTempEvent = async (value: number) => {
    setTempValue(value)
  }

  useEffect(() => {
    setTempValue(avg)
  }, [avg])

  const emitEvent = async (value: number) => {
    try {
      await spectoda.emitPercentage(eventName, value, deviceIds)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    tempValue,
    value: avg as number,
    events,
    emitEvent,
    emitTempEvent,
    min,
    max,
    meta,
  }
}

/**
 * @deprecated use `useTypedEvents` from `spectoda-core` instead
 */
export const useSpectodaGroupColorEvent = (
  eventName: string,
  deviceIds: number[] | number,
) => {
  if (!Array.isArray(deviceIds)) {
    deviceIds = [deviceIds]
  }

  const { events, avg, max, min, meta } = useSpectodaGroup(eventName, deviceIds)

  // TODO - implement optimistic updates for tempValue
  const [tempValue, setTempValue] = useState(events[0]?.value)

  const emitTempEvent = async (value: string) => {
    setTempValue(value)
  }

  const emitEvent = async (value: string) => {
    try {
      await spectoda.emitColor(eventName, value, deviceIds)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    tempValue,
    value: (events.length > 0 && events[0]
      ? events[0].value
      : '#000000') as string,
    events,
    emitEvent,
    emitTempEvent,
    min,
    max,
    meta,
  }
}

/** @deprecated use `useTypedEvents` from `spectoda-core` instead */
export const useSpectodaGroupTimestampEvent = (
  eventName: string,
  deviceIds: number[] | number,
) => {
  if (!Array.isArray(deviceIds)) {
    deviceIds = [deviceIds]
  }

  const { events, avg, max, min, meta } = useSpectodaGroup(eventName, deviceIds)

  const value = useMemo(() => {
    return events.length > 0 && events[0] ? events[0].value : 0
  }, [events])

  /** @deprecated use event emitting from `core` instead */
  const emitTempEvent = async (value: number) => {
    // eslint-disable-next-line no-console
    console.warn(
      '`emitTempEvent` is deprecated. Use event emitting from `core` instead.',
    )
  }

  const emitEvent = async (value: number) => {
    try {
      await spectoda.emitTimestamp(eventName, value, deviceIds)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    value,
    events,
    emitEvent,
    emitTempEvent,
    min,
    max,
    meta,
  }
}

/** @deprecated use `useTypedEvents` from `spectoda-core` instead */
export const useSpectodaGroupBooleanEvent = (
  eventName: string,
  deviceIds: number[] | number,
) => {
  if (!Array.isArray(deviceIds)) {
    deviceIds = [deviceIds]
  }

  const { events, avg, max, min, meta } = useSpectodaGroup(eventName, deviceIds)

  const value = useMemo(() => {
    return events.length > 0 && events[0] ? events[0].value : false
  }, [events])

  /** @deprecated use event emitting from `core` instead */
  const emitTempEvent = async (value: boolean) => {
    // eslint-disable-next-line no-console
    console.warn(
      '`emitTempEvent` is deprecated. Use event emitting from `core` instead.',
    )
  }

  const emitEvent = async (value: boolean) => {
    try {
      await spectoda.emitBoolean(eventName, value, deviceIds)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    value,
    events,
    emitEvent,
    emitTempEvent,
    min,
    max,
    meta,
  }
}

/** @deprecated use `useTypedEvents` from `spectoda-core` instead */
export const useSpectodaGroupNumberEvent = (
  eventName: string,
  deviceIds: number[] | number,
) => {
  if (!Array.isArray(deviceIds)) {
    deviceIds = [deviceIds]
  }

  const { events, avg, max, min, meta } = useSpectodaGroup(eventName, deviceIds)

  const value = useMemo(() => {
    return events.length > 0 && events[0] ? events[0].value : 0
  }, [events])

  /** @deprecated use event emitting from `core` instead */
  const emitTempEvent = async (value: number) => {
    // eslint-disable-next-line no-console
    console.warn(
      '`emitTempEvent` is deprecated. Use event emitting from `core` instead.',
    )
  }

  const emitEvent = async (value: number) => {
    try {
      await spectoda.emitNumber(eventName, value, deviceIds)
    } catch (error) {
      console.error(error)
    }
  }

  return {
    value,
    events,
    emitEvent,
    emitTempEvent,
    min,
    max,
    meta,
  }
}
