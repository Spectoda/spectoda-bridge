// @ts-nocheck

import type { EventState } from '..'
import {
  createNanoEvents,
  createNanoEventsWithWrappedEmit,
  detectChrome,
  detectGW,
  detectLinux,
  detectNode,
  detectSpectodaConnect,
  sleep,
} from '../functions'
import { logging } from '../logging'
import type { Spectoda } from '../Spectoda'
import { TimeTrack } from '../TimeTrack'
import { SpectodaConnectConnector } from './connector/SpectodaConnectConnector'
import { SpectodaNodeBluetoothConnector } from './connector/SpectodaNodeBleConnector'
import { SpectodaNodeSerialConnector } from './connector/SpectodaNodeSerialConnector'
import { SpectodaSimulatedConnector } from './connector/SpectodaSimulatedConnector'
import { SpectodaWebBluetoothConnector } from './connector/SpectodaWebBluetoothConnector'
import { SpectodaWebSerialConnector } from './connector/SpectodaWebSerialConnector'
import { APP_MAC_ADDRESS, DEFAULT_TIMEOUT } from './constants'
import { Spectoda_JS } from './Spectoda_JS'
// import { SpectodaConnectConnector } from "./SpectodaConnectConnector";
import { SpectodaWasm } from './SpectodaWasm'
import { type SpectodaAppEventMap, SpectodaAppEvents } from './types/app-events'
import type { ConnectorType } from './types/connect'
import type {
  ControllerInfo,
  Criteria,
  Criterium,
  SpectodaIdsType,
  SpectodaIdType,
} from './types/primitives'
import type { Connection, ConnectionInfo, Synchronization } from './types/wasm'

// Spectoda.js -> SpectodaRuntime.js -> | SpectodaXXXConnector.js ->

// SpectodaRuntime vsude vraci Promisy a ma v sobe spolecne
// koncepty pro vsechny konektory. Tzn send queue, ktery paruje odpovedi a resolvuje
// promisy.
// SpectodaRuntime definuje
// userSelect, autoSelect, selected
// connect, disconnect, connected
// execute, request
// setClock, getClock, updateFW
// addEventListener - "connected", "disconnected", "otastatus", "tngl"

// SpectodaXXXConnector.js je jakoby blokujici API, pres ktere se da pripojovat k FW.

/////////////////////////////////////////////////////////////////////////

// TODO Interface proccesses the commands before they are handed to Runtime. It deals with the same command spaming (moving slider generates a lot of events)
// TODO Hands the execute commands to other Interfaces in "paralel" of giving it to its own Runtime.

// Interface -> Interface -> Interface
//     |            |            |
//  Runtime      Runtime      Runtime

// TODO SpectodaRuntime is the host of the FW simulation of the Spectoda Controller Runtime.
// TODO Wasm holds the event store, current TNGL banks and acts like the FW.
// TODO execute commands goes in and when processed goes back out to be handed over to Connectors to sendExecute() the commands to other connected Interfaces
// TODO request commands goes in and if needed another request command goes out to Connectors to sendRequest() to a external Interface with given mac address.

/////////////////////////////////////////////////////////////////////////
export const allEventsEmitter = createNanoEvents()

export function emitHandler({ event, args }: { event: string; args: any }) {
  allEventsEmitter.emit('on', { name: event, args })
}

class BitSet {
  size: number
  bitArray: Uint32Array

  constructor(size: number) {
    this.size = size
    this.bitArray = new Uint32Array(Math.ceil(size / 32))
  }

  setBit(position: number) {
    const index = Math.floor(position / 32)
    const bit = position % 32

    this.bitArray[index] |= 1 << bit
  }

  clearBit(position: number) {
    const index = Math.floor(position / 32)
    const bit = position % 32

    this.bitArray[index] &= ~(1 << bit)
  }

  toggleBit(position: number) {
    const index = Math.floor(position / 32)
    const bit = position % 32

    this.bitArray[index] ^= 1 << bit
  }

  isSet(position: number) {
    const index = Math.floor(position / 32)
    const bit = position % 32

    return (this.bitArray[index] & (1 << bit)) !== 0
  }

  toString() {
    return [...this.bitArray]
      .map((num) => num.toString(2).padStart(32, '0'))
      .reverse()
      .join('')
  }
}

type UserSelectQuery = {
  criteria_array: Array<Criterium>
  timeout: number | typeof DEFAULT_TIMEOUT
}

type AutoSelectQuery = {
  criteria_array: Array<Criterium>
  scan_period: number | typeof DEFAULT_TIMEOUT
  timeout: number | typeof DEFAULT_TIMEOUT
}

type ScanQuery = {
  criteria_array: Array<Criterium>
  scan_period: number | typeof DEFAULT_TIMEOUT
}

type ConnectQuery = {
  timeout: number | typeof DEFAULT_TIMEOUT
}

type SendExecuteQuery = {
  command_bytes: Uint8Array
  source_connection: Connection
}

type SendRequestQuery = {
  request_bytecode: Uint8Array
  destination_connection: Connection
}

type SendSynchronizeQuery = {
  synchronization: Synchronization
  source_connection: Connection
}

type ExecuteQuery = {
  bytecode: Uint8Array
}

type RequestQuery = {
  bytecode: Uint8Array
  read_response: boolean
  timeout: number | typeof DEFAULT_TIMEOUT
}

// Deffered object
class Query {
  static TYPE_UNDEFINED = 0
  static TYPE_EXECUTE = 1
  static TYPE_DELIVER = 2
  static TYPE_TRANSMIT = 3
  static TYPE_USERSELECT = 4
  static TYPE_AUTOSELECT = 5
  static TYPE_SELECTED = 6
  static TYPE_UNSELECT = 7
  static TYPE_SCAN = 8
  static TYPE_CONNECT = 9
  static TYPE_CONNECTED = 10
  static TYPE_DISCONNECT = 11
  static TYPE_REQUEST = 12
  // static TYPE_SET_CLOCK = 13;
  // static TYPE_GET_CLOCK = 14;
  static TYPE_FIRMWARE_UPDATE = 15
  static TYPE_DESTROY = 16
  static TYPE_SEND_EXECUTE = 17
  static TYPE_SEND_REQUEST = 18
  static TYPE_SEND_RESPONSE = 19
  static TYPE_SEND_SYNCHRONIZE = 20

  type: number
  a: any
  b: any
  c: any
  d: any
  promise: Promise<any>
  resolve: (value?: any) => void
  reject: (reason?: any) => void

  constructor(
    type: number = Query.TYPE_UNDEFINED,
    a: any | null = null,
    b: any | null = null,
    c: any | null = null,
    d: any | null = null,
  ) {
    this.type = type
    this.a = a
    this.b = b
    this.c = c
    this.d = d

    this.reject = () => {}
    this.resolve = () => {}

    this.promise = new Promise((resolve, reject) => {
      this.reject = reject
      this.resolve = resolve
    })
  }
}

// filters out duplicate payloads and merges them together. Also decodes payloads received from the connector.
export class SpectodaRuntime {
  #eventEmitter
  #registeredListeners

  #queue: Query[]
  #processing: boolean

  #chunkSize: number

  #selecting: boolean
  #scanning: boolean

  #disconnectQuery: any | null

  #connectGuard: boolean

  #lastUpdateTime: number
  #lastUpdatePercentage: number

  #inicilized: boolean

  #assignedConnector: string
  #assignedConnectorParameter: any | null

  #ups
  #fps

  spectodaReference: Spectoda
  spectoda_js: Spectoda_JS

  clock: TimeTrack
  connector:
    | SpectodaWebBluetoothConnector
    | SpectodaWebSerialConnector
    | SpectodaNodeBluetoothConnector
    | SpectodaNodeSerialConnector
    | SpectodaConnectConnector
    | SpectodaSimulatedConnector
    | null

  onConnected: (e: any) => void
  onDisconnected: (e: any) => void

  lastUpdateTime: number
  lastUpdatePercentage: number

  WIP_name: string

  constructor(spectodaReference: Spectoda) {
    this.spectodaReference = spectodaReference
    this.spectoda_js = new Spectoda_JS(this)

    this.clock = new TimeTrack(0)

    // TODO implement a way of having more than one connector at the same time
    this.connector = null

    this.#eventEmitter = createNanoEventsWithWrappedEmit(emitHandler)
    this.#registeredListeners = new Map()

    this.#queue = []
    this.#processing = false
    this.#chunkSize = 208 // 208 is ESPNOW chunk size

    this.#selecting = false
    this.#disconnectQuery = null

    this.#connectGuard = false

    this.#lastUpdateTime = Date.now()
    this.#lastUpdatePercentage = 0

    this.#inicilized = false

    this.#assignedConnector = 'none'
    this.#assignedConnectorParameter = null

    this.onConnected = (_e) => {}
    this.onDisconnected = (_e) => {}

    this.lastUpdateTime = 0
    this.lastUpdatePercentage = 0

    this.WIP_name = 'APP'

    this.#eventEmitter.on(SpectodaAppEvents.OTA_PROGRESS, (value: number) => {
      const now = Date.now()

      const timeDelta = now - this.lastUpdateTime

      logging.verbose('time_delta:', timeDelta)
      this.lastUpdateTime = now

      const percentageDelta = value - this.lastUpdatePercentage

      logging.verbose('percentage_delta:', percentageDelta)
      this.lastUpdatePercentage = value

      const percentageLeft = 100 - value

      logging.verbose('percentage_left:', percentageLeft)

      const timeLeft = (percentageLeft / percentageDelta) * timeDelta

      logging.verbose('time_left:', timeLeft)

      this.emit(SpectodaAppEvents.OTA_TIMELEFT, timeLeft)
    })

    this.#eventEmitter.on(SpectodaAppEvents.PRIVATE_CONNECTED, (e: any) => {
      this.#onConnected(e)
    })

    this.#eventEmitter.on(SpectodaAppEvents.PRIVATE_DISCONNECTED, (e: any) => {
      this.#onDisconnected(e)
    })

    if (typeof window !== 'undefined') {
      // Use pagehide instead of beforeunload to avoid destroying the runtime
      // when user clicks "Cancel" on the leave confirmation dialog
      window.addEventListener('pagehide', () => {
        if (this.#inicilized) {
          this.destroyConnector()
          this.spectoda_js.destruct()
        }
      })
    }

    this.#ups = 10
    this.#fps = 2
  }

  #runtimeTask = async () => {
    try {
      await this.spectoda_js.inicilize()

      // ? "APP" controller config
      const appControllerConfig = {
        controller: {
          name: this.WIP_name,
        },
        console: {
          debug: logging.level,
        },
        io: {
          DUMMY: {
            type: 'GPIO',
            pin: -1,
          },
        },
      }

      await this.spectoda_js.construct(appControllerConfig, APP_MAC_ADDRESS)

      await sleep(0.1) // short delay to let fill up the queue to merge the execute items if possible

      // TODO figure out #fps (render) vs #ups (compute) for non visual processing (a.k.a event handling for example)

      const PROCESS = async () => {
        try {
          await this.spectoda_js.process()
        } catch (e) {
          logging.error('Error in process:', e)
        }

        // TODO if the ups was set to 0 and then back to some value, then the render loop should be started again
        if (this.#ups !== 0) {
          setTimeout(PROCESS, 1000 / this.#ups)
        }
      }

      const RENDER = async () => {
        try {
          await this.spectoda_js.render()
        } catch (e) {
          logging.error('Error in render:', e)
        }

        // TODO if the fps was set to 0 and then back to some value, then the render loop should be started again
        if (this.#fps !== 0) {
          setTimeout(RENDER, 1000 / this.#fps)
        }
      }

      setTimeout(PROCESS, 0)
      setTimeout(RENDER, 0)
    } catch (e) {
      logging.error('Error in runtime:', e)
    }
  }

  async #initialize(): Promise<void> {
    if (!this.#inicilized) {
      this.#inicilized = true
      await this.#runtimeTask()
    }

    await this.spectoda_js.waitForInitilize()
  }

  /**
   * @name addEventListener
   * @param {string} event
   * @param {Function} callback
   *
   * events: "disconnected", "connected"
   *
   * all events: event.target === the sender object (SpectodaWebBluetoothConnector)
   * event "disconnected": event.reason has a string with a disconnect reason
   *
   * @returns {Function} unbind function
   */

  addEventListener<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ) {
    return this.on(event, callback)
  }
  /**
   * @alias this.addEventListener
   */
  on<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ) {
    const eventKey = String(event)

    let listenersForEvent = this.#registeredListeners.get(eventKey)

    if (!listenersForEvent) {
      listenersForEvent = new Set()
      this.#registeredListeners.set(eventKey, listenersForEvent)
    }

    listenersForEvent.add(callback)

    const unsubscribe = this.#eventEmitter.on(event, callback)

    return () => {
      const currentListeners = this.#registeredListeners.get(eventKey)

      currentListeners?.delete(callback)

      if (currentListeners && currentListeners.size === 0) {
        this.#registeredListeners.delete(eventKey)
      }

      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }

  /**
   * Returns a snapshot of currently registered listeners for this runtime,
   * grouped by event key.
   *
   * The returned Map is the internal instance, so callers should treat it as
   * read-only and never mutate it directly.
   */
  getRegisteredListeners() {
    return this.#registeredListeners
  }

  emit<K extends keyof SpectodaAppEventMap>(
    event: K,
    ...args: SpectodaAppEventMap[K] extends undefined
      ? []
      : [SpectodaAppEventMap[K]]
  ) {
    this.#eventEmitter.emit(event, ...args)
  }

  /**
   *
   * @param desired_connector
   * @param connector_parameter WIP - still figuring out what is can be used for. Right now it is used for simulated connector to pass the parameters for the simulated network.
   */
  assignConnector(
    desiredConnector: ConnectorType = 'default',
    connectorParameter: any = null,
  ) {
    logging.debug(
      `SpectodaRuntime::assignConnector(desired_connector=${desiredConnector})`,
    )

    let choosenConnector

    if (typeof desiredConnector !== 'string') {
      throw 'InvalidConnectorType'
    }

    if (desiredConnector === 'default') {
      if (detectGW() || (detectLinux() && detectChrome())) {
        desiredConnector = 'serial'
      } else {
        desiredConnector = 'bluetooth'
      }
    }

    if (desiredConnector.includes('bluetooth')) {
      if (detectSpectodaConnect()) {
        choosenConnector = 'flutterbluetooth'
      } else if (detectChrome()) {
        choosenConnector = 'webbluetooth'
      } else if (detectNode()) {
        choosenConnector = 'nodebluetooth'
      } else {
        throw 'UnsupportedConnectorPlatform'
      }
    }
    //
    else if (desiredConnector.includes('serial')) {
      if (detectNode()) {
        choosenConnector = 'nodeserial'
      } else if (detectChrome()) {
        choosenConnector = 'webserial'
      } else {
        throw 'UnsupportedConnectorPlatform'
      }
    }
    //
    else if (desiredConnector.includes('simulated')) {
      choosenConnector = 'simulated'
    }
    //
    else if (
      desiredConnector.includes('none') ||
      desiredConnector.length === 0
    ) {
      choosenConnector = 'none'
    }

    if (choosenConnector === undefined) {
      throw 'UnsupportedConnector'
    }

    // leave this at info, for faster debug
    logging.info(
      `> Assigning ${choosenConnector} connector with parameter:`,
      connectorParameter,
    )
    this.#assignedConnector = choosenConnector
    this.#assignedConnectorParameter = connectorParameter
  }

  async #updateConnector() {
    if (
      (this.connector !== null &&
        this.#assignedConnector === this.connector.type) ||
      (this.connector === null && this.#assignedConnector === 'none')
    ) {
      return
    }

    if (this.connector) {
      await this.connector.disconnect()
      await this.connector.destroy()
    }

    switch (this.#assignedConnector) {
      case 'none': {
        this.connector = null
        break
      }

      case 'simulated': {
        this.connector = new SpectodaSimulatedConnector(this)
        await this.connector.initialize(this.#assignedConnectorParameter)
        break
      }

      case 'webbluetooth': {
        this.connector = new SpectodaWebBluetoothConnector(this)
        break
      }

      case 'webserial': {
        this.connector = new SpectodaWebSerialConnector(this)
        break
      }

      case 'flutterbluetooth': {
        this.connector = new SpectodaConnectConnector(this)
        break
      }

      case 'nodebluetooth': {
        this.connector = new SpectodaNodeBluetoothConnector(this)
        break
      }

      case 'nodeserial': {
        this.connector = new SpectodaNodeSerialConnector(this)
        break
      }

      default: {
        logging.warn(`Unsupported connector: ${this.#assignedConnector}`)

        this.#assignedConnector = 'none'
        this.connector = null
      }
    }
  }

  userSelect(
    criteria: Criteria,
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    logging.debug(
      `SpectodaRuntime::userSelect(criteria=${JSON.stringify(criteria)}, timeout=${timeout}`,
    )

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    this.#selecting = true

    // ? makes sure that criteria is always an array of Criterium
    let criteriaArray: Array<Criterium>

    if (criteria === null || criteria === undefined) {
      criteriaArray = []
    } else if (Array.isArray(criteria)) {
      criteriaArray = criteria as Array<Criterium>
    } else {
      criteriaArray = [criteria as Criterium]
    }

    const userSelectQuery: UserSelectQuery = {
      criteria_array: criteriaArray,
      timeout,
    }
    const item = new Query(Query.TYPE_USERSELECT, userSelectQuery)

    this.#process(item)

    return item.promise.finally(() => {
      this.#selecting = false
    })
  }

  autoSelect(
    criteria: object,
    scanPeriod: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    logging.debug(
      `SpectodaRuntime::autoSelect(criteria=${JSON.stringify(
        criteria,
      )}, scan_period=${scanPeriod}, timeout=${timeout}`,
    )

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    this.#selecting = true

    // ? makes sure that criteria is always an array of Criterium
    let criteriaArray: Array<Criterium>

    if (criteria === null || criteria === undefined) {
      criteriaArray = []
    } else if (Array.isArray(criteria)) {
      criteriaArray = criteria as Array<Criterium>
    } else {
      criteriaArray = [criteria as Criterium]
    }

    const autoSelectQuery: AutoSelectQuery = {
      criteria_array: criteriaArray,
      scan_period: scanPeriod,
      timeout,
    }
    const item = new Query(Query.TYPE_AUTOSELECT, autoSelectQuery)

    this.#process(item)

    return item.promise.finally(() => {
      this.#selecting = false
    })
  }

  unselect(): Promise<null> {
    logging.debug('SpectodaRuntime::unselect()')

    const item = new Query(Query.TYPE_UNSELECT)

    this.#process(item)
    return item.promise
  }

  selected(): Promise<Criterium | null> {
    logging.debug('SpectodaRuntime::selected()')

    const item = new Query(Query.TYPE_SELECTED)

    this.#process(item)
    return item.promise
  }

  scan(
    criteria: object,
    scanPeriod: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    logging.debug(
      `SpectodaRuntime::scan(criteria=${JSON.stringify(criteria)}, scan_period=${scanPeriod}`,
    )

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    if (this.#scanning) {
      return Promise.reject('ScanningInProgress')
    }

    this.#scanning = true

    // ? makes sure that criteria is always an array of Criterium
    let criteriaArray: Array<Criterium>

    if (criteria === null || criteria === undefined) {
      criteriaArray = []
    } else if (Array.isArray(criteria)) {
      criteriaArray = criteria as Array<Criterium>
    } else {
      criteriaArray = [criteria as Criterium]
    }

    const scanQuery: ScanQuery = {
      criteria_array: criteriaArray,
      scan_period: scanPeriod,
    }
    const item = new Query(Query.TYPE_SCAN, scanQuery)

    this.#process(item)
    return item.promise.finally(() => {
      this.#scanning = false
    })
  }

  connect(
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    logging.debug(`SpectodaRuntime::connect(timeout=${timeout})`)

    const connectQuery: ConnectQuery = { timeout }
    const item = new Query(Query.TYPE_CONNECT, connectQuery)

    this.#process(item)
    return item.promise
  }

  #onConnected = (event: any) => {
    if (this.#connectGuard) {
      logging.info(
        'Connecting logic error. #connected called when already connected. Ignoring the #connected event',
      )
      return
    }

    this.#connectGuard = true
    this.onConnected(event)
  }

  disconnect(): Promise<void> {
    logging.debug('SpectodaRuntime::disconnect()')

    const item = new Query(Query.TYPE_DISCONNECT)

    this.#process(item)
    return item.promise
  }

  #onDisconnected = (event: any) => {
    if (!this.#connectGuard) {
      logging.info(
        'Connecting logic error. #disconnected called when already disconnected. Ignoring the #disconnected event',
      )
      return
    }

    this.#connectGuard = false
    this.onDisconnected(event)

    if (this.#disconnectQuery) {
      this.#disconnectQuery.resolve()
    }
  }

  connected(): Promise<Criterium | null> {
    logging.debug('SpectodaRuntime::connected()')

    const item = new Query(Query.TYPE_CONNECTED)

    this.#process(item)
    return item.promise
  }

  cancel(): void {
    if (this.connector) {
      this.connector.cancel()
    }
  }

  // ! bytes_type is deprecated and will be removed in the future
  execute(
    bytecode: number[] | Uint8Array,
    bytesType: string | undefined,
  ): Promise<unknown> {
    logging.debug('execute', { bytecode, bytes_type: bytesType })

    const executeQuery: ExecuteQuery = { bytecode: new Uint8Array(bytecode) }

    const item = new Query(Query.TYPE_EXECUTE, executeQuery, bytesType)

    // there must only by one item in the queue with given label
    // this is used to send only the most recent item.
    // for example events
    // so if there is a item with that label, then remove it and
    // push this item to the end of the queue
    if (bytesType) {
      for (let i = 0; i < this.#queue.length; i++) {
        if (
          this.#queue[i].type === Query.TYPE_EXECUTE &&
          bytesType === this.#queue[i].b
        ) {
          logging.verbose(
            `Query ${bytesType} already in queue waiting for execute. Resolving it`,
          )
          this.#queue[i].resolve()
          this.#queue.splice(i, 1)
          break
        }
      }
    }

    this.#process(item)
    return item.promise
  }

  request(
    bytecode: number[] | Uint8Array,
    readResponse = true,
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    logging.debug(
      `SpectodaRuntime::request(bytecode.length=${bytecode.length}, read_response=${readResponse}, timeout=${timeout})`,
    )
    logging.verbose('bytecode=', bytecode)

    const requestQuery: RequestQuery = {
      bytecode: new Uint8Array(bytecode),
      read_response: readResponse,
      timeout,
    }

    const item = new Query(Query.TYPE_REQUEST, requestQuery)

    this.#process(item)
    return item.promise
  }

  updateFW(firmwareBytes: Uint8Array, options?: { skipReboot?: boolean }) {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `SpectodaRuntime::updateFW(firmware_bytes.length=${firmwareBytes.length}, skipReboot=${skipReboot})`,
    )

    const item = new Query(
      Query.TYPE_FIRMWARE_UPDATE,
      firmwareBytes,
      skipReboot,
    )

    for (let i = 0; i < this.#queue.length; i++) {
      if (this.#queue[i].type === Query.TYPE_FIRMWARE_UPDATE) {
        this.#queue[i].reject('Multiple FW Updates')
        this.#queue.splice(i, 1)
        break
      }
    }

    this.#process(item)
    return item.promise
  }

  destroyConnector() {
    logging.debug('SpectodaRuntime::destroyConnector()')

    const item = new Query(Query.TYPE_DESTROY)

    for (let i = 0; i < this.#queue.length; i++) {
      if (this.#queue[i].type === Query.TYPE_DESTROY) {
        this.#queue[i].reject('Multiple Connector destroy()')
        this.#queue.splice(i, 1)
        break
      }
    }

    this.#process(item)
    return item.promise
  }

  // starts a "thread" that is processing the commands from queue
  #process(item: Query) {
    if (item) {
      this.#queue.push(item)
    }

    if (!this.#processing) {
      this.#processing = true

      // spawn async function to handle the transmittion one item at the time
      ;(async () => {
        await this.#initialize()

        await sleep(0.001) // short delay to let fill up the queue to merge the execute items if possible

        try {
          await this.#updateConnector()

          while (this.#queue.length > 0) {
            const item = this.#queue.shift()

            if (!item) {
              continue
            }

            if (!this.connector) {
              item.reject('ConnectorNotAssigned')
              this.#queue = []
              return
            }

            switch (item.type) {
              case Query.TYPE_USERSELECT: {
                {
                  const userSelectQuery: UserSelectQuery = item.a

                  try {
                    await this.connector
                      .userSelect(
                        userSelectQuery.criteria_array,
                        userSelectQuery.timeout,
                      )
                      .then((result: any) => {
                        item.resolve(result)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_AUTOSELECT: {
                {
                  const autoSelectQuery: AutoSelectQuery = item.a

                  try {
                    await this.connector
                      .autoSelect(
                        autoSelectQuery.criteria_array,
                        autoSelectQuery.scan_period,
                        autoSelectQuery.timeout,
                      )
                      .then((result: any) => {
                        item.resolve(result)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_SELECTED: {
                try {
                  await this.connector.selected().then((result: any) => {
                    item.resolve(result)
                  })
                } catch (error) {
                  item.reject(error)
                }
                break
              }

              case Query.TYPE_UNSELECT: {
                try {
                  await this.connector.unselect().then(() => {
                    item.resolve()
                  })
                } catch (error) {
                  item.reject(error)
                }
                break
              }

              case Query.TYPE_SCAN: {
                {
                  const scanQuery: ScanQuery = item.a

                  try {
                    await this.connector
                      .scan(scanQuery.criteria_array, scanQuery.scan_period)
                      .then((result: any) => {
                        item.resolve(result)
                      })
                  } catch (error) {
                    //logging.warn(error);
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_CONNECT: {
                {
                  const connectQuery: ConnectQuery = item.a

                  try {
                    await this.connector
                      .connect(connectQuery.timeout)
                      .then(async (result: any) => {
                        if (!this.#connectGuard) {
                          logging.info(
                            'Connection logic error. #connected not called during successful connect(). Emitting #connected',
                          )
                          this.#eventEmitter.emit(
                            SpectodaAppEvents.PRIVATE_CONNECTED,
                          )
                        }

                        try {
                          this.clock = await this.connector?.getClock()
                          this.spectoda_js.setClockTimestamp(
                            this.clock.millis(),
                          )
                          this.#eventEmitter.emit(
                            SpectodaAppEvents.PRIVATE_WASM_CLOCK,
                            this.clock.millis(),
                          )
                          item.resolve(result)
                        } catch (error) {
                          logging.error(error)
                          this.clock = new TimeTrack(0)
                          item.resolve(result)
                        }
                      })
                  } catch (error) {
                    await this.connector.disconnect()
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_CONNECTED: {
                try {
                  await this.connector.connected().then((result: any) => {
                    item.resolve(result)
                  })
                } catch (error) {
                  item.reject(error)
                }
                break
              }

              case Query.TYPE_DISCONNECT: {
                this.#disconnectQuery = new Query()

                try {
                  await this.connector
                    .disconnect()
                    .then(this.#disconnectQuery.promise)
                    .then(() => {
                      this.#disconnectQuery = null
                      item.resolve()
                    })
                } catch (error) {
                  item.reject(error)
                }
                break
              }

              case Query.TYPE_EXECUTE: {
                {
                  const executeQuery: ExecuteQuery = item.a

                  const payload = new Uint8Array(0xffff)
                  let index = 0

                  payload.set(executeQuery.bytecode, index)
                  index += executeQuery.bytecode.length

                  const executesInPayload = [item]

                  // while there are items in the queue, and the next item is also TYPE_EXECUTE
                  while (
                    this.#queue.length > 0 &&
                    this.#queue[0].type === Query.TYPE_EXECUTE
                  ) {
                    // @ts-expect-error it is never undefined because of (this.#queue.length > 0)
                    const nextItem: Query = this.#queue.shift()
                    const nextExecuteQuery: ExecuteQuery = nextItem.a

                    // then check if I have room to merge other payload bytes
                    if (
                      index + nextExecuteQuery.bytecode.length <=
                      this.#chunkSize
                    ) {
                      payload.set(nextExecuteQuery.bytecode, index)
                      index += nextExecuteQuery.bytecode.length
                      executesInPayload.push(nextItem)
                    }

                    // if not, then return the item back into the queue
                    else {
                      this.#queue.unshift(nextItem)
                      break
                    }
                  }

                  const mergedPayload = payload.slice(0, index)

                  // logging.debug("EXECUTE", uint8ArrayToHexString(merged_payload));

                  try {
                    this.spectoda_js.execute(
                      mergedPayload,
                      SpectodaWasm.Connection.make(
                        APP_MAC_ADDRESS,
                        SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
                        SpectodaWasm.connection_rssi_t.RSSI_MAX,
                      ),
                    )
                    for (const element of executesInPayload) {
                      element.resolve()
                    }
                  } catch (error) {
                    for (const element of executesInPayload) {
                      element.reject(error)
                    }
                  }
                }
                break
              }

              case Query.TYPE_REQUEST: {
                try {
                  const requestQuery: RequestQuery = item.a

                  await this.connector
                    .request(
                      requestQuery.bytecode,
                      requestQuery.read_response,
                      requestQuery.timeout,
                    )
                    .then((response: any) => {
                      item.resolve(response)
                    })
                } catch (error) {
                  item.reject(error)
                }
                break
              }

              // case Query.TYPE_SET_CLOCK:
              //   {

              //     this.spectoda_js.setClockTimestamp(item.a.millis());

              //     try {
              //       await this.connector.setClock(item.a).then((response: any) => {
              //         item.resolve(response);
              //       });
              //     } catch (error) {
              //       item.reject(error);
              //     }
              //   }
              //   break;

              // case Query.TYPE_GET_CLOCK:
              //   {
              //     try {
              //       await this.connector.getClock().then((clock: TimeTrack) => {
              //         item.resolve(clock);
              //       });
              //     } catch (error) {
              //       item.reject(error);
              //     }
              //   }
              //   break;

              case Query.TYPE_FIRMWARE_UPDATE: {
                try {
                  await this.spectodaReference.requestWakeLock()
                } catch {}

                try {
                  const skipReboot = item.b === true

                  await this.connector
                    ?.updateFW(item.a, { skipReboot })
                    .then((response: any) => {
                      item.resolve(response)
                    })
                } catch (error) {
                  item.reject(error)
                }

                try {
                  this.spectodaReference.releaseWakeLock()
                } catch {}
                break
              }

              case Query.TYPE_DESTROY: {
                // this.#reconection = false;
                try {
                  // await this.connector
                  //   .request([COMMAND_FLAGS.FLAG_DEVICE_DISCONNECT_REQUEST], false)
                  //   .catch(() => { })
                  //   .then(() => {
                  await this.connector?.disconnect()
                  // })
                  // .then(() => {
                  await this.connector?.destroy()
                  // })

                  // .catch(error => {
                  //   //logging.warn(error);
                  //   this.connector = null;
                  //   item.reject(error);
                  // });
                } catch (error) {
                  logging.warn('Error while destroying connector:', error)
                } finally {
                  this.connector = null
                  item.resolve()
                }
                break
              }

              // ========================================================================================================================================================================

              case Query.TYPE_SEND_EXECUTE: {
                {
                  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

                  const sendExecuteQuery: SendExecuteQuery = item.a

                  try {
                    this.emit(
                      SpectodaAppEvents.PRIVATE_WASM_EXECUTE,
                      sendExecuteQuery.command_bytes,
                    )

                    await this.connector
                      .sendExecute(
                        sendExecuteQuery.command_bytes,
                        sendExecuteQuery.source_connection,
                      )
                      .then((result: any) => {
                        item.resolve(result)
                      })
                      .catch((e: any) => {
                        item.reject(e)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_SEND_REQUEST: {
                {
                  // bool _sendRequeststd::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

                  const sendRequestQuery: SendRequestQuery = item.a

                  try {
                    await this.connector
                      .sendRequest(
                        sendRequestQuery.request_bytecode,
                        sendRequestQuery.destination_connection,
                      )
                      .then((result: any) => {
                        item.resolve(result)
                      })
                      .catch((e: any) => {
                        item.reject(e)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_SEND_SYNCHRONIZE: {
                {
                  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

                  const sendSynchronizeQuery: SendSynchronizeQuery = item.a

                  try {
                    await this.connector
                      .sendSynchronize(
                        sendSynchronizeQuery.synchronization,
                        sendSynchronizeQuery.source_connection,
                      )
                      .then((result: any) => {
                        item.resolve(result)
                      })
                      .catch((e: any) => {
                        item.reject(e)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              // ========================================================================================================================================================================

              default: {
                logging.error('ERROR item.type=', item.type)
                item.reject('InvalidQueryType')
                break
              }
            }
          }
        } catch (e) {
          logging.error('Runtime::#process() ERROR:', e)
        } finally {
          this.#processing = false
        }
      })()
    }
  }

  readVariableAddress(variableAddress: number, deviceId: number) {
    logging.verbose(
      `readVariableAddress(variable_address=${variableAddress}, device_id=${deviceId})`,
    )

    return this.spectoda_js.readVariableAddress(variableAddress, deviceId)
  }

  WIP_loadFS() {
    return SpectodaWasm.loadFS()
  }

  WIP_saveFS() {
    return SpectodaWasm.saveFS()
  }

  async WIP_waitForInitilize() {
    return this.spectoda_js.waitForInitilize()
  }

  WIP_setFPS(fps: number) {
    this.#fps = fps
  }

  WIP_setUPS(ups: number) {
    this.#ups = ups
  }

  WIP_makePort(portLabel: string, portConfig: object) {
    return this.spectoda_js.makePort(portLabel, JSON.stringify(portConfig))
  }

  WIP_process(
    options: {
      skip_berry_plugin_update: boolean
      skip_eventstate_updates: boolean
      force_event_emittion: boolean
      skip_event_emittion: boolean
    } = {
      skip_berry_plugin_update: false,
      skip_eventstate_updates: false,
      force_event_emittion: false,
      skip_event_emittion: false,
    },
  ) {
    return this.spectoda_js.process(options)
  }

  WIP_render(options: { power: number } = { power: 255 }) {
    return this.spectoda_js.render(options)
  }

  WIP_setName(name: string) {
    this.WIP_name = name
  }

  WIP_setClockTimestamp(millis: number) {
    return this.spectoda_js.setClockTimestamp(millis)
  }

  WIP_getClockTimestamp() {
    return this.spectoda_js.getClockTimestamp()
  }

  async emitNumber(
    eventLabel: string,
    eventValue: number,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitNumber(eventLabel, eventValue, eventId)
  }

  async emitLabel(
    eventLabel: string,
    eventValue: string,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitLabel(eventLabel, eventValue, eventId)
  }

  async emitTimestamp(
    eventLabel: string,
    eventValue: number,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitTimestamp(eventLabel, eventValue, eventId)
  }

  async emitPercentage(
    eventLabel: string,
    eventValue: number,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitPercentage(eventLabel, eventValue, eventId)
  }

  async emitDate(
    eventLabel: string,
    eventValue: string,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitDate(eventLabel, eventValue, eventId)
  }

  async emitColor(
    eventLabel: string,
    eventValue: string,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitColor(eventLabel, eventValue, eventId)
  }

  async emitPixels(
    eventLabel: string,
    eventValue: number,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitPixels(eventLabel, eventValue, eventId)
  }

  async emitBoolean(
    eventLabel: string,
    eventValue: boolean,
    eventId: number,
  ): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitBoolean(eventLabel, eventValue, eventId)
  }

  async emitNull(eventLabel: string, eventId: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitNull(eventLabel, eventId)
  }

  async getEventStates(
    eventStateName: string,
    eventStateIds: SpectodaIdsType,
  ): Promise<(EventState | undefined)[]> {
    await this.#initialize()
    if (Array.isArray(eventStateIds)) {
      return eventStateIds.map((id) =>
        this.spectoda_js.getEventState(eventStateName, id),
      )
    } else {
      return [this.spectoda_js.getEventState(eventStateName, eventStateIds)]
    }
  }

  async getEventState(
    eventStateName: string,
    eventStateId: SpectodaIdType,
  ): Promise<EventState | undefined> {
    await this.#initialize()
    return this.spectoda_js.getEventState(eventStateName, eventStateId)
  }

  async getDateTime(): Promise<{ time: number; date: string }> {
    await this.#initialize()
    return this.spectoda_js.getDateTime()
  }

  async registerDeviceContexts(ids: SpectodaIdsType): Promise<boolean[]> {
    await this.#initialize()
    if (Array.isArray(ids)) {
      return ids.map((id) => this.spectoda_js.registerDeviceContext(id))
    } else {
      return [this.spectoda_js.registerDeviceContext(ids)]
    }
  }

  async registerDeviceContext(id: SpectodaIdType): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.registerDeviceContext(id)
  }

  // ====================================================================================================

  // REQUESTS

  // TODO requestEmitTnglBytecode(), requestReloadTngl(), requestWriteIoVariant(), requestWriteIoMapping()

  /**
   * Writes configuration to a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param config - Configuration JSON string to write
   * @param options - timeout (ms), rebootAfterWrite (bool)
   */
  async requestWriteConfig(
    connectionPath: string[],
    config: string,
    options?: { rebootAfterWrite?: boolean; timeout?: number },
  ): Promise<Uint8Array> {
    await this.#initialize()

    // TODO the incoming promises should be queued and processed sequentially

    return this.spectoda_js.requestWriteConfig(connectionPath, config, options)
  }

  /**
   * Reads configuration from a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to config JSON string
   */
  async requestReadConfig(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    await this.#initialize()

    return this.spectoda_js.requestReadConfig(connectionPath, options)
  }

  /**
   * Reads available connections from a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to array of ConnectionInfo objects with connector, mac, and rssi
   * @example
   * // Returns: [{ connector: 'espnow', mac: 'aa:bb:cc:dd:ee:ff', rssi: -45 }, ...]
   */
  async requestReadConnections(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ConnectionInfo[]> {
    await this.#initialize()

    return this.spectoda_js.requestReadConnections(connectionPath, options)
  }

  /**
   * Reads controller info from a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to ControllerInfo object
   */
  async requestReadControllerInfo(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ControllerInfo> {
    await this.#initialize()

    return this.spectoda_js.requestReadControllerInfo(connectionPath, options)
  }

  /**
   * Reboots a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when reboot command is sent
   */
  async requestRestart(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    await this.#initialize()

    return this.spectoda_js.requestRestart(connectionPath, options)
  }

  /**
   * Puts a controller to sleep via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms), duration (ms) - sleep duration, 0 for indefinite (requires power cycle)
   * @returns Promise resolving when sleep command is sent
   */
  async requestSleep(
    connectionPath: string[],
    options?: { timeout?: number; duration?: number },
  ): Promise<void> {
    await this.#initialize()

    return this.spectoda_js.requestSleep(connectionPath, options)
  }

  /**
   * Erases network ownership from a controller via connection path.
   * Controller will need to be commissioned again after this operation.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when network is erased
   */
  async requestEraseNetwork(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    await this.#initialize()

    return this.spectoda_js.requestEraseNetwork(connectionPath, options)
  }

  /**
   * Reads the controller label (short name) via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the controller label string
   */
  async requestReadControllerLabel(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    await this.#initialize()

    return this.spectoda_js.requestReadControllerLabel(connectionPath, options)
  }

  /**
   * Writes the controller label (short name) via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param label - The new controller label to write
   * @param options - timeout (ms)
   * @returns Promise resolving when label is written
   */
  async requestWriteControllerLabel(
    connectionPath: string[],
    label: string,
    options?: { timeout?: number },
  ): Promise<void> {
    await this.#initialize()

    return this.spectoda_js.requestWriteControllerLabel(connectionPath, label, options)
  }

  /**
   * Reads the firmware version via connection path.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the firmware version string
   */
  async requestReadFwVersion(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    await this.#initialize()

    return this.spectoda_js.requestReadFwVersion(connectionPath, options)
  }

  // ====================================================================================================

  // synchronize(synchronization: Synchronization, source_connection: Connection) {
  //   logging.debug(`synchronize(synchronization=${JSON.stringify(synchronization)}, source_connection=${JSON.stringify(source_connection)})`);

  //   const item = new Query(Query.TYPE_SYNCHRONIZE, synchronization, source_connection);
  //   this.#process(item);
  //   return item.promise;
  // }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `SpectodaRuntime::sendExecute(command_bytes=${commandBytes}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    const sendExecuteQuery: SendExecuteQuery = {
      command_bytes: commandBytes,
      source_connection: sourceConnection,
    }

    const item = new Query(Query.TYPE_SEND_EXECUTE, sendExecuteQuery)

    this.#process(item)
    return item.promise
  }

  // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.debug(
      `SpectodaRuntime::sendRequest(request_bytecode.length=${requestBytecode.length}, destination_connection=${destinationConnection})`,
    )
    logging.verbose('request_bytecode=', requestBytecode)

    const sendRequestQuery: SendRequestQuery = {
      request_bytecode: requestBytecode,
      destination_connection: destinationConnection,
    }

    const item = new Query(Query.TYPE_SEND_REQUEST, sendRequestQuery)

    this.#process(item)
    return item.promise
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(
    synchronization: Synchronization,
    sourceConnection: Connection,
  ) {
    logging.debug(
      `SpectodaRuntime::sendSynchronize(synchronization=${JSON.stringify(
        synchronization,
      )}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    const sendSynchronizeQuery: SendSynchronizeQuery = {
      synchronization,
      source_connection: sourceConnection,
    }

    const item = new Query(Query.TYPE_SEND_SYNCHRONIZE, sendSynchronizeQuery)

    this.#process(item)
    return item.promise
  }
}
