// TODO Figure out how to make interface Window { ... } work without this empty import
import type {} from './src/types/global'
import { io } from 'socket.io-client'
import customParser from 'socket.io-msgpack-parser'

import { TnglCodeParser } from './SpectodaParser'
import { TimeTrack } from './TimeTrack'
import './TnglReader'
import { TnglReader } from './TnglReader'
import './TnglWriter'
import {
  cssColorToHex,
  detectNode,
  detectSpectodaConnect,
  fetchFirmware,
  hexStringToUint8Array,
  labelToBytes,
  numberToBytes,
  sleep,
  strMacToBytes,
  stringToBytes,
  uint8ArrayToHexString,
} from './functions'
import { logging } from './logging'
import { SpectodaWasm } from './src/SpectodaWasm'
import { tnglDefinitionsFromJsonToTngl } from './src/Preprocessor'
import {
  COMMAND_FLAGS,
  CONNECTORS,
  DEFAULT_CONNECTOR,
  DEFAULT_TIMEOUT,
  NO_NETWORK_KEY,
  NO_NETWORK_SIGNATURE,
  TNGL_SIZE_CONSIDERED_BIG,
} from './src/constants'
import { WEBSOCKET_URL } from './SpectodaWebSocketsConnector'
import './TnglReader'
import './TnglWriter'
import { SpectodaRuntime, allEventsEmitter } from './src/SpectodaRuntime'
import { CPP_EVENT_VALUE_LIMITS as VALUE_LIMITS } from './src/constants/limits'
import { SpectodaAppEventMap, SpectodaAppEventName, SpectodaAppEvents } from './src/types/app-events'
import {
  CONNECTION_STATUS,
  ConnectionStatus,
  ConnectorType,
  REMOTECONTROL_STATUS,
  RemoteControlConnectionStatus,
} from './src/types/connect'
import {
  ControllerInfo,
  Criteria,
  NetworkKey,
  NetworkSignature,
  PcbCode,
  ProductCode,
  TnglBank,
  ValueTypeLabel,
  NetworkStorageData,
} from './src/types/primitives'
import { SpectodaClass } from './src/types/spectodaClass'
import { fetchTnglFromApiById, sendTnglToApi } from './tnglapi'
import { EventStateSchema } from './src/schemas/event'
import { VALUE_TYPES, ValueType } from './src/constants/values'
import {
  ValueTypeColor,
  ValueTypeDate,
  ValueTypeID,
  ValueTypeIDs,
  ValueTypePercentage,
  ValueTypePixels,
  ValueTypeTimestamp,
} from './src/types/values'
import { MainModule } from './src/types/wasm'

import { EventState } from '.'

const MIN_FIRMWARE_LENGTH = 10000
const DEFAULT_RECONNECTION_TIME = 2500
const DEFAULT_RECONNECTION_INTERVAL = 10000

const FW_VERSION_FULL_BYTES = 32
const TNGL_FINGERPRINT_BYTES = 32
const EVENT_STORE_FINGERPRINT_BYTES = 32
const CONFIG_FINGERPRINT_BYTES = 32
const NETWORK_SIGNATURE_BYTES = 16

const ALL_METADATA_BYTES =
  FW_VERSION_FULL_BYTES +
  TNGL_FINGERPRINT_BYTES +
  EVENT_STORE_FINGERPRINT_BYTES +
  CONFIG_FINGERPRINT_BYTES +
  NETWORK_SIGNATURE_BYTES

// TODO - kdyz zavolam spectoda.connect(), kdyz jsem pripojeny, tak nechci aby se do interfacu poslal select
// TODO - kdyz zavolam funkci connect a uz jsem pripojeny, tak vyslu event connected, pokud si myslim ze nejsem pripojeny.
// TODO - "watchdog timer" pro resolve/reject z TC

export class Spectoda implements SpectodaClass {
  #parser: TnglCodeParser

  #uuidCounter: number
  #ownerSignature: NetworkSignature
  #ownerKey: NetworkKey
  #updating: boolean

  #connectionState: ConnectionStatus
  #remoteControlConnectionState: RemoteControlConnectionStatus

  #criteria: Criteria
  #reconnecting: boolean
  #autonomousReconnection: boolean
  #wakeLock: WakeLockSentinel | null | undefined
  #isPrioritizedWakelock: boolean

  #reconnectionIntervalHandle: any

  // ? This is used for getEmittedEvents() to work properly
  #__events: any

  timeline: TimeTrack
  runtime: SpectodaRuntime

  socket: any

  constructor(connectorType: ConnectorType = DEFAULT_CONNECTOR, reconnecting = true) {
    this.#parser = new TnglCodeParser()

    this.#uuidCounter = Math.floor(Math.random() * 0xffffffff)

    this.#ownerSignature = NO_NETWORK_SIGNATURE
    this.#ownerKey = NO_NETWORK_KEY

    this.timeline = new TimeTrack(0, true)
    this.runtime = new SpectodaRuntime(this)
    this.socket = undefined

    if (connectorType !== CONNECTORS.NONE) {
      try {
        this.runtime.assignConnector(connectorType)
      } catch (e) {
        logging.error(e)
      }
    }

    this.#updating = false

    this.#reconnecting = reconnecting ? true : false
    this.#connectionState = CONNECTION_STATUS.DISCONNECTED
    this.#remoteControlConnectionState = REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED

    this.#isPrioritizedWakelock = false
    this.#autonomousReconnection = false
    this.#reconnectionIntervalHandle = undefined
    this.#criteria = []
    this.#__events = undefined

    this.runtime.onConnected = () => {
      logging.debug('> Runtime connected')

      this.#resetReconnectionInterval()
    }

    this.runtime.onDisconnected = () => {
      logging.debug('> Runtime disconnected')

      this.#resetReconnectionInterval()

      if (this.getConnectionState() === CONNECTION_STATUS.CONNECTED && this.#reconnecting) {
        logging.debug(`Reconnecting in ${DEFAULT_RECONNECTION_TIME}ms..`)
        this.#setConnectionState(CONNECTION_STATUS.CONNECTING)

        return sleep(DEFAULT_RECONNECTION_TIME)
          .then(() => {
            return this.#connect(true)
          })
          .then(() => {
            logging.info('Reconnection successful.')
            this.#setConnectionState(CONNECTION_STATUS.CONNECTED)
          })
          .catch((error) => {
            logging.warn('Reconnection failed:', error)
            this.#setConnectionState(CONNECTION_STATUS.DISCONNECTED)
          })
      } else {
        this.#setConnectionState(CONNECTION_STATUS.DISCONNECTED)
      }
    }

    this.#reconnectionIntervalHandle = undefined
    this.#resetReconnectionInterval()
  }

  #resetReconnectionInterval() {
    clearInterval(this.#reconnectionIntervalHandle)

    this.#reconnectionIntervalHandle = setInterval(() => {
      // TODO move this to runtime
      if (
        !this.#updating &&
        this.runtime.connector &&
        this.getConnectionState() === CONNECTION_STATUS.DISCONNECTED &&
        this.#autonomousReconnection
      ) {
        return this.#connect(true).catch((error) => {
          logging.warn(error)
        })
      }
    }, DEFAULT_RECONNECTION_INTERVAL)
  }

  #setRemoteControlConnectionState(remoteControlConnectionState: RemoteControlConnectionStatus) {
    switch (remoteControlConnectionState) {
      case REMOTECONTROL_STATUS.REMOTECONTROL_CONNECTING: {
        if (remoteControlConnectionState !== this.#remoteControlConnectionState) {
          logging.warn('> Spectoda websockets connecting')
          this.#remoteControlConnectionState = remoteControlConnectionState
          this.runtime.emit(SpectodaAppEvents.REMOTECONTROL_CONNECTING)
        }
        break
      }
      case REMOTECONTROL_STATUS.REMOTECONTROL_CONNECTED: {
        if (remoteControlConnectionState !== this.#remoteControlConnectionState) {
          logging.warn('> Spectoda websockets connected')
          this.#remoteControlConnectionState = remoteControlConnectionState
          this.runtime.emit(SpectodaAppEvents.REMOTECONTROL_CONNECTED)
        }
        break
      }
      case REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTING: {
        if (remoteControlConnectionState !== this.#remoteControlConnectionState) {
          logging.warn('> Spectoda websockets disconnecting')
          this.#remoteControlConnectionState = remoteControlConnectionState
          this.runtime.emit(SpectodaAppEvents.REMOTECONTROL_DISCONNECTING)
        }
        break
      }
      case REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED: {
        if (remoteControlConnectionState !== this.#remoteControlConnectionState) {
          logging.warn('> Spectoda websockets disconnected')
          this.#remoteControlConnectionState = remoteControlConnectionState
          this.runtime.emit(SpectodaAppEvents.REMOTECONTROL_DISCONNECTED)
        }
        break
      }
      default: {
        throw `InvalidState: ${remoteControlConnectionState}`
      }
    }
  }

  getRemoteControlConnectionState() {
    return this.#remoteControlConnectionState
  }

  #setConnectionState(connectionState: ConnectionStatus) {
    switch (connectionState) {
      case CONNECTION_STATUS.CONNECTING: {
        if (connectionState !== this.#connectionState) {
          logging.warn('> Spectoda connecting')
          this.#connectionState = connectionState
          this.runtime.emit(SpectodaAppEvents.CONNECTING)
        }
        break
      }
      case CONNECTION_STATUS.CONNECTED: {
        if (connectionState !== this.#connectionState) {
          logging.warn('> Spectoda connected')
          this.#connectionState = connectionState
          this.runtime.emit(SpectodaAppEvents.CONNECTED)
        }
        break
      }
      case CONNECTION_STATUS.DISCONNECTING: {
        if (connectionState !== this.#connectionState) {
          logging.warn('> Spectoda disconnecting')
          this.#connectionState = connectionState
          this.runtime.emit(SpectodaAppEvents.DISCONNECTING)
        }
        break
      }
      case CONNECTION_STATUS.DISCONNECTED: {
        if (connectionState !== this.#connectionState) {
          logging.warn('> Spectoda disconnected')
          this.#connectionState = connectionState
          this.runtime.emit(SpectodaAppEvents.DISCONNECTED)
        }
        break
      }
      default: {
        logging.error('#setConnectionState(): InvalidState')
        throw 'InvalidState'
      }
    }
  }

  getConnectionState() {
    return this.#connectionState
  }

  #setOwnerSignature(ownerSignature: NetworkSignature) {
    const reg = ownerSignature.match(/([\dA-Fa-f]{32})/g)

    if (!reg || reg.length === 0 || !reg[0]) {
      throw 'InvalidSignature'
    }

    this.#ownerSignature = reg[0]
    return true
  }

  #setOwnerKey(ownerKey: NetworkKey) {
    const reg = ownerKey.match(/([\dA-Fa-f]{32})/g)

    if (!reg || reg.length === 0 || !reg[0]) {
      throw 'InvalidKey'
    }

    this.#ownerKey = reg[0]
    return true
  }

  /**
   * Calls WakeLock API to prevent the screen from turning off.
   * TODO: Move to different file. Not a spectoda.js concern.
   */
  requestWakeLock(prioritized = false) {
    logging.debug(`Spectoda::requestWakeLock(prioritized=${prioritized})`)

    logging.info('> Activating wakeLock...')

    if (prioritized) {
      this.#isPrioritizedWakelock = true
    }

    try {
      if (detectNode()) {
        // NOP
      } else if (detectSpectodaConnect()) {
        window.flutter_inappwebview.callHandler('setWakeLock', true)
      } else {
        navigator.wakeLock
          .request('screen')
          .then((Wakelock) => {
            logging.info('Web Wakelock activated.')
            this.#wakeLock = Wakelock
          })
          .catch(() => {
            logging.warn('Web Wakelock activation failed.')
          })
      }
      return Promise.resolve()
    } catch (e) {
      return Promise.reject(e)
    }
  }

  /**
   * Calls WakeLock API to release the screen from being prevented from turning off.
   * TODO: Move to different file. Not a spectoda.js concern.
   */
  releaseWakeLock(prioritized = false) {
    logging.debug(`Spectoda::releaseWakeLock(prioritized=${prioritized})`)

    logging.info('> Deactivating wakeLock...')

    if (prioritized) {
      this.#isPrioritizedWakelock = false
    } else if (this.#isPrioritizedWakelock) {
      return Promise.resolve()
    }

    try {
      if (detectNode()) {
        // NOP
      } else if (detectSpectodaConnect()) {
        window.flutter_inappwebview.callHandler('setWakeLock', false)
      } else {
        this.#wakeLock
          ?.release()
          .then(() => {
            logging.info('Web Wakelock deactivated.')
            this.#wakeLock = null
          })
          .catch(() => {
            logging.warn('Web Wakelock deactivation failed.')
          })
      }
      return Promise.resolve()
    } catch (e) {
      return Promise.reject(e)
    }
  }

  /**
   * Alias for assignConnector
   * Assigns with which "connector" you want to `connect`. E.g. "webbluetooth", "serial", "websockets", "simulated".
   * The name `connector` legacy term, but we don't have a better name for it yer.
   * TODO: @immakermatty remove assignConnector and make it a parameter of connect()
   * For now this is handled via spectoda-core
   */
  setConnector(connector_type: ConnectorType, connector_param = null) {
    return this.runtime.assignConnector(connector_type, connector_param)
  }

  /**
   * ! Useful
   * TODO: @immakermatty remove assignConnector and make it a parameter of connect()
   * For now this is handled via spectoda-core
   * @alias this.setConnector
   */
  assignConnector(connector_type: ConnectorType, connector_param = null) {
    return this.setConnector(connector_type, connector_param)
  }

  /**
   * @alias this.setConnector
   */
  assignOwnerSignature(ownerSignature: NetworkSignature) {
    return this.#setOwnerSignature(ownerSignature)
  }

  /**
   * @deprecated
   * Set the network `signature` (deprecated terminology "ownerSignature").
   */
  setOwnerSignature(ownerSignature: NetworkSignature) {
    return this.#setOwnerSignature(ownerSignature)
  }

  /**
   * @deprecated
   * Get the network `signature` (deprecated terminology "ownerSignature").
   */
  getOwnerSignature(): NetworkSignature {
    return this.#ownerSignature
  }

  /**
   * @alias this.setOwnerKey
   */
  assignOwnerKey(ownerKey: NetworkKey) {
    return this.#setOwnerKey(ownerKey)
  }

  /**
   * Sets the network `key` (deprecated terminology "ownerKey").
   */
  setOwnerKey(ownerKey: NetworkKey) {
    return this.#setOwnerKey(ownerKey)
  }

  /**
   * Get the network `key` (deprecated terminology "ownerKey").
   */
  getOwnerKey(): NetworkKey {
    return this.#ownerKey
  }

  /**
   * ! Useful
   * Initializes Remote control (RC) receiving.
   * ! Remote control needs a complete refactor and needs to be moved from Spectoda.js to a different file. Remote control should not connect based on network signature and key.
   *
   * @param {Object} options
   * @param {string?} options.signature - The network signature.
   * @param {string?} options.key - The network key.
   * @param {Object} [options.meta] - info about the receiver
   * @param {boolean?} [options.sessionOnly] - Whether to enable remote control for the current session only.
   */
  async enableRemoteControl({
    signature,
    key,
    sessionOnly,
    meta,
  }: {
    signature: string
    key: string
    sessionOnly: boolean
    meta: object
  }) {
    logging.debug(
      `Spectoda::enableRemoteControl(signature=${signature}, key=${key}, sessionOnly=${sessionOnly}, meta=${JSON.stringify(
        meta,
      )})`,
    )

    logging.info('> Enabling Remote Control Receiver...')

    // TODO refactor to async/await for less nesting
    //* Added by @immakermatty to automatically connect the sender app if the receiver is connected
    const postJoinActions = () => {
      {
        //* if the receiver is connected, emit the connected event on the sender
        //* so that sender will switch to connected state
        this.connected() ////
          .then((connectedCriteria) => {
            if (connectedCriteria) {
              //* emit the connected event to the sender app
              this.emit(SpectodaAppEvents.CONNECTED, null)
            } else {
              //* emit the disconnected event to the sender app
              this.emit(SpectodaAppEvents.DISCONNECTED, null)
            }
          })
          .then(() => {
            //* reload tngl to get all event state updates from the receiver
            this.reloadTngl()
          })
          .catch((err: any) => {
            logging.error('RC Receiver postJoinActions() error:', err)
          })
      }
    }

    if (this.socket) {
      this.socket.removeAllListeners() // Removes all listeners attached to the socket
      this.socket.disconnect()

      for (const listener of this.socket?.___SpectodaListeners) {
        listener()
      }
    }

    this.socket = io(WEBSOCKET_URL, {
      parser: customParser,
    })

    this.socket.connect()
    this.requestWakeLock(true)

    // TODO [DEV-3521] Remote control refactor: Remove this function
    const setConnectionSocketData = async () => {
      // const peers = await this.getConnectedPeersInfo();
      // logging.debug("peers", peers);
      // this.socket.emit("set-connection-data", peers);
      this.socket.emit('set-meta-data', meta)
    }

    this.socket.___SpectodaListeners = [
      // TODO [DEV-3521] Remote control refactor: Remove this function
      this.on(SpectodaAppEvents.CONNECTED, async () => {
        setConnectionSocketData()
      }),
      // TODO [DEV-3521] Remote control refactor: Remove this function
      this.on(SpectodaAppEvents.DISCONNECTED, () => {
        this.socket.emit('set-connection-data', null)
      }),
      allEventsEmitter.on('on', ({ name, args }: { name: string; args: any[] }) => {
        try {
          logging.verbose('event', name, args)
          // circular json, function ... can be issues, that's why wrapped
          this.socket.emit('event', { name, args })
        } catch (err) {
          console.error(err)
        }
      }),
    ]

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line no-undef
    globalThis.allEventsEmitter = allEventsEmitter

    this.socket.on('func', async (payload: any, callback: any) => {
      if (!callback) {
        logging.error('No callback provided')
        return
      }

      const { functionName, arguments: args } = payload

      // call internal class function await this[functionName](...args)

      // call internal class function
      try {
        if (functionName === 'debug') {
          logging.debug(...args)
          return callback({
            status: 'success',
            message: 'debug',
            payload: args,
          })
        }
        if (functionName === 'assignOwnerSignature' || functionName === 'assignOwnerKey') {
          return callback({
            status: 'success',
            message: 'assign key/signature is ignored on remote.',
          })
        }

        // TODO rename to updateControllerFirmware
        if (functionName === 'updateDeviceFirmware' || functionName === 'updateNetworkFirmware') {
          if (Array.isArray(args?.[0])) {
            // TODO Add types
            args[0] = new Uint8Array(args[0] as any)
          } else if (typeof args?.[0] === 'object') {
            const arr: any = Object.values(args[0])
            const uint8Array = new Uint8Array(arr)

            args[0] = uint8Array
          }
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const result = await this[functionName](...args)

        callback({ status: 'success', result })
      } catch (e) {
        logging.error(e)
        callback({ status: 'error', error: e })
      }
    })

    return await new Promise((resolve, reject) => {
      this.socket.on('disconnect', () => {
        logging.info('> RC Receiver disconnected')

        this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED)
      })

      this.socket.on('connect', async () => {
        logging.info('> RC Receiver connected')

        logging.setLogCallback((...e) => {
          console.log(...e)
          this.socket.emit('event', { name: 'log', args: e })
        })

        logging.setWarnCallback((...e) => {
          console.warn(...e)
          this.socket.emit('event', { name: 'log-warn', args: e })
        })

        logging.setErrorCallback((...e) => {
          console.error(...e)
          this.socket.emit('event', { name: 'log-error', args: e })
        })

        if (sessionOnly) {
          // Handle session-only logic
          const response = await this.socket.emitWithAck('join-session', null)
          const roomNumber = response?.roomNumber

          if (response?.status === 'success') {
            this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_CONNECTED)

            // TODO refactor when refactoring Remote Control. Needs to be rethought and reimplemented
            setConnectionSocketData()

            logging.debug('Remote control session joined successfully', roomNumber)

            resolve({ status: 'success', roomNumber })
          } else {
            this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED)
            logging.debug('Remote control session join failed, does not exist')
          }
        } else if (signature) {
          // Handle signature-based logic
          this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_CONNECTING)

          await this.socket
            .emitWithAck('join', { signature, key })
            .then(() => {
              logging.info('> RC Receiver joined')
              this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_CONNECTED)
              postJoinActions()

              // TODO [DEV-3521] Remote control refactor: Remove this function
              setConnectionSocketData()

              resolve({ status: 'success' })
            })
            .catch((e: any) => {
              this.#setRemoteControlConnectionState(REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED)
              reject(e)
            })
        }
      })
    })
  }

  /**
   * ! Useful
   * Disconnects Remote Control receiving. More info about remote control in `enableRemoteControl`.
   */
  disableRemoteControl() {
    logging.setLogCallback(console.log)
    logging.setWarnCallback(console.warn)
    logging.setErrorCallback(console.error)

    logging.debug('Spectoda::disableRemoteControl()')

    logging.info('> Disableing Remote Control Receiver')

    this.releaseWakeLock(true)
    this.socket?.disconnect()
  }

  // valid UUIDs are in range [1..4294967295] (32-bit unsigned number)
  #getUUID() {
    if (this.#uuidCounter >= 4294967295) {
      this.#uuidCounter = 0
    }

    return ++this.#uuidCounter
  }

  /**
   * ! Useful
   * @name addEventListener
   * @param {string} event
   * @param {Function} callback
   *
   * events: "disconnected", "connected"
   *
   * all events: event.target === the sender object (SpectodaWebBluetoothConnector)
   * event "disconnected": event.reason has a string with a disconnect reason
   *
   * TODO I think this should expose an "off" method to remove the listener
   * @returns {Function} unbind function
   */
  addEventListener<K extends keyof SpectodaAppEventMap>(event: K, callback: (props: SpectodaAppEventMap[K]) => void) {
    return this.runtime.addEventListener(event, callback)
  }

  /**
   * @alias this.addEventListener
   */
  on<K extends keyof SpectodaAppEventMap>(event: K, callback: (props: SpectodaAppEventMap[K]) => void) {
    return this.runtime.on(event, callback)
  }

  /**
   * ! Useful
   * Scans for controllers that match the given criteria around the user.
  
    *
    * TODO: Fix types!!! Returned value should be in format:
    * Array<{
    *   commissionable: boolean;
    *   fw: string;
    *   name: string;
    *   network: string;
    *   product: number;
    *   rssi: number;
    * }>
    *

  */
  scan(scan_criteria: object[] = [{}], scan_period: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT) {
    logging.debug(`Spectoda::scan(scan_criteria=${JSON.stringify(scan_criteria)}, scan_period=${scan_period})`)

    logging.info('> Scanning for Controllers...')
    return this.runtime.scan(scan_criteria, scan_period)
  }

  #connect(
    autoConnect: boolean,
    scanPeriod: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    scanTimeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ) {
    logging.debug(`Spectoda::#connect(autoConnect=${autoConnect})`)

    this.#setConnectionState(CONNECTION_STATUS.CONNECTING)

    logging.info('> Selecting Controller...')

    return (
      autoConnect
        ? this.runtime.autoSelect(this.#criteria, scanPeriod, scanTimeout)
        : this.runtime.userSelect(this.#criteria, scanTimeout)
    )
      .then(() => {
        // ? eraseTimeline to discard Timeline from the previous session
        return this.eraseTimeline()
      })
      .then(() => {
        logging.info('> Connecting to the selected Controller...')

        return this.runtime.connect()
      })
      .then((connectedControllerCriteria) => {
        logging.info('> Synchronizing $APP Controller State...')

        // ! this whole section is a workaround to "allow" one spectoda-js instance to cache data of multiple Networks
        // ! which will be removed in version 0.13, where each spectoda-js instance is equal to only one Network
        // ! so please do not try to optimize or refactor this code, it will be removed
        return this.readControllerInfo()
          .then(async (info) => {
            // 0.12.4 and up implements readControllerInfo() which give a hash (fingerprint) of
            // TNGL and EventStore on the Controller. If the TNGL and EventStore
            // FP cashed in localstorage are equal, then the app does not need to
            // "fetch" the TNGL and EventStore from Controller.

            const tnglFingerprint = this.runtime.spectoda_js.getTnglFingerprint()
            const eventStoreFingerprint = this.runtime.spectoda_js.getEventStoreFingerprint()
            const networkStorageFingerprint = this.runtime.spectoda_js.getNetworkStorageFingerprint()

            logging.debug('APP tnglFingerprint', tnglFingerprint)
            logging.debug('ESP tnglFingerprint', info.tnglFingerprint)
            logging.debug('APP eventStoreFingerprint', eventStoreFingerprint)
            logging.debug('ESP eventStoreFingerprint', info.eventStoreFingerprint)
            logging.debug('APP networkStorageFingerprint', networkStorageFingerprint)
            logging.debug('ESP networkStorageFingerprint', info.networkStorageFingerprint)

            // First erase in localstorage
            if (info.tnglFingerprint !== tnglFingerprint) {
              this.runtime.spectoda_js.eraseTngl()
            }

            if (info.eventStoreFingerprint !== eventStoreFingerprint) {
              this.runtime.spectoda_js.eraseHistory()
            }

            if (info.networkStorageFingerprint !== networkStorageFingerprint) {
              this.runtime.spectoda_js.eraseNetworkStorage()
            }

            // Then read from Controller
            if (info.tnglFingerprint !== tnglFingerprint) {
              // "fetch" the TNGL from Controller to App localstorage
              // ! do not await to avoid blocking the connection process and let the TNGL sync in the background
              this.syncTngl().catch((e) => {
                logging.debug('TNGL sync after connection failed:', e)
              })
            }

            if (info.eventStoreFingerprint !== eventStoreFingerprint) {
              // "fetch" the EventStore from Controller to App localstorage
              // ! do not await to avoid blocking the connection process and let the EventStore sync in the background
              this.syncEventHistory().catch((e) => {
                logging.debug('EventStore sync after connection failed:', e)
              })
            }

            // ! For FW 0.12 on every connection, force sync timeline to day time
            // ! do not await to avoid blocking the connection process and let the Timeline sync in the background
            this.syncTimelineToDayTime().catch((e) => {
              logging.debug('Timeline sync after connection failed:', e)
            })
          }) //
          .catch(async (e) => {
            logging.error('Reading controller info after connection failed:', e)

            // App connected to FW that does not support readControllerInfo(),
            // so remove cashed TNGL and EventStore (EventHistory) from localstogare
            // and read it from the Controller

            // first clean all
            this.runtime.spectoda_js.eraseTngl()
            this.runtime.spectoda_js.eraseHistory()
            this.runtime.spectoda_js.eraseNetworkStorage()

            // "fetch" the TNGL from Controller to App localstorage
            await this.syncTngl().catch((e) => {
              logging.error('TNGL sync after connection failed:', e)
            })

            // "fetch" the EventStore from Controller to App localstorage
            await this.syncEventHistory().catch((e) => {
              logging.error('EventStore sync after connection failed:', e)
            })

            // ! For FW 0.12 on every connection, force sync timeline to day time
            await this.syncTimelineToDayTime().catch((e) => {
              logging.error('Timeline sync after connection failed:', e)
            })
          }) //
          .then(() => {
            return this.runtime.connected()
          })
          .then((connected) => {
            return { connected, criteria: connectedControllerCriteria }
          })
      }) //
      .then(({ connected, criteria }) => {
        if (!connected) {
          throw 'ConnectionFailed'
        }
        this.#setConnectionState(CONNECTION_STATUS.CONNECTED)
        return criteria
      })
      .catch((error) => {
        logging.error('Error during connect():', error)

        this.#setConnectionState(CONNECTION_STATUS.DISCONNECTED)

        if (error) {
          throw error
        } else {
          throw 'ConnectionFailed'
        }
      })
  }

  /**
   * ! Useful
   * Connects to a controller that matches the given criteria.
   * In web environment, this launches the "Select Device" dialog.
   * If connection is already established, it will first disconnect and then connect again.
   *
   * To connect to ANY controller, use `spectoda.connect(null, true, null, null, true)`
   * The option to connect to ANY controller will be deprecated in Spectoda FW V1, you should only be able to connect to a controller whose `signature` and `key` you enter.
   *
   * TODO REFACTOR to use only one criteria object instead of this param madness
   */
  connect(
    criteria: Criteria,
    autoConnect = true,
    ownerSignature: NetworkSignature = '',
    ownerKey: NetworkKey = '',
    connectAny = false,
    fwVersion = '',
    autonomousReconnection = false,
    overrideConnection = false,
  ) {
    logging.debug(
      `Spectoda::connect(criteria=${JSON.stringify(
        criteria,
      )}, autoConnect=${autoConnect}, ownerSignature=${ownerSignature}, ownerKey=${ownerKey}, connectAny=${connectAny}, fwVersion=${fwVersion}, autonomousReconnection=${autonomousReconnection}, overrideConnection=${overrideConnection})`,
    )

    this.#autonomousReconnection = autonomousReconnection

    if (!overrideConnection && this.getConnectionState() === CONNECTION_STATUS.CONNECTING) {
      return Promise.reject('ConnectingInProgress')
    }

    if (ownerSignature) {
      this.#setOwnerSignature(ownerSignature)
    }

    if (ownerKey) {
      this.#setOwnerKey(ownerKey)
    }

    // if criteria is object or array of obects
    if (criteria && typeof criteria === 'object') {
      // if criteria is not an array, make it an array
      if (!Array.isArray(criteria)) {
        criteria = [criteria]
      }
    }
    //
    else {
      criteria = [{}]
    }

    if (!connectAny) {
      // add ownerSignature to each criteria
      for (const criterion of criteria) {
        criterion.network = this.#ownerSignature
      }
    }

    if (typeof fwVersion == 'string' && /(!?)(\d+).(\d+).(\d+)/.test(fwVersion)) {
      for (const criterion of criteria) {
        criterion.fw = fwVersion
      }
    }

    this.#criteria = criteria

    return this.#connect(autoConnect)
  }

  /**
   * ! Useful
   * Disconnects from the connected controller.
   */
  disconnect() {
    logging.debug('Spectoda::disconnect()')

    this.#autonomousReconnection = false

    logging.info('> Disconnecting controller...')

    if (this.getConnectionState() === CONNECTION_STATUS.DISCONNECTED) {
      logging.warn('> Controller already disconnected')
      return Promise.resolve()
    }

    this.#setConnectionState(CONNECTION_STATUS.DISCONNECTING)

    return this.runtime.disconnect()
  }

  /**
   * Used only for debugging
   * TODO: @immakermatty rename to isConnected()
   * TODO: @immakermatty shoudl return Promise<boolean>
   */
  connected() {
    return this.getConnectionState() === CONNECTION_STATUS.CONNECTED ? this.runtime.connected() : Promise.resolve(null)
  }

  /**
   * ! Useful
   * Cancels the current connect or scan operation.
   */
  cancel() {
    logging.debug('Spectoda::cancel()')

    logging.info('> Cancelling connect and scan operations...')

    return this.runtime.cancel()
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * ! Useful
   * Preprocesses TNGL code by handling API injections, removing comments, minifying BERRY code, replacing specific patterns within BERRY code, and handling #define statements.
   * Happens
   *
   * @param tngl_code The TNGL code as a string.
   * @returns The preprocessed TNGL code.
   */
  async preprocessTngl(tngl_code: string) {
    logging.debug(`Spectoda::preprocessTngl(tngl_code.length=${tngl_code.length})`)
    logging.verbose('tngl_code', tngl_code)

    logging.info('> Preprocessing TNGL code...')

    /**
     * Formats a value according to its type for TNGL usage.
     * TODO move this function to some kind of utils?
     *
     * @param type The numeric type code
     * @param rawValue The raw value as given in the event
     * @returns The correctly formatted TNGL-compatible string
     */
    function formatValue(type: ValueType, rawValue: any) {
      switch (type) {
        case VALUE_TYPES.COLOR: {
          // Ensure a leading "#" and normalize to lowercase
          // e.g. "bf1d1d" -> "#bf1d1d"
          //      "#00FF0a" -> "#00ff0a"
          const colorStr = String(rawValue).replace(/^#/, '').toLowerCase()

          return `#${colorStr}`
        }
        case VALUE_TYPES.LABEL:
          // e.g. "evt" -> "$evt"
          return `$${rawValue}`
        case VALUE_TYPES.PERCENTAGE:
          // Keep floating points, e.g. -20.34 => "-20.34%"
          // parseFloat to ensure a valid numeric string (but keep decimals if present)
          return `${parseFloat(rawValue)}%`
        case VALUE_TYPES.TIMESTAMP:
          // No floating points; parse as integer, then add "ms"
          // e.g. 1000.123 => "1000ms"
          return `${parseInt(rawValue, 10)}ms`
        case VALUE_TYPES.NULL:
          return 'null'
        case VALUE_TYPES.UNDEFINED:
          return 'undefined'
        case VALUE_TYPES.BOOLEAN:
          // e.g. true => "true", false => "false"
          return String(rawValue)
        case VALUE_TYPES.PIXELS:
          // No floating points; parse as integer, then add "px"
          return `${parseInt(rawValue, 10)}px`
        case VALUE_TYPES.NUMBER:
          // No floating points; parse as integer
          return String(parseInt(rawValue, 10))
        case VALUE_TYPES.DATE:
          // Leave the date string as-is, e.g. "2023-09-21"
          return String(rawValue)
        default:
          // Fallback for any unrecognized type
          return String(rawValue)
      }
    }

    /**
     * Helper function to parse timestamp strings and convert them to total milliseconds/tics.
     * TODO move this function to some kind of utils?
     *
     * @param value The timestamp string (e.g., "1.2d+9h2m7.2s-123t").
     * @returns The total time in milliseconds/tics.
     */
    function computeTimestamp(value: string): number {
      if (!value) {
        return 0 // Equivalent to CONST_TIMESTAMP_0
      }

      value = value.trim()

      const timestampRegex = /([+-]?(\d+\.\d+|\d+|\.\d+))\s*(d|h|m(?!s)|s|ms|t)/gi
      let match
      let total = 0

      while ((match = timestampRegex.exec(value)) !== null) {
        const number = parseFloat(match[1])
        const unit = match[3].toLowerCase()

        switch (unit) {
          case 'd': {
            total += number * 86400000 // 24*60*60*1000
            break
          }
          case 'h': {
            total += number * 3600000 // 60*60*1000
            break
          }
          case 'm': {
            total += number * 60000 // 60*1000
            break
          }
          case 's': {
            total += number * 1000 // 1000
            break
          }
          case 'ms':
          case 't': {
            total += number
            break
          }
          default: {
            logging.error('Error while parsing timestamp: Unknown unit', unit)
            break
          }
        }
      }

      if (total >= VALUE_LIMITS.TIMESTAMP_MAX) {
        return VALUE_LIMITS.TIMESTAMP_MAX // Equivalent to CONST_TIMESTAMP_INFINITY
      } else if (total <= VALUE_LIMITS.TIMESTAMP_MIN) {
        return VALUE_LIMITS.TIMESTAMP_MIN // Equivalent to CONST_TIMESTAMP_MINUS_INFINITY
      } else if (total === 0) {
        return 0 // Equivalent to CONST_TIMESTAMP_0
      } else {
        return Math.round(total) // Ensure it's an integer (int32_t)
      }
    }

    /**
     * Helper function to minify BERRY code by removing # comments, specific patterns, and unnecessary whitespace.
     * TODO move this function to some kind of utils?
     *
     * @param berryCode The BERRY code to minify.
     * @returns The minified BERRY code.
     */
    function preprocessBerry(berryCode: string): string {
      let minified = berryCode

      // Step 0: Determine flags
      let flag_no_minify = false
      let flag_minify = false

      if (minified.includes('@no-minify')) {
        minified = minified.replace('@no-minify', '')
        flag_no_minify = true
      }

      if (minified.includes('@minify')) {
        minified = minified.replace('@minify', '')
        flag_minify = true
      }

      /**
       * Step 1: Define the enum constants to replace in Berry code
       *
       * This creates a mapping of constant names to their numeric values
       * that will be used to replace occurrences in the Berry code during minification.
       *
       * Two types of constants are defined:
       *
       * a. Value type constants from VALUE_TYPES:
       *    - 'NUMBER' will be replaced with '29'
       *    - 'PERCENTAGE' will be replaced with '30'
       *    - 'LABEL' will be replaced with '31'
       *    - 'TIMESTAMP' will be replaced with '32'
       *    - 'BOOLEAN' will be replaced with '2'
       *    - etc.
       *
       * b. Device ID constants (ID0-ID255):
       *    - 'ID0' will be replaced with '0'
       *    - 'ID1' will be replaced with '1'
       *    - 'ID2' will be replaced with '2'
       *    - And so on up to ID255
       *
       * This allows Berry scripts to use readable constant names while
       * the minified version uses the actual numeric values for better performance.
       */
      const berryDefines: { [key: string]: string } = {}

      // a. Keys of VALUE_TYPES as string keys in berryDefines are being replaced with their numeric values
      Object.keys(VALUE_TYPES).forEach((key) => {
        berryDefines[key] = VALUE_TYPES[key as keyof typeof VALUE_TYPES].toString()
      })

      // b. ID0-ID255 constants are being replaced with their numeric values
      for (let i = 0; i <= 255; i++) {
        berryDefines[`ID${i}`] = i.toString()
      }

      // Step 2: First pass - Remove comments while preserving string literals
      let result = ''
      let i = 0
      let inSingleQuoteString = false
      let inDoubleQuoteString = false
      let inLineComment = false
      let inMultilineComment = false
      let escaped = false

      while (i < minified.length) {
        const char = minified[i]
        const nextChar = i + 1 < minified.length ? minified[i + 1] : ''

        // Handle escape sequences in strings
        if (escaped) {
          if (inSingleQuoteString || inDoubleQuoteString) {
            result += char
          }
          escaped = false
          i++
          continue
        }

        if (char === '\\' && (inSingleQuoteString || inDoubleQuoteString)) {
          result += char
          escaped = true
          i++
          continue
        }

        // Handle string boundaries
        if (char === '"' && !inSingleQuoteString && !inMultilineComment && !inLineComment) {
          inDoubleQuoteString = !inDoubleQuoteString
          result += char
          i++
          continue
        }

        if (char === "'" && !inDoubleQuoteString && !inMultilineComment && !inLineComment) {
          inSingleQuoteString = !inSingleQuoteString
          result += char
          i++
          continue
        }

        // Inside strings, just copy characters
        if (inSingleQuoteString || inDoubleQuoteString) {
          result += char
          i++
          continue
        }

        // Handle comments
        if (char === '#' && nextChar === '-' && !inLineComment && !inMultilineComment) {
          inMultilineComment = true
          i += 2 // Skip '#-'
          continue
        }

        if (char === '-' && nextChar === '#' && inMultilineComment) {
          inMultilineComment = false
          i += 2 // Skip '-#'
          continue
        }

        if (char === '#' && !inMultilineComment && !inLineComment) {
          inLineComment = true
          i++
          continue
        }

        if ((char === '\n' || char === '\r') && inLineComment) {
          inLineComment = false
          result += char // Keep the newline
          i++
          continue
        }

        // Skip characters in comments
        if (inLineComment || inMultilineComment) {
          i++
          continue
        }

        // Add non-comment characters
        result += char
        i++
      }

      minified = result

      // Step 3: Now apply the pattern replacements (after comments are removed)
      // // // Pattern A: Hex Color Codes - /#[0-9a-f]{6}/i
      // // const colorRegex = /#([\da-f]{6})/gi

      // // minified = minified.replace(colorRegex, (match, p1) => {
      // //   return `Value.Color("${p1.toLowerCase()}")`
      // // })

      // Pattern B: Timestamps - /([+-]?(\d+\.\d+|\d+|\.\d+))(d|h|m(?!s)|s|ms|t)\b/gi
      const timestampRegex = /([+-]?(?:\d+\.\d+|\d+|\.\d+))(d|h|m(?!s)|s|ms|t)\b/gi

      minified = minified.replace(timestampRegex, (match) => {
        const milliseconds = computeTimestamp(match)

        return `Value.Timestamp(${milliseconds})`
      })

      // // // Pattern C: Labels - /\$[\w]+/
      // // const labelRegex = /\$(\w+)/g

      // // minified = minified.replace(labelRegex, (match, p1) => {
      // //   return `Value.Label("${p1}")`
      // // })

      // Pattern D: Percentages - /[+-]?\d+(\.\d+)?%/
      const percentageRegex = /([+-]?\d+(\.\d+)?)%/g

      minified = minified.replace(percentageRegex, (match, p1) => {
        return `Value.Percentage(${parseFloat(p1)})`
      })

      // // // Pattern F: null value
      // // const nullRegex = /\bnull\b/g

      // // minified = minified.replace(nullRegex, () => {
      // //   return 'Value.Null()'
      // // })

      // Step 4: Third pass - Replace enum constants with their values (only outside strings)
      result = ''
      i = 0
      inSingleQuoteString = false
      inDoubleQuoteString = false
      escaped = false
      let token = ''

      while (i < minified.length) {
        const char = minified[i]

        // Handle escape sequences in strings
        if (escaped) {
          result += char
          escaped = false
          i++
          continue
        }

        if (char === '\\' && (inSingleQuoteString || inDoubleQuoteString)) {
          result += char
          escaped = true
          i++
          continue
        }

        // Handle string boundaries
        if (char === '"' && !inSingleQuoteString) {
          inDoubleQuoteString = !inDoubleQuoteString
          result += char
          i++
          continue
        }

        if (char === "'" && !inDoubleQuoteString) {
          inSingleQuoteString = !inSingleQuoteString
          result += char
          i++
          continue
        }

        // Inside strings, just copy characters
        if (inSingleQuoteString || inDoubleQuoteString) {
          result += char
          i++
          continue
        }

        // If the character is alphanumeric or underscore, it could be part of an identifier
        if (/[A-Za-z0-9_]/.test(char)) {
          token += char
          i++
        } else {
          // Check if the token is a defined constant
          if (token && token in berryDefines) {
            result += berryDefines[token]
          } else if (token) {
            result += token
          }

          // Add the current character
          result += char
          token = ''
          i++
        }
      }

      // Handle any remaining token
      if (token && token in berryDefines) {
        result += berryDefines[token]
      } else if (token) {
        result += token
      }

      minified = result

      // Step 5: Fix any remaining ID references in strings
      // This ensures that "ID1" in string literals like "<EventState $test[ID1]: <Value 42>>" is preserved
      minified = minified.replace(/(\[)ID(\d+)(\])/g, '$1ID$2$3')

      // Step 6: Remove unnecessary semicolons
      minified = minified.replace(/;+/g, ' ')

      // Step 7: Minify variable names if @minify flag is present
      if (flag_minify && !flag_no_minify) {
        // Set to store all local variable names found
        const localVars = new Set<string>()

        // Extract variable declarations with "var"
        const varRegex = /var\s+([A-Za-z_][A-Za-z0-9_]*)/g
        let match

        while ((match = varRegex.exec(minified)) !== null) {
          localVars.add(match[1])
        }

        // Extract loop variables from "for" loops
        const forRegex = /for\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g

        while ((match = forRegex.exec(minified)) !== null) {
          localVars.add(match[1])
        }

        // Create short name generator
        function* shortNameGenerator() {
          const letters = 'abcdefghijklmnopqrstuvwxyz'
          let length = 1

          while (true) {
            const max = Math.pow(letters.length, length)

            for (let i = 0; i < max; i++) {
              let name = ''
              let num = i

              for (let j = 0; j < length; j++) {
                name = letters[num % letters.length] + name
                num = Math.floor(num / letters.length)
              }
              yield name
            }
            length++
          }
        }

        // Build mapping of original names to minified names
        const gen = shortNameGenerator()
        const mapping: { [key: string]: string } = {}

        for (const origVar of localVars) {
          mapping[origVar] = gen.next().value as string
        }

        // Replace all occurrences of the variables, but not within strings
        for (const [orig, min] of Object.entries(mapping)) {
          // This regex matches the variable name only when it's not inside quotes
          const idRegex = new RegExp(`\\b${orig}\\b(?=(?:[^"']*["'][^"']*["'])*[^"']*$)`, 'g')

          minified = minified.replace(idRegex, min)
        }
      }

      // Step 8: Remove spaces around specific characters (if not @no-minify)
      if (!flag_no_minify) {
        // Remove spaces before and after specific characters
        const charsToRemoveSpaceAround = [
          ';',
          ',',
          '{',
          '}',
          '(',
          ')',
          '=',
          '<',
          '>',
          '+',
          '-',
          '*',
          '/',
          '%',
          '&',
          '|',
          '!',
          ':',
          '?',
        ]

        for (const char of charsToRemoveSpaceAround) {
          // Remove space before the character
          const beforeRegex = new RegExp(`\\s+\\${char}`, 'g')

          minified = minified.replace(beforeRegex, char)

          // Remove space after the character
          const afterRegex = new RegExp(`\\${char}\\s+`, 'g')

          minified = minified.replace(afterRegex, char)
        }
      }

      return minified
    }

    /**
     * Converts an array of event objects to TNGL chains, grouped by `id`.
     * TODO move this function to some kind of utils?
     *
     * Output:
     *   - One chain per ID, each beginning with `onEventStateSet<IDxxx>($sceneName)`.
     *   - For each event:
     *       * If type/value differs from the previous event, emit `.setValue(formattedValue)`.
     *       * Then emit `.setEventState($label)`.
     *   - The events for each ID appear in the exact order encountered in the array.
     *   - Final output orders IDs from largest to smallest.
     *
     * @param sceneName The name of the scene (for onEventStateSet<IDxxx>($sceneName))
     * @param events The JSON array of events
     *   Each event is an object: { type, value, id, label, timestamp }
     * @returns The joined TNGL output (one chain per line)
     */
    function convertEventsToTnglChains(sceneName: string, events: EventState[]) {
      // Group events by ID while preserving their relative order
      const eventsById: Record<number, EventState[]> = {}

      for (const evt of events) {
        if (!eventsById[evt.id]) {
          eventsById[evt.id] = []
        }
        eventsById[evt.id].push(evt)
      }

      // Sort IDs descending
      const sortedIds = Object.keys(eventsById)
        .map((id) => parseInt(id, 10))
        .sort((a, b) => b - a)

      // Build one chain per ID (descending ID order)
      const chains = sortedIds.map((id) => {
        const eventList = eventsById[id]
        let chain = `onEventStateSet<ID${id}>($${sceneName})`

        let lastType = null
        let lastValue = null

        for (const e of eventList) {
          const currentFormattedValue = formatValue(e.type, e.value)

          // If (type, value) changed from last time, setValue
          if (e.type !== lastType || e.value !== lastValue) {
            chain += `.setValue(${currentFormattedValue})`
            lastType = e.type
            lastValue = e.value
          }

          // Always setEventState($label) after setValue
          chain += `.setEventState($${e.label})`
        }

        chain += ';'
        return chain
      })

      // Return all chains, separated by newlines
      return chains.join('\n')
    }

    /**
     * Helper function to remove comments from TNGL code while preserving string literals
     * @param code The TNGL code with comments
     * @returns The TNGL code with comments removed
     */
    function removeNonBerryComments(code: string): string {
      let result = ''
      let i = 0
      let inSingleQuoteString = false
      let inDoubleQuoteString = false
      let inSingleLineComment = false
      let inMultiLineComment = false

      while (i < code.length) {
        const char = code[i]
        const nextChar = i + 1 < code.length ? code[i + 1] : ''

        // Handle string boundaries
        if (char === '"' && !inSingleQuoteString && !inSingleLineComment && !inMultiLineComment) {
          inDoubleQuoteString = !inDoubleQuoteString
          result += char
          i++
          continue
        }

        if (char === "'" && !inDoubleQuoteString && !inSingleLineComment && !inMultiLineComment) {
          inSingleQuoteString = !inSingleQuoteString
          result += char
          i++
          continue
        }

        // Inside strings, just copy characters
        if (inSingleQuoteString || inDoubleQuoteString) {
          result += char
          i++
          continue
        }

        // Handle comments
        if (char === '/' && nextChar === '*' && !inSingleLineComment && !inMultiLineComment) {
          inMultiLineComment = true
          i += 2
          continue
        }

        if (char === '*' && nextChar === '/' && inMultiLineComment) {
          inMultiLineComment = false
          i += 2
          continue
        }

        if (char === '/' && nextChar === '/' && !inSingleLineComment && !inMultiLineComment) {
          inSingleLineComment = true
          i += 2
          continue
        }

        if ((char === '\n' || char === '\r') && inSingleLineComment) {
          inSingleLineComment = false
          result += char // Keep the newline
          i++
          continue
        }

        // Skip characters in comments
        if (inSingleLineComment || inMultiLineComment) {
          i++
          continue
        }

        // Add non-comment characters
        result += char
        i++
      }

      return result
    }

    // Regular expressions for API handling
    const regexPUBLISH_TNGL_TO_API = /PUBLISH_TNGL_TO_API\s*\(\s*"([^"]*)"\s*,\s*`([^`]*)`\s*\);?/ms
    const regexINJECT_TNGL_FROM_API = /INJECT_TNGL_FROM_API\s*\(\s*"([^"]*)"\s*\);?/ms

    // Handle PUBLISH_TNGL_TO_API
    for (let requests = 0; requests < 64; requests++) {
      const match = regexPUBLISH_TNGL_TO_API.exec(tngl_code)

      if (!match) {
        break
      }

      logging.verbose(match)

      const name = match[1]
      const id = encodeURIComponent(name)
      const tngl = match[2]

      try {
        logging.verbose(`sendTnglToApi({ id=${id}, name=${name}, tngl=${tngl} })`)
        await sendTnglToApi({ id, name, tngl })
        tngl_code = tngl_code.replace(match[0], '')
      } catch {
        logging.error(`Failed to send "${name}" to TNGL API`)
        throw 'SendTnglToApiFailed'
      }
    }

    // Handle INJECT_TNGL_FROM_API
    for (let requests = 0; requests < 64; requests++) {
      const match = regexINJECT_TNGL_FROM_API.exec(tngl_code)

      if (!match) {
        break
      }

      logging.verbose(match)

      const name = match[1]
      const id = encodeURIComponent(name)

      try {
        logging.verbose(`fetchTnglFromApiById({ id=${id} })`)
        const response = await fetchTnglFromApiById(id)

        tngl_code = tngl_code.replace(match[0], response.tngl)
      } catch (e) {
        logging.error(`Failed to fetch "${name}" from TNGL API`, e)
        throw 'FetchTnglFromApiFailed'
      }
    }

    // Handle #define, #ifdef, #ifndef, #endif, #warning, #error directives
    {
      // First remove comments from the TNGL code
      tngl_code = removeNonBerryComments(tngl_code)

      // Now gather all defines and process conditionals
      const defines = new Map<string, string>()
      const lines = tngl_code.split('\n')
      const resultLines: string[] = []

      // Stack to track conditional compilation state
      // Each entry is {symbol: string, include: boolean, wasTrue: boolean}
      const conditionalStack: Array<{ symbol: string; include: boolean; wasTrue: boolean }> = []

      // Should we include the current section?
      let includeSection = true

      for (const line of lines) {
        // Extract directive if present
        const defineMatch = line.match(/^\s*#define\s+(\w+)(?:\s+(.*))?/)
        const undefMatch = line.match(/^\s*#undef\s+(\w+)/)
        const ifdefMatch = line.match(/^\s*#ifdef\s+(\w+)/)
        const ifndefMatch = line.match(/^\s*#ifndef\s+(\w+)/)
        const endifMatch = line.match(/^\s*#endif/)
        const warningMatch = line.match(/^\s*#warning\s+(.*)/)
        const errorMatch = line.match(/^\s*#error\s+(.*)/)

        if (defineMatch) {
          // Process #define, but only if we're in an included section
          if (includeSection) {
            const name = defineMatch[1]
            const value = defineMatch[2] || '' // Default to empty string if no value

            defines.set(name, value)
          }
          // Don't include the #define line in output
          continue
        } else if (undefMatch) {
          // Process #undef, but only if we're in an included section
          if (includeSection) {
            const name = undefMatch[1]

            defines.delete(name)
          }
          // Don't include the #undef line in output
          continue
        } else if (ifdefMatch) {
          // Process #ifdef
          const symbol = ifdefMatch[1]
          const symbolDefined = defines.has(symbol)

          // This section is included if the parent section is included AND the condition is true
          const newInclude: boolean = includeSection && symbolDefined

          // Push state onto stack
          conditionalStack.push({
            symbol,
            include: newInclude,
            wasTrue: symbolDefined,
          })

          // Update current include state
          includeSection = newInclude

          // Don't include the #ifdef line in output
          continue
        } else if (ifndefMatch) {
          // Process #ifndef (same as #ifdef but condition is inverted)
          const symbol = ifndefMatch[1]
          const symbolDefined = defines.has(symbol)

          // This section is included if the parent section is included AND the condition is true
          const newInclude: boolean = includeSection && !symbolDefined

          // Push state onto stack
          conditionalStack.push({
            symbol,
            include: newInclude,
            wasTrue: !symbolDefined,
          })

          // Update current include state
          includeSection = newInclude

          // Don't include the #ifndef line in output
          continue
        } else if (endifMatch) {
          // Process #endif - pop the last conditional state
          if (conditionalStack.length === 0) {
            logging.error('Error: #endif without matching #ifdef or #ifndef')
            throw 'InvalidPreprocessorDirective'
          }

          const lastState = conditionalStack.pop()

          // Restore include state from parent conditional (or true if we're at root level)
          includeSection = conditionalStack.length > 0 ? conditionalStack[conditionalStack.length - 1].include : true

          // Don't include the #endif line in output
          continue
        } else if (warningMatch && includeSection) {
          // Process #warning - only if in an included section
          const warningMessage = `TNGL Warning: ${warningMatch[1]}`

          logging.warn(warningMessage)

          // TODO: Process the warning in studio

          // Don't include the #warning line in output
          continue
        } else if (errorMatch && includeSection) {
          // Process #error - only if in an included section
          const errorMessage = `TNGL Error: ${errorMatch[1]}`

          logging.error(errorMessage)

          // TODO: Process the error in studio

          // Abort processing when an error directive is encountered
          throw 'TnglPreprocessorError: ' + errorMessage
        }

        // Include the line only if we're in an included section
        if (includeSection) {
          // Apply symbol replacements to each included line immediately
          let processedLine = line

          for (const [name, value] of defines.entries()) {
            if (value === null || value === undefined) {
              continue
            }

            // Create a regex that matches the symbol name with word boundaries
            // The symbol name must not be preceded or followed by a word character
            const defineRegex = new RegExp(`\\b${name}\\b`, 'g')

            processedLine = processedLine.replace(defineRegex, value)
          }
          resultLines.push(processedLine)
        }
      }

      // Check if all #ifdef/#ifndef have matching #endif
      if (conditionalStack.length > 0) {
        logging.error('Error: Unclosed #ifdef or #ifndef directives')
        throw 'UnclosedPreprocessorDirective'
      }

      // Reassemble the code
      tngl_code = resultLines.join('\n')
    }

    // Handle TNGL_DEFINITIONS_FROM_JSON
    {
      const tnglDefinitionsRegex = /TNGL_DEFINITIONS_FROM_JSON\s*\(\s*`([^`]*)`\s*\)\s*;?/g
      let definitionsMatch

      while ((definitionsMatch = tnglDefinitionsRegex.exec(tngl_code)) !== null) {
        const fullMatch = definitionsMatch[0]
        const jsonString = definitionsMatch[1]

        try {
          // Convert JSON to TNGL definitions
          const tnglDefinitions = tnglDefinitionsFromJsonToTngl(jsonString)

          // Replace the TNGL_DEFINITIONS_FROM_JSON call with the generated TNGL
          tngl_code =
            tngl_code.substring(0, definitionsMatch.index) +
            tnglDefinitions +
            tngl_code.substring(definitionsMatch.index + fullMatch.length)

          // Reset lastIndex to account for potential length changes
          tnglDefinitionsRegex.lastIndex = definitionsMatch.index + tnglDefinitions.length
        } catch (error) {
          logging.error(`Failed to process TNGL_DEFINITIONS_FROM_JSON: ${error}`)
          throw new Error(`TNGL_DEFINITIONS_FROM_JSON processing failed: ${error}`)
        }
      }
    }

    // Process BERRY code blocks after handling preprocessor directives
    {
      // Extract and process BERRY code segments
      const berryRegex = /BERRY\(`([\S\s]*?)`\)/g
      let berryMatch

      while ((berryMatch = berryRegex.exec(tngl_code)) !== null) {
        const fullMatch = berryMatch[0]
        const berryCode = berryMatch[1]

        // Process the BERRY code using the preprocessBerry function
        const processedBerryCode = preprocessBerry(berryCode)

        // Replace the original BERRY segment with the processed one
        const newBerrySegment = `BERRY(\`${processedBerryCode}\`)`

        tngl_code =
          tngl_code.substring(0, berryMatch.index) +
          newBerrySegment +
          tngl_code.substring(berryMatch.index + fullMatch.length)

        // Reset lastIndex to account for potential length changes
        berryRegex.lastIndex = berryMatch.index + newBerrySegment.length
      }
    }

    // Clean up the whitespaces in TNGL code
    {
      tngl_code = tngl_code
        // Remove empty lines with only whitespace
        .replace(/^\s*[\n\r]/gm, '')

        // Remove multiple consecutive empty lines
        .replace(/[\n\r]{3,}/g, '\n\n')

        // Remove trailing whitespace at end of lines
        .replace(/[\t ]+$/gm, '')

        // Remove multiple spaces between words/tokens (preserving indentation)
        .replace(/([^\t\n\r ])[\t ]{2,}([^\t\n\r ])/g, '$1 $2')

        // Standardize line endings to \n
        .replace(/\r\n|\r/g, '\n')

        // Remove spaces before commas and semicolons
        .replace(/\s+([,;])/g, '$1')

        // Remove multiple spaces after commas (but preserve line indentation)
        .replace(/([,;])[\t ]{2,}/g, '$1 ')

        // Remove spaces around parentheses while preserving indentation
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')

        // Remove extra spaces around operators while preserving indentation
        .replace(/(\S)[\t ]{2,}([%*+/<=>\-])/g, '$1 $2')
        .replace(/([%*+/<=>\-])[\t ]{2,}(\S)/g, '$1 $2')

        // Remove duplicate spaces after line indentation
        .replace(/^([\t ]*?)[\t ]{2,}/gm, '$1')

        // Remove extra whitespace at the start and end of the file
        .trim()
    }

    logging.debug(tngl_code)

    // Handle SCENE declarations
    {
      // Regular expression to find all SCENE("name"|$name, [IDxxx,] `[...]`) segments
      const regexSCENE = /SCENE\s*\(\s*(?:"([^"]*)"|(\$\w+))\s*(?:,\s*ID(\d+))?\s*,\s*`\[([^]*?)\]`\s*\)\s*;?/g
      let match

      while ((match = regexSCENE.exec(tngl_code)) !== null) {
        const sceneName = match[1] || match[2] // match[1] for quoted string, match[2] for $variable
        const sceneId = match[3] // Will be undefined if no ID was provided
        // Clean up the JSON string by removing trailing commas before the closing bracket
        const eventsJson = `[${match[4].replace(/,(\s*\])/g, '$1')}]`

        try {
          // Parse the JSON array of events
          const events = JSON.parse(eventsJson)

          // Convert events to TNGL chains using existing function
          const tnglChains = convertEventsToTnglChains(sceneName.replace(/^\$/, ''), events)

          // Replace the SCENE declaration with the generated TNGL chains
          tngl_code = tngl_code.replace(match[0], tnglChains)
        } catch (e) {
          logging.error(`Failed to parse SCENE "${sceneName}"`, e)
          throw 'InvalidSceneFormat'
        }
      }
    }

    return tngl_code
  }

  /**
   * Gets the TNGL code from the controller to the WASM runtime.
   */
  syncTngl() {
    logging.debug('Spectoda::syncTngl()')

    logging.info('> Reading TNGL bytecode...')

    const request_uuid = this.#getUUID()
    const command_bytes = [COMMAND_FLAGS.FLAG_READ_TNGL_BYTECODE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(command_bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      const flag = reader.readFlag()

      logging.verbose(`flag=${flag}`)
      if (flag !== COMMAND_FLAGS.FLAG_READ_TNGL_BYTECODE_RESPONSE) {
        // logging.error("ERROR ds9a8f07");
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      logging.verbose(`response_uuid=${response_uuid}`)
      if (response_uuid !== request_uuid) {
        // logging.error("ERROR fd0s987");
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        const tngl_bytecode_size = reader.readUint16()

        logging.debug(`tngl_bytecode_size=${tngl_bytecode_size}`)

        const tngl_bytecode = reader.readBytes(tngl_bytecode_size)

        logging.debug(`tngl_bytecode=[${tngl_bytecode}]`)

        const DUMMY_CONNECTION = SpectodaWasm.Connection.make(
          '00:00:00:00:00:00',
          SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
          SpectodaWasm.connection_rssi_t.RSSI_MAX,
        )

        this.runtime.spectoda_js.request(new Uint8Array(tngl_bytecode), DUMMY_CONNECTION)
      } else {
        // maybe no TNGL in the controller
        throw 'FailedToSynchronizeTngl'
      }
    })
  }

  /**
   * ! Useful
   * Writes the given TNGL code to the controller.
   * Controller synchronize their TNGL. Which means the TNLG you upload to one controller will be synchronized to all controllers (within a few minutes, based on the TNGL file size)
   * @immakermatty refactor suggestion to `loadTngl` (???)
   */
  writeTngl(tngl_code: string | null, tngl_bytes: Uint8Array | null) {
    logging.debug(`Spectoda::writeTngl(tngl_code=${tngl_code}, tngl_bytes=${tngl_bytes})`)

    logging.info('> Writing Tngl code...')

    if ((tngl_code === null || tngl_code === undefined) && (tngl_bytes === null || tngl_bytes === undefined)) {
      return Promise.reject('InvalidParameters')
    }

    if (tngl_bytes === null || tngl_bytes === undefined) {
      tngl_bytes = this.#parser.parseTnglCode(tngl_code)
    }

    const reinterpret_bytecode = [
      COMMAND_FLAGS.FLAG_LOAD_TNGL,
      ...numberToBytes(this.runtime.clock.millis(), 6),
      0,
      ...numberToBytes(tngl_bytes.length, 4),
      ...tngl_bytes,
    ]

    if (tngl_bytes.length >= TNGL_SIZE_CONSIDERED_BIG) {
      const erase_tngl_uuid = this.#getUUID()
      const erase_tngl_bytecode = [COMMAND_FLAGS.FLAG_ERASE_TNGL_BYTECODE_REQUEST, ...numberToBytes(erase_tngl_uuid, 4)]

      return this.runtime.execute(erase_tngl_bytecode, undefined).then(() => {
        return this.runtime.execute(reinterpret_bytecode, 'TNGL')
      })
    } else {
      return this.runtime.execute(reinterpret_bytecode, 'TNGL')
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with null value.
   */
  emitEvent(
    event_label: ValueTypeLabel,
    // TODO rename to spectodaIds
    device_ids: ValueTypeIDs = 255,
    force_delivery = true,
  ) {
    logging.debug(
      `Spectoda::emitEvent(event_label=${event_label},device_ids=${device_ids},force_delivery=${force_delivery})`,
    )

    const func = async (id: ValueTypeID) => {
      if (!(await this.runtime.emitNull(event_label, id))) {
        return Promise.reject('EventEmitFailed')
      }
      return Promise.resolve()
    }

    if (typeof device_ids === 'object') {
      const promises = device_ids.map(func)

      return Promise.all(promises)
    } else {
      return func(device_ids)
    }
  }

  /**
   * @deprecated Use emitEvent() instead to match the function names with BerryLang codebase
   */
  emitNullEvent = this.emitEvent

  /**
   * @deprecated Use emitEvent() instead to match the function names with BerryLang codebase
   */
  emitNull = this.emitEvent

  /**
   * ! Useful
   * Emits Spectoda Event with timestamp value.
   * Timestamp value range is (-86400000, 86400000)
   */
  emitTimestamp(event_label: ValueTypeLabel, event_value: ValueTypeTimestamp, device_ids: ValueTypeIDs = 255) {
    logging.verbose(`emitTimestamp(label=${event_label},value=${event_value},id=${device_ids})`)

    if (event_value > 86400000) {
      logging.error('Invalid event value')
      event_value = 86400000
    }

    if (event_value < -86400000) {
      logging.error('Invalid event value')
      event_value = -86400000
    }

    const func = async (id: ValueTypeID) => {
      if (!(await this.runtime.emitTimestamp(event_label, event_value, id))) {
        return Promise.reject('EventEmitFailed')
      }
      return Promise.resolve()
    }

    if (typeof device_ids === 'object') {
      const promises = device_ids.map(func)

      return Promise.all(promises)
    } else {
      return func(device_ids)
    }
  }

  /**
   * @deprecated Use emitTimestamp() instead to match the function names with BerryLang codebase
   */
  emitTimestampEvent = this.emitTimestamp

  /**
   * ! Useful
   * Emits Spectoda Event with color value.
   * Color value must be a string in hex format with or without "#" prefix.
   */
  emitColor(event_label: ValueTypeLabel, event_value: ValueTypeColor, device_ids: ValueTypeIDs = 255) {
    logging.verbose(`emitColor(label=${event_label},value=${event_value},id=${device_ids})`)

    event_value = cssColorToHex(event_value)

    if (!event_value || !/#?[\dA-Fa-f]{6}/g.test(event_value)) {
      logging.error('Invalid event value. event_value=', event_value)
      event_value = '#000000'
    }

    const func = async (id: ValueTypeID) => {
      if (!(await this.runtime.emitColor(event_label, event_value, id))) {
        return Promise.reject('EventEmitFailed')
      }
      return Promise.resolve()
    }

    if (typeof device_ids === 'object') {
      const promises = device_ids.map(func)

      return Promise.all(promises)
    } else {
      return func(device_ids)
    }
  }

  /**
   * @deprecated Use emitColor() instead to match the function names with BerryLang codebase
   */
  emitColorEvent = this.emitColor

  /**
   * ! Useful
   * Emits Spectoda Event with percentage value
   * value range is (-100,100)
   */
  emitPercentage(event_label: ValueTypeLabel, event_value: ValueTypePercentage, device_ids: ValueTypeIDs = 255) {
    logging.verbose(`emitPercentage(label=${event_label},value=${event_value},id=${device_ids})`)

    if (event_value > 100) {
      logging.error('Invalid event value')
      event_value = 100
    }

    if (event_value < -100) {
      logging.error('Invalid event value')
      event_value = -100
    }

    const func = async (id: ValueTypeID) => {
      if (!(await this.runtime.emitPercentage(event_label, event_value, id))) {
        return Promise.reject('EventEmitFailed')
      }
      return Promise.resolve()
    }

    if (typeof device_ids === 'object') {
      const promises = device_ids.map(func)

      return Promise.all(promises)
    } else {
      return func(device_ids)
    }
  }

  /**
   * @deprecated Use emitPercentage() instead to match the function names with BerryLang codebase
   */
  emitPercentageEvent = this.emitPercentage

  /**
   * E.g. event "anima" to value "a_001"
   */
  emitLabel(event_label: ValueTypeLabel, event_value: ValueTypeLabel, device_ids: ValueTypeIDs = 255) {
    logging.verbose(`emitLabel(label=${event_label},value=${event_value},id=${device_ids})`)

    if (typeof event_value !== 'string') {
      logging.error('Invalid event value')
      event_value = ''
    }

    if (event_value.length > 5) {
      logging.error('Invalid event value')
      event_value = event_value.slice(0, 5)
    }

    const func = async (id: ValueTypeID) => {
      if (!(await this.runtime.emitLabel(event_label, event_value, id))) {
        return Promise.reject('EventEmitFailed')
      }
      return Promise.resolve()
    }

    if (typeof device_ids === 'object') {
      const promises = device_ids.map(func)

      return Promise.all(promises)
    } else {
      return func(device_ids)
    }
  }

  /**
   * @deprecated Use emitLabel() instead to match the function names with BerryLang codebase
   */
  emitLabelEvent = this.emitLabel

  /**
   * Sets the timeline to the current time of the day and unpauses it.
   */
  syncTimelineToDayTime(): Promise<unknown> {
    logging.verbose('syncTimelineToDayTime()')

    const now = new Date()

    const hours = now.getHours()
    const minutes = now.getMinutes()
    const seconds = now.getSeconds()
    const miliseconds = now.getMilliseconds()

    const time = hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000 + miliseconds

    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0') // getMonth() returns 0-based index
    const year = now.getFullYear()

    this.timeline.unpause()
    this.timeline.setMillis(time)
    this.timeline.setDate(`${day}-${month}-${year}`)

    return this.syncTimeline()
  }
  /**
   * Manipulates the timeline by setting its timestamp, pause state and date
   * @param {number} timestamp - The timestamp in milliseconds to set the timeline to
   * @param {boolean} pause - Whether to pause or unpause the timeline
   * @param {string} date - The date to set in "DD-MM-YYYY" format
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  manipulateTimeline(timestamp: number, pause: boolean, date: string): Promise<unknown> {
    logging.debug(`Spectoda::manipulateTimeline(timestamp=${timestamp}, pause=${pause}, date=${date})`)

    logging.info('> Manipulating with Timeline...')

    if (pause) {
      this.timeline.pause()
    } else {
      this.timeline.unpause()
    }

    this.timeline.setMillis(timestamp)
    this.timeline.setDate(date)

    return this.syncTimeline()
  }

  /**
   * Rewinds the timeline to the beginning (timestamp 0)
   * @param {boolean} pause - Whether to pause the timeline after rewinding. Defaults to false.
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  rewindTimeline(pause = false): Promise<unknown> {
    logging.debug(`Spectoda::rewindTimeline(pause=${pause})`)

    logging.info('> Rewinding Timeline...')

    if (pause) {
      this.timeline.pause()
    } else {
      this.timeline.unpause()
    }

    this.timeline.setMillis(0)

    return this.syncTimeline()
  }

  /**
   * Pauses the timeline
   * @returns {Promise<void>} Promise that resolves when timeline is synchronized
   */
  pauseTimeline(): Promise<unknown> {
    logging.debug('Spectoda::pauseTimeline()')

    logging.info('> Pausing Timeline...')

    this.timeline.pause()

    return this.syncTimeline()
  }

  /**
   * Unpauses the timeline
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  unpauseTimeline(): Promise<unknown> {
    logging.debug('Spectoda::unpauseTimeline()')

    logging.info('> Unpausing Timeline...')

    this.timeline.unpause()

    return this.syncTimeline()
  }

  /**
   * Synchronizes timeline of the connected controller with the current time of the runtime.
   * TODO! [0.13] move Timeline handling to WASM
   */
  syncTimeline(
    timestamp: ValueTypeTimestamp | null = null,
    paused: boolean | null = null,
    date: ValueTypeDate | null = null,
  ): Promise<unknown> {
    logging.debug(`Spectoda::syncTimeline(timestamp=${timestamp}, paused=${paused}, date=${date})`)

    logging.info('> Synchronizing Timeline...')

    if (timestamp === null || timestamp === undefined) {
      timestamp = this.timeline.millis()
    }

    if (paused === null || paused === undefined) {
      paused = this.timeline.paused()
    }

    if (date === null || date === undefined) {
      date = this.timeline.getDate()
    }

    const clock_timestamp = this.runtime.clock.millis()

    logging.debug(
      `> Setting timeline to timestamp=${timestamp}, paused=${paused}, date=${date}, clock_timestamp=${clock_timestamp}`,
    )

    // from "DD-MM-YYYY" date erase "-" and convert to number YYYYMMDD:
    const date_number = parseInt(date.split('-').reverse().join(''))

    // flags: [reserved,reserved,reserved,timeline_paused,reserved,reserved,write_rtc_flag,reserved]
    const FLAG_PAUSED_BIT = 4
    const FLAG_WRITE_RTC_BIT = 1

    const ALWAYS_WRITE_RTC_FROM_APP_TIMELINE_WRITE_COMMAND = true

    let timeline_flags = 0

    timeline_flags |= paused ? 1 << FLAG_PAUSED_BIT : 0
    timeline_flags |= ALWAYS_WRITE_RTC_FROM_APP_TIMELINE_WRITE_COMMAND ? 1 << FLAG_WRITE_RTC_BIT : 0

    const payload = [
      COMMAND_FLAGS.FLAG_TIMELINE_WRITE,
      ...numberToBytes(clock_timestamp, 6),
      ...numberToBytes(timestamp, 4),
      timeline_flags,
      ...numberToBytes(date_number, 4),
    ]

    return this.runtime.execute(payload, 'TMLN')
  }

  /**
   * Synchronizes TNGL variable state of given ID to all other IDs
   */
  syncState(deviceId: ValueTypeID) {
    logging.debug(`Spectoda::syncState(deviceId=${deviceId})`)

    logging.info('> Synchronizing state...')

    const request_uuid = this.#getUUID()
    const device_request = [COMMAND_FLAGS.FLAG_SYNC_STATE_REQUEST, ...numberToBytes(request_uuid, 4), deviceId]

    return this.runtime.request(device_request, false)
  }

  /**
   * downloads firmware and calls updateDeviceFirmware()
   * @param {string} url - whole URL of the firmware file
   */
  async fetchAndUpdateDeviceFirmware(url: string) {
    logging.debug(`Spectoda::fetchAndUpdateDeviceFirmware(url=${url})`)

    logging.info('> Fetching and Updating Controller Firmware...')
    const fw = await fetchFirmware(url)

    return this.updateDeviceFirmware(fw)
  }

  /**
   * downloads firmware and calls updateNetworkFirmware()
   * @param {string} url - whole URL of the firmware file
   */
  async fetchAndUpdateNetworkFirmware(url: string) {
    logging.debug(`Spectoda::fetchAndUpdateNetworkFirmware(url=${url})`)

    logging.info('> Fetching and Updating Firmware of all Controllers...')
    const fw = await fetchFirmware(url)

    return this.updateNetworkFirmware(fw)
  }

  /**
   * ! Useful
   * Update the firmware of the connected controller.
   * @param {Uint8Array} firmware - The firmware to update the controller with.
   */
  // todo rename to updateControllerFirmware
  updateDeviceFirmware(firmware: Uint8Array) {
    logging.debug(`Spectoda::updateDeviceFirmware(firmware.length=${firmware?.length})`)

    logging.info('> Updating Controller FW...')

    if (!firmware || firmware.length < MIN_FIRMWARE_LENGTH) {
      logging.error('Invalid firmware')
      return Promise.reject('InvalidFirmware')
    }

    return Promise.resolve()
      .then(() => {
        return this.requestWakeLock().catch((e) => {
          logging.error('Failed to acquire wake lock', e)
        })
      })
      .then(() => {
        return this.runtime.updateFW(firmware).finally(() => {
          return this.runtime.disconnect()
        })
      })
      .finally(() => {
        return this.releaseWakeLock().catch((e) => {
          logging.error('Failed to release wake lock', e)
        })
      })
  }

  /**
   * ! Useful
   * Update the firmware of ALL CONNECTED CONTROLLERS in the network.
   * @param {Uint8Array} firmware - The firmware to update the controller with.
   */
  updateNetworkFirmware(firmware: Uint8Array) {
    logging.debug(`Spectoda::updateNetworkFirmware(firmware.length=${firmware?.length})`)

    logging.info('> Updating Firmware of all Controllers...')

    if (!firmware || firmware.length < 10000) {
      logging.error('Invalid firmware')
      return Promise.reject('InvalidFirmware')
    }

    this.#updating = true

    this.requestWakeLock().catch((e) => {
      logging.error('Failed to acquire wake lock', e)
    })

    return new Promise(async (resolve, reject) => {
      // const chunk_size = detectAndroid() ? 480 : 3984; // must be modulo 16
      // const chunk_size = 992; // must be modulo 16
      const chunk_size = detectSpectodaConnect() ? 480 : 3984

      let index_from = 0
      let index_to = chunk_size

      let written = 0

      // logging.setLoggingLevel(logging.level - 1);

      logging.info('OTA UPDATE')
      logging.verbose(firmware)

      const start_timestamp = Date.now()

      await sleep(100)

      try {
        this.runtime.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.info('OTA RESET')

          const command_bytes = [COMMAND_FLAGS.FLAG_OTA_RESET, 0x00, ...numberToBytes(0x00000000, 4)]

          await this.runtime.execute(command_bytes, undefined)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.info('OTA BEGIN')

          const command_bytes = [COMMAND_FLAGS.FLAG_OTA_BEGIN, 0x00, ...numberToBytes(firmware.length, 4)]

          await this.runtime.execute(command_bytes, undefined)
        }

        // TODO optimalize this begin by detecting when all controllers have erased its flash
        // TODO also, right now the gateway controller sends to other controlles to erase flash after it is done.
        // TODO that slows things down
        await sleep(8000) // ! keep this below 10 seconds to avoid connection timeout

        {
          //===========// WRITE //===========//
          logging.info('OTA WRITE')

          while (written < firmware.length) {
            if (index_to > firmware.length) {
              index_to = firmware.length
            }

            const command_bytes = [
              COMMAND_FLAGS.FLAG_OTA_WRITE,
              0x00,
              ...numberToBytes(written, 4),
              ...firmware.slice(index_from, index_to),
            ]

            await this.runtime.execute(command_bytes, undefined)

            written += index_to - index_from

            const percentage = Math.floor((written * 10000) / firmware.length) / 100

            logging.info(percentage + '%')
            this.runtime.emit(SpectodaAppEvents.OTA_PROGRESS, percentage)

            index_from += chunk_size
            index_to = index_from + chunk_size
          }
        }

        await sleep(1000)

        {
          //===========// END //===========//
          logging.info('OTA END')

          const command_bytes = [COMMAND_FLAGS.FLAG_OTA_END, 0x00, ...numberToBytes(written, 4)]

          await this.runtime.execute(command_bytes, undefined)
        }

        await sleep(3000)

        await this.rebootNetwork()

        logging.debug('> Firmware written in ' + (Date.now() - start_timestamp) / 1000 + ' seconds')

        this.runtime.emit(SpectodaAppEvents.OTA_STATUS, 'success')

        resolve(null)
        return
      } catch (e) {
        this.runtime.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
        reject(e)
        return
      }
    })
      .then(() => {
        return this.runtime.disconnect()
      })

      .finally(() => {
        this.releaseWakeLock().catch((e) => {
          logging.error('Failed to release wake lock', e)
        })
        this.#updating = false

        // logging.setLoggingLevel(logging.level + 1);
      })
  }

  /**
   * Tells the connected controller to update a peer controller with its own firmware
   */
  async updatePeerFirmware(peer: string) {
    logging.verbose(`updatePeerFirmware(peer=${peer})`)

    // Validate the input to ensure it is a valid MAC address
    if (typeof peer !== 'string' || !/^([\dA-Fa-f]{2}[:-]){5}([\dA-Fa-f]{2})$/.test(peer)) {
      // If the input is invalid, display an error message and return null
      throw 'InvalidPeerMacAdress'
    }

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_FW_UPDATE_PEER_REQUEST, ...numberToBytes(request_uuid, 4), ...strMacToBytes(peer)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_FW_UPDATE_PEER_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        logging.info('Update sucessful')
      } else {
        throw 'Fail'
      }
    })
  }

  /**
   * ! Useful
   * Get the JSON config of the connected controller.
   */
  // todo rename to readControllerConfig
  readDeviceConfig() {
    logging.debug('Spectoda::readDeviceConfig()')

    logging.info('> Reading device config...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_DEVICE_CONFIG_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_DEVICE_CONFIG_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        const config_size = reader.readUint32()

        logging.verbose(`config_size=${config_size}`)

        const config_bytes = reader.readBytes(config_size)

        logging.verbose(`config_bytes=${config_bytes}`)

        const decoder = new TextDecoder()
        const config = decoder.decode(new Uint8Array(config_bytes))

        logging.verbose(`config=${config}`)

        if (config.charAt(config.length - 1) == '\0') {
          logging.warn('NULL config character detected')
          return config.slice(0, -1)
        }

        return config
      } else {
        throw 'Fail'
      }
    })
  }

  /**
   * ! Useful
   * Updates the JSON config of the connected controller.
   */
  // todo rename to updateControllerConfig
  updateDeviceConfig(config_string: string) {
    logging.debug(`Spectoda::updateDeviceConfig(config_string=${config_string})`)

    logging.info('> Writing Controller Config...')

    const condif_object = JSON.parse(config_string)
    const config = JSON.stringify(condif_object)

    logging.verbose(`config=${config}`)

    const encoder = new TextEncoder()
    const config_bytes = encoder.encode(config)
    const config_bytes_size = config.length

    // make config update request
    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_CONFIG_UPDATE_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...numberToBytes(config_bytes_size, 4),
      ...config_bytes,
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_CONFIG_UPDATE_RESPONSE) {
        throw 'InvalidResponse'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponse'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        logging.info('> Rebooting Controller...')
        const payload = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

        return this.runtime.request(payload, false)
      } else {
        throw 'Fail'
      }
    })
  }

  /**
   * Updates the JSON config of ALL CONNECTED CONTROLLERS in the network.
   */
  updateNetworkConfig(config_string: string) {
    logging.debug(`Spectoda::updateNetworkConfig(config_string=${config_string})`)

    logging.info('> Writing Config to all Controllers...')

    const encoder = new TextEncoder()
    const config_bytes = encoder.encode(config_string)
    const config_bytes_size = config_string.length

    // make config update request
    const request_uuid = this.#getUUID()
    const request_bytes = [
      COMMAND_FLAGS.FLAG_CONFIG_UPDATE_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...numberToBytes(config_bytes_size, 4),
      ...config_bytes,
    ]

    return this.runtime.execute(request_bytes, 'CONF').then(() => {
      logging.info('> Rebooting all Controllers...')
      const command_bytecode = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

      return this.runtime.execute(command_bytecode, undefined)
    })
  }

  /**
   * Gets the timeline from connected controller to the runtime.
   */
  requestTimeline() {
    logging.debug('Spectoda::requestTimeline()')

    logging.info('> Reading Timeline from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_TIMELINE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      logging.verbose(`response.byteLength=${response.byteLength}`)

      const reader = new TnglReader(response)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_TIMELINE_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      if (error_code !== 0) {
        throw 'RequestTimelineFailed'
      }

      const clock_timestamp = reader.readUint48()
      const timeline_timestamp = reader.readInt32()
      const timeline_paused = reader.readUint8()
      const timeline_date_number = reader.available >= 4 ? reader.readUint32() : 0

      // Convert date number YYYYMMDD to DD-MM-YYYY format
      const timeline_date = timeline_date_number
        ? `${String(timeline_date_number % 100).padStart(2, '0')}-${String(
            Math.floor(timeline_date_number / 100) % 100,
          ).padStart(2, '0')}-${Math.floor(timeline_date_number / 10000)}`
        : '01-01-1970'

      logging.info(
        `clock_timestamp=${clock_timestamp}, timeline_timestamp=${timeline_timestamp}, timeline_paused=${timeline_paused}, timeline_date=${timeline_date}`,
      )

      const flags = timeline_paused ? 0b00010000 : 0b00000000 // flags: [reserved,reserved,reserved,timeline_paused,reserved,reserved,reserved,reserved]
      const payload = [
        COMMAND_FLAGS.FLAG_TIMELINE_WRITE,
        ...numberToBytes(clock_timestamp, 6),
        ...numberToBytes(timeline_timestamp, 4),
        flags,
        ...numberToBytes(timeline_date_number, 4),
      ]

      return this.runtime.execute(payload, 'TMLN')
    })
  }

  // Code.device.runtime.execute([240,1,0,0,0,5],null)
  /**
   * ! Useful
   * Reboots ALL CONNECTED CONTROLLERS in the network. This will temporarily disconnect the controller from the network. Spectoda.js will try to reconnect you back to the controller.
   */
  rebootNetwork() {
    logging.debug('Spectoda::rebootNetwork()')

    logging.info('> Rebooting all Controllers...')

    const payload = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * ! Useful
   * Reboots the controller. This will temporarily disconnect the controller from the network. Spectoda.js will try to reconnect you back to the controller.
   */
  // todo rename to rebootController
  rebootDevice() {
    logging.debug('Spectoda::rebootDevice()')

    logging.info('> Rebooting Controller...')

    const payload = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   * Reboots the controller. This will temporarily disconnect the controller from the network. No automatic reconnection will be attempted.
   */
  // todo rename to disconnectController
  rebootAndDisconnectDevice() {
    logging.debug('Spectoda::rebootAndDisconnectDevice()')

    logging.info('> Rebooting and disconnecting Controller...')

    const payload = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

    return this.runtime.request(payload, false).then(() => {
      return this.disconnect()
    })
  }

  /**
   * ! Useful
   * Puts currently connected controller into the DEFAULT network. More info at the top of this file.
   */
  removeOwner(rebootController = true) {
    logging.debug(`Spectoda::removeOwner(rebootController=${rebootController})`)

    logging.info('> Removing Network Signature+Key from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_ERASE_NETWORK_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_ERASE_OWNER_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code !== 0) {
        throw 'OwnerEraseFailed'
      }

      const removed_device_mac_bytes = reader.readBytes(6)

      return (rebootController ? this.rebootDevice() : Promise.resolve()).then(() => {
        let removed_device_mac = '00:00:00:00:00:00'

        if (removed_device_mac_bytes.length >= 6) {
          removed_device_mac = Array.from(removed_device_mac_bytes, function (byte) {
            return ('0' + (byte & 0xff).toString(16)).slice(-2)
          }).join(':')
        }
        return {
          mac: removed_device_mac === '00:00:00:00:00:00' ? null : removed_device_mac,
        }
      })
    })
  }

  /**
   * ! Useful
   * Removes ALL CONTROLLERS from their current network. More info at the top of this file.
   */
  removeNetworkOwner() {
    logging.debug('Spectoda::removeNetworkOwner()')

    logging.info('> Removing Network Signature+Key from all Controllers...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_ERASE_NETWORK_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(bytes, undefined).then(() => {
      return this.rebootNetwork()
    })
  }

  /**
   * ! Useful
   * Get the firmware version of the controller in string format
   */
  getFwVersion() {
    logging.debug('Spectoda::getFwVersion()')

    logging.info('> Reading FW version from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_FW_VERSION_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_FW_VERSION_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let version = null

      if (error_code === 0) {
        version = reader.readString(32)
      } else {
        throw 'Fail'
      }
      logging.verbose(`version=${version}`)

      logging.info(`FW Version: ${version}`)

      return version.trim()
    })
  }

  /**
   * ! Useful
   * Get the fingerprint of a currently uploaded Tngl (via `writeTngl()`)
   * Tngl fingerprint is an identifier of the Tngl code that is currently running on the controller. It is used for checking if the controller has the correct Tngl code.
   */
  getTnglFingerprint() {
    logging.debug('Spectoda::getTnglFingerprint()')

    logging.info('> Reading TNGL fingerprint from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_TNGL_FINGERPRINT_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose('response:', response)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_TNGL_FINGERPRINT_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let fingerprint = null

      if (error_code === 0) {
        fingerprint = reader.readBytes(32)
      } else {
        throw 'Fail'
      }

      logging.verbose(`fingerprint=${fingerprint}`)
      logging.verbose(
        `fingerprint=${[...fingerprint].map((byte) => ('0' + (byte & 0xff).toString(16)).slice(-2)).join(',')}`,
      )

      logging.info('Controller TNGL Fingerprint: ' + uint8ArrayToHexString(fingerprint))
      console.log('fingerprinting', fingerprint)
      return new Uint8Array(fingerprint)
    })
  }

  /**
   * For FW nerds
   */
  // datarate in bits per second
  setNetworkDatarate(datarate: number) {
    logging.debug(`Spectoda::setNetworkDatarate(datarate=${datarate})`)

    logging.info('> Writing ESPNOW datarate to Controller...')

    const request_uuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_CHANGE_DATARATE_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...numberToBytes(datarate, 4),
    ]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * @deprecated
   */
  readRomPhyVdd33() {
    logging.debug('Spectoda::readRomPhyVdd33()')

    logging.info('> Reading rom_phy_vdd33 from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_ROM_PHY_VDD33_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_ROM_PHY_VDD33_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let vdd_reading = null

      if (error_code === 0) {
        vdd_reading = reader.readInt32()
      } else {
        throw 'Fail'
      }
      logging.info(`vdd_reading=${vdd_reading}`)

      return vdd_reading
    })
  }

  /**
   * @deprecated Will be replaced in 0.12 by IO operations
   */
  readPinVoltage(pin: number) {
    logging.debug(`Spectoda::readPinVoltage(pin=${pin})`)

    logging.info(`> Reading pin ${pin} voltage from Controller...`)

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_VOLTAGE_ON_PIN_REQUEST, ...numberToBytes(request_uuid, 4), pin]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_VOLTAGE_ON_PIN_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let pin_reading = null

      if (error_code === 0) {
        pin_reading = reader.readUint32()
      } else {
        throw 'Fail'
      }
      logging.info(`pin_reading=${pin_reading}`)

      return pin_reading
    })
  }

  /**
   * Set the debug level of the Spectoda.js library
   */
  setDebugLevel(level: number) {
    logging.setLoggingLevel(level)
  }

  /**
   * ! Useful
   * TODO: Rename to readConnectedPeersInfo()
   * Returns the MAC addresses of all nodes connected in the current network in real-time
   */
  getConnectedPeersInfo() {
    logging.debug('Spectoda::getConnectedPeersInfo()')

    logging.info('> Reading Controller connected peers info...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_CONNECTED_PEERS_INFO_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_CONNECTED_PEERS_INFO_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      const peers = []

      if (error_code === 0) {
        const count = reader.readUint16()

        for (let index = 0; index < count; index++) {
          const mac = reader
            .readBytes(6)
            .map((v) => v.toString(16).padStart(2, '0'))
            .join(':')
          const rssi = reader.readUint16() / (65535 / 512) - 256

          peers.push({
            mac: mac,
            rssi: rssi,
          })
        }

        logging.info(`> Connected peers:\n${peers.map((x) => `  mac:${x.mac}, rssi:${x.rssi}`).join('\n')}`)

        return peers
      } else {
        throw 'Fail'
      }
    })
  }

  /**
   * Gets the EventHistory from the connected controller and loads it into the runtime.
   * @deprecated
   */
  syncEventHistory() {
    logging.debug('Spectoda::syncEventHistory()')

    logging.info('> Reading EventStore from Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_EVENT_HISTORY_BC_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_EVENT_HISTORY_BC_RESPONSE) {
        // logging.error("InvalidResponseFlag");
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        // logging.error("InvalidResponseUuid");
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        const historic_events_bytecode_size = reader.readUint16()

        logging.debug(`historic_events_bytecode_size=${historic_events_bytecode_size}`)

        const historic_events_bytecode = reader.readBytes(historic_events_bytecode_size)

        logging.debug(`historic_events_bytecode=[${historic_events_bytecode}]`)

        this.runtime.spectoda_js.eraseHistory()

        const DUMMY_CONNECTION = SpectodaWasm.Connection.make(
          '00:00:00:00:00:00',
          SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
          SpectodaWasm.connection_rssi_t.RSSI_MAX,
        )

        this.runtime.spectoda_js.request(new Uint8Array(historic_events_bytecode), DUMMY_CONNECTION)
      } else {
        logging.error('ERROR cxzv982io')
        throw 'FailedToSynchronizeEventHistory'
      }
    })
  }

  /**
   * ! Useful
   * ! TODO rename to eraseEventStore
   * ! TODO refactor to use use spectoda_js.eraseEventStore(destination_connection)
   * Erases the event state history of ALL CONTROLLERS in the Spectoda network
   */
  eraseEventHistory() {
    logging.debug('Spectoda::eraseEventHistory()')

    logging.info('> Erasing EventStore from all Controllers...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_ERASE_EVENT_HISTORY_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   * Erases the timeline of the connected controller.
   */
  eraseTimeline() {
    logging.debug('Spectoda::eraseTimeline()')

    logging.info('> Erasing Timeline from all Controllers...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_ERASE_TIMELINE_COMMAND_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   * Erases the network data of the connected Network.
   */
  eraseNetworkStorage() {
    logging.debug('Spectoda::eraseNetworkStorage()')

    logging.info('> Erasing NetworkStorage from all Controllers...')

    const request_uuid = this.#getUUID()
    const command_bytes = [COMMAND_FLAGS.FLAG_ERASE_NETWORKSTORAGE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(command_bytes, undefined)
  }

  /**
   * ! Useful
   * Puts CONTROLLER Spectoda.js is `connect`ed to to sleep. To wake him up, power must be cycled by removing and reapplying it.
   
  * TODO rename to controllerSleep
   */
  deviceSleep() {
    logging.debug('Spectoda::deviceSleep()')

    logging.info('> Sleeping Controller...')

    const request_uuid = this.#getUUID()
    const payload = [COMMAND_FLAGS.FLAG_SLEEP_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   * Puts ALL CONTROLLERS in the network Spectoda.js is `connect`ed to to sleep. To wake them up, power must be cycled by removing and reapplying it.
   */
  networkSleep() {
    logging.debug('Spectoda::networkSleep()')

    logging.info('> Sleeping all Controllers...')

    const request_uuid = this.#getUUID()
    const payload = [COMMAND_FLAGS.FLAG_SLEEP_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * Forces a TNGL variable state save on the connected controller. TNGL variable state is by default saved every 8 seconds atfer no event is emitted.
   */
  saveState() {
    logging.debug('Spectoda::saveState()')

    logging.info('> Forcing EventState values save in all Controllers...')

    const request_uuid = this.#getUUID()
    const payload = [COMMAND_FLAGS.FLAG_SAVE_STATE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * ! Useful
   * Changes the network of the controller Spectoda.js is `connect`ed to.
   */
  writeOwner(ownerSignature: NetworkSignature = NO_NETWORK_SIGNATURE, ownerKey: NetworkKey = NO_NETWORK_KEY) {
    logging.debug(`writeOwner(ownerSignature=${ownerSignature}, ownerKey=${ownerKey})`)

    logging.info('> Writing Network Signature+Key to Controller...')

    if (!ownerSignature || !ownerKey) {
      throw 'InvalidParameters'
    }

    if (ownerSignature == NO_NETWORK_SIGNATURE && ownerKey == NO_NETWORK_KEY) {
      logging.warn('> Removing owner instead of writing all zero owner')
      return this.removeOwner(false)
    }

    const owner_signature_bytes = hexStringToUint8Array(ownerSignature, 16)
    const owner_key_bytes = hexStringToUint8Array(ownerKey, 16)

    logging.verbose('owner_signature_bytes', owner_signature_bytes)
    logging.verbose('owner_key_bytes', owner_key_bytes)

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ADOPT_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...owner_signature_bytes,
      ...owner_key_bytes,
    ]

    logging.verbose(bytes)

    return this.runtime
      .request(bytes, true)
      .then((response) => {
        if (response === null) {
          throw 'NoResponseReceived'
        }

        const reader = new TnglReader(response)

        logging.verbose('response=', response)

        if (reader.readFlag() !== COMMAND_FLAGS.FLAG_ADOPT_RESPONSE) {
          throw 'InvalidResponse'
        }

        const response_uuid = reader.readUint32()

        if (response_uuid != request_uuid) {
          throw 'InvalidResponse'
        }

        // TODO rename to controllerMac
        let device_mac = 'null'

        const error_code = reader.readUint8()

        // error_code 0 is success
        if (error_code === 0) {
          const device_mac_bytes = reader.readBytes(6)

          device_mac = Array.from(device_mac_bytes, function (byte) {
            return ('0' + (byte & 0xff).toString(16)).slice(-2)
          }).join(':')
        }

        logging.verbose(`error_code=${error_code}, device_mac=${device_mac}`)

        if (error_code === 0) {
          // TODO Remove word adopted
          logging.info(`Adopted ${device_mac} successfully`)
          return {
            mac: device_mac,
            ownerSignature: this.#ownerSignature,
            ownerKey: this.#ownerKey,
            // Todo remove commented out code
            // name: newDeviceName,
            // id: newDeviceId,
          }
        } else {
          logging.warn('Adoption refused by device.')
          throw 'AdoptionRefused'
        }
      })
      .catch((e) => {
        logging.error('Error during writeOwner():', e)
        throw 'AdoptionFailed'
      })
  }

  /**
   * ! Useful
   * Changes the network of ALL controllers in the network Spectoda.js is `connect`ed to.
   */
  writeNetworkOwner(
    ownerSignature: NetworkSignature = '00000000000000000000000000000000',
    ownerKey: NetworkKey = '00000000000000000000000000000000',
  ) {
    logging.debug(`writeNetworkOwner(ownerSignature=${ownerSignature}, ownerKey=${ownerKey})`)

    logging.info('> Writing Network Signature+Key to all Controllers...')

    if (!ownerSignature || !ownerKey) {
      throw 'InvalidParameters'
    }

    if (ownerSignature == '00000000000000000000000000000000' && ownerKey == '00000000000000000000000000000000') {
      logging.warn('> Removing owner instead of writing all zero owner')
      return this.removeNetworkOwner()
    }

    const owner_signature_bytes = hexStringToUint8Array(ownerSignature, 16)
    const owner_key_bytes = hexStringToUint8Array(ownerKey, 16)

    logging.verbose('owner_signature_bytes', owner_signature_bytes)
    logging.verbose('owner_key_bytes', owner_key_bytes)

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ADOPT_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...owner_signature_bytes,
      ...owner_key_bytes,
    ]

    logging.verbose(bytes)

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   */
  writeControllerName(label: ValueTypeLabel) {
    logging.debug(`Spectoda::writeControllerName(label=${label})`)

    logging.info('> Writing Controller Name...')

    const request_uuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_NAME_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...stringToBytes(label, 16, false),
    ]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   */
  readControllerName() {
    logging.debug('Spectoda::readControllerName()')

    logging.info('> Reading Controller Name...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_READ_CONTROLLER_NAME_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_CONTROLLER_NAME_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let name = null

      if (error_code === 0) {
        name = reader.readString(16)
      } else {
        throw 'Fail'
      }

      logging.verbose(`name=${name}`)
      logging.info(`> Controller Name: ${name}`)

      return name
    })
  }

  /**
   * ! Useful
   * Write IO variant for a specific IO label in the controller config
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @param variant - variant name (max 16 characters)
   */
  writeControllerIoVariant(ioLabel: ValueTypeLabel, variant: string | null) {
    logging.debug(`Spectoda::writeControllerIoVariant(ioLabel=${ioLabel}, variant=${variant})`)

    logging.info('> Writing Controller IO Variant...')

    const request_uuid = this.#getUUID()
    const remove_io_variant = variant == null

    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_IO_VARIANT_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...labelToBytes(ioLabel),
      ...(remove_io_variant ? [] : stringToBytes(variant, 16, false)),
    ]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   * Write IO variant for a specific IO label in ALL CONNECTED CONTROLLERS in the network
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @param variant - variant name (max 16 characters)
   */
  writeNetworkIoVariant(ioLabel: ValueTypeLabel, variant: string | null) {
    logging.debug(`Spectoda::writeNetworkIoVariant(ioLabel=${ioLabel}, variant=${variant})`)

    logging.info('> Writing IO Variant for all Controllers...')

    const request_uuid = this.#getUUID()
    const remove_io_variant = variant == null

    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_IO_VARIANT_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...labelToBytes(ioLabel),
      ...(remove_io_variant ? [] : stringToBytes(variant, 16, false)),
    ]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * ! Useful
   * Read IO variant for a specific IO label from the controller config
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @returns The variant name for the specified IO label
   */
  readControllerIoVariant(ioLabel: ValueTypeLabel) {
    logging.debug(`Spectoda::readControllerIoVariant(ioLabel=${ioLabel})`)

    logging.info('> Reading Controller IO Variant...')

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_IO_VARIANT_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...labelToBytes(ioLabel),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_IO_VARIANT_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let variant = null

      if (error_code === 0) {
        variant = reader.readString(16)
      } else {
        throw 'Fail'
      }

      logging.verbose(`variant=${variant}`)
      logging.info(`> IO Variant of ${ioLabel}: ${variant}`)

      return variant
    })
  }

  writeControllerIoMapping(ioLabel: ValueTypeLabel, mapping: Array<ValueTypePixels> | null) {
    logging.debug(`Spectoda::writeControllerIoMapping(ioLabel=${ioLabel}, mapping=${mapping})`)

    logging.info('> Writing Controller IO Mapping...')

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_WRITE_IO_MAPPING_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...labelToBytes(ioLabel),
      ...(mapping ? numberToBytes(mapping.length, 2) : []), // size is uint16_t
      ...(mapping ? mapping.flatMap((num) => numberToBytes(num, 2)) : []), // each item is int16_t
    ]

    return this.runtime.request(bytes, false)
  }

  /**
   * ! Useful
   * Read IO mapping for a specific IO label from the controller config
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @returns The mapping for the specified IO label
   */
  readControllerIoMapping(ioLabel: ValueTypeLabel): Promise<Array<ValueTypePixels>> {
    logging.debug(`Spectoda::readControllerIoMapping(ioLabel=${ioLabel})`)

    logging.info('> Reading Controller IO Mapping...')

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_IO_MAPPING_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...labelToBytes(ioLabel),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_IO_MAPPING_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      let mapping = null

      if (error_code === 0) {
        const mapping_size = reader.readUint16()

        mapping = []

        for (let i = 0; i < mapping_size; i++) {
          mapping.push(reader.readInt16())
        }
      } else {
        throw 'Fail'
      }

      logging.verbose(`mapping=${mapping}`)
      logging.info(`> IO Mapping for ${ioLabel}: ${mapping}`)

      return mapping
    })
  }

  async WIP_emitTnglBytecode(bytecode: Uint8Array) {
    logging.debug(`Spectoda::WIP_emitTnglBytecode(bytecode.length=${bytecode?.length})`)

    logging.info('> Emitting TNGL Bytecode...')

    const connection = '/'
    const request = {
      args: {
        bytecode: bytecode,
      },
    }

    return this.runtime.spectoda_js.requestEmitTnglBytecode(connection, request)
  }

  /**
   * Lists all available network storage data present in the App Controller.
   *
   * See {@link Spectoda_JS.listNetworkStorageData} for implementation details.
   */
  listNetworkStorageData() {
    return this.runtime.spectoda_js.listNetworkStorageData()
  }

  /**
   * Emits (spreads) the provided network storage data through the Network using the execute command.
   *
   * See {@link Spectoda_JS.emitNetworkStorageData} for implementation details.
   *
   * @param data - The network storage data to emit across the network.
   */
  emitNetworkStorageData(data: NetworkStorageData) {
    return this.runtime.spectoda_js.emitNetworkStorageData(data)
  }

  /**
   * Sets (stores) the provided network storage data into the App Controller, which then synchronizes it to other
   * Controllers in the Network as the Network bandwidth allows.
   *
   * See {@link Spectoda_JS.setNetworkStorageData} for implementation details.
   *
   * @param data - The network storage data to set in the controller.
   */
  setNetworkStorageData(data: NetworkStorageData) {
    return this.runtime.spectoda_js.setNetworkStorageData(data)
  }

  /**
   * Reads the specified network storage data from the App Controller. May take a while to sycnhronize all
   * data from Network after connection. The data is cached in localstorage between reconnections.
   *
   * See {@link Spectoda_JS.getNetworkStorageData} for implementation details.
   *
   * @param name - The name of the network storage data to retrieve.
   */
  getNetworkStorageData(name: string) {
    return this.runtime.spectoda_js.getNetworkStorageData(name)
  }

  /**
   * Computes the fingerprint (hash) of the provided network storage data bytes.
   *
   * This function generates a unique fingerprint for the given network data, which can be used
   * to identify and compare different versions of the data for synchronization and validation purposes.
   *
   * @param bytes - The network storage data as a Uint8Array.
   */
  static computeNetworkStorageDataFingerprint(bytes: Uint8Array) {
    return (SpectodaWasm as unknown as MainModule).computeFingerprint32(bytes)
  }

  //* WIP
  async WIP_writeIoVariant(ioLabel: ValueTypeLabel, variant: string | null): Promise<void> {
    logging.verbose(`writeIoVariant(ioLabel=${ioLabel}, variant=${variant})`)

    logging.info('> Writing IO Variant...')

    const connection = '/'
    const request = {
      args: {
        label: ioLabel,
        variant: variant ? variant : '',
        remove_io_variant: variant == null,
      },
    }

    if (!this.runtime.spectoda_js.requestWriteIoVariant(connection, request)) {
      throw 'RequestFailed'
    }
  }

  //* WIP
  async WIP_writeIoMapping(ioLabel: ValueTypeLabel, mapping: number[] | null): Promise<void> {
    logging.verbose(`writeIoMapping(ioLabel=${ioLabel}, mapping=${mapping})`)

    logging.info('> Writing IO Mapping...')

    const connection = '/'
    const request = {
      args: {
        label: ioLabel,
        mapping: mapping ? new Int16Array(mapping) : new Int16Array(0),
        remove_io_mapping: mapping == null,
      },
    }

    if (!this.runtime.spectoda_js.requestWriteIoMapping(connection, request)) {
      throw 'RequestFailed'
    }
  }

  /**
   * Reads the TNGL variable on given ID from App's WASM
   */
  readVariable(variable_name: string, id: ValueTypeID = 255) {
    logging.debug(`Spectoda::readVariable(variable_name=${variable_name}, id=${id})`)

    logging.info('> Reading Variable by its Name...')

    const variable_declarations = this.#parser.getVariableDeclarations()

    logging.verbose('variable_declarations=', variable_declarations)

    let variable_address = undefined

    // check if the variable is already declared
    // look for the latest variable address on the stack
    for (const declaration of variable_declarations) {
      if (declaration.name === variable_name) {
        variable_address = declaration.address
        break
      }
    }

    if (variable_address === undefined) {
      throw 'VariableNotFound'
    }

    const variable_value = this.runtime.readVariableAddress(variable_address, id)

    logging.verbose(`variable_name=${variable_name}, id=${id}, variable_value=${variable_value.debug}`)

    return variable_value
  }

  /**
   * For FW nerds
   */
  readVariableAddress(variable_address: number, id: ValueTypeID = 255) {
    logging.debug(`Spectoda::readVariableAddress(variable_address=${variable_address}, id=${id})`)

    logging.info('> Reading Variable by its Address...')

    const memory_stack = this.#parser.getMemoryStack()

    logging.verbose(`memory_stack=${memory_stack}`)

    logging.info(
      `Reading memory address ${variable_address} for ID${id} with description: "${memory_stack[variable_address]}" ...`,
    )

    return this.runtime.readVariableAddress(variable_address, id)
  }

  /**
   * Hides the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  hideHomeButton() {
    return this.setHomeVisible(false)
  }

  /**
   * Shows the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  showHomeButton() {
    return this.setHomeVisible(true)
  }

  /**
   * Shows or hides the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  setHomeVisible(visible: boolean) {
    logging.debug(`Spectoda::setHomeVisible(visible=${visible})`)

    logging.info('> Hiding SpectodaConnect home button...')

    if (!detectSpectodaConnect()) {
      return Promise.reject('PlatformNotSupported')
    }

    return window.flutter_inappwebview?.callHandler('setHomeVisible', visible)
  }

  /**
   * Goes to the home screen on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  goHome() {
    logging.debug('Spectoda::goHome()')

    logging.info('> Going home in SpectodaConnect...')

    if (!detectSpectodaConnect()) {
      return Promise.reject('PlatformNotSupported')
    }

    return window.flutter_inappwebview?.callHandler('goHome')
  }

  /**
   * Sets orientation of the Flutter Spectoda Connect:
   * 0 = no restriction, 1 = portrait, 2 = landscape
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  setOrientation(option: number) {
    logging.debug(`Spectoda::setOrientation(option=${option})`)

    logging.info('> Setting orientation of SpectodaConnect...')

    if (!detectSpectodaConnect()) {
      return Promise.reject('PlatformNotSupported')
    }

    if (typeof option !== 'number') {
      return Promise.reject('InvalidOption')
    }

    if (option < 0 || option > 2) {
      return Promise.reject('InvalidOption')
    }

    // TODO remove any and replace flutter calling with SCF Bridge
    return window.flutter_inappwebview.callHandler('setOrientation', option as any)
  }

  // 0.9.4

  /**
   * ! Useful
   * Reads the network signature of the controller Spectoda.js is `connect`ed to.
   */
  readNetworkSignature() {
    logging.debug('Spectoda::readNetworkSignature()')

    logging.info('> Reading Network Signature from the Controller...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_READ_OWNER_SIGNATURE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_OWNER_SIGNATURE_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code !== 0) {
        throw 'Fail'
      }

      const signature_bytes = reader.readBytes(16)

      logging.debug(`signature_bytes=${signature_bytes}`)

      const signature_string = uint8ArrayToHexString(signature_bytes)

      logging.debug(`signature_string=${signature_string}`)

      logging.info(`> Network Signature: ${signature_string}`)

      return signature_string
    })
  }

  /**
   * Write PCB Code and Product Code. Used when manufacturing a controller
   *
   * PCB Code is a code of a specific PCB. A printed circuit of a special type. You can connect many inputs and many outputs to it. E.g. Spectoda Industry A6 controller.
   *
   * Product Code is a code of a specific product. A product is a defined, specific configuration of inputs and outputs that make up a whole product. E.g. NARA Lamp (two LED outputs of certain length and a touch button), Sunflow Lamp (three LED outputs, push button)
   */
  writeControllerCodes(pcb_code: PcbCode, product_code: ProductCode) {
    logging.debug(`Spectoda::writeControllerCodes(pcb_code=${pcb_code}, product_code=${product_code})`)

    logging.info('> Writing Controller PCB+Product Codes...')

    const request_uuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_CODES_REQUEST,
      ...numberToBytes(request_uuid, 4),
      ...numberToBytes(pcb_code, 2),
      ...numberToBytes(product_code, 2),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_CODES_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code !== 0) {
        throw 'Fail'
      }
    })
  }

  /**
   * ! Useful
   * Get PCB Code and Product Code. For more information see `writeControllerCodes`
   */
  readControllerCodes() {
    logging.debug('Spectoda::readControllerCodes()')

    logging.info('> Reading Controller PCB+Product Codes ...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_READ_CONTROLLER_CODES_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose('response=', response)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_CONTROLLER_CODES_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code !== 0) {
        throw 'Fail'
      }

      const pcb_code = reader.readUint16()
      const product_code = reader.readUint16()

      logging.debug(`pcb_code=${pcb_code}`)
      logging.debug(`product_code=${product_code}`)

      logging.info(`> Controller Codes: ${pcb_code}, ${product_code}`)

      return { pcb_code: pcb_code, product_code: product_code }
    })
  }

  /**
   * For FW nerds
   */
  execute(bytecode: number[]) {
    return this.runtime.execute(bytecode, undefined)
  }

  /**
   * Emits SpectodaAppEvents
   * TODO: should be private and renamed to `emitAppEvent` as SpectodaCore should not be able to emit AppEvents on Spectoda object
   * todo @immakermatty use the correct event-value pairing from PropMap, do not use any
   */
  emit(event: SpectodaAppEventName, value: any) {
    this.runtime.emit(event, value)
  }

  /**
   * Reloads the window or restarts node process. Useful when connected to the device via Remote control.
   * TODO: This is not really a "FW communication feature", should be moved to another function. Spectoda.JS should take care only of the communication with the device.
   */
  reload() {
    this.disconnect()

    setTimeout(() => {
      if (detectNode()) {
        process.exit(1)
      } else {
        if (window && window.location) {
          window.location.reload()
        }
      }
    }, 1000)

    return Promise.resolve()
  }

  /**
   * Reloads the TNGL in this APP Controller
   * Can be used to reset EventStateStore
   * ! TODO refator: Does not work correctly for now because it cannot edit eventStateStore in core. Implementation needs to be fixed by @immakermatty
   */
  reloadTngl() {
    logging.debug('Spectoda::reloadTngl()')

    logging.info('> Reloading TNGL of the APP Controller...')

    return this.runtime.spectoda_js.requestReloadTngl('/')
  }

  /**
   * Erase current TNGL of the whole network
   */
  eraseTngl() {
    logging.debug('Spectoda::eraseTngl()')

    logging.info('> Erasing TNGL from all Controllers...')

    const request_uuid = this.#getUUID()
    const command_bytes = [COMMAND_FLAGS.FLAG_ERASE_TNGL_BYTECODE_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.execute(command_bytes, undefined)
  }

  /**
   * TNGL BANKS: A concept in which you can save Tngl to different memory banks, and then load them when you need. Used to speed up tngl synchronization in installations where all animations don't fit to one Tngl file
   */

  /**
   * Save the current uploaded Tngl (via `writeTngl) to the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  saveTnglBank(tngl_bank: TnglBank) {
    logging.debug(`Spectoda::saveTnglBank(tngl_bank=${tngl_bank})`)

    logging.info(`> Saving TNGL to bank ${tngl_bank}...`)

    const request_uuid = this.#getUUID()
    const command_bytes = [
      COMMAND_FLAGS.FLAG_SAVE_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(request_uuid, 4),
      tngl_bank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(command_bytes, undefined)
  }

  /**
   * Load the Tngl from the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  loadTnglBank(tngl_bank: TnglBank) {
    logging.debug(`Spectoda::loadTnglBank(tngl_bank=${tngl_bank})`)

    logging.info(`> Loading TNGL from bank ${tngl_bank}...`)

    const request_uuid = this.#getUUID()
    const command_bytes = [
      COMMAND_FLAGS.FLAG_LOAD_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(request_uuid, 4),
      tngl_bank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(command_bytes, undefined)
  }

  /**
   * Erase the Tngl from the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  eraseTnglBank(tngl_bank: TnglBank) {
    logging.debug(`Spectoda::eraseTnglBank(tngl_bank=${tngl_bank})`)

    logging.info(`> Erasing TNGL bank ${tngl_bank} from all Controllers...`)

    const request_uuid = this.#getUUID()
    const command_bytes = [
      COMMAND_FLAGS.FLAG_ERASE_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(request_uuid, 4),
      tngl_bank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(command_bytes, undefined)
  }

  getEventStates(event_state_label: ValueTypeLabel, event_state_ids: ValueTypeIDs) {
    return this.runtime.getEventStates(event_state_label, event_state_ids)
  }

  getEventState(event_state_label: ValueTypeLabel, event_state_id: ValueTypeID) {
    return this.runtime.getEventState(event_state_label, event_state_id)
  }

  getDateTime() {
    return this.runtime.getDateTime()
  }

  /** Refactor suggestion by @mchlkucera registerIDContext */
  registerDeviceContexts(ids: ValueTypeIDs) {
    return this.runtime.registerDeviceContexts(ids)
  }

  /** Refactor suggestion by @mchlkucera registerIDContext */
  registerDeviceContext(id: ValueTypeID) {
    return this.runtime.registerDeviceContext(id)
  }

  /**
   * ! This function needs a refactor to extract the events directly from WASM via a API function call
   *
   * Gets the current state of events for the specified IDs. The resulting JSON event array
   * represents a scene that can be later applied by calling emitEvents().
   *
   * @param ids - Single ID or array of device IDs to get events for
   * @returns Array of events representing the current scene state
   */
  getEmittedEvents(ids: ValueTypeIDs) {
    logging.debug(`Spectoda::getEmittedEvents(ids=${Array.isArray(ids) ? '[' + ids.join(',') + ']' : ids})`)

    logging.info('> Getting emitted events...')

    // Check if ids is not an array and make it an array if necessary
    if (!Array.isArray(ids)) {
      ids = [ids]
    }

    // TODO refactor getting events from WASM
    this.#__events = {}
    for (let id = 0; id < 256; id++) {
      this.#__events[id] = {}
    }

    const unregisterListenerEmittedevents = this.runtime.on(
      SpectodaAppEvents.EMITTED_EVENTS,
      (events: EventState[]) => {
        for (const event of events) {
          if (event.id === 255) {
            for (let id = 0; id < 256; id++) {
              if (!this.#__events[id][event.label]) {
                this.#__events[id][event.label] = {}
              }

              if (
                !this.#__events[id][event.label] ||
                !this.#__events[id][event.label].timestamp ||
                event.timestamp >= this.#__events[id][event.label].timestamp
              ) {
                this.#__events[id][event.label].type = event.type
                this.#__events[id][event.label].value = event.value
                this.#__events[id][event.label].id = id
                this.#__events[id][event.label].label = event.label
                this.#__events[id][event.label].timestamp = event.timestamp
              }
            }

            continue
          }

          if (!this.#__events[event.id][event.label]) {
            this.#__events[event.id][event.label] = {}
          }

          if (
            !this.#__events[event.id][event.label] ||
            !this.#__events[event.id][event.label].timestamp ||
            event.timestamp >= this.#__events[event.id][event.label].timestamp
          ) {
            this.#__events[event.id][event.label].type = event.type
            this.#__events[event.id][event.label].value = event.value
            this.#__events[event.id][event.label].id = event.id
            this.#__events[event.id][event.label].label = event.label
            this.#__events[event.id][event.label].timestamp = event.timestamp
          }
        }

        logging.verbose('#__events', this.#__events)
      },
    )

    this.runtime.spectoda_js.eraseHistory()

    // ! let the events to be synchronized via the CPP networking layer
    return sleep(10000)
      .then(() => {
        const events = []

        for (const id of ids) {
          for (const event in this.#__events[id]) {
            events.push(this.#__events[id][event])
          }
        }

        // Step 2: Sort the events by timestamp
        events.sort((a, b) => a.timestamp - b.timestamp)

        const eventsJson = '[\n' + events.map((event) => JSON.stringify(event)).join(',\n') + '\n]'

        logging.info('> Events:', eventsJson)

        // Stringify with formatting to put objects on separate lines
        return eventsJson
      })
      .finally(() => {
        unregisterListenerEmittedevents()
        this.#__events = {}
      })
  }

  /**
   * Emits events to the Spectoda network. This function is used to apply Scenes.
   * As Scenes are just a list of events, this function is used to apply them.
   *
   * @remarks
   * The following event value types are not yet implemented:
   * - number (VALUE_TYPES.NUMBER)
   * - date (VALUE_TYPES.DATE)
   * - pixels (VALUE_TYPES.PIXELS)
   * - boolean/bool (VALUE_TYPES.BOOLEAN)
   *
   * Currently implemented types:
   * - label (VALUE_TYPES.LABEL)
   * - timestamp/time (VALUE_TYPES.TIME)
   * - percentage (VALUE_TYPES.PERCENTAGE)
   * - color (VALUE_TYPES.COLOR)
   * - none/null (VALUE_TYPES.NULL)
   *
   * @param events - Array of events or single event to emit
   * @param events[].label - Event label/name
   * @param events[].type - Event value type (string or ValueType enum)
   * @param events[].value - Event value (null, string, number or boolean)
   * @param events[].id - Event ID
   * @param events[].timestamp - Event timestamp
   * @returns Promise that resolves when events are emitted
   */
  emitEvents(
    events:
      | Pick<EventState, 'label' | 'type' | 'value' | 'id'>[]
      | {
          // TODO @immakermatty remove this generic event type, use only SpectodaEvent
          label: ValueTypeLabel
          // TODO Make this only ValueType, why string?
          type: string | ValueType
          value: null | string | number | boolean
          id: ValueTypeID
          timestamp: number
        }[],
  ) {
    logging.debug('Spectoda::emitEvents()')

    logging.info('> Emitting Events...')

    if (typeof events === 'string') {
      const parsed = JSON.parse(events)
      const validated = EventStateSchema.array().safeParse(parsed)

      if (validated.success) {
        events = validated.data
      } else {
        // TODO Handle validation error
      }
    }

    // Check if events is not an array and make it an array if necessary
    if (!Array.isArray(events)) {
      events = [events]
    }

    // NUMBER: 29,
    // LABEL: 31,
    // TIME: 32,
    // PERCENTAGE: 30,
    // DATE: 28,
    // COLOR: 26,
    // PIXELS: 19,
    // BOOLEAN: 2,
    // NULL: 1,
    // UNDEFINED: 0,

    // TODO! add all the event types

    for (const event of events) {
      switch (event.type) {
        // TODO
        // case "number":
        // case VALUE_TYPES.NUMBER: {
        //   this.emitNumber(event.label, event.value as number, event.id);
        //   break;
        // }
        case 'label':
        case VALUE_TYPES.LABEL: {
          this.emitLabel(event.label, event.value as string, event.id)
          break
        }
        case 'timestamp':
        case 'time':
        case VALUE_TYPES.TIMESTAMP: {
          this.emitTimestamp(event.label, event.value as number, event.id)
          break
        }
        case 'percentage':
        case VALUE_TYPES.PERCENTAGE: {
          this.emitPercentage(event.label, event.value as number, event.id)
          break
        }
        // TODO
        // case 'date':
        // case VALUE_TYPES.DATE: {
        //   this.emitDate(event.label, event.value as string, event.id);
        //   break;
        // }
        case 'color':
        case VALUE_TYPES.COLOR: {
          this.emitColor(event.label, event.value as string, event.id)
          break
        }
        // TODO
        // case "pixels":
        // case VALUE_TYPES.PIXELS: {
        //   this.emitPixels(event.label, event.value as number, event.id);
        //   break;
        // }
        // TODO
        // case "boolean":
        // case "bool":
        // case VALUE_TYPES.BOOLEAN: {
        //   this.emitBoolean(event.label, event.value as boolean, event.id);
        //   break;
        // }
        case 'none':
        case 'null':
        case VALUE_TYPES.NULL: {
          this.emitEvent(event.label, event.id)
          break
        }
        default: {
          logging.warn(`Unknown event type: ${event.type}`)
          break
        }
      }
    }
  }

  /**
   * Returns information object about the connected controller
   *
   * Implemented in FW 0.12.4, extended in FW 0.12.11
   */
  async readControllerInfo(): Promise<ControllerInfo> {
    logging.debug('Spectoda::readControllerInfo()')

    logging.info('> Reading Controller info...')

    const request_uuid = this.#getUUID()
    const bytes = [COMMAND_FLAGS.FLAG_READ_CONTROLLER_INFO_REQUEST, ...numberToBytes(request_uuid, 4)]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        logging.info('No response received from controller')
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      const responseFlag = reader.readFlag()

      if (responseFlag !== COMMAND_FLAGS.FLAG_READ_CONTROLLER_INFO_RESPONSE) {
        logging.info(`Invalid response flag received: ${responseFlag}`)
        throw 'InvalidResponseFlag'
      }

      const response_uuid = reader.readUint32()

      if (response_uuid != request_uuid) {
        logging.info(`UUID mismatch - Request: ${request_uuid}, Response: ${response_uuid}`)
        throw 'InvalidResponseUuid'
      }

      const error_code = reader.readUint8()

      logging.verbose(`error_code=${error_code}`)

      if (error_code === 0) {
        // Read all the controller info fields in order matching interface.cpp
        const full_name = reader.readString(16).trim() // NAME_STRING_MAX_SIZE
        const label = reader.readString(6).trim() // 5 chars + null terminator
        const mac_bytes = reader.readBytes(6) // MAC_SIZE
        const controller_flags = reader.readUint8()
        const __reserved1 = reader.readUint8() // reserved for potential flags increase

        const pcb_code = reader.readUint16()
        const product_code = reader.readUint16()
        const fw_version_code = reader.readUint16()
        const fw_platform_code = reader.readUint16() // added in FW 0.12.11

        const fw_compilation_unix_timestamp = reader.readUint64()
        const __reserved2 = reader.readUint64() // reserved

        const fw_version_full = reader.readString(FW_VERSION_FULL_BYTES).trim() // FW_VERSION_STRING_MAX_SIZE
        const tngl_fingerprint = reader.readBytes(TNGL_FINGERPRINT_BYTES) // TNGL_FINGERPRINT_SIZE
        const event_store_fingerprint = reader.readBytes(EVENT_STORE_FINGERPRINT_BYTES) // HISTORY_FINGERPRINT_SIZE
        const config_fingerprint = reader.readBytes(CONFIG_FINGERPRINT_BYTES) // CONFIG_FINGERPRINT_SIZE
        const network_signature = reader.readBytes(NETWORK_SIGNATURE_BYTES) // NETWORK_SIGNATURE_SIZE

        const is_extended = reader.available >= ALL_METADATA_BYTES // added in FW 0.12.11

        const __reserved3 = is_extended ? reader.readBytes(16) : new Uint8Array(16) // reserved for potential network signature growth to 32 bytes in 0.13.0
        const networkstorage_fingerprint = is_extended ? reader.readBytes(32) : new Uint8Array(32) // NETWORKSTORAGE_FINGERPRINT_SIZE
        const controllerstore_fingerprint = is_extended ? reader.readBytes(32) : new Uint8Array(32) // CONTROLLERSTORE_FINGERPRINT_SIZE
        const notificationstore_fingerprint = is_extended ? reader.readBytes(32) : new Uint8Array(32) // NOTIFICATIONSTORE_FINGERPRINT_SIZE
        const __reserved4 = is_extended ? reader.readBytes(32) : new Uint8Array(32) // reserved for another fingerprint
        const __reserved5 = is_extended ? reader.readBytes(32) : new Uint8Array(32) // reserved for another fingerprint

        // fw version string from code
        const fw_version_short = `${Math.floor(fw_version_code / 10000)}.${Math.floor(
          (fw_version_code % 10000) / 100,
        )}.${fw_version_code % 100}`

        // get Commissionable flag
        const COMMISSIONABLE_FLAG_BIT_POSITION = 0
        const commissionable = !!(controller_flags & (1 << COMMISSIONABLE_FLAG_BIT_POSITION))

        // Format MAC address
        const mac_address = Array.from(mac_bytes, (byte) => byte.toString(16).padStart(2, '0')).join(':')

        // Format fingerprints and signature as hex strings
        const network_signature_hex = uint8ArrayToHexString(network_signature)
        const tngl_fingerprint_hex = uint8ArrayToHexString(tngl_fingerprint)
        const event_store_fingerprint_hex = uint8ArrayToHexString(event_store_fingerprint)
        const config_fingerprint_hex = uint8ArrayToHexString(config_fingerprint)
        const networkstorage_fingerprint_hex = uint8ArrayToHexString(networkstorage_fingerprint)
        const controllerstore_fingerprint_hex = uint8ArrayToHexString(controllerstore_fingerprint)
        const notificationstore_fingerprint_hex = uint8ArrayToHexString(notificationstore_fingerprint)

        // Mock data:
        // TODO @immakermatty move mock data to __mocks__ directory
        /* {
         *   connectionCriteria: {
         *     name: string = "SC_01",
         *     product: number = 2,
         *     mac: string = "01:23:45:56:ab:cd",
         *     fw: string = "0.12.4",
         *     network: string = "14fe7f8214fe7f8214fe7f8214fe7f82",
         *     commissionable: boolean = false
         *   }
         *   fullName: string = "SC_01",
         *   controllerLabel: string = "SC_01",
         *   commissionable: boolean = false,
         *   pcbCode: number = 1,
         *   productCode: number = 2,
         *   macAddress: string = "01:23:45:56:ab:cd",
         *   fwVersionFull: string = "FW_0.12.1_20241117",
         *   fwVersion: : string = "0.12.1",
         *   fwVersionCode: number = 1201,
         *   fwPlatformCode: number = 1,
         *   fwCompilationUnixTimestamp: number = 1743879238912,
         *   networkSignature: string = "14fe7f8214fe7f8214fe7f8214fe7f82",
         *   tnglFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039",
         *   eventStoreFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039",
         *   configFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039"
         *   networkStorageFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039",
         *   controllerStoreFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039",
         *   notificationStoreFingerprint: string = "ba5a56fbe0fc8c3e2b545130e43499a6d2e8debb11bf09a280dce1623a0a7039"
         * }
         */

        const info = {
          // connection criteria
          controllerLabel: label,
          productCode: product_code,
          macAddress: mac_address,
          fwVersion: fw_version_short,
          networkSignature: network_signature_hex,
          commissionable: commissionable,

          fullName: full_name,
          pcbCode: pcb_code,
          fwVersionFull: fw_version_full,
          fwVersionCode: fw_version_code,
          fwPlatformCode: fw_platform_code,
          fwCompilationUnixTimestamp: fw_compilation_unix_timestamp,
          tnglFingerprint: tngl_fingerprint_hex,
          eventStoreFingerprint: event_store_fingerprint_hex,
          configFingerprint: config_fingerprint_hex,
          networkStorageFingerprint: networkstorage_fingerprint_hex,
          controllerStoreFingerprint: controllerstore_fingerprint_hex,
          notificationStoreFingerprint: notificationstore_fingerprint_hex,
        } as ControllerInfo

        logging.info('> Controller Info:', info)
        return info
      } else {
        logging.error(`Request failed with error code: ${error_code}`)
        throw 'Fail'
      }
    })
  }
}
