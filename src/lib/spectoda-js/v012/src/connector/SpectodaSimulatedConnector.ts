// eslint-disable-next-line @typescript-eslint/ban-ts-comment

import { sleep } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { PreviewController } from '../PreviewController'
import { APP_MAC_ADDRESS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaTypes } from '../types/primitives'
import { Connection, Synchronization, Uint8Vector } from '../types/wasm'
import { SpectodaAppEvents } from '../types/app-events'

import { IConnector_JS } from './IConnector_JS'

export const SIMULATED_MAC_ADDRESS = '00:00:23:34:45:56'

/////////////////////////////////////////////////////////////////////////////////////

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices
export class SpectodaSimulatedConnector {
  #runtimeReference
  #selected: boolean
  #connected: boolean

  #clock: TimeTrack

  #processIntervalHandle: NodeJS.Timeout | null
  #renderIntervalHandle: NodeJS.Timeout | null

  #ups
  #fps

  type: string
  controllers: PreviewController[]

  constructor(runtimeReference: SpectodaRuntime) {
    this.type = 'simulated'

    this.#runtimeReference = runtimeReference

    this.#processIntervalHandle = null
    this.#renderIntervalHandle = null

    this.#ups = 0
    this.#fps = 0

    this.#selected = false
    this.#connected = false

    this.#clock = new TimeTrack(0, false)
    this.controllers = []
  }

  // declare TS type

  async initialize(networkDefinition: any) {
    logging.verbose(`construct(networkDefinition=${networkDefinition})`)

    // let networkDefinition = JSON.parse(networkJsonDefinition);

    if (this.controllers.length > 0) {
      for (const controller of this.controllers) {
        controller.destruct()
      }
      this.controllers = []
    }

    if (this.#processIntervalHandle) {
      clearTimeout(this.#processIntervalHandle)
      this.#processIntervalHandle = null
    }
    if (this.#renderIntervalHandle) {
      clearTimeout(this.#renderIntervalHandle)
      this.#renderIntervalHandle = null
    }

    if (!networkDefinition) {
      const SimulatedControllerMacAddress = SIMULATED_MAC_ADDRESS

      const SimulatedControllerConfig = {
        controller: { name: 'SIMULATED' },
        console: { debug: 3 },

        io: {
          PIX1: { type: 'NEOPIXEL', variant: 'WS2812B' },
          PIX2: { type: 'NEOPIXEL', variant: 'WS2811', order: 'RGB' },
          PWM: { type: 'PWM', order: 'W' },
          DALI: { type: 'DALI' },
        },
      }

      const SimulatedConnectorImplementation = {
        _scan: (criteria_json: string, scan_period: number, result_out: any) => {
          return false
        },
        _autoConnect: (criteria_json: string, scan_period: number, timeout: number, result_out: any) => {
          return false
        },
        _userConnect: (criteria_json: string, timeout: number, result_out: any) => {
          return false
        },
        _disconnect: (connection: Connection) => {
          return false
        },
        _sendExecute: (command_bytecode: Uint8Vector, source_connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendExecute(source_connection:${source_connection.address_string})`,
          )

          const command_bytecode_array = SpectodaWasm.convertUint8VectorUint8Array(command_bytecode)

          if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED) {
            logging.debug('SpectodaSimulatedConnector::_sendExecute() - source_connection is CONNECTOR_SIMULATED')
            return true
          }

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return Promise.resolve()
          }

          // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00

          try {
            if (source_connection.address_string == '00:00:00:00:00:00') {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED
              source_connection.address_string = SimulatedControllerMacAddress

              this.#runtimeReference.spectoda_js.execute(command_bytecode_array, source_connection)
            } else {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED
              this.#runtimeReference.sendExecute(command_bytecode_array, source_connection).catch((e) => {
                logging.error(e)
                return false
              })
            }
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _sendRequest: (
          request_ticket_number: number,
          request_bytecode: Uint8Vector,
          destination_connection: Connection,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendRequest(destination_connection: ${destination_connection.address_string})`,
          )

          return true
        },
        _sendResponse: (
          request_ticket_number: number,
          request_result: number,
          response_bytecode: Uint8Vector,
          destination_connection: Connection,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendResponse(destination_connection: ${destination_connection.address_string})`,
          )

          return true
        },
        _sendSynchronize: (synchronization: Synchronization, source_connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendSynchronize(synchronization:${synchronization}, source_connection=${source_connection.address_string})`,
          )

          if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED) {
            logging.debug('SpectodaSimulatedConnector::_sendSynchronize() - source_connection is CONNECTOR_SIMULATED')
            return true
          }

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return Promise.resolve()
          }

          try {
            // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
            if (source_connection.address_string == '00:00:00:00:00:00') {
              source_connection.address_string = SimulatedControllerMacAddress
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED

              this.#runtimeReference.spectoda_js.synchronize(synchronization, source_connection)
            } else {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED
              this.#runtimeReference.sendSynchronize(synchronization, source_connection).catch((e) => {
                logging.error(e)
                return false
              })
            }
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _process: () => {},
      }

      const connector = new IConnector_JS()

      await connector.construct(SimulatedConnectorImplementation, SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED)
      const controller = new PreviewController(SimulatedControllerMacAddress)

      await controller.construct(SimulatedControllerConfig, connector)

      this.controllers.push(controller)
    }

    // TODO! be able to create whole simulated network
    // else if (networkDefinition?.controllers) {
    //   for (let controllerDefinition of networkDefinition.controllers) {
    //     let SimulatedControllerConfig: any;
    //     let controller_mac_address: string;

    //     if (controllerDefinition.config) {
    //       SimulatedControllerConfig = controllerDefinition.config;
    //     } else {
    //       if (controllerDefinition.name) {
    //         SimulatedControllerConfig = { controller: { name: controllerDefinition.name } };
    //       }
    //     }

    //     if (controllerDefinition.mac) {
    //       controller_mac_address = controllerDefinition.mac;
    //     } else {
    //       // get a random "00:00:00:00:00:00" MAC address
    //       controller_mac_address = Array.from({ length: 6 }, () =>
    //         Math.floor(Math.random() * 256)
    //           .toString(16)
    //           .padStart(2, "0"),
    //       ).join(":");
    //     }

    //     const controller = new PreviewController(controller_mac_address);
    //     controller.construct(SimulatedControllerConfig, SimulatedConnectorImplementation);
    //     this.controllers.push(controller);
    //   }
    // }

    // ? This can be offloaded to different thread
    {
      this.#ups = 10
      this.#fps = 5

      const __process = async () => {
        for (const controller of this.controllers) {
          try {
            controller.process()
          } catch (e) {
            logging.error(e)
          }
        }
      }

      const __render = async () => {
        for (const controller of this.controllers) {
          try {
            controller.render()
          } catch (e) {
            logging.error(e)
          }
        }
      }

      // TODO if the ups was set to 0 and then back to some value, then the render loop should be started again
      this.#processIntervalHandle = setInterval(__process, 1000 / this.#ups)
      // TODO if the fps was set to 0 and then back to some value, then the render loop should be started again
      this.#renderIntervalHandle = setInterval(__render, 1000 / this.#fps)
    }
  }

  userSelect(
    criterium_array: Array<SpectodaTypes['Criterium']>,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 60000
    }

    const criteria_json = JSON.stringify(criterium_array)

    logging.verbose('userSelect(criteria=' + criteria_json + ')')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }

      // TODO implement userSelect logic of choosing specific controller
      if (this.controllers.length === 0) {
        reject('SelectionFailed')
        return
      }

      await sleep(Math.random() * 1000) // userSelect logic process delay

      this.#selected = true

      // @ts-expect-error TODO: @immakermatty fix missing connector
      resolve({ connector: this.type })
    })
  }

  autoSelect(
    criterium_array: Array<SpectodaTypes['Criterium']>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    if (scan_duration_number === DEFAULT_TIMEOUT) {
      // ? 1200ms seems to be the minimum for the scan_duration if the controller is rebooted
      scan_duration_number = 1500
    }
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }

    // step 1. for the scan_period scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout,
    //         then return error

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }

      // TODO implement userSelect logic of choosing specific controller
      if (this.controllers.length === 0) {
        reject('SelectionFailed')
        return
      }

      await sleep(Math.random() * 1000) // autoSelect logic process delay

      this.#selected = true

      // @ts-expect-error TODO: @immakermatty fix missing connector
      resolve({ connector: this.type })
    })
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('selected()')

    return new Promise(async (resolve, reject) => {
      if (this.#selected) {
        // @ts-expect-error TODO: @immakermatty fix missing connector
        resolve({ connector: this.type })
      } else {
        resolve(null)
      }
    })
  }

  unselect(): Promise<null> {
    logging.verbose('unselect()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }
      await sleep(10) // unselect logic
      this.#selected = false
      resolve(null)
    })
  }

  scan(
    criterium_array: Array<SpectodaTypes['Criterium']>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<SpectodaTypes['Criterium']>> {
    if (scan_duration_number === DEFAULT_TIMEOUT) {
      scan_duration_number = 7000
    }

    logging.verbose(
      'scan(criterium_array=' +
        JSON.stringify(criterium_array) +
        ', scan_duration_number=' +
        scan_duration_number +
        ')',
    )

    // TODO scan logic based on the controllers contructed and criteria

    return Promise.resolve([])
  }

  connect(timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium']> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 20000
    }
    logging.debug(`connect(timeout=${timeout_number})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#selected) {
        reject('DeviceNotSelected')
        return
      }

      await sleep(Math.random() * 1000) // connecting logic process delay

      this.#connected = true
      this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)

      // @ts-expect-error TODO: @immakermatty fix missing connector
      resolve({ connector: this.type })
    })
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect(): Promise<unknown> {
    logging.verbose('disconnect()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await sleep(100) // disconnecting logic process delay

        this.#connected = false
        this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
      }
      resolve(null) // always resolves even if there are internal errors
    })
  }

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('connected()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        // @ts-expect-error TODO: @immakermatty fix missing connector
        resolve({ connector: this.type })
      } else {
        resolve(null)
      }
    })
  }

  // deliver handles the communication with the Spectoda network in a way
  // that the command is guaranteed to arrive
  deliver(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.verbose(`deliver(payload=${payload_bytes}, timeout=${timeout_number})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      for (const controller of this.controllers) {
        await controller.execute(
          payload_bytes,
          SpectodaWasm.Connection.make(
            APP_MAC_ADDRESS,
            SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED,
            SpectodaWasm.connection_rssi_t.RSSI_MAX,
          ),
        )
      }

      await sleep(25) // delivering logic

      resolve(undefined)
    })
  }

  // transmit handles the communication with the Spectoda network in a way
  // that the command is NOT guaranteed to arrive
  transmit(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 1000
    }
    logging.verbose(`transmit(payload=${payload_bytes}, timeout=${timeout_number})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      for (const controller of this.controllers) {
        await controller.execute(
          payload_bytes,
          SpectodaWasm.Connection.make(
            APP_MAC_ADDRESS,
            SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
            SpectodaWasm.connection_rssi_t.RSSI_MAX,
          ),
        )
      }

      await sleep(10) // transmiting logic
      resolve(undefined)
    })
  }

  // request handles the requests on the Spectoda network. The command request
  // is guaranteed to get a response
  request(
    payload_bytes: Uint8Array,
    read_response: boolean,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.verbose(
      `request(payload=${payload_bytes}, read_response=${read_response ? 'true' : 'false'}, timeout=${timeout_number})`,
    )

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      // TODO choose the controller I am connected to choosen in userSelect() or autoSelect()

      const response =
        this.controllers.length > 0
          ? this.controllers[0].request(
              payload_bytes,
              SpectodaWasm.Connection.make(
                APP_MAC_ADDRESS,
                SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
                SpectodaWasm.connection_rssi_t.RSSI_MAX,
              ),
            )
          : new Uint8Array()

      if (read_response) {
        await sleep(50) // requesting logic
        resolve(response)
      } else {
        await sleep(25) // requesting logic
        resolve(null)
      }
    })
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.verbose(`setClock(clock.millis()=${clock.millis()})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      this.#clock.setMillis(clock.millis())

      for (const controller of this.controllers) {
        await controller.setClockTimestamp(clock.millis())
      }

      await sleep(10) // writing clock logic.

      logging.verbose(`setClock() -> ${this.#clock.millis()}`)

      resolve(null)
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.verbose('getClock()')

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      // TODO choose the controller I am connected to choosen in userSelect() or autoSelect()

      const clock_timestamp = this.controllers.length > 0 ? this.controllers[0].getClockTimestamp() : 0

      this.#clock.setMillis(clock_timestamp)

      await sleep(50) // reading clock logic.

      logging.verbose(`getClock() -> ${this.#clock.millis()}`)
      resolve(this.#clock)
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers
  updateFW(firmware_bytes: Uint8Array): Promise<unknown> {
    logging.debug('updateFW()', firmware_bytes)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')
      await sleep(4000) // preparing FW logic.

      for (let i = 1; i <= 100; i++) {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_PROGRESS, i)
        await sleep(25) // writing FW logic.
      }

      await sleep(1000) // finishing FW logic.

      this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
      resolve(null)
    })
  }

  cancel(): void {
    // TODO implement
  }

  destroy(): Promise<unknown> {
    logging.verbose('destroy()')

    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
      .finally(() => {
        if (this.#processIntervalHandle) {
          clearTimeout(this.#processIntervalHandle)
          this.#processIntervalHandle = null
        }
        if (this.#renderIntervalHandle) {
          clearTimeout(this.#renderIntervalHandle)
          this.#renderIntervalHandle = null
        }
        if (this.controllers.length > 0) {
          for (const controller of this.controllers) {
            controller.destruct()
          }
          this.controllers = []
        }
      })
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(command_bytes: Uint8Array, source_connection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection.address_string})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED) {
      logging.debug('SpectodaSimulatedConnector::sendExecute() - source_connection is CONNECTOR_SIMULATED')
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    // TODO simulated connector needs the other side to receive the executed

    // ! This is a hack to make the simulated connector work with the preview controllers
    return new Promise(async (resolve, reject) => {
      //
      // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
      if (source_connection.address_string == '00:00:00:00:00:00') {
        source_connection.address_string = APP_MAC_ADDRESS
      }

      for (const controller of this.controllers) {
        if (controller.mac != source_connection.address_string) {
          try {
            controller.execute(command_bytes, source_connection)
          } catch (e) {
            logging.error(e)
          }
        }
      }

      resolve(null)
    })
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    // TODO simulated connector needs the other side to receive the request

    return Promise.reject('NotImplemented')
  }
  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

  sendResponse(
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Array,
    destination_connection: Connection,
  ) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    // TODO simulated connector needs the other side to receive the response

    return Promise.reject('NotImplemented')
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendSynchronize(synchronization=${synchronization.origin_address}, source_connection=${source_connection.address_string})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED) {
      logging.debug('SpectodaSimulatedConnector::sendSynchronize() - source_connection is CONNECTOR_SIMULATED')
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    // TODO simulated connector needs the other side to receive the synchronizes

    // ! This is a hack to make the simulated connector work with the preview controllers
    return new Promise(async (resolve, reject) => {
      //
      source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_SIMULATED

      // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
      if (source_connection.address_string == '00:00:00:00:00:00') {
        source_connection.address_string = APP_MAC_ADDRESS
      }

      for (const controller of this.controllers) {
        if (controller.mac != source_connection.address_string) {
          try {
            controller.synchronize(synchronization, source_connection)
          } catch (e) {
            logging.error(e)
          }
        }
      }

      resolve(null)
    })
  }
}
