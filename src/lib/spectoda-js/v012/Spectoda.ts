// TODO Figure out how to make interface Window { ... } work without this empty import

import { TnglCodeParser } from './SpectodaParser'
import type { } from './src/types/global'
import { TimeTrack } from './TimeTrack'
import './TnglReader'
import { TnglReader } from './TnglReader'
import './TnglWriter'

import type { ConnectionInfo, EventState } from '.'
import { ControllerRef } from './src/ControllerRef'
import {
  cssColorToHex,
  detectNode,
  detectSpectodaConnect,
  fetchFirmware,
  hexStringToUint8Array,
  labelToBytes,
  numberToBytes,
  sleep,
  stringToBytes,
  strMacToBytes,
  uint8ArrayToHexString,
} from './functions'
import { logging } from './logging'
import {
  COMMAND_FLAGS,
  CONNECTORS,
  DEFAULT_CONNECTOR,
  DEFAULT_TIMEOUT,
  TNGL_SIZE_CONSIDERED_BIG,
  UNCOMMISSIONED_NETWORK_KEY,
  UNCOMMISSIONED_NETWORK_SIGNATURE,
} from './src/constants'
import { JS_EVENT_VALUE_LIMITS as VALUE_LIMITS } from './src/constants/limits'
import { VALUE_TYPES, type ValueType } from './src/constants/values'
import { RemoteControlReceiver } from './src/rc/v1/RemoteControlReceiver'
import { makeSpectodaVirtualProxy } from './src/rc/v1/RemoteControlSender'
import { SpectodaRuntime } from './src/SpectodaRuntime'
import { SpectodaWasm } from './src/SpectodaWasm'
import { EventStateSchema } from './src/schemas/event'
import { preprocessTngl } from './src/TnglPreprocessor'
import {
  type SpectodaAppEventMap,
  type SpectodaAppEventName,
  SpectodaAppEvents,
} from './src/types/app-events'
import {
  CONNECTION_STATUS,
  type ConnectionStatus,
  type ConnectOptions,
  type ConnectorType,
  type ScanOptions,
} from './src/types/connect'
import type {
  ControllerInfo,
  Criteria,
  Criterium,
  NetworkKey,
  NetworkSignature,
  NetworkStorageData,
  PcbCode,
  ProductCode,
  TnglBank,
  ValueTypeLabel,
} from './src/types/primitives'
import type { SpectodaClass } from './src/types/spectodaClass'
import type {
  SpectodaIdsType,
  SpectodaIdType,
  ValueTypeBoolean,
  ValueTypeColor,
  ValueTypeDate,
  ValueTypeNumber,
  ValueTypePercentage,
  ValueTypePixels,
  ValueTypeTimestamp,
} from './src/types/values'
import type { MainModule } from './src/types/wasm'
import { getSpectodaVersion, type SpectodaVersion } from './src/version'

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
  timeline: TimeTrack
  runtime: SpectodaRuntime
  #remoteControlReceiver: RemoteControlReceiver | null = null

  /**
   * @deprecated Use emitEvent() instead to match the function names with BerryLang codebase
   */
  emitNullEvent = this.emitEvent
  /**
   * @deprecated Use emitEvent() instead to match the function names with BerryLang codebase
   */
  emitNull = this.emitEvent
  /**
   * @deprecated Use emitTimestamp() instead to match the function names with BerryLang codebase
   */
  emitTimestampEvent = this.emitTimestamp
  /**
   * @deprecated Use emitColor() instead to match the function names with BerryLang codebase
   */
  emitColorEvent = this.emitColor
  /**
   * @deprecated Use emitPercentage() instead to match the function names with BerryLang codebase
   */
  emitPercentageEvent = this.emitPercentage
  /**
   * @deprecated Use emitLabel() instead to match the function names with BerryLang codebase
   */
  emitLabelEvent = this.emitLabel
  #parser: TnglCodeParser
  #uuidCounter: number
  #updating: boolean
  #connectionState: ConnectionStatus
  #criteria: Criteria
  #reconnecting: boolean
  #autonomousReconnection: boolean
  #wakeLock: WakeLockSentinel | null | undefined
  #isPrioritizedWakelock: boolean
  #reconnectionIntervalHandle: any
  // ? This is used for getEmittedEvents() to work properly
  #__events: any

  constructor(
    connectorType: ConnectorType = DEFAULT_CONNECTOR,
    reconnecting = true,
  ) {
    this.#parser = new TnglCodeParser()

    this.#uuidCounter = Math.floor(Math.random() * 0xffffffff)

    this.timeline = new TimeTrack(0, true)
    this.runtime = new SpectodaRuntime(this)

    if (connectorType !== CONNECTORS.NONE) {
      try {
        this.runtime.assignConnector(connectorType)
      } catch (e) {
        logging.error(e)
      }
    }

    this.#updating = false

    this.#reconnecting = !!reconnecting
    this.#connectionState = CONNECTION_STATUS.DISCONNECTED

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

      if (
        this.getConnectionState() === CONNECTION_STATUS.CONNECTED &&
        this.#reconnecting
      ) {
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

  getConnectionState() {
    return this.#connectionState
  }

  /**
   * Returns the current spectoda-js version information.
   *
   * This method is used by spectoda-core to determine which API signatures
   * are supported when communicating with remote control receivers.
   *
   * @returns SpectodaVersion object containing wasmFullVersion and jsRevision
   *
   * @example
   * const version = spectoda.version()
   * console.log(version.wasmFullVersion) // "DEBUG_UNIVERSAL_0.12.11_20251123"
   * console.log(version.jsRevision)      // 1
   */
  version(): SpectodaVersion {
    return getSpectodaVersion()
  }

  /**
   * Calls WakeLock API to prevent the screen from turning off.
   * TODO: Move to different file. Not a spectoda.js concern.
   */
  async requestWakeLock(prioritized = false): Promise<void> {
    logging.debug(`Spectoda::requestWakeLock(prioritized=${prioritized})`)

    logging.info('> Activating wakeLock...')

    if (prioritized) {
      this.#isPrioritizedWakelock = true
    }

    // Node environment
    if (detectNode()) {
      return
    }
    // SpectodaConnect environment
    else if (detectSpectodaConnect()) {
      try {
        await window.flutter_inappwebview.callHandler('setWakeLock', true)
      } catch (e) {
        logging.warn('SpectodaConnect Wakelock activation failed.', e)
        throw e
      }
      return
    }
    // Web environment
    else if ('wakeLock' in navigator) {
      try {
        const wakeLock = await navigator.wakeLock.request('screen')
        logging.info('Web Wakelock activated.')
        this.#wakeLock = wakeLock
      } catch (e) {
        logging.warn('Web Wakelock activation failed.', e)
        throw e
      }
      return
    }
    //
    else {
      logging.warn('WakeLock API not supported in this environment.')
      throw new Error('WakeLock API not supported in this environment.')
    }
  }

  /**
   * Calls WakeLock API to release the screen from being prevented from turning off.
   * TODO: Move to different file. Not a spectoda.js concern.
   */
  async releaseWakeLock(prioritized = false): Promise<void> {
    logging.debug(`Spectoda::releaseWakeLock(prioritized=${prioritized})`)

    logging.info('> Deactivating wakeLock...')

    if (prioritized) {
      this.#isPrioritizedWakelock = false
    } else if (this.#isPrioritizedWakelock) {
      return
    }

    // Node environment
    if (detectNode()) {
      return
    }
    // SpectodaConnect environment
    else if (detectSpectodaConnect()) {
      try {
        await window.flutter_inappwebview.callHandler('setWakeLock', false)
      } catch (e) {
        logging.warn('SpectodaConnect Wakelock deactivation failed.', e)
        throw e
      }
      return
    }
    // Web environment
    else {
      try {
        if (this.#wakeLock) {
          await this.#wakeLock.release()
          logging.info('Web Wakelock deactivated.')
          this.#wakeLock = null
        }
      } catch (e) {
        logging.warn('Web Wakelock deactivation failed.', e)
        throw e
      }
    }
  }

  /**
   * @alias this.setConnector
   */
  async installRemoteControlReceiver(options: {
    signature: string
    key: string
    sessionOnly: boolean
    meta: object
  }) {
    // Uninstall any existing receiver
    if (this.#remoteControlReceiver) {
      this.#remoteControlReceiver.uninstall()
    }

    this.#remoteControlReceiver = new RemoteControlReceiver()
    return this.#remoteControlReceiver.install(this, options)
  }

  /**
   * Disconnects Remote Control receiving.
   *
   * Named "uninstall" to differentiate from spectoda-core's disableRemoteControl()
   * which manages state and calls this lower-level method.
   */
  uninstallRemoteControlReceiver() {
    this.#remoteControlReceiver?.uninstall()
    this.#remoteControlReceiver = null
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
  addEventListener<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ) {
    return this.runtime.addEventListener(event, callback)
  }

  /**
   * @alias this.addEventListener
   */
  on<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ) {
    return this.runtime.on(event, callback)
  }

  /**
   * Transfers all runtime-registered listeners from this instance to another
   * Spectoda-like instance (typically the Remote Control sender proxy).
   *
   * It reads the internal listener registry from `this.runtime` and
   * re-subscribes the same callbacks on the `target`'s `on` method, then
   * clears the registry on this instance.
   */
  transferListenersTo(target: Spectoda) {
    if (!target?.on) {
      return
    }

    const registeredListeners = this.runtime.getRegisteredListeners() as Map<
      string,
      Set<(props: any) => void>
    >

    registeredListeners.forEach((listeners, event) => {
      listeners.forEach((listener) => {
        target.on?.(event as SpectodaAppEventName, listener)
      })
    })

    registeredListeners.clear()
  }

  /**
   * ! Useful
   * Scans for controllers that match the given criteria around the user.
   *
   * @param connector - The connector type to use for scanning (e.g., 'bluetooth', 'serial')
   * @param criteria - Filter criteria for device discovery (network, fw, mac, name, etc.)
   * @param options - Scan options (timeout)
   * @returns Array of discovered devices matching the criteria
   *
   * @example
   * // Scan for all devices
   * spectoda.scan('bluetooth', {})
   *
   * // Scan for devices on a specific network
   * spectoda.scan('bluetooth', { network: 'abc123...' }, { scanPeriod: 5000 })
   *
   * @remarks
   * **Remote Control Compatibility (JS Revision 1):**
   * When this method is called over Remote Control, the receiver might be running
   * an older version of spectoda-js (JS Revision 0) that uses the legacy signature:
   * ```
   * scan(criteria: Criteria, scanPeriod: number)
   * ```
   * The `spectoda-core` package provides `scanWithRevisionFallback()` which checks the receiver's
   * JS revision via `spectoda.version()` and calls the appropriate signature.
   *
   * @see JS_REVISION_CHANGELOG.md for details on API changes between revisions
   */
  async scan(
    connector: ConnectorType,
    criteria: Criteria = {},
    options: ScanOptions = {},
  ) {
    const { scanPeriod = DEFAULT_TIMEOUT } = options

    logging.debug(
      `Spectoda::scan(connector=${connector}, criteria=${JSON.stringify(criteria)}, options=${JSON.stringify(options)})`,
    )

    // Assign connector for scanning
    this.runtime.assignConnector(connector)

    // Normalize criteria to array
    const criteriaArray: Criterium[] = Array.isArray(criteria)
      ? criteria
      : [criteria]

    logging.info('> Scanning for Controllers...')
    return this.runtime.scan(criteriaArray, scanPeriod)
  }

  /**
   * ! Useful
   * Connects to a controller that matches the given criteria.
   * In web environment, this launches the "Select Device" dialog.
   * If connection is already established, it will first disconnect and then connect again.
   *
   * @param connector - The connector type to use (e.g., 'bluetooth', 'serial', 'websockets', 'simulated')
   * @param criteria - Filter criteria for device selection (network, key, fw, mac, name, etc.)
   * @param options - Connection options (autoSelect, overrideConnection, autonomousReconnection)
   * @returns The criteria of the connected controller, or null if connection failed
   *
   * @example
   * // Connect to a specific network
   * spectoda.connect('bluetooth', { network: 'abc123...', key: 'def456...' })
   *
   * // Connect to any device with auto-selection
   * spectoda.connect('bluetooth', {}, { autoSelect: true })
   *
   * // Connect with autonomous reconnection
   * spectoda.connect('bluetooth', { network: '...' }, { autonomousReconnection: true })
   *
   * @remarks
   * **Remote Control Compatibility (JS Revision 1):**
   * When this method is called over Remote Control, the receiver might be running
   * an older version of spectoda-js (JS Revision 0) that uses the legacy signature:
   * ```
   * connect(criteria: Criteria, autoConnect: boolean, ownerSignature: NetworkSignature, ownerKey: NetworkKey, connectAny: boolean, fwVersion: string, autonomousReconnection: boolean, overrideConnection: boolean)
   * ```
   * The `spectoda-core` package provides `connectWithRevisionFallback()` which checks the receiver's
   * JS revision via `spectoda.version()` and calls the appropriate signature.
   *
   * @see JS_REVISION_CHANGELOG.md for details on API changes between revisions
   */
  async connect(
    connector: ConnectorType,
    criteria: Criteria,
    options: ConnectOptions = {},
  ): Promise<Criterium | null> {
    const {
      autoSelect = false,
      overrideConnection = false,
      autonomousReconnection = false,
    } = options

    logging.debug(
      `Spectoda::connect(connector=${connector}, criteria=${JSON.stringify(criteria)}, options=${JSON.stringify(options)})`,
    )

    // Assign connector
    this.runtime.assignConnector(connector)

    this.#autonomousReconnection = autonomousReconnection

    if (
      !overrideConnection &&
      this.getConnectionState() === CONNECTION_STATUS.CONNECTING
    ) {
      throw 'ConnectingInProgress'
    }

    // Normalize criteria to array
    let criteriaArray: Criterium[]
    if (criteria && typeof criteria === 'object') {
      criteriaArray = Array.isArray(criteria) ? criteria : [criteria]
    } else {
      criteriaArray = [{}]
    }

    this.#criteria = criteriaArray

    return this.#connect(autoSelect)
  }

  /**
   * ! Useful
   * Disconnects from the connected controller.
   */
  async disconnect() {
    logging.debug('Spectoda::disconnect()')

    this.#autonomousReconnection = false

    logging.info('> Disconnecting controller...')

    if (this.getConnectionState() === CONNECTION_STATUS.DISCONNECTED) {
      logging.warn('> Controller already disconnected')
      return
    }

    this.#setConnectionState(CONNECTION_STATUS.DISCONNECTING)

    return this.runtime.disconnect()
  }

  /**
   * ! Useful
   * Returns a promise that resolves to the criteria of the connected controller.
   */
  async connected() {
    logging.debug('Spectoda::connected()')

    return this.runtime.connected()
  }

  /**
   * ! Useful
   * Cancels the current connect or scan operation.
   */
  async cancel() {
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
  async preprocessTngl(tnglCode: string) {
    logging.debug('Spectoda::preprocessTngl(tngl_code=${tnglCode})')

    logging.info('> Preprocessing TNGL code...')

    return preprocessTngl(tnglCode)
  }

  /**
   * Gets the TNGL code from the controller to the WASM runtime.
   */
  async syncTngl() {
    logging.debug('Spectoda::syncTngl()')

    logging.info('> Reading TNGL bytecode...')

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_READ_TNGL_BYTECODE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(commandBytes, true).then((response) => {
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

      const responseUuid = reader.readUint32()

      logging.verbose(`response_uuid=${responseUuid}`)
      if (responseUuid !== requestUuid) {
        // logging.error("ERROR fd0s987");
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        const tnglBytecodeSize = reader.readUint16()

        logging.debug(`tngl_bytecode_size=${tnglBytecodeSize}`)

        const tnglBytecode = reader.readBytes(tnglBytecodeSize)

        logging.debug(`tngl_bytecode=[${tnglBytecode}]`)

        const DUMMY_CONNECTION = SpectodaWasm.Connection.make(
          '00:00:00:00:00:00',
          SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
          SpectodaWasm.connection_rssi_t.RSSI_MAX,
        )

        this.runtime.spectoda_js.request(
          new Uint8Array(tnglBytecode),
          DUMMY_CONNECTION,
        )
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
  async writeTngl(
    tnglCode: string | null,
    tnglBytes: Uint8Array | null,
    tnglBank = 0,
  ) {
    logging.debug(
      `Spectoda::writeTngl(tngl_code=${tnglCode}, tngl_bytes=${tnglBytes})`,
    )

    logging.info('> Writing Tngl code...')

    if (
      (tnglCode === null || tnglCode === undefined) &&
      (tnglBytes === null || tnglBytes === undefined)
    ) {
      throw 'InvalidParameters'
    }

    if (tnglBytes === null || tnglBytes === undefined) {
      tnglBytes = this.#parser.parseTnglCode(tnglCode)
    }

    const reinterpretBytecode = [
      COMMAND_FLAGS.FLAG_LOAD_TNGL,
      ...numberToBytes(this.runtime.clock.millis(), 6),
      tnglBank,
      ...numberToBytes(tnglBytes.length, 4),
      ...tnglBytes,
    ]

    if (tnglBytes.length >= TNGL_SIZE_CONSIDERED_BIG) {
      const eraseTnglUuid = this.#getUUID()
      const eraseTnglBytecode = [
        COMMAND_FLAGS.FLAG_ERASE_TNGL_BYTECODE_REQUEST,
        ...numberToBytes(eraseTnglUuid, 4),
      ]

      return this.runtime.execute(eraseTnglBytecode, undefined).then(() => {
        return this.runtime.execute(reinterpretBytecode, 'TNGL')
      })
    } else {
      return this.runtime.execute(reinterpretBytecode, 'TNGL')
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with null value.
   */
  async emitEvent(
    eventLabel: ValueTypeLabel,
    spectodaIds: SpectodaIdsType = 255,
    forceDelivery = true,
  ) {
    logging.debug(
      `Spectoda::emitEvent(event_label=${eventLabel},device_ids=${spectodaIds},force_delivery=${forceDelivery})`,
    )

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitNull(eventLabel, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with number value.
   * Number value range is (VALUE_LIMITS.NUMBER_MIN, VALUE_LIMITS.NUMBER_MAX)
   */
  async emitNumber(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeNumber,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitNumber(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    if (eventValue > VALUE_LIMITS.NUMBER_MAX) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.NUMBER_MAX
    }

    if (eventValue < VALUE_LIMITS.NUMBER_MIN) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.NUMBER_MIN
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitNumber(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with timestamp value.
   * Timestamp value range is (VALUE_LIMITS.TIMESTAMP_MIN, VALUE_LIMITS.TIMESTAMP_MAX)
   */
  async emitTimestamp(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeTimestamp,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitTimestamp(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    if (eventValue > VALUE_LIMITS.TIMESTAMP_MAX) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.TIMESTAMP_MAX
    }

    if (eventValue < VALUE_LIMITS.TIMESTAMP_MIN) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.TIMESTAMP_MIN
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitTimestamp(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with color value.
   * Color value must be a string in hex format with or without "#" prefix.
   */
  async emitColor(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeColor,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitColor(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    eventValue = cssColorToHex(eventValue)

    if (!eventValue || !/#?[\dA-Fa-f]{6}/g.test(eventValue)) {
      logging.error('Invalid event value. event_value=', eventValue)
      eventValue = '#000000'
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitColor(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with pixels value.
   * Pixels value range is (VALUE_LIMITS.PIXELS_MIN, VALUE_LIMITS.PIXELS_MAX)
   */
  async emitPixels(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypePixels,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitPixels(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    if (eventValue > VALUE_LIMITS.PIXELS_MAX) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.PIXELS_MAX
    }

    if (eventValue < VALUE_LIMITS.PIXELS_MIN) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.PIXELS_MIN
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitPixels(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with percentage value
   * value range is (VALUE_LIMITS.PERCENTAGE_MIN, VALUE_LIMITS.PERCENTAGE_MAX)
   */
  async emitPercentage(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypePercentage,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitPercentage(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    if (eventValue > VALUE_LIMITS.PERCENTAGE_MAX) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.PERCENTAGE_MAX
    }

    if (eventValue < VALUE_LIMITS.PERCENTAGE_MIN) {
      logging.error('Invalid event value')
      eventValue = VALUE_LIMITS.PERCENTAGE_MIN
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitPercentage(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with date value.
   * Date value must be in format 'YYYY-MM-DD'.
   */
  async emitDate(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeDate,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitDate(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitDate(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * E.g. event "anima" to value "a_001"
   */
  async emitLabel(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeLabel,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitLabel(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    if (typeof eventValue !== 'string') {
      logging.error('Invalid event value')
      eventValue = ''
    }

    if (eventValue.length > 5) {
      logging.error('Invalid event value')
      eventValue = eventValue.slice(0, 5)
    }

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitLabel(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * ! Useful
   * Emits Spectoda Event with boolean value.
   */
  async emitBoolean(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeBoolean,
    spectodaIds: SpectodaIdsType = 255,
  ) {
    logging.verbose(
      `emitBoolean(label=${eventLabel},value=${eventValue},id=${spectodaIds})`,
    )

    const func = async (id: SpectodaIdType) => {
      if (!(await this.runtime.emitBoolean(eventLabel, eventValue, id))) {
        throw 'EventEmitFailed'
      }
    }

    if (typeof spectodaIds === 'object') {
      const promises = spectodaIds.map(func)

      return Promise.all(promises)
    } else {
      return func(spectodaIds)
    }
  }

  /**
   * Sets the timeline to the current time of the day and unpauses it.
   */
  async syncTimelineToDayTime(): Promise<unknown> {
    logging.verbose('syncTimelineToDayTime()')

    const now = new Date()

    const hours = now.getHours()
    const minutes = now.getMinutes()
    const seconds = now.getSeconds()
    const miliseconds = now.getMilliseconds()

    const time =
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000 +
      miliseconds

    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0') // getMonth() returns 0-based index
    const year = now.getFullYear()

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
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
  async manipulateTimeline(
    timestamp: number,
    pause: boolean,
    date: string,
  ): Promise<unknown> {
    logging.debug(
      `Spectoda::manipulateTimeline(timestamp=${timestamp}, pause=${pause}, date=${date})`,
    )

    logging.info('> Manipulating with Timeline...')

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
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
  async rewindTimeline(pause = false): Promise<unknown> {
    logging.debug(`Spectoda::rewindTimeline(pause=${pause})`)

    logging.info('> Rewinding Timeline...')

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
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
  async pauseTimeline(): Promise<unknown> {
    logging.debug('Spectoda::pauseTimeline()')

    logging.info('> Pausing Timeline...')

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
    this.timeline.pause()

    return this.syncTimeline()
  }

  /**
   * Unpauses the timeline
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  async unpauseTimeline(): Promise<unknown> {
    logging.debug('Spectoda::unpauseTimeline()')

    logging.info('> Unpausing Timeline...')

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
    this.timeline.unpause()

    return this.syncTimeline()
  }

  /**
   * Gets the current timeline state including millis, paused state and date.
   * This method can be called over WebSocket in remote control mode.
   * @returns The current timeline state object
   */
  async getTimelineState(): Promise<{
    millis: number
    paused: boolean
    date: string
  }> {
    logging.debug('Spectoda::getTimelineState()')

    return {
      millis: this.timeline.millis(),
      paused: this.timeline.paused(),
      date: this.timeline.getDate(),
    }
  }

  /**
   * Gets the current timeline milliseconds.
   * This method can be called over WebSocket in remote control mode.
   * @returns {Promise<number>} The current timeline milliseconds
   */
  async getTimelineMillis(): Promise<number> {
    logging.debug('Spectoda::getTimelineMillis()')

    return this.timeline.millis()
  }

  /**
   * Gets the current timeline paused state.
   * This method can be called over WebSocket in remote control mode.
   * @returns {Promise<boolean>} Whether the timeline is paused
   */
  async getTimelinePaused(): Promise<boolean> {
    logging.debug('Spectoda::getTimelinePaused()')

    return this.timeline.paused()
  }

  /**
   * Gets the current timeline date.
   * This method can be called over WebSocket in remote control mode.
   * @returns {Promise<string>} The current timeline date in "DD-MM-YYYY" format
   */
  async getTimelineDate(): Promise<string> {
    logging.debug('Spectoda::getTimelineDate()')

    return this.timeline.getDate()
  }

  /**
   * Sets the timeline milliseconds and syncs with connected controller.
   * This method can be called over WebSocket in remote control mode.
   * @param {number} millis - The milliseconds to set
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  async setTimelineMillis(millis: number): Promise<unknown> {
    logging.debug(`Spectoda::setTimelineMillis(millis=${millis})`)

    logging.info('> Setting Timeline millis...')

    // Update local timeline (TIMELINE_UPDATE event will be emitted from WASM callback)
    this.timeline.setMillis(millis)

    return this.syncTimeline()
  }

  /**
   * Sets the timeline date and syncs with connected controller.
   * This method can be called over WebSocket in remote control mode.
   * @param {string} date - The date in "DD-MM-YYYY" format
   * @returns {Promise<unknown>} Promise that resolves when timeline is synchronized
   */
  async setTimelineDate(date: string): Promise<unknown> {
    logging.debug(`Spectoda::setTimelineDate(date=${date})`)

    logging.info('> Setting Timeline date...')

    this.timeline.setDate(date)

    return this.syncTimeline()
  }

  /**
   * Synchronizes timeline of the connected controller with the current time of the runtime.
   * TODO! [0.13] move Timeline handling to WASM
   */
  async syncTimeline(
    timestamp: ValueTypeTimestamp | null = null,
    paused: boolean | null = null,
    date: ValueTypeDate | null = null,
  ): Promise<unknown> {
    logging.debug(
      `Spectoda::syncTimeline(timestamp=${timestamp}, paused=${paused}, date=${date})`,
    )

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

    const clockTimestamp = this.runtime.clock.millis()

    logging.debug(
      `> Setting timeline to timestamp=${timestamp}, paused=${paused}, date=${date}, clock_timestamp=${clockTimestamp}`,
    )

    // from "DD-MM-YYYY" date erase "-" and convert to number YYYYMMDD:
    const dateNumber = parseInt(date.split('-').reverse().join(''), 10)

    // flags: [reserved,reserved,reserved,timeline_paused,reserved,reserved,write_rtc_flag,reserved]
    const FLAG_PAUSED_BIT = 4
    const FLAG_WRITE_RTC_BIT = 1

    const ALWAYS_WRITE_RTC_FROM_APP_TIMELINE_WRITE_COMMAND = true

    let timelineFlags = 0

    timelineFlags |= paused ? 1 << FLAG_PAUSED_BIT : 0
    timelineFlags |= ALWAYS_WRITE_RTC_FROM_APP_TIMELINE_WRITE_COMMAND
      ? 1 << FLAG_WRITE_RTC_BIT
      : 0

    const payload = [
      COMMAND_FLAGS.FLAG_TIMELINE_WRITE,
      ...numberToBytes(clockTimestamp, 6),
      ...numberToBytes(timestamp, 4),
      timelineFlags,
      ...numberToBytes(dateNumber, 4),
    ]

    return this.runtime.execute(payload, 'TMLN')
  }

  /**
   * Synchronizes TNGL variable state of given ID to all other IDs
   */
  async syncState(deviceId: SpectodaIdType) {
    logging.debug(`Spectoda::syncState(deviceId=${deviceId})`)

    logging.info('> Synchronizing state...')

    const requestUuid = this.#getUUID()
    const deviceRequest = [
      COMMAND_FLAGS.FLAG_SYNC_STATE_REQUEST,
      ...numberToBytes(requestUuid, 4),
      deviceId,
    ]

    return this.runtime.request(deviceRequest, false)
  }

  /**
   * downloads firmware and calls updateDeviceFirmware()
   * @param url - whole URL of the firmware file
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controller will not be rebooted after firmware update (default: false)
   */
  async fetchAndUpdateDeviceFirmware(
    url: string,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::fetchAndUpdateDeviceFirmware(url=${url}, skipReboot=${skipReboot})`,
    )

    logging.info('> Fetching and Updating Controller Firmware...')
    const fw = await fetchFirmware(url)

    return this.updateDeviceFirmware(fw, { skipReboot })
  }

  /**
   * downloads firmware and calls updateNetworkFirmware()
   * @param url - whole URL of the firmware file
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controllers will not be rebooted after firmware update (default: false)
   */
  async fetchAndUpdateNetworkFirmware(
    url: string,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::fetchAndUpdateNetworkFirmware(url=${url}, skipReboot=${skipReboot})`,
    )

    logging.info('> Fetching and Updating Firmware of all Controllers...')
    const fw = await fetchFirmware(url)

    return this.updateNetworkFirmware(fw, { skipReboot })
  }

  /**
   * ! Useful
   * Update the firmware of the connected controller.
   * @param firmware - The firmware to update the controller with.
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controller will not be rebooted after firmware update (default: false)
   */
  // todo rename to updateControllerFirmware
  async updateDeviceFirmware(
    firmware: Uint8Array,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::updateDeviceFirmware(firmware.length=${firmware?.length}, skipReboot=${skipReboot})`,
    )

    logging.info('> Updating Controller FW...')

    if (!firmware || firmware.length < MIN_FIRMWARE_LENGTH) {
      logging.error('Invalid firmware')
      throw 'InvalidFirmware'
    }

    return Promise.resolve()
      .then(() => {
        return this.requestWakeLock().catch((e) => {
          logging.error('Failed to acquire wake lock', e)
        })
      })
      .then(() => {
        return this.runtime.updateFW(firmware, { skipReboot }).finally(() => {
          if (!skipReboot) {
            return this.runtime.disconnect()
          }
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
   * @param firmware - The firmware to update the controller with.
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controllers will not be rebooted after firmware update (default: false)
   */
  async updateNetworkFirmware(
    firmware: Uint8Array,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::updateNetworkFirmware(firmware.length=${firmware?.length}, skipReboot=${skipReboot})`,
    )

    logging.info('> Updating Firmware of all Controllers...')

    if (!firmware || firmware.length < 10000) {
      logging.error('Invalid firmware')
      throw 'InvalidFirmware'
    }

    this.#updating = true

    this.requestWakeLock().catch((e) => {
      logging.error('Failed to acquire wake lock', e)
    })

    return new Promise(async (resolve, reject) => {
      // const chunk_size = detectAndroid() ? 480 : 3984; // must be modulo 16
      // const chunk_size = 992; // must be modulo 16
      const chunkSize = detectSpectodaConnect() ? 480 : 3984

      let indexFrom = 0
      let indexTo = chunkSize

      let written = 0

      // logging.setLoggingLevel(logging.level - 1);

      logging.info('OTA UPDATE')
      logging.verbose(firmware)

      const startTimestamp = Date.now()

      await sleep(100)

      try {
        this.runtime.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.info('OTA RESET')

          const commandBytes = [
            COMMAND_FLAGS.FLAG_OTA_RESET,
            0x00,
            ...numberToBytes(0x00000000, 4),
          ]

          await this.runtime.execute(commandBytes, undefined)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.info('OTA BEGIN')

          const commandBytes = [
            COMMAND_FLAGS.FLAG_OTA_BEGIN,
            0x00,
            ...numberToBytes(firmware.length, 4),
          ]

          await this.runtime.execute(commandBytes, undefined)
        }

        // TODO optimalize this begin by detecting when all controllers have erased its flash
        // TODO also, right now the gateway controller sends to other controlles to erase flash after it is done.
        // TODO that slows things down
        await sleep(8000) // ! keep this below 10 seconds to avoid connection timeout
        //===========// WRITE //===========//
        logging.info('OTA WRITE')

        while (written < firmware.length) {
          if (indexTo > firmware.length) {
            indexTo = firmware.length
          }

          const commandBytes = [
            COMMAND_FLAGS.FLAG_OTA_WRITE,
            0x00,
            ...numberToBytes(written, 4),
            ...firmware.slice(indexFrom, indexTo),
          ]

          await this.runtime.execute(commandBytes, undefined)

          written += indexTo - indexFrom

          const percentage =
            Math.floor((written * 10000) / firmware.length) / 100

          logging.info(`${percentage}%`)
          this.runtime.emit(SpectodaAppEvents.OTA_PROGRESS, percentage)

          indexFrom += chunkSize
          indexTo = indexFrom + chunkSize
        }

        await sleep(1000)

        {
          //===========// END //===========//
          logging.info('OTA END')

          const commandBytes = [
            COMMAND_FLAGS.FLAG_OTA_END,
            0x00,
            ...numberToBytes(written, 4),
          ]

          await this.runtime.execute(commandBytes, undefined)
        }

        await sleep(3000)

        if (!skipReboot) {
          await this.rebootNetwork()
        } else {
          logging.info('Firmware written, skipping reboot as requested')
        }

        logging.debug('> Firmware written in ' + (Date.now() - startTimestamp) / 1000 + ' seconds')

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
        if (!skipReboot) {
          return this.runtime.disconnect()
        }
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
    if (
      typeof peer !== 'string' ||
      !/^([\dA-Fa-f]{2}[:-]){5}([\dA-Fa-f]{2})$/.test(peer)
    ) {
      // If the input is invalid, display an error message and return null
      throw 'InvalidPeerMacAdress'
    }

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_FW_UPDATE_PEER_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...strMacToBytes(peer),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_FW_UPDATE_PEER_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
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
  async readDeviceConfig() {
    logging.debug('Spectoda::readDeviceConfig()')

    logging.info('> Reading device config...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_DEVICE_CONFIG_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_DEVICE_CONFIG_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        const configSize = reader.readUint32()

        logging.verbose(`config_size=${configSize}`)

        const configBytes = reader.readBytes(configSize)

        logging.verbose(`config_bytes=${configBytes}`)

        const decoder = new TextDecoder()
        const config = decoder.decode(new Uint8Array(configBytes))

        logging.verbose(`config=${config}`)

        if (config.charAt(config.length - 1) === '\0') {
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
   * @param config_string - The JSON config string to write
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controller will not be rebooted after config update (default: false)
   */
  // todo rename to updateControllerConfig
  async updateDeviceConfig(
    configString: string,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::updateDeviceConfig(config_string=${configString}, skipReboot=${skipReboot})`,
    )

    logging.info('> Writing Controller Config...')

    const condifObject = JSON.parse(configString)
    const config = JSON.stringify(condifObject)

    logging.verbose(`config=${config}`)

    const encoder = new TextEncoder()
    const configBytes = encoder.encode(config)
    const configBytesSize = config.length

    // make config update request
    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_CONFIG_UPDATE_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...numberToBytes(configBytesSize, 4),
      ...configBytes,
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

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponse'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        if (skipReboot) {
          logging.info('> Config updated, skipping reboot as requested')
          return
        }
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
   * @param config_string - The JSON config string to write
   * @param options - Optional configuration
   * @param options.skipReboot - If true, the controllers will not be rebooted after config update (default: false)
   */
  async updateNetworkConfig(
    configString: string,
    options?: { skipReboot?: boolean },
  ) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `Spectoda::updateNetworkConfig(config_string=${configString}, skipReboot=${skipReboot})`,
    )

    logging.info('> Writing Config to all Controllers...')

    const encoder = new TextEncoder()
    const configBytes = encoder.encode(configString)
    const configBytesSize = configString.length

    // make config update request
    const requestUuid = this.#getUUID()
    const requestBytes = [
      COMMAND_FLAGS.FLAG_CONFIG_UPDATE_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...numberToBytes(configBytesSize, 4),
      ...configBytes,
    ]

    return this.runtime.execute(requestBytes, 'CONF').then(() => {
      if (skipReboot) {
        logging.info(
          '> Config updated on all controllers, skipping reboot as requested',
        )
        return
      }
      logging.info('> Rebooting all Controllers...')
      const commandBytecode = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

      return this.runtime.execute(commandBytecode, undefined)
    })
  }

  /**
   * Gets the timeline from connected controller to the runtime.
   */
  async requestTimeline() {
    logging.debug('Spectoda::requestTimeline()')

    logging.info('> Reading Timeline from Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_TIMELINE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      logging.verbose(`response.byteLength=${response.byteLength}`)

      const reader = new TnglReader(response)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_TIMELINE_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      if (errorCode !== 0) {
        throw 'RequestTimelineFailed'
      }

      const clockTimestamp = reader.readUint48()
      const timelineTimestamp = reader.readInt32()
      const timelinePaused = reader.readUint8()
      const timelineDateNumber = reader.available >= 4 ? reader.readUint32() : 0

      // Convert date number YYYYMMDD to DD-MM-YYYY format
      const timelineDate = timelineDateNumber
        ? `${String(timelineDateNumber % 100).padStart(2, '0')}-${String(
          Math.floor(timelineDateNumber / 100) % 100,
        ).padStart(2, '0')}-${Math.floor(timelineDateNumber / 10000)}`
        : '01-01-1970'

      logging.info(
        `clock_timestamp=${clockTimestamp}, timeline_timestamp=${timelineTimestamp}, timeline_paused=${timelinePaused}, timeline_date=${timelineDate}`,
      )

      const flags = timelinePaused ? 0b00010000 : 0b00000000 // flags: [reserved,reserved,reserved,timeline_paused,reserved,reserved,reserved,reserved]
      const payload = [
        COMMAND_FLAGS.FLAG_TIMELINE_WRITE,
        ...numberToBytes(clockTimestamp, 6),
        ...numberToBytes(timelineTimestamp, 4),
        flags,
        ...numberToBytes(timelineDateNumber, 4),
      ]

      return this.runtime.execute(payload, 'TMLN')
    })
  }

  // Code.device.runtime.execute([240,1,0,0,0,5],null)
  /**
   * ! Useful
   * Reboots ALL CONNECTED CONTROLLERS in the network. This will temporarily disconnect the controller from the network. Spectoda.js will try to reconnect you back to the controller.
   */
  async rebootNetwork() {
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
  async rebootDevice() {
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
  async rebootAndDisconnectDevice() {
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
  async removeOwner(rebootController = true) {
    logging.debug(`Spectoda::removeOwner(rebootController=${rebootController})`)

    logging.info('> Removing Network Signature+Key from Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ERASE_NETWORK_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_ERASE_OWNER_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode !== 0) {
        throw 'OwnerEraseFailed'
      }

      const removedDeviceMacBytes = reader.readBytes(6)

      return (rebootController ? this.rebootDevice() : Promise.resolve()).then(
        () => {
          let removedDeviceMac = '00:00:00:00:00:00'

          if (removedDeviceMacBytes.length >= 6) {
            removedDeviceMac = Array.from(removedDeviceMacBytes, (byte) =>
              `0${(byte & 0xff).toString(16)}`.slice(-2),
            ).join(':')
          }
          return {
            mac:
              removedDeviceMac === '00:00:00:00:00:00'
                ? null
                : removedDeviceMac,
          }
        },
      )
    })
  }

  /**
   * ! Useful
   * Removes ALL CONTROLLERS from their current network. More info at the top of this file.
   */
  async removeNetworkOwner() {
    logging.debug('Spectoda::removeNetworkOwner()')

    logging.info('> Removing Network Signature+Key from all Controllers...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ERASE_NETWORK_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(bytes, undefined).then(() => {
      return this.rebootNetwork()
    })
  }

  /**
   * ! Useful
   * Get the firmware version of the controller in string format
   */
  async getFwVersion() {
    logging.debug('Spectoda::getFwVersion()')

    logging.info('> Reading FW version from Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_FW_VERSION_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_FW_VERSION_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      let version = null

      if (errorCode === 0) {
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
  async getTnglFingerprint() {
    logging.debug('Spectoda::getTnglFingerprint()')

    logging.info('> Reading TNGL fingerprint from Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_TNGL_FINGERPRINT_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose('response:', response)

      if (reader.readFlag() !== COMMAND_FLAGS.FLAG_TNGL_FINGERPRINT_RESPONSE) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      let fingerprint = null

      if (errorCode === 0) {
        fingerprint = reader.readBytes(32)
      } else {
        throw 'Fail'
      }

      logging.verbose(`fingerprint=${fingerprint}`)
      logging.verbose(
        `fingerprint=${[...fingerprint].map((byte) => `0${(byte & 0xff).toString(16)}`.slice(-2)).join(',')}`,
      )

      logging.info(
        `Controller TNGL Fingerprint: ${uint8ArrayToHexString(fingerprint)}`,
      )
      console.log('fingerprinting', fingerprint)
      return new Uint8Array(fingerprint)
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
  async getConnectedPeersInfo() {
    logging.debug('Spectoda::getConnectedPeersInfo()')

    logging.info('> Reading Controller connected peers info...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_CONNECTED_PEERS_INFO_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (
        reader.readFlag() !== COMMAND_FLAGS.FLAG_CONNECTED_PEERS_INFO_RESPONSE
      ) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      const peers = []

      if (errorCode === 0) {
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

        logging.info(
          `> Connected peers:\n${peers.map((x) => `  mac:${x.mac}, rssi:${x.rssi}`).join('\n')}`,
        )

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
  async syncEventHistory() {
    logging.debug('Spectoda::syncEventHistory()')

    logging.info('> Reading EventStore from Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_EVENT_HISTORY_BC_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

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

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        // logging.error("InvalidResponseUuid");
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        const historicEventsBytecodeSize = reader.readUint16()

        logging.debug(
          `historic_events_bytecode_size=${historicEventsBytecodeSize}`,
        )

        const historicEventsBytecode = reader.readBytes(
          historicEventsBytecodeSize,
        )

        logging.debug(`historic_events_bytecode=[${historicEventsBytecode}]`)

        this.runtime.spectoda_js.eraseHistory()

        const DUMMY_CONNECTION = SpectodaWasm.Connection.make(
          '00:00:00:00:00:00',
          SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
          SpectodaWasm.connection_rssi_t.RSSI_MAX,
        )

        this.runtime.spectoda_js.request(
          new Uint8Array(historicEventsBytecode),
          DUMMY_CONNECTION,
        )
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
  async eraseEventHistory() {
    logging.debug('Spectoda::eraseEventHistory()')

    logging.info('> Erasing EventStore from all Controllers...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ERASE_EVENT_HISTORY_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   * Erases the timeline of the connected controller.
   */
  async eraseTimeline() {
    logging.debug('Spectoda::eraseTimeline()')

    logging.info('> Erasing Timeline from all Controllers...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ERASE_TIMELINE_COMMAND_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   * Erases the network data of the connected Network.
   */
  async eraseNetworkStorage() {
    logging.debug('Spectoda::eraseNetworkStorage()')

    logging.info('> Erasing NetworkStorage from all Controllers...')

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_ERASE_NETWORKSTORAGE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(commandBytes, undefined)
  }

  /**
   * ! Useful
   * Puts CONTROLLER Spectoda.js is `connect`ed to to sleep. To wake him up, power must be cycled by removing and reapplying it.
   
  * TODO rename to controllerSleep
   */
  async deviceSleep() {
    logging.debug('Spectoda::deviceSleep()')

    logging.info('> Sleeping Controller...')

    const requestUuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_SLEEP_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   * Puts ALL CONTROLLERS in the network Spectoda.js is `connect`ed to to sleep. To wake them up, power must be cycled by removing and reapplying it.
   */
  async networkSleep() {
    logging.debug('Spectoda::networkSleep()')

    logging.info('> Sleeping all Controllers...')

    const requestUuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_SLEEP_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * Forces a TNGL variable state save on the connected controller. TNGL variable state is by default saved every 8 seconds atfer no event is emitted.
   */
  async saveState() {
    logging.debug('Spectoda::saveState()')

    logging.info('> Forcing EventState values save in all Controllers...')

    const requestUuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_SAVE_STATE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * ! Useful
   * Changes the network of the controller Spectoda.js is `connect`ed to.
   */
  async writeOwner(
    ownerSignature: NetworkSignature = UNCOMMISSIONED_NETWORK_SIGNATURE,
    ownerKey: NetworkKey = UNCOMMISSIONED_NETWORK_KEY,
  ) {
    logging.debug(
      `writeOwner(ownerSignature=${ownerSignature}, ownerKey=${ownerKey})`,
    )

    logging.info('> Writing Network Signature+Key to Controller...')

    if (!ownerSignature || !ownerKey) {
      throw 'InvalidParameters'
    }

    if (
      ownerSignature === UNCOMMISSIONED_NETWORK_SIGNATURE &&
      ownerKey === UNCOMMISSIONED_NETWORK_KEY
    ) {
      logging.warn('> Removing owner instead of writing all zero owner')
      return this.removeOwner(false)
    }

    const ownerSignatureBytes = hexStringToUint8Array(ownerSignature, 16)
    const ownerKeyBytes = hexStringToUint8Array(ownerKey, 16)

    logging.verbose('owner_signature_bytes', ownerSignatureBytes)
    logging.verbose('owner_key_bytes', ownerKeyBytes)

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ADOPT_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...ownerSignatureBytes,
      ...ownerKeyBytes,
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

        const responseUuid = reader.readUint32()

        if (responseUuid !== requestUuid) {
          throw 'InvalidResponse'
        }

        // TODO rename to controllerMac
        let deviceMac = 'null'

        const errorCode = reader.readUint8()

        // error_code 0 is success
        if (errorCode === 0) {
          const deviceMacBytes = reader.readBytes(6)

          deviceMac = Array.from(deviceMacBytes, (byte) =>
            `0${(byte & 0xff).toString(16)}`.slice(-2),
          ).join(':')
        }

        logging.verbose(`error_code=${errorCode}, device_mac=${deviceMac}`)

        if (errorCode === 0) {
          // TODO Remove word adopted
          logging.info(`Adopted ${deviceMac} successfully`)
          return {
            mac: deviceMac,
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
  async writeNetworkOwner(
    ownerSignature: NetworkSignature = '00000000000000000000000000000000',
    ownerKey: NetworkKey = '00000000000000000000000000000000',
  ) {
    logging.debug(
      `writeNetworkOwner(ownerSignature=${ownerSignature}, ownerKey=${ownerKey})`,
    )

    logging.info('> Writing Network Signature+Key to all Controllers...')

    if (!ownerSignature || !ownerKey) {
      throw 'InvalidParameters'
    }

    if (
      ownerSignature === '00000000000000000000000000000000' &&
      ownerKey === '00000000000000000000000000000000'
    ) {
      logging.warn('> Removing owner instead of writing all zero owner')
      return this.removeNetworkOwner()
    }

    const ownerSignatureBytes = hexStringToUint8Array(ownerSignature, 16)
    const ownerKeyBytes = hexStringToUint8Array(ownerKey, 16)

    logging.verbose('owner_signature_bytes', ownerSignatureBytes)
    logging.verbose('owner_key_bytes', ownerKeyBytes)

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_ADOPT_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...ownerSignatureBytes,
      ...ownerKeyBytes,
    ]

    logging.verbose(bytes)

    return this.runtime.execute(bytes, undefined)
  }

  /**
   * ! Useful
   */
  async writeControllerName(label: ValueTypeLabel) {
    logging.debug(`Spectoda::writeControllerName(label=${label})`)

    logging.info('> Writing Controller Name...')

    const requestUuid = this.#getUUID()
    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_NAME_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...stringToBytes(label, 16, false),
    ]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   */
  async readControllerName() {
    logging.debug('Spectoda::readControllerName()')

    logging.info('> Reading Controller Name...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_CONTROLLER_NAME_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (
        reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_CONTROLLER_NAME_RESPONSE
      ) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      let name = null

      if (errorCode === 0) {
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
  async writeControllerIoVariant(
    ioLabel: ValueTypeLabel,
    variant: string | null,
  ) {
    logging.debug(
      `Spectoda::writeControllerIoVariant(ioLabel=${ioLabel}, variant=${variant})`,
    )

    logging.info('> Writing Controller IO Variant...')

    const requestUuid = this.#getUUID()
    const removeIoVariant = variant == null

    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_IO_VARIANT_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...labelToBytes(ioLabel),
      ...(removeIoVariant ? [] : stringToBytes(variant, 16, false)),
    ]

    return this.runtime.request(payload, false)
  }

  /**
   * ! Useful
   * Write IO variant for a specific IO label in ALL CONNECTED CONTROLLERS in the network
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @param variant - variant name (max 16 characters)
   */
  async writeNetworkIoVariant(ioLabel: ValueTypeLabel, variant: string | null) {
    logging.debug(
      `Spectoda::writeNetworkIoVariant(ioLabel=${ioLabel}, variant=${variant})`,
    )

    logging.info('> Writing IO Variant for all Controllers...')

    const requestUuid = this.#getUUID()
    const removeIoVariant = variant == null

    const payload = [
      COMMAND_FLAGS.FLAG_WRITE_IO_VARIANT_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...labelToBytes(ioLabel),
      ...(removeIoVariant ? [] : stringToBytes(variant, 16, false)),
    ]

    return this.runtime.execute(payload, undefined)
  }

  /**
   * ! Useful
   * Read IO variant for a specific IO label from the controller config
   * @param ioLabel - 5 character IO label (e.g. "BTN_1")
   * @returns The variant name for the specified IO label
   */
  async readControllerIoVariant(ioLabel: ValueTypeLabel) {
    logging.debug(`Spectoda::readControllerIoVariant(ioLabel=${ioLabel})`)

    logging.info('> Reading Controller IO Variant...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_IO_VARIANT_REQUEST,
      ...numberToBytes(requestUuid, 4),
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

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      let variant = null

      if (errorCode === 0) {
        variant = reader.readString(16)
      } else {
        throw 'Fail'
      }

      logging.verbose(`variant=${variant}`)
      logging.info(`> IO Variant of ${ioLabel}: ${variant}`)

      return variant
    })
  }

  async writeControllerIoMapping(
    ioLabel: ValueTypeLabel,
    mapping: Array<ValueTypePixels> | null,
  ) {
    logging.debug(
      `Spectoda::writeControllerIoMapping(ioLabel=${ioLabel}, mapping=${mapping})`,
    )

    logging.info('> Writing Controller IO Mapping...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_WRITE_IO_MAPPING_REQUEST,
      ...numberToBytes(requestUuid, 4),
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
  async readControllerIoMapping(
    ioLabel: ValueTypeLabel,
  ): Promise<Array<ValueTypePixels>> {
    logging.debug(`Spectoda::readControllerIoMapping(ioLabel=${ioLabel})`)

    logging.info('> Reading Controller IO Mapping...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_IO_MAPPING_REQUEST,
      ...numberToBytes(requestUuid, 4),
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

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      let mapping = null

      if (errorCode === 0) {
        const mappingSize = reader.readUint16()

        mapping = []

        for (let i = 0; i < mappingSize; i++) {
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
    logging.debug(
      `Spectoda::WIP_emitTnglBytecode(bytecode.length=${bytecode?.length})`,
    )

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
  async listNetworkStorageData() {
    return this.runtime.spectoda_js.listNetworkStorageData()
  }

  /**
   * Emits (spreads) the provided network storage data through the Network using the execute command.
   *
   * See {@link Spectoda_JS.emitNetworkStorageData} for implementation details.
   *
   * @param data - The network storage data to emit across the network.
   */
  async emitNetworkStorageData(data: NetworkStorageData) {
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
  async setNetworkStorageData(data: NetworkStorageData) {
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
  async getNetworkStorageData(name: string) {
    return this.runtime.spectoda_js.getNetworkStorageData(name)
  }

  //* WIP
  async WIP_writeIoVariant(
    ioLabel: ValueTypeLabel,
    variant: string | null,
  ): Promise<void> {
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
  async WIP_writeIoMapping(
    ioLabel: ValueTypeLabel,
    mapping: number[] | null,
  ): Promise<void> {
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
  async readVariable(variableName: string, id: SpectodaIdType = 255) {
    logging.debug(
      `Spectoda::readVariable(variable_name=${variableName}, id=${id})`,
    )

    logging.info('> Reading Variable by its Name...')

    const variableDeclarations = this.#parser.getVariableDeclarations()

    logging.verbose('variable_declarations=', variableDeclarations)

    let variableAddress

    // check if the variable is already declared
    // look for the latest variable address on the stack
    for (const declaration of variableDeclarations) {
      if (declaration.name === variableName) {
        variableAddress = declaration.address
        break
      }
    }

    if (variableAddress === undefined) {
      throw 'VariableNotFound'
    }

    const variableValue = this.runtime.readVariableAddress(variableAddress, id)

    logging.verbose(
      `variable_name=${variableName}, id=${id}, variable_value=${variableValue.debug}`,
    )

    return variableValue
  }

  /**
   * For FW nerds
   */
  async readVariableAddress(variableAddress: number, id: SpectodaIdType = 255) {
    logging.debug(
      `Spectoda::readVariableAddress(variable_address=${variableAddress}, id=${id})`,
    )

    logging.info('> Reading Variable by its Address...')

    const memoryStack = this.#parser.getMemoryStack()

    logging.verbose(`memory_stack=${memoryStack}`)

    logging.info(
      `Reading memory address ${variableAddress} for ID${id} with description: "${memoryStack[variableAddress]}" ...`,
    )

    return this.runtime.readVariableAddress(variableAddress, id)
  }

  /**
   * Hides the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  async hideHomeButton() {
    return this.setHomeVisible(false)
  }

  /**
   * Shows the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  async showHomeButton() {
    return this.setHomeVisible(true)
  }

  /**
   * Shows or hides the home button on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  async setHomeVisible(visible: boolean) {
    logging.debug(`Spectoda::setHomeVisible(visible=${visible})`)

    logging.info('> Hiding SpectodaConnect home button...')

    if (!detectSpectodaConnect()) {
      throw 'PlatformNotSupported'
    }

    return window.flutter_inappwebview?.callHandler('setHomeVisible', visible)
  }

  /**
   * Goes to the home screen on the Flutter Spectoda Connect:
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  async goHome() {
    logging.debug('Spectoda::goHome()')

    logging.info('> Going home in SpectodaConnect...')

    if (!detectSpectodaConnect()) {
      throw 'PlatformNotSupported'
    }

    return window.flutter_inappwebview?.callHandler('goHome')
  }

  /**
   * Sets orientation of the Flutter Spectoda Connect:
   * 0 = no restriction, 1 = portrait, 2 = landscape
   * TODO: This is not really a "FW communication feature", should be moved to another file ("FlutterBridge?""). Spectoda.JS should take care only of the communication with the device.
   */
  async setOrientation(option: number) {
    logging.debug(`Spectoda::setOrientation(option=${option})`)

    logging.info('> Setting orientation of SpectodaConnect...')

    if (!detectSpectodaConnect()) {
      throw 'PlatformNotSupported'
    }

    if (typeof option !== 'number') {
      throw 'InvalidOption'
    }

    if (option < 0 || option > 2) {
      throw 'InvalidOption'
    }

    // TODO remove any and replace flutter calling with SCF Bridge
    return window.flutter_inappwebview.callHandler(
      'setOrientation',
      option as any,
    )
  }

  /**
   * ! Useful
   * Reads the network signature of the controller Spectoda.js is `connect`ed to.
   */
  async readNetworkSignature() {
    logging.debug('Spectoda::readNetworkSignature()')

    logging.info('> Reading Network Signature from the Controller...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_OWNER_SIGNATURE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (
        reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_OWNER_SIGNATURE_RESPONSE
      ) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode !== 0) {
        throw 'Fail'
      }

      const signatureBytes = reader.readBytes(16)

      logging.debug(`signature_bytes=${signatureBytes}`)

      const signatureString = uint8ArrayToHexString(signatureBytes)

      logging.debug(`signature_string=${signatureString}`)

      logging.info(`> Network Signature: ${signatureString}`)

      return signatureString
    })
  }

  /**
   * Write PCB Code and Product Code. Used when manufacturing a controller
   *
   * PCB Code is a code of a specific PCB. A printed circuit of a special type. You can connect many inputs and many outputs to it. E.g. Spectoda Industry A6 controller.
   *
   * Product Code is a code of a specific product. A product is a defined, specific configuration of inputs and outputs that make up a whole product. E.g. NARA Lamp (two LED outputs of certain length and a touch button), Sunflow Lamp (three LED outputs, push button)
   */
  async writeControllerCodes(pcbCode: PcbCode, productCode: ProductCode) {
    logging.debug(
      `Spectoda::writeControllerCodes(pcb_code=${pcbCode}, product_code=${productCode})`,
    )

    logging.info('> Writing Controller PCB+Product Codes...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_CODES_REQUEST,
      ...numberToBytes(requestUuid, 4),
      ...numberToBytes(pcbCode, 2),
      ...numberToBytes(productCode, 2),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose(`response.byteLength=${response.byteLength}`)

      if (
        reader.readFlag() !== COMMAND_FLAGS.FLAG_WRITE_CONTROLLER_CODES_RESPONSE
      ) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        logging.info('Controller codes written successfully')
      } else {
        throw 'Fail'
      }
    })
  }

  /**
   * ! Useful
   * Get PCB Code and Product Code. For more information see `writeControllerCodes`
   */
  async readControllerCodes() {
    logging.debug('Spectoda::readControllerCodes()')

    logging.info('> Reading Controller PCB+Product Codes ...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_CONTROLLER_CODES_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.request(bytes, true).then((response) => {
      if (response === null) {
        throw 'NoResponseReceived'
      }

      const reader = new TnglReader(response)

      logging.verbose('response=', response)

      if (
        reader.readFlag() !== COMMAND_FLAGS.FLAG_READ_CONTROLLER_CODES_RESPONSE
      ) {
        throw 'InvalidResponseFlag'
      }

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode !== 0) {
        throw 'Fail'
      }

      const pcbCode = reader.readUint16()
      const productCode = reader.readUint16()

      logging.debug(`pcb_code=${pcbCode}`)
      logging.debug(`product_code=${productCode}`)

      logging.info(`> Controller Codes: ${pcbCode}, ${productCode}`)

      return { pcb_code: pcbCode, product_code: productCode }
    })
  }

  /**
   * For FW nerds
   */
  async execute(bytecode: number[]) {
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
  async reload() {
    this.disconnect()

    setTimeout(() => {
      if (detectNode()) {
        process.exit(1)
      } else {
        if (window?.location) {
          window.location.reload()
        }
      }
    }, 1000)
  }

  /**
   * Reloads the TNGL in this APP Controller
   * Can be used to reset EventStateStore
   * ! TODO refator: Does not work correctly for now because it cannot edit eventStateStore in core. Implementation needs to be fixed by @immakermatty
   */
  async reloadTngl() {
    logging.debug('Spectoda::reloadTngl()')

    logging.info('> Reloading TNGL of the APP Controller...')

    return this.runtime.spectoda_js.requestReloadTngl('/')
  }

  // 0.9.4

  /**
   * Erase current TNGL of the whole network
   */
  async eraseTngl() {
    logging.debug('Spectoda::eraseTngl()')

    logging.info('> Erasing TNGL from all Controllers...')

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_ERASE_TNGL_BYTECODE_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

    return this.runtime.execute(commandBytes, undefined)
  }

  /**
   * Save the current uploaded Tngl (via `writeTngl) to the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  async saveTnglBank(tnglBank: TnglBank) {
    logging.debug(`Spectoda::saveTnglBank(tngl_bank=${tnglBank})`)

    logging.info(`> Saving TNGL to bank ${tnglBank}...`)

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_SAVE_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(requestUuid, 4),
      tnglBank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(commandBytes, undefined)
  }

  /**
   * Load the Tngl from the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  async loadTnglBank(tnglBank: TnglBank) {
    logging.debug(`Spectoda::loadTnglBank(tngl_bank=${tnglBank})`)

    logging.info(`> Loading TNGL from bank ${tnglBank}...`)

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_LOAD_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(requestUuid, 4),
      tnglBank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(commandBytes, undefined)
  }

  /**
   * Erase the Tngl from the bank in parameter
   * TODO! [0.13] Move saveTnglBank to CPP class `Spectoda` and expose the function via WASM API
   */
  async eraseTnglBank(tnglBank: TnglBank) {
    logging.debug(`Spectoda::eraseTnglBank(tngl_bank=${tnglBank})`)

    logging.info(`> Erasing TNGL bank ${tnglBank} from all Controllers...`)

    const requestUuid = this.#getUUID()
    const commandBytes = [
      COMMAND_FLAGS.FLAG_ERASE_TNGL_MEMORY_BANK_REQUEST,
      ...numberToBytes(requestUuid, 4),
      tnglBank,
      ...numberToBytes(this.runtime.clock.millis(), 6),
    ]

    return this.runtime.execute(commandBytes, undefined)
  }

  async getEventStates(
    eventStateLabel: ValueTypeLabel,
    eventStateIds: SpectodaIdsType,
  ) {
    return this.runtime.getEventStates(eventStateLabel, eventStateIds)
  }

  async getEventState(
    eventStateLabel: ValueTypeLabel,
    eventStateId: SpectodaIdType,
  ) {
    return this.runtime.getEventState(eventStateLabel, eventStateId)
  }

  async getDateTime() {
    return this.runtime.getDateTime()
  }

  /** Refactor suggestion by @mchlkucera registerIDContext */
  async registerDeviceContexts(ids: SpectodaIdsType) {
    return this.runtime.registerDeviceContexts(ids)
  }

  /**
   * TNGL BANKS: A concept in which you can save Tngl to different memory banks, and then load them when you need. Used to speed up tngl synchronization in installations where all animations don't fit to one Tngl file
   */

  /** Refactor suggestion by @mchlkucera registerIDContext */
  async registerDeviceContext(id: SpectodaIdType) {
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
  async getEmittedEvents(ids: SpectodaIdsType) {
    logging.debug(
      `Spectoda::getEmittedEvents(ids=${Array.isArray(ids) ? `[${ids.join(',')}]` : ids})`,
    )

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

        const eventsJson =
          '[\n' +
          events.map((event) => JSON.stringify(event)).join(',\n') +
          '\n]'

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
   * Currently implemented types:
   * - number (VALUE_TYPES.NUMBER)
   * - label (VALUE_TYPES.LABEL)
   * - timestamp/time (VALUE_TYPES.TIME)
   * - percentage (VALUE_TYPES.PERCENTAGE)
   * - date (VALUE_TYPES.DATE)
   * - color (VALUE_TYPES.COLOR)
   * - pixels (VALUE_TYPES.PIXELS)
   * - boolean/bool (VALUE_TYPES.BOOLEAN)
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
  async emitEvents(
    events:
      | Pick<EventState, 'label' | 'type' | 'value' | 'id'>[]
      | {
        // TODO @immakermatty remove this generic event type, use only SpectodaEvent
        label: ValueTypeLabel
        // TODO Make this only ValueType, why string?
        type: string | ValueType
        value: null | string | number | boolean
        id: SpectodaIdType
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

    for (const event of events) {
      switch (event.type) {
        case 'number':
        case VALUE_TYPES.NUMBER: {
          this.emitNumber(event.label, event.value as number, event.id)
          break
        }
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
        case 'date':
        case VALUE_TYPES.DATE: {
          this.emitDate(event.label, event.value as string, event.id)
          break
        }
        case 'color':
        case VALUE_TYPES.COLOR: {
          this.emitColor(event.label, event.value as string, event.id)
          break
        }
        case 'pixels':
        case VALUE_TYPES.PIXELS: {
          this.emitPixels(event.label, event.value as number, event.id)
          break
        }
        case 'boolean':
        case 'bool':
        case VALUE_TYPES.BOOLEAN: {
          this.emitBoolean(event.label, event.value as boolean, event.id)
          break
        }
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
   * ! Experimental
   * Initializes Remote Control sender by creating a websocket-based proxy
   * instance and transferring all listeners from this instance to the proxy.
   *
   * The returned proxy forwards method calls over WebSocket to a remote
   * Spectoda runtime. Callers are expected to replace their local reference
   * with the returned proxy (e.g. `spectoda = spectoda.makeRemoteControlSender(...)`).
   */
  makeRemoteControlSender({
    signature,
    key,
    sessionOnly = false,
    sessionRoomNumber = 0,
  }: {
    signature: string
    key: string
    sessionOnly: boolean
    sessionRoomNumber: number
  }): Spectoda {
    const spectodaProxyObject = makeSpectodaVirtualProxy({
      signature,
      key,
      sessionOnly,
      sessionRoomNumber,
    })

    this.transferListenersTo(spectodaProxyObject as unknown as Spectoda)

    return spectodaProxyObject as unknown as Spectoda
  }

  /**
   * Returns information object about the connected controller
   *
   * Implemented in FW 0.12.4, extended in FW 0.12.11
   */
  async readControllerInfo(): Promise<ControllerInfo> {
    logging.debug('Spectoda::readControllerInfo()')

    logging.info('> Reading Controller info...')

    const requestUuid = this.#getUUID()
    const bytes = [
      COMMAND_FLAGS.FLAG_READ_CONTROLLER_INFO_REQUEST,
      ...numberToBytes(requestUuid, 4),
    ]

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

      const responseUuid = reader.readUint32()

      if (responseUuid !== requestUuid) {
        logging.info(
          `UUID mismatch - Request: ${requestUuid}, Response: ${responseUuid}`,
        )
        throw 'InvalidResponseUuid'
      }

      const errorCode = reader.readUint8()

      logging.verbose(`error_code=${errorCode}`)

      if (errorCode === 0) {
        // Read all the controller info fields in order matching interface.cpp
        const fullName = reader.readString(16).trim() // NAME_STRING_MAX_SIZE
        const label = reader.readString(6).trim() // 5 chars + null terminator
        const macBytes = reader.readBytes(6) // MAC_SIZE
        const controllerFlags = reader.readUint8()
        const __reserved1 = reader.readUint8() // reserved for potential flags increase

        const pcbCode = reader.readUint16()
        const productCode = reader.readUint16()
        const fwVersionCode = reader.readUint16()
        const fwPlatformCode = reader.readUint16() // added in FW 0.12.11

        const fwCompilationUnixTimestamp = reader.readUint64()
        const __reserved2 = reader.readUint64() // reserved

        const fwVersionFull = reader.readString(FW_VERSION_FULL_BYTES).trim() // FW_VERSION_STRING_MAX_SIZE
        const tnglFingerprint = reader.readBytes(TNGL_FINGERPRINT_BYTES) // TNGL_FINGERPRINT_SIZE
        const eventStoreFingerprint = reader.readBytes(
          EVENT_STORE_FINGERPRINT_BYTES,
        ) // HISTORY_FINGERPRINT_SIZE
        const configFingerprint = reader.readBytes(CONFIG_FINGERPRINT_BYTES) // CONFIG_FINGERPRINT_SIZE
        const networkSignature = reader.readBytes(NETWORK_SIGNATURE_BYTES) // NETWORK_SIGNATURE_SIZE

        const isExtended = reader.available >= ALL_METADATA_BYTES // added in FW 0.12.11

        const __reserved3 = isExtended
          ? reader.readBytes(16)
          : new Uint8Array(16) // reserved for potential network signature growth to 32 bytes in 0.13.0
        const networkstorageFingerprint = isExtended
          ? reader.readBytes(32)
          : new Uint8Array(32) // NETWORKSTORAGE_FINGERPRINT_SIZE
        const controllerstoreFingerprint = isExtended
          ? reader.readBytes(32)
          : new Uint8Array(32) // CONTROLLERSTORE_FINGERPRINT_SIZE
        const notificationstoreFingerprint = isExtended
          ? reader.readBytes(32)
          : new Uint8Array(32) // NOTIFICATIONSTORE_FINGERPRINT_SIZE
        const __reserved4 = isExtended
          ? reader.readBytes(32)
          : new Uint8Array(32) // reserved for another fingerprint
        const __reserved5 = isExtended
          ? reader.readBytes(32)
          : new Uint8Array(32) // reserved for another fingerprint

        // fw version string from code
        const fwVersionShort = `${Math.floor(fwVersionCode / 10000)}.${Math.floor(
          (fwVersionCode % 10000) / 100,
        )}.${fwVersionCode % 100}`

        // get Commissionable flag
        const COMMISSIONABLE_FLAG_BIT_POSITION = 0
        const commissionable = !!(
          controllerFlags &
          (1 << COMMISSIONABLE_FLAG_BIT_POSITION)
        )

        // Format MAC address
        const macAddress = Array.from(macBytes, (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(':')

        // Format fingerprints and signature as hex strings
        const networkSignatureHex = uint8ArrayToHexString(networkSignature)
        const tnglFingerprintHex = uint8ArrayToHexString(tnglFingerprint)
        const eventstoresFingerprintHex = uint8ArrayToHexString(
          eventStoreFingerprint,
        )
        const configFingerprintHex = uint8ArrayToHexString(configFingerprint)
        const networkstorageFingerprintHex = uint8ArrayToHexString(
          networkstorageFingerprint,
        )
        const controllerstoreFingerprintHex = uint8ArrayToHexString(
          controllerstoreFingerprint,
        )
        const notificationstoreFingerprintHex = uint8ArrayToHexString(
          notificationstoreFingerprint,
        )

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
          productCode: productCode,
          macAddress: macAddress,
          fwVersion: fwVersionShort,
          networkSignature: networkSignatureHex,
          commissionable: commissionable,

          fullName: fullName,
          pcbCode: pcbCode,
          fwVersionFull: fwVersionFull,
          fwVersionCode: fwVersionCode,
          fwPlatformCode: fwPlatformCode,
          fwCompilationUnixTimestamp: fwCompilationUnixTimestamp,
          tnglFingerprint: tnglFingerprintHex,
          eventStoreFingerprint: eventstoresFingerprintHex,
          configFingerprint: configFingerprintHex,
          networkStorageFingerprint: networkstorageFingerprintHex,
          controllerStoreFingerprint: controllerstoreFingerprintHex,
          notificationStoreFingerprint: notificationstoreFingerprintHex,
        } satisfies ControllerInfo

        logging.info('> Controller Info:', info)
        return info
      } else {
        logging.error(`Request failed with error code: ${errorCode}`)
        throw 'Fail'
      }
    })
  }

  // =============================== 0.12.11 ===============================

  /**
   * Creates a ControllerRef bound to a specific connection path.
   *
   * @param path - Single hop (string) or array of hops to reach the controller
   *   - [] or no args for app controller (local/root)
   *   - "bluetooth/aa:bb:cc:dd:ee:ff" or ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct
   *   - ["bluetooth/...", "espnow/..."] for multi-hop
   * @returns ControllerRef instance
   *
   * @example
   * const appRef = spectoda.use([])  // app controller
   * const directRef = spectoda.use("bluetooth/aa:bb:cc:dd:ee:ff")
   * const multiHopRef = spectoda.use(["bluetooth/...", "espnow/..."])
   *
   * // Chain to reach deeper controllers
   * const deeper = directRef.use("espnow/11:22:33:44:55:66")
   */
  use(path: string | string[] = []): ControllerRef {
    const connectionPath = typeof path === 'string' ? [path] : path

    // Extract MAC from the last hop if present
    let mac = ''
    const lastHop = connectionPath.at(-1)
    if (lastHop) {
      const slashIndex = lastHop.indexOf('/')
      if (slashIndex !== -1) {
        mac = lastHop.slice(slashIndex + 1)
      }
    }

    return new ControllerRef(this, connectionPath, {
      mode: 'controllerActions', // Spectoda.use() always creates controllerActions mode refs
      mac,
    })
  }

  /**
   * Writes configuration to a controller via connection path.
   *
   * @param connection - Connection path as array of hops, e.g., ["/"] for app controller,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct connection,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff", "espnow/12:34:56:78:90:ab"] for multi-hop
   * @param config - Configuration JSON string to write
   * @param options - Optional settings: timeout (ms), rebootAfterWrite (bool)
   */
  async requestWriteConfig(
    connection: string[],
    config: string,
    options?: { rebootAfterWrite?: boolean; timeout?: number },
  ): Promise<Uint8Array> {
    return this.runtime.requestWriteConfig(connection, config, options)
  }

  /**
   * Reads configuration from a controller via connection path.
   *
   * @param connection - Connection path as array of hops, e.g., ["/"] for app controller,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct connection,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff", "espnow/12:34:56:78:90:ab"] for multi-hop
   * @param options - Optional settings: timeout (ms)
   * @returns Promise resolving to config JSON string
   */
  async requestReadConfig(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    return this.runtime.requestReadConfig(connection, options)
  }

  /**
   * Reads available connections from a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connection - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to array of ConnectionInfo objects with connector, mac, and rssi
   * @example
   * // Returns: [{ connector: 'espnow', mac: 'aa:bb:cc:dd:ee:ff', rssi: -45 }, ...]
   */
  async requestReadConnections(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<ConnectionInfo[]> {
    return this.runtime.requestReadConnections(connection, options)
  }

  /**
   * Reads controller info from a controller via connection path.
   * Uses callback-first async API for multi-hop support. Response parsing is done in WASM.
   *
   * @param connection - Connection path as array of hops, e.g., ["/"] for app controller,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct connection,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff", "espnow/12:34:56:78:90:ab"] for multi-hop
   * @param options - Optional settings: timeout (ms)
   * @returns Promise resolving to ControllerInfo object
   */
  async requestReadControllerInfo(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<ControllerInfo> {
    return this.runtime.requestReadControllerInfo(connection, options)
  }

  /**
   * Reboots a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connection - Connection path as array of hops, e.g., ["/"] for app controller,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct connection,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff", "espnow/12:34:56:78:90:ab"] for multi-hop
   * @param options - Optional settings: timeout (ms)
   * @returns Promise resolving when reboot command is sent
   */
  async requestRestart(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    return this.runtime.requestRestart(connection, options)
  }

  /**
   * Puts a controller to sleep via connection path.
   * Uses callback-first async API for multi-hop support.
   * Sleep requires power cycle to wake up (unless duration is specified).
   *
   * @param connection - Connection path as array of hops, e.g., ["/"] for app controller,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct connection,
   *                     ["bluetooth/aa:bb:cc:dd:ee:ff", "espnow/12:34:56:78:90:ab"] for multi-hop
   * @param options - Optional settings: timeout (ms), duration (ms) - 0 for indefinite sleep
   * @returns Promise resolving when sleep command is sent
   */
  async requestSleep(
    connection: string[],
    options?: { timeout?: number; duration?: number },
  ): Promise<void> {
    return this.runtime.requestSleep(connection, options)
  }

  /**
   * Reads the controller label (short name) via connection path.
   *
   * @param connection - Array of hops to reach the controller
   * @param options - timeout (ms)
   * @returns Promise resolving to the controller label string
   */
  async requestReadControllerLabel(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    logging.debug(
      `Spectoda::requestReadControllerLabel(connection=${JSON.stringify(connection)}, options=${JSON.stringify(options)})`,
    )
    return this.runtime.requestReadControllerLabel(connection, options)
  }

  /**
   * Writes the controller label (short name) via connection path.
   *
   * @param connection - Array of hops to reach the controller
   * @param label - The new controller label to write
   * @param options - timeout (ms)
   * @returns Promise resolving when label is written
   */
  async requestWriteControllerLabel(
    connection: string[],
    label: string,
    options?: { timeout?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda::requestWriteControllerLabel(connection=${JSON.stringify(connection)}, label=${label}, options=${JSON.stringify(options)})`,
    )
    return this.runtime.requestWriteControllerLabel(connection, label, options)
  }

  /**
   * Reads the firmware version via connection path.
   *
   * @param connection - Array of hops to reach the controller
   * @param options - timeout (ms)
   * @returns Promise resolving to the firmware version string
   */
  async requestReadFwVersion(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    logging.debug(
      `Spectoda::requestReadFwVersion(connection=${JSON.stringify(connection)}, options=${JSON.stringify(options)})`,
    )
    return this.runtime.requestReadFwVersion(connection, options)
  }

  /**
   * Erases the network ownership from a controller via connection path.
   * Controller will need to be commissioned again.
   *
   * @param connection - Array of hops to reach the controller
   * @param options - timeout (ms)
   * @returns Promise resolving when network is erased
   */
  async requestEraseNetwork(
    connection: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda::requestEraseNetwork(connection=${JSON.stringify(connection)}, options=${JSON.stringify(options)})`,
    )
    return this.runtime.requestEraseNetwork(connection, options)
  }

  // =============================== 0.12.11 ===============================

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

  // valid UUIDs are in range [1..4294967295] (32-bit unsigned number)
  #getUUID() {
    if (this.#uuidCounter >= 4294967295) {
      this.#uuidCounter = 0
    }

    return ++this.#uuidCounter
  }

  async #connect(
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

            const tnglFingerprint =
              this.runtime.spectoda_js.getTnglFingerprint()
            const eventStoreFingerprint =
              this.runtime.spectoda_js.getEventStoreFingerprint()
            const networkStorageFingerprint =
              this.runtime.spectoda_js.getNetworkStorageFingerprint()

            logging.debug('APP tnglFingerprint', tnglFingerprint)
            logging.debug('ESP tnglFingerprint', info.tnglFingerprint)
            logging.debug('APP eventStoreFingerprint', eventStoreFingerprint)
            logging.debug(
              'ESP eventStoreFingerprint',
              info.eventStoreFingerprint,
            )
            logging.debug(
              'APP networkStorageFingerprint',
              networkStorageFingerprint,
            )
            logging.debug(
              'ESP networkStorageFingerprint',
              info.networkStorageFingerprint,
            )

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
}
