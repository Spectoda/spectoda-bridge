// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { SpectodaDummyConnector } from '../SpectodaDummyConnector'
import {
  createNanoEvents,
  createNanoEventsWithWrappedEmit,
  detectChrome,
  detectGW,
  detectLinux,
  detectNode,
  detectSpectodaConnect,
  numberToBytes,
  sleep,
  uint8ArrayToHexString,
} from '../functions'
import { logging } from '../logging'
import { TimeTrack } from '../TimeTrack'
import { Spectoda } from '../Spectoda'
import { TnglReader } from '../TnglReader'
import { TnglWriter } from '../TnglWriter'

import { SpectodaWebBluetoothConnector } from './connector/SpectodaWebBluetoothConnector'
import { SpectodaWebSerialConnector } from './connector/SpectodaWebSerialConnector'
// import { SpectodaConnectConnector } from "./SpectodaConnectConnector";
import { PreviewController } from './PreviewController'
import { SpectodaWasm } from './SpectodaWasm'
import { Spectoda_JS } from './Spectoda_JS'
import { SpectodaConnectConnector } from './connector/SpectodaConnectConnector'
import { APP_MAC_ADDRESS, COMMAND_FLAGS, DEFAULT_TIMEOUT } from './constants'
import { SpectodaNodeBluetoothConnector } from './connector/SpectodaNodeBleConnector'
import { SpectodaNodeSerialConnector } from './connector/SpectodaNodeSerialConnector'
import { SpectodaSimulatedConnector } from './connector/SpectodaSimulatedConnector'
import { SPECTODA_APP_EVENTS, SpectodaAppEventMap, SpectodaAppEvents } from './types/app-events'
import { ConnectorType } from './types/connect'
import { EventState } from './types/event'
import { SpectodaTypes } from './types/primitives'
import { Connection, Synchronization } from './types/wasm'

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
// TODO Wasm holds the event history, current TNGL banks and acts like the FW.
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
  criteria_array: Array<SpectodaTypes['Criterium']>
  timeout: number | typeof DEFAULT_TIMEOUT
}

type AutoSelectQuery = {
  criteria_array: Array<SpectodaTypes['Criterium']>
  scan_period: number | typeof DEFAULT_TIMEOUT
  timeout: number | typeof DEFAULT_TIMEOUT
}

type ScanQuery = {
  criteria_array: Array<SpectodaTypes['Criterium']>
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
  request_ticket_number: number
  request_bytecode: Uint8Array
  destination_connection: Connection
}

type SendResponseQuery = {
  request_ticket_number: number
  request_result: number
  response_bytecode: Uint8Array
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

  #queue: Query[]
  #processing: boolean

  #chunkSize: number

  #selecting: boolean
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
    | SpectodaDummyConnector
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

  previewControllers: { [key: string]: PreviewController }

  WIP_name: string

  constructor(spectodaReference: Spectoda) {
    this.spectodaReference = spectodaReference
    this.spectoda_js = new Spectoda_JS(this)

    this.clock = new TimeTrack(0)

    // TODO implement a way of having more than one connector at the same time
    this.connector = null

    this.#eventEmitter = createNanoEventsWithWrappedEmit(emitHandler)

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

    this.onConnected = (e) => {}
    this.onDisconnected = (e) => {}

    this.lastUpdateTime = 0
    this.lastUpdatePercentage = 0

    this.WIP_name = 'APP'

    this.#eventEmitter.on(SpectodaAppEvents.OTA_PROGRESS, (value: number) => {
      const now = Date.now()

      const time_delta = now - this.lastUpdateTime

      logging.verbose('time_delta:', time_delta)
      this.lastUpdateTime = now

      const percentage_delta = value - this.lastUpdatePercentage

      logging.verbose('percentage_delta:', percentage_delta)
      this.lastUpdatePercentage = value

      const percentage_left = 100 - value

      logging.verbose('percentage_left:', percentage_left)

      const time_left = (percentage_left / percentage_delta) * time_delta

      logging.verbose('time_left:', time_left)

      this.emit(SpectodaAppEvents.OTA_TIMELEFT, time_left)
    })

    this.#eventEmitter.on(SpectodaAppEvents.PRIVATE_CONNECTED, (e: any) => {
      this.#onConnected(e)
    })

    this.#eventEmitter.on(SpectodaAppEvents.PRIVATE_DISCONNECTED, (e: any) => {
      this.#onDisconnected(e)
    })

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e) => {
        // If I cant disconnect right now for some readon
        // return this.disconnect(false).catch(reason => {
        //   if (reason == "CurrentlyWriting") {
        //     e.preventDefault();
        //     e.cancelBubble = true;
        //     e.returnValue = "Právě probíhá update připojeného zařízení, neopouštějte tuto stránku.";
        //     window.confirm("Právě probíhá update připojeného zařízení, neopouštějte tuto stránku.");
        //   }
        // });

        if (this.#inicilized) {
          this.destroyConnector()
          this.spectoda_js.destruct()
        }
      })
    }

    this.previewControllers = {}

    this.#eventEmitter.on(SPECTODA_APP_EVENTS.PRIVATE_WASM_EXECUTE, (command: Uint8Array) => {
      for (const previewController of Object.values(this.previewControllers)) {
        try {
          previewController.execute(
            command,
            SpectodaWasm.Connection.make(
              '11:11:11:11:11:11',
              SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
              SpectodaWasm.connection_rssi_t.RSSI_MAX,
            ),
          )
        } catch (error) {
          logging.error(error)
        }
      }
    })

    this.#eventEmitter.on(SPECTODA_APP_EVENTS.PRIVATE_WASM_CLOCK, (timestamp: number) => {
      for (const previewController of Object.values(this.previewControllers)) {
        try {
          previewController.setClockTimestamp(timestamp)
        } catch (error) {
          logging.error(error)
        }
      }
    })

    this.#ups = 10 // TODO increase to 10 when the performance is good
    this.#fps = 2 // TODO increase to 2 when the performance is good
  }

  #runtimeTask = async () => {
    try {
      await this.spectoda_js.inicilize()

      // ? "APP" controller config
      const app_controller_config = {
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

      await this.spectoda_js.construct(app_controller_config, APP_MAC_ADDRESS)

      await sleep(0.1) // short delay to let fill up the queue to merge the execute items if possible

      // TODO figure out #fps (render) vs #ups (compute) for non visual processing (a.k.a event handling for example)

      const __process = async () => {
        try {
          await this.spectoda_js.process()
        } catch (e) {
          logging.error('Error in process:', e)
        }

        // TODO if the ups was set to 0 and then back to some value, then the render loop should be started again
        if (this.#ups !== 0) {
          setTimeout(__process, 1000 / this.#ups)
        }
      }

      const __render = async () => {
        try {
          await this.spectoda_js.render()
        } catch (e) {
          logging.error('Error in render:', e)
        }

        // TODO if the fps was set to 0 and then back to some value, then the render loop should be started again
        if (this.#fps !== 0) {
          setTimeout(__render, 1000 / this.#fps)
        }
      }

      setTimeout(__process, 0)
      setTimeout(__render, 0)
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

  addEventListener<K extends keyof SpectodaAppEventMap>(event: K, callback: (props: SpectodaAppEventMap[K]) => void) {
    return this.on(event, callback)
  }
  /**
   * @alias this.addEventListener
   */
  on<K extends keyof SpectodaAppEventMap>(event: K, callback: (props: SpectodaAppEventMap[K]) => void) {
    return this.#eventEmitter.on(event, callback)
  }

  emit<K extends keyof SpectodaAppEventMap>(
    event: K,
    ...args: SpectodaAppEventMap[K] extends any[] ? SpectodaAppEventMap[K] : [SpectodaAppEventMap[K]] | []
  ) {
    this.#eventEmitter.emit(event, ...args)
  }

  /**
   *
   * @param desired_connector
   * @param connector_parameter WIP - still figuring out what is can be used for. Right now it is used for simulated connector to pass the parameters for the simulated network.
   */
  assignConnector(desired_connector: ConnectorType = 'default', connector_parameter: any = null) {
    logging.verbose(`assignConnector(desired_connector=${desired_connector})`)

    let choosen_connector = undefined

    if (typeof desired_connector !== 'string') {
      throw 'InvalidConnectorType'
    }

    if (desired_connector == 'default') {
      if (detectGW() || (detectLinux() && detectChrome())) {
        desired_connector = 'serial'
      } else {
        desired_connector = 'bluetooth'
      }
    }

    if (desired_connector.includes('bluetooth')) {
      if (detectSpectodaConnect()) {
        choosen_connector = 'flutterbluetooth'
      } else if (detectChrome()) {
        choosen_connector = 'webbluetooth'
      } else if (detectNode()) {
        choosen_connector = 'nodebluetooth'
      } else {
        throw 'UnsupportedConnectorPlatform'
      }
    }
    //
    else if (desired_connector.includes('serial')) {
      if (detectNode()) {
        choosen_connector = 'nodeserial'
      } else if (detectChrome()) {
        choosen_connector = 'webserial'
      } else {
        throw 'UnsupportedConnectorPlatform'
      }
    }
    //
    else if (desired_connector.includes('dummy')) {
      choosen_connector = 'dummy'
    }
    //
    else if (desired_connector.includes('simulated')) {
      choosen_connector = 'simulated'
    }
    //
    else if (desired_connector.includes('none') || desired_connector.length === 0) {
      choosen_connector = 'none'
    }

    if (choosen_connector === undefined) {
      throw 'UnsupportedConnector'
    }

    // leave this at info, for faster debug
    logging.info(`> Assigning ${choosen_connector} connector with parameter:`, connector_parameter)
    this.#assignedConnector = choosen_connector
    this.#assignedConnectorParameter = connector_parameter
  }

  async #updateConnector() {
    if (
      (this.connector !== null && this.#assignedConnector === this.connector.type) ||
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

      case 'dummy': {
        this.connector = new SpectodaDummyConnector(this)
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

      //? TBD in the future
      // case "websockets":
      //   this.connector = new SpectodaWebSocketsConnector(this);
      //   break;

      default: {
        logging.warn(`Unsupported connector: ${this.#assignedConnector}`)

        this.#assignedConnector = 'none'
        this.connector = null
      }
    }
  }

  userSelect(
    criteria: SpectodaTypes['Criteria'],
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose(`userSelect(criteria=${JSON.stringify(criteria)}, timeout=${timeout}`)

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    this.#selecting = true

    // ? makes sure that criteria is always an array of SpectodaTypes['Criterium']
    let criteria_array: Array<SpectodaTypes['Criterium']>

    if (criteria === null || criteria === undefined) {
      criteria_array = []
    } else if (Array.isArray(criteria)) {
      criteria_array = criteria as Array<SpectodaTypes['Criterium']>
    } else {
      criteria_array = [criteria as SpectodaTypes['Criterium']]
    }

    const user_select_query: UserSelectQuery = { criteria_array, timeout }
    const item = new Query(Query.TYPE_USERSELECT, user_select_query)

    this.#process(item)

    return item.promise.finally(() => {
      this.#selecting = false
    })
  }

  autoSelect(
    criteria: object,
    scan_period: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose(`autoSelect(criteria=${JSON.stringify(criteria)}, scan_period=${scan_period}, timeout=${timeout}`)

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    this.#selecting = true

    // ? makes sure that criteria is always an array of SpectodaTypes['Criterium']
    let criteria_array: Array<SpectodaTypes['Criterium']>

    if (criteria === null || criteria === undefined) {
      criteria_array = []
    } else if (Array.isArray(criteria)) {
      criteria_array = criteria as Array<SpectodaTypes['Criterium']>
    } else {
      criteria_array = [criteria as SpectodaTypes['Criterium']]
    }

    const auto_select_query: AutoSelectQuery = {
      criteria_array,
      scan_period,
      timeout,
    }
    const item = new Query(Query.TYPE_AUTOSELECT, auto_select_query)

    this.#process(item)

    return item.promise.finally(() => {
      this.#selecting = false
    })
  }

  unselect(): Promise<null> {
    logging.verbose('unselect()')

    const item = new Query(Query.TYPE_UNSELECT)

    this.#process(item)
    return item.promise
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('selected()')

    const item = new Query(Query.TYPE_SELECTED)

    this.#process(item)
    return item.promise
  }

  scan(
    criteria: object,
    scan_period: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<SpectodaTypes['Criterium']>> {
    logging.verbose(`scan(criteria=${JSON.stringify(criteria)}, scan_period=${scan_period}`)

    if (this.#selecting) {
      return Promise.reject('SelectingInProgress')
    }

    this.#selecting = true

    // ? makes sure that criteria is always an array of SpectodaTypes['Criterium']
    let criteria_array: Array<SpectodaTypes['Criterium']>

    if (criteria === null || criteria === undefined) {
      criteria_array = []
    } else if (Array.isArray(criteria)) {
      criteria_array = criteria as Array<SpectodaTypes['Criterium']>
    } else {
      criteria_array = [criteria as SpectodaTypes['Criterium']]
    }

    const scan_query: ScanQuery = { criteria_array, scan_period }
    const item = new Query(Query.TYPE_SCAN, scan_query)

    this.#process(item)
    return item.promise.finally(() => {
      this.#selecting = false
    })
  }

  connect(timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose(`connect(timeout=${timeout})`)

    const connect_query: ConnectQuery = { timeout }
    const item = new Query(Query.TYPE_CONNECT, connect_query)

    this.#process(item)
    return item.promise
  }

  #onConnected = (event: any) => {
    if (this.#connectGuard) {
      logging.error('Connecting logic error. #connected called when already connected?')
      logging.warn('Ignoring the #connected event')
      return
    }

    this.#connectGuard = true
    this.onConnected(event)
  }

  disconnect(): Promise<null> {
    logging.verbose('disconnect()')

    const item = new Query(Query.TYPE_DISCONNECT)

    this.#process(item)
    return item.promise
  }

  #onDisconnected = (event: any) => {
    if (!this.#connectGuard) {
      logging.error('Connecting logic error. #disconnected called when already disconnected?')
      logging.warn('Ignoring the #disconnected event')
      return
    }

    this.#connectGuard = false
    this.onDisconnected(event)

    if (this.#disconnectQuery) {
      this.#disconnectQuery.resolve()
    }
  }

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('connected()')

    const item = new Query(Query.TYPE_CONNECTED)

    this.#process(item)
    return item.promise
  }

  cancel(): Promise<unknown> {
    if (this.connector) {
      this.connector.cancel()
    }

    return Promise.resolve(null)
  }

  // ! bytes_type is deprecated and will be removed in the future
  execute(bytecode: number[] | Uint8Array, bytes_type: string | undefined): Promise<unknown> {
    logging.verbose('execute', { bytecode, bytes_type })

    const execute_query: ExecuteQuery = { bytecode: new Uint8Array(bytecode) }

    const item = new Query(Query.TYPE_EXECUTE, execute_query, bytes_type)

    // there must only by one item in the queue with given label
    // this is used to send only the most recent item.
    // for example events
    // so if there is a item with that label, then remove it and
    // push this item to the end of the queue
    if (bytes_type) {
      for (let i = 0; i < this.#queue.length; i++) {
        if (this.#queue[i].type === Query.TYPE_EXECUTE && bytes_type === this.#queue[i].b) {
          logging.verbose(`Query ${bytes_type} already in queue waiting for execute. Resolving it`)
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
    read_response = true,
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    logging.verbose('request', { bytecode, read_response, timeout })

    const request_query: RequestQuery = {
      bytecode: new Uint8Array(bytecode),
      read_response,
      timeout,
    }

    const item = new Query(Query.TYPE_REQUEST, request_query)

    this.#process(item)
    return item.promise
  }

  updateFW(firmware_bytes: Uint8Array) {
    logging.verbose('updateFW()')

    const item = new Query(Query.TYPE_FIRMWARE_UPDATE, firmware_bytes)

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
    logging.verbose('destroyConnector()')

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
                  const user_select_query: UserSelectQuery = item.a

                  try {
                    await this.connector
                      .userSelect(user_select_query.criteria_array, user_select_query.timeout)
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
                  const auto_select_query: AutoSelectQuery = item.a

                  try {
                    await this.connector
                      .autoSelect(
                        auto_select_query.criteria_array,
                        auto_select_query.scan_period,
                        auto_select_query.timeout,
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
                {
                  try {
                    await this.connector.selected().then((result: any) => {
                      item.resolve(result)
                    })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_UNSELECT: {
                {
                  try {
                    await this.connector.unselect().then(() => {
                      item.resolve()
                    })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_SCAN: {
                {
                  const scan_query: ScanQuery = item.a

                  try {
                    await this.connector.scan(scan_query.criteria_array, scan_query.scan_period).then((result: any) => {
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
                  const connect_query: ConnectQuery = item.a

                  try {
                    await this.connector.connect(connect_query.timeout).then(async (result: any) => {
                      if (!this.#connectGuard) {
                        logging.error('Connection logic error. #connected not called during successful connect()?')
                        logging.warn('Emitting #connected')
                        this.#eventEmitter.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
                      }

                      try {
                        this.clock = await this.connector?.getClock()
                        this.spectoda_js.setClockTimestamp(this.clock.millis())
                        this.#eventEmitter.emit(SpectodaAppEvents.PRIVATE_WASM_CLOCK, this.clock.millis())
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
                {
                  try {
                    await this.connector.connected().then((result: any) => {
                      item.resolve(result)
                    })
                  } catch (error) {
                    item.reject(error)
                  }
                }
                break
              }

              case Query.TYPE_DISCONNECT: {
                {
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
                }
                break
              }

              case Query.TYPE_EXECUTE: {
                {
                  const execute_query: ExecuteQuery = item.a

                  const payload = new Uint8Array(0xffff)
                  let index = 0

                  payload.set(execute_query.bytecode, index)
                  index += execute_query.bytecode.length

                  const executesInPayload = [item]

                  // while there are items in the queue, and the next item is also TYPE_EXECUTE
                  while (this.#queue.length > 0 && this.#queue[0].type == Query.TYPE_EXECUTE) {
                    // @ts-ignore it is never undefined because of (this.#queue.length > 0)
                    const next_item: Query = this.#queue.shift()
                    const next_execute_query: ExecuteQuery = next_item.a

                    // then check if I have room to merge other payload bytes
                    if (index + next_execute_query.bytecode.length <= this.#chunkSize) {
                      payload.set(next_execute_query.bytecode, index)
                      index += next_execute_query.bytecode.length
                      executesInPayload.push(next_item)
                    }

                    // if not, then return the item back into the queue
                    else {
                      this.#queue.unshift(next_item)
                      break
                    }
                  }

                  const merged_payload = payload.slice(0, index)

                  // logging.debug("EXECUTE", uint8ArrayToHexString(merged_payload));

                  try {
                    this.spectoda_js.execute(
                      merged_payload,
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
                {
                  try {
                    const request_query: RequestQuery = item.a

                    await this.connector
                      .request(request_query.bytecode, request_query.read_response, request_query.timeout)
                      .then((response: any) => {
                        item.resolve(response)
                      })
                  } catch (error) {
                    item.reject(error)
                  }
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
                {
                  try {
                    await this.spectodaReference.requestWakeLock()
                  } catch {}

                  try {
                    await this.connector?.updateFW(item.a).then((response: any) => {
                      item.resolve(response)
                    })
                  } catch (error) {
                    item.reject(error)
                  }

                  try {
                    this.spectodaReference.releaseWakeLock()
                  } catch {}
                }
                break
              }

              case Query.TYPE_DESTROY: {
                {
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
                }
                break
              }

              // ========================================================================================================================================================================

              case Query.TYPE_SEND_EXECUTE: {
                {
                  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

                  const send_execute_query: SendExecuteQuery = item.a

                  try {
                    this.emit(SpectodaAppEvents.PRIVATE_WASM_EXECUTE, send_execute_query.command_bytes)

                    await this.connector
                      .sendExecute(send_execute_query.command_bytes, send_execute_query.source_connection)
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
                  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

                  const send_request_query: SendRequestQuery = item.a

                  try {
                    await this.connector
                      .sendRequest(
                        send_request_query.request_ticket_number,
                        send_request_query.request_bytecode,
                        send_request_query.destination_connection,
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

              case Query.TYPE_SEND_RESPONSE: {
                {
                  // bool _sendResponse(const int32_t request_ticket_number, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

                  const send_response_query: SendResponseQuery = item.a

                  try {
                    await this.connector
                      .sendResponse(
                        send_response_query.request_ticket_number,
                        send_response_query.request_result,
                        send_response_query.response_bytecode,
                        send_response_query.destination_connection,
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

                  const send_synchronize_query: SendSynchronizeQuery = item.a

                  try {
                    await this.connector
                      .sendSynchronize(send_synchronize_query.synchronization, send_synchronize_query.source_connection)
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
                {
                  logging.error('ERROR item.type=', item.type)
                  item.reject('InvalidQueryType')
                }
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

  readVariableAddress(variable_address: number, device_id: number) {
    logging.verbose('readVariableAddress()', { variable_address, device_id })

    return this.spectoda_js.readVariableAddress(variable_address, device_id)
  }

  WIP_makePreviewController(controller_mac_address: string, controller_config: object) {
    logging.debug(`> Making PreviewController ${controller_mac_address}...`)

    if (typeof controller_config === 'string') {
      // TODO Add data validation
      controller_config = JSON.parse(controller_config) as any
    }

    logging.verbose('controller_config=', controller_config)

    const controller = new PreviewController(controller_mac_address)

    controller.construct(controller_config)
    this.previewControllers[controller_mac_address] = controller

    return controller
  }

  WIP_getPreviewController(controller_mac_address: string) {
    logging.verbose(`> Getting PreviewController ${controller_mac_address}...`)

    return this.previewControllers[controller_mac_address]
  }

  WIP_getPreviewControllers() {
    logging.verbose('> Getting PreviewControllers...')

    return this.previewControllers
  }

  WIP_renderPreview() {
    // logging.verbose(`> Rendering preview...`);

    try {
      for (const previewController of Object.values(this.previewControllers)) {
        previewController.render()
      }
    } catch (e) {
      console.error(e)
    }
  }

  WIP_loadFS() {
    return SpectodaWasm.loadFS()
  }

  WIP_saveFS() {
    return SpectodaWasm.saveFS()
  }

  // returns a promise that resolves a bytecode of the captured port pixels
  async WIP_capturePixels() {
    const A_ASCII_CODE = 'A'.charCodeAt(0)
    const D_ASCII_CODE = 'D'.charCodeAt(0)

    const PIXEL_ENCODING_CODE = 1

    let uuidCounter = Math.floor(Math.random() * 0xffffffff)

    const writer = new TnglWriter(65535)

    for (const previewController of Object.values(this.previewControllers)) {
      const tempWriter = new TnglWriter(65535)

      for (let portTag = A_ASCII_CODE; portTag <= D_ASCII_CODE; portTag++) {
        const request_uuid = uuidCounter++
        const request_bytes = [
          COMMAND_FLAGS.FLAG_READ_PORT_PIXELS_REQUEST,
          ...numberToBytes(request_uuid, 4),
          portTag,
          PIXEL_ENCODING_CODE,
        ]

        logging.debug('Sending request', uint8ArrayToHexString(request_bytes))
        const response = await previewController.request(
          new Uint8Array(request_bytes),
          SpectodaWasm.Connection.make(
            '11:11:11:11:11:11',
            SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
            SpectodaWasm.connection_rssi_t.RSSI_MAX,
          ),
        )

        logging.debug('Received response', uint8ArrayToHexString(response))
        const tempReader = new TnglReader(response)

        const response_flag = tempReader.readFlag()

        if (response_flag !== COMMAND_FLAGS.FLAG_READ_PORT_PIXELS_RESPONSE) {
          logging.error('InvalidResponse1')
          continue
        }

        const response_uuid = tempReader.readUint32()

        if (response_uuid !== request_uuid) {
          logging.error('InvalidResponse2')
          continue
        }

        const error_code = tempReader.readUint8()

        if (error_code === 0) {
          // error_code 0 is success
          const pixelDataSize = tempReader.readUint16()

          logging.debug('pixelDataSize=', pixelDataSize)

          const pixelData = tempReader.readBytes(pixelDataSize)

          logging.debug('pixelData=', pixelData)

          tempWriter.writeBytes(
            new Uint8Array([
              COMMAND_FLAGS.FLAG_WRITE_PORT_PIXELS_REQUEST,
              ...numberToBytes(uuidCounter++, 4),
              portTag,
              PIXEL_ENCODING_CODE,
              ...numberToBytes(pixelDataSize, 2),
              ...pixelData,
            ]),
          )
        }
      }

      const controllerIdentifier = previewController.identifier

      logging.debug('controllerIdentifier=', controllerIdentifier)

      const tempWriterDataView = tempWriter.bytes
      const tempWriterDataArray = new Uint8Array(tempWriterDataView.buffer)

      writer.writeBytes(
        new Uint8Array([
          COMMAND_FLAGS.FLAG_EVALUATE_ON_CONTROLLER_REQUEST,
          ...numberToBytes(uuidCounter++, 4),
          ...numberToBytes(controllerIdentifier, 4),
          ...numberToBytes(tempWriter.written, 2),
          ...tempWriterDataArray,
        ]),
      )
    }

    const command_bytes = new Uint8Array(writer.bytes.buffer)

    logging.verbose('command_bytes=', command_bytes)

    this.execute(command_bytes, undefined)

    return command_bytes
  }

  WIP_previewToJSON() {
    const segmnet_template = `{
      "segment": "seg1",
      "id": 0,
      "sections": []
    }`

    // TODO Add data validation
    const segment = JSON.parse(segmnet_template) as any

    const A_ASCII_CODE = 'A'.charCodeAt(0)
    const D_ASCII_CODE = 'D'.charCodeAt(0)

    const PIXEL_ENCODING_CODE = 1

    let uuidCounter = Math.floor(Math.random() * 0xffffffff)

    const writer = new TnglWriter(65535)

    for (const previewController of Object.values(this.previewControllers)) {
      for (let portTag = A_ASCII_CODE; portTag <= D_ASCII_CODE; portTag++) {
        const request_uuid = uuidCounter++
        const request_bytes = [
          COMMAND_FLAGS.FLAG_READ_PORT_PIXELS_REQUEST,
          ...numberToBytes(request_uuid, 4),
          portTag,
          PIXEL_ENCODING_CODE,
        ]

        logging.debug('Sending request', uint8ArrayToHexString(request_bytes))
        const response = previewController.request(
          new Uint8Array(request_bytes),
          SpectodaWasm.Connection.make(
            '11:11:11:11:11:11',
            SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
            SpectodaWasm.connection_rssi_t.RSSI_MAX,
          ),
        )

        logging.debug('Received response', uint8ArrayToHexString(response))
        const tempReader = new TnglReader(response)

        const response_flag = tempReader.readFlag()

        if (response_flag !== COMMAND_FLAGS.FLAG_READ_PORT_PIXELS_RESPONSE) {
          logging.error('InvalidResponse1')
          continue
        }

        const response_uuid = tempReader.readUint32()

        if (response_uuid !== request_uuid) {
          logging.error('InvalidResponse2')
          continue
        }

        const error_code = tempReader.readUint8()

        if (error_code === 0) {
          // error_code 0 is success
          const pixelDataSize = tempReader.readUint16()

          logging.debug('pixelDataSize=', pixelDataSize)

          const pixelData = tempReader.readBytes(pixelDataSize)

          logging.debug('pixelData=', pixelData)

          const bitset = new BitSet(pixelDataSize * 8)

          for (let i = 0; i < pixelDataSize; i++) {
            for (let j = 0; j < 8; j++) {
              if (pixelData[i] & (1 << j)) {
                bitset.setBit(i * 8 + j)
              }
            }
          }

          console.log(`Controller ${previewController.label}, Port ${String.fromCharCode(portTag)}:`, bitset.toString())

          const section_template = `{
            "controller": "con1",
            "port": "A",
            "from": 0,
            "to": 0,
            "reversed": false
          }`

          // TODO Add data validation
          let section = JSON.parse(section_template) as any

          section.controller = previewController.label
          section.port = String.fromCharCode(portTag)
          section.from = undefined
          section.to = undefined
          section.reversed = false

          for (let i = 0; i < bitset.size; i++) {
            if (bitset.isSet(i) && section.from === undefined) {
              section.from = i
            }
            if (!bitset.isSet(i) && section.from !== undefined) {
              section.to = i
              if (section.to - section.from > 40) {
                segment.sections.push(section)
              }

              // TODO Add data validation
              section = JSON.parse(section_template) as any
              section.controller = previewController.label
              section.port = String.fromCharCode(portTag)
              section.from = undefined
              section.to = undefined
              section.reversed = false
            }
          }

          if (section.from !== undefined) {
            section.to = bitset.size

            if (section.to - section.from > 40) {
              segment.sections.push(section)
            }
          }
        }
      }
    }

    console.log(JSON.stringify(segment))

    return segment
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

  WIP_makePort(port_label: string, port_config: object) {
    return this.spectoda_js.makePort(port_label, JSON.stringify(port_config))
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

  async emitNumber(event_label: string, event_value: number, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitNumber(event_label, event_value, event_id)
  }

  async emitLabel(event_label: string, event_value: string, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitLabel(event_label, event_value, event_id)
  }

  async emitTimestamp(event_label: string, event_value: number, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitTimestamp(event_label, event_value, event_id)
  }

  async emitPercentage(event_label: string, event_value: number, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitPercentage(event_label, event_value, event_id)
  }

  async emitDate(event_label: string, event_value: string, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitDate(event_label, event_value, event_id)
  }

  async emitColor(event_label: string, event_value: string, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitColor(event_label, event_value, event_id)
  }

  async emitPixels(event_label: string, event_value: number, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitPixels(event_label, event_value, event_id)
  }

  async emitBoolean(event_label: string, event_value: boolean, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitBoolean(event_label, event_value, event_id)
  }

  async emitNull(event_label: string, event_id: number): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.emitNull(event_label, event_id)
  }

  async getEventStates(
    event_state_name: string,
    event_state_ids: SpectodaTypes['IDs'],
  ): Promise<(EventState | undefined)[]> {
    await this.#initialize()
    if (Array.isArray(event_state_ids)) {
      return event_state_ids.map((id) => this.spectoda_js.getEventState(event_state_name, id))
    } else {
      return [this.spectoda_js.getEventState(event_state_name, event_state_ids)]
    }
  }

  async getEventState(event_state_name: string, event_state_id: SpectodaTypes['ID']): Promise<EventState | undefined> {
    await this.#initialize()
    return this.spectoda_js.getEventState(event_state_name, event_state_id)
  }

  async getDateTime(): Promise<{ time: number; date: string }> {
    await this.#initialize()
    return this.spectoda_js.getDateTime()
  }

  async registerDeviceContexts(ids: SpectodaTypes['IDs']): Promise<boolean[]> {
    await this.#initialize()
    if (Array.isArray(ids)) {
      return ids.map((id) => this.spectoda_js.registerDeviceContext(id))
    } else {
      return [this.spectoda_js.registerDeviceContext(ids)]
    }
  }

  async registerDeviceContext(id: SpectodaTypes['ID']): Promise<boolean> {
    await this.#initialize()
    return this.spectoda_js.registerDeviceContext(id)
  }

  // ====================================================================================================

  // synchronize(synchronization: Synchronization, source_connection: Connection) {
  //   logging.verbose(`synchronize(synchronization=${synchronization}, source_connection=${source_connection})`);

  //   const item = new Query(Query.TYPE_SYNCHRONIZE, synchronization, source_connection);
  //   this.#process(item);
  //   return item.promise;
  // }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(command_bytes: Uint8Array, source_connection: Connection) {
    logging.verbose(
      `SpectodaRuntime::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection})`,
    )

    const send_execute_query: SendExecuteQuery = {
      command_bytes,
      source_connection,
    }

    const item = new Query(Query.TYPE_SEND_EXECUTE, send_execute_query)

    this.#process(item)
    return item.promise
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaRuntime::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    const send_request_query: SendRequestQuery = {
      request_ticket_number,
      request_bytecode,
      destination_connection,
    }

    const item = new Query(Query.TYPE_SEND_REQUEST, send_request_query)

    this.#process(item)
    return item.promise
  }
  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

  sendResponse(
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Array,
    destination_connection: Connection,
  ) {
    logging.verbose(
      `SpectodaRuntime::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    const send_response_query: SendResponseQuery = {
      request_ticket_number,
      request_result,
      response_bytecode,
      destination_connection,
    }

    const item = new Query(Query.TYPE_SEND_RESPONSE, send_response_query)

    this.#process(item)
    return item.promise
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaRuntime::sendSynchronize(synchronization=${synchronization}, source_connection=${source_connection})`,
    )

    const send_synchronize_query: SendSynchronizeQuery = {
      synchronization,
      source_connection,
    }

    const item = new Query(Query.TYPE_SEND_SYNCHRONIZE, send_synchronize_query)

    this.#process(item)
    return item.promise
  }
}
