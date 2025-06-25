import { CONNECTION_STATUS, ConnectionStatus, REMOTECONTROL_STATUS, RemoteControlConnectionStatus } from './connect'
import { ControllerError, ControllerWarning } from './messages'
import { Event } from './event'
import { SpectodaTypes } from './primitives'

type RemoteControlConnectionStatusProps = {
  [K in RemoteControlConnectionStatus]: undefined
}

type ConnectionStatusProps = {
  [K in ConnectionStatus]: undefined
}

type SpectodaAppEventType<T extends string = string> = {
  [K in Uppercase<T>]: T
}

export const SpectodaAppEvents = {
  ...CONNECTION_STATUS,
  ...REMOTECONTROL_STATUS,

  SCAN_RESULTS: 'scan_results',

  PEER_CONNECTED: 'peer_connected',
  PEER_DISCONNECTED: 'peer_disconnected',

  OTA_STATUS: 'ota_status',
  OTA_PROGRESS: 'ota_progress',
  OTA_TIMELEFT: 'ota_timeleft',

  TNGL_UPDATE: 'tngl_update',

  EMITTED_EVENTS: 'emittedevents',
  EVENT_STATE_UPDATES: 'eventstateupdates',

  NETWORK_ERROR: 'networkerror',
  NETWORK_WARNING: 'networkwarning',

  /** @private for spectoda-js internal use only */
  PRIVATE_CONNECTED: '#connected',
  /** @private for spectoda-js internal use only */
  PRIVATE_DISCONNECTED: '#disconnected',
  /** @private for spectoda-js internal use only */
  PRIVATE_WASM_CLOCK: '#wasm_clock',
  /** @private for spectoda-js internal use only */
  PRIVATE_WASM_REQUEST: '#wasm_request',
  /** @private for spectoda-js internal use only */
  PRIVATE_WASM_EXECUTE: '#wasm_execute',
} as const satisfies SpectodaAppEventType

type PropsMap = RemoteControlConnectionStatusProps &
  ConnectionStatusProps & {
    // TODO for future payload key: `json`
    [SpectodaAppEvents.SCAN_RESULTS]: string

    // TODO for future payload key: `mac`
    [SpectodaAppEvents.PEER_CONNECTED]: string

    // TODO for future payload key: `mac`
    [SpectodaAppEvents.PEER_DISCONNECTED]: string

    // TODO for future payload key: `status`
    [SpectodaAppEvents.OTA_STATUS]: 'begin' | 'success' | 'fail'

    // TODO for future payload key: `percentageProgress`
    [SpectodaAppEvents.OTA_PROGRESS]: number

    // TODO for future payload key: `timeleftSeconds`
    [SpectodaAppEvents.OTA_TIMELEFT]: number

    [SpectodaAppEvents.TNGL_UPDATE]: {
      tngl_bytes: SpectodaTypes['TnglBytes']
      used_ids: SpectodaTypes['UsedIds']
    }

    // TODO for future payload key: `events`
    [SpectodaAppEvents.EVENT_STATE_UPDATES]: Event[]

    // TODO for future payload key: `events`
    [SpectodaAppEvents.EMITTED_EVENTS]: Event[]

    [SpectodaAppEvents.NETWORK_ERROR]: ControllerError
    [SpectodaAppEvents.NETWORK_WARNING]: ControllerWarning

    /** @private event */
    [SpectodaAppEvents.PRIVATE_CONNECTED]: undefined

    /** @private event */
    [SpectodaAppEvents.PRIVATE_DISCONNECTED]: undefined

    /** @private event */
    [SpectodaAppEvents.PRIVATE_WASM_CLOCK]: number

    /** @private event */
    [SpectodaAppEvents.PRIVATE_WASM_REQUEST]: Uint8Array

    /** @private event */
    [SpectodaAppEvents.PRIVATE_WASM_EXECUTE]: Uint8Array
  }

export type SpectodaAppEventName = (typeof SpectodaAppEvents)[keyof typeof SpectodaAppEvents]

export type SpectodaAppEventMap = {
  [K in SpectodaAppEventName]: PropsMap[K]
}

export const SPECTODA_APP_EVENTS = Object.freeze(SpectodaAppEvents)
