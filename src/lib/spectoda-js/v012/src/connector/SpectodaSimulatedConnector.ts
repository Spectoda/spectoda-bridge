// eslint-disable-next-line @typescript-eslint/ban-ts-comment

import { sleep } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { PreviewController } from '../PreviewController'
import { APP_MAC_ADDRESS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { Criterium } from '../types/primitives'
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

  #scanIntervalHandle: NodeJS.Timeout | null
  #scanCancelled: boolean
  #scanResolve: ((value: Array<Criterium>) => void) | null
  #currentScanResults: Array<Criterium & { connector: string; rssi: number; product: number }> | null

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

    this.#scanIntervalHandle = null
    this.#scanCancelled = false
    this.#scanResolve = null
    this.#currentScanResults = null

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
      }

      const SimulatedConnectorImplementation = {
        _scan: (criteria_json: string, scan_period: number, result_out: any) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_scan(criteria_json=${criteria_json}, scan_period=${scan_period}, result_out=${result_out})`,
          )

          return false
        },
        _autoConnect: (criteria_json: string, scan_period: number, timeout: number, result_out: any) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_autoConnect(criteria_json=${criteria_json}, scan_period=${scan_period}, timeout=${timeout}, result_out=${result_out})`,
          )

          return false
        },
        _userConnect: (criteria_json: string, timeout: number, result_out: any) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_userConnect(criteria_json=${criteria_json}, timeout=${timeout}, result_out=${result_out})`,
          )

          return false
        },
        _disconnect: (connection: Connection) => {
          logging.verbose(`SpectodaSimulatedConnector::_disconnect(connection=${connection.address_string})`)

          return false
        },
        _sendExecute: (command_bytecode: Uint8Vector, source_connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendExecute(source_connection:${source_connection.address_string})`,
          )

          const command_bytecode_array = SpectodaWasm.convertUint8VectorUint8Array(command_bytecode)

          if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME) {
            logging.debug(
              'SpectodaSimulatedConnector::_sendExecute() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME',
            )
            return true
          }

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return true
          }

          // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00

          try {
            if (source_connection.address_string == '00:00:00:00:00:00') {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              source_connection.address_string = SimulatedControllerMacAddress

              return this.#runtimeReference.spectoda_js.execute(command_bytecode_array, source_connection)
            } else {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              this.#runtimeReference.sendExecute(command_bytecode_array, source_connection).catch((e) => {
                logging.error(e)
              })
              return true
            }
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _sendRequest: (request_bytecode: Uint8Vector, destination_connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendRequest(destination_connection: ${destination_connection.address_string})`,
          )

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return true
          }

          // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00

          try {
            destination_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
            destination_connection.address_string = SimulatedControllerMacAddress

            return this.#runtimeReference.spectoda_js.request(
              SpectodaWasm.convertUint8VectorUint8Array(request_bytecode),
              destination_connection,
            )
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _sendSynchronize: (synchronization: Synchronization, source_connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendSynchronize(synchronization:${synchronization}, source_connection=${source_connection.address_string})`,
          )

          if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME) {
            logging.debug(
              'SpectodaSimulatedConnector::_sendSynchronize() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME',
            )
            return true
          }

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return true
          }

          try {
            // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
            if (source_connection.address_string == '00:00:00:00:00:00') {
              source_connection.address_string = SimulatedControllerMacAddress
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME

              return this.#runtimeReference.spectoda_js.synchronize(synchronization, source_connection)
            } else {
              source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              this.#runtimeReference.sendSynchronize(synchronization, source_connection).catch((e) => {
                logging.error(e)
              })
              return true
            }
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _process: () => {
          return true
        },
        _render: () => {
          return true
        },
      }

      const connector = new IConnector_JS()

      await connector.construct(
        SimulatedConnectorImplementation,
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
      )
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
    criterium_array: Array<Criterium>,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
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
    criterium_array: Array<Criterium>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
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

  selected(): Promise<Criterium | null> {
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
    criterium_array: Array<Criterium>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
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

    return new Promise(async (resolve) => {
      // Reset cancellation flag
      this.#scanCancelled = false
      this.#scanResolve = resolve

      // @ts-ignore TODO: @immakermatty fix missing connector, rssi, product in Criterium type
      const matchingControllers: Array<Criterium & { connector: string; rssi: number; product: number }> = []
      // @ts-ignore TODO: @immakermatty fix missing connector, rssi, product in Criterium type
      const scanResults: Array<Criterium & { connector: string; rssi: number; product: number }> = []

      // Store reference to current results so cancel() can access them
      this.#currentScanResults = matchingControllers

      // Helper function to check if controller matches criteria
      const controllerMatchesCriteria = (controller: PreviewController, criterium: Criterium): boolean => {
        const controllerName = controller.label || controller.mac

        // Check MAC address match
        if (criterium.mac !== undefined && controller.mac !== criterium.mac) {
          return false
        }

        // Check name match
        if (criterium.name !== undefined && controllerName !== criterium.name) {
          return false
        }

        // Check name prefix match
        if (criterium.nameprefix !== undefined && !controllerName.startsWith(criterium.nameprefix)) {
          return false
        }

        // Check product code match if specified
        if (criterium.product !== undefined) {
          // For simulated controllers, we use default product code 0
          const simulatedProductCode = 0

          if (simulatedProductCode !== criterium.product) {
            return false
          }
        }

        // Note: network, fw, and commissionable are not available
        // from PreviewController, so we skip those checks for simulated controllers

        return true
      }

      // Helper function to create controller result
      const createControllerResult = (controller: PreviewController) => {
        // Simulate RSSI between -80 and -30 dBm
        const RSSI_MIN = -80
        const RSSI_MAX = -30
        const rssi = Math.floor(Math.random() * (RSSI_MAX - RSSI_MIN + 1)) + RSSI_MIN

        // Default product code for simulated controllers
        // TODO add a way how to define the product code for the simulated controllers in the network definition
        const productCode = 0

        return {
          connector: this.type,
          mac: controller.mac,
          name: controller.label || controller.mac,
          rssi: rssi,
          product: productCode,
        }
      }

      // Helper function to slightly fluctuate RSSI values (simulates real-world signal variation)
      const fluctuateRSSI = (currentRSSI: number): number => {
        const RSSI_MIN = -80
        const RSSI_MAX = -30
        const RSSI_VARIATION = 3 // Maximum variation in dBm per update
        const VARIATION_MULTIPLIER = 2 // Used to calculate ±variation range

        // Add small random variation (±3 dBm)
        const variation = Math.floor(Math.random() * (RSSI_VARIATION * VARIATION_MULTIPLIER + 1)) - RSSI_VARIATION
        const newRSSI = currentRSSI + variation

        // Clamp to valid range
        return Math.max(RSSI_MIN, Math.min(RSSI_MAX, newRSSI))
      }

      // Simulate scanning process - emit scan events during the scan duration
      const scanStartTime = Date.now()
      const SCAN_EVENT_INTERVAL = 500 // Emit scan events every 500ms

      // Emit initial empty array to simulate scan starting with no results
      this.#runtimeReference.emit(SpectodaAppEvents.SCAN_RESULTS, JSON.stringify([]))

      this.#scanIntervalHandle = setInterval(() => {
        // Check if scan was cancelled
        if (this.#scanCancelled) {
          if (this.#scanIntervalHandle) {
            clearInterval(this.#scanIntervalHandle)
            this.#scanIntervalHandle = null
          }
          return
        }

        const elapsed = Date.now() - scanStartTime

        if (elapsed >= scan_duration_number) {
          if (this.#scanIntervalHandle) {
            clearInterval(this.#scanIntervalHandle)
            this.#scanIntervalHandle = null
          }
          return
        }

        // Update RSSI values slightly for each controller (simulates signal fluctuation)
        for (const result of scanResults) {
          result.rssi = fluctuateRSSI(result.rssi)
        }

        // Emit current scan results as JSON string (may be empty if no controllers found yet)
        const currentResults = scanResults.map((result) => ({
          connector: result.connector,
          mac: result.mac,
          name: result.name,
          rssi: result.rssi,
          product: result.product,
        }))

        this.#runtimeReference.emit(SpectodaAppEvents.SCAN_RESULTS, JSON.stringify(currentResults))
      }, SCAN_EVENT_INTERVAL)

      // Simulate initial delay before discovering controllers (scan doesn't catch them instantly)
      const INITIAL_DISCOVERY_DELAY = 300 // Wait 300ms before first controller appears

      await sleep(INITIAL_DISCOVERY_DELAY)

      // Check if scan was cancelled during initial delay
      if (this.#scanCancelled) {
        if (this.#scanIntervalHandle) {
          clearInterval(this.#scanIntervalHandle)
          this.#scanIntervalHandle = null
        }
        // Only resolve if cancel() hasn't already resolved
        if (this.#scanResolve !== null) {
          this.#scanResolve = null
          this.#currentScanResults = null
          resolve(matchingControllers)
        }
        return
      }

      // Emit empty array again after initial delay (still no results)
      this.#runtimeReference.emit(SpectodaAppEvents.SCAN_RESULTS, JSON.stringify([]))

      // Simulate progressive discovery - discover controllers quickly (early in scan)
      const controllersToDiscover =
        criterium_array.length === 0
          ? this.controllers
          : this.controllers.filter((controller) =>
              criterium_array.some((criterium) => controllerMatchesCriteria(controller, criterium)),
            )

      // Discover controllers quickly with short delays (100-200ms between each)
      const DISCOVERY_DELAY = 150 // Fast discovery delay
      const DISCOVERY_TIME_PERCENTAGE = 0.3 // Discover within first 30% of scan duration
      const MAX_DISCOVERY_TIME_MS = 2000 // Maximum discovery time in milliseconds
      const MAX_DISCOVERY_TIME = Math.min(scan_duration_number * DISCOVERY_TIME_PERCENTAGE, MAX_DISCOVERY_TIME_MS)

      for (let i = 0; i < controllersToDiscover.length; i++) {
        // Check if scan was cancelled
        if (this.#scanCancelled) {
          break
        }

        // Stop discovering if we've exceeded the max discovery time
        const elapsed = Date.now() - scanStartTime

        if (elapsed >= MAX_DISCOVERY_TIME) {
          break
        }

        await sleep(DISCOVERY_DELAY)

        // Check again after sleep in case cancellation happened during sleep
        if (this.#scanCancelled) {
          break
        }

        const controller = controllersToDiscover[i]
        const controllerResult = createControllerResult(controller)

        matchingControllers.push(controllerResult)
        scanResults.push(controllerResult)

        // Update RSSI values slightly for all previously discovered controllers
        for (let j = 0; j < scanResults.length - 1; j++) {
          scanResults[j].rssi = fluctuateRSSI(scanResults[j].rssi)
        }

        // Emit scan event for this discovery
        const currentResults = scanResults.map((result) => ({
          connector: result.connector,
          mac: result.mac,
          name: result.name,
          rssi: result.rssi,
          product: result.product,
        }))

        this.#runtimeReference.emit(SpectodaAppEvents.SCAN_RESULTS, JSON.stringify(currentResults))
      }

      // Check if scan was cancelled before waiting for remaining duration
      if (this.#scanCancelled) {
        if (this.#scanIntervalHandle) {
          clearInterval(this.#scanIntervalHandle)
          this.#scanIntervalHandle = null
        }
        // Only resolve if cancel() hasn't already resolved
        if (this.#scanResolve !== null) {
          this.#scanResolve = null
          this.#currentScanResults = null
          resolve(matchingControllers)
        }
        return
      }

      // Wait for remaining scan duration
      const elapsed = Date.now() - scanStartTime

      if (elapsed < scan_duration_number) {
        await sleep(scan_duration_number - elapsed)
      }

      // Final check if scan was cancelled during wait
      if (this.#scanCancelled) {
        if (this.#scanIntervalHandle) {
          clearInterval(this.#scanIntervalHandle)
          this.#scanIntervalHandle = null
        }
        // Only resolve if cancel() hasn't already resolved
        if (this.#scanResolve !== null) {
          this.#scanResolve = null
          this.#currentScanResults = null
          resolve(matchingControllers)
        }
        return
      }

      if (this.#scanIntervalHandle) {
        clearInterval(this.#scanIntervalHandle)
        this.#scanIntervalHandle = null
      }

      // Update RSSI values slightly one more time before final emission
      for (const result of scanResults) {
        result.rssi = fluctuateRSSI(result.rssi)
      }

      // Emit final scan results
      const finalResults = matchingControllers.map((result) => ({
        connector: result.connector,
        mac: result.mac,
        name: result.name,
        rssi: result.rssi,
        product: result.product,
      }))

      this.#runtimeReference.emit(SpectodaAppEvents.SCAN_RESULTS, JSON.stringify(finalResults))

      // Only resolve if not already resolved by cancel()
      if (this.#scanResolve !== null) {
        this.#scanResolve = null
        this.#currentScanResults = null
        resolve(matchingControllers)
      }
    })
  }

  connect(timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<Criterium> {
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

  connected(): Promise<Criterium | null> {
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
            SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
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
            SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
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
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
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
  updateFW(firmware_bytes: Uint8Array, options?: { skipReboot?: boolean }): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    logging.debug('updateFW()', firmware_bytes, { skipReboot })

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

      if (skipReboot) {
        logging.info('Firmware written, skipping reboot as requested')
      }

      this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
      resolve(null)
    })
  }

  cancel(): void {
    logging.verbose('cancel()')

    // Set cancellation flag
    this.#scanCancelled = true

    // Clear scan interval if it exists
    if (this.#scanIntervalHandle) {
      clearInterval(this.#scanIntervalHandle)
      this.#scanIntervalHandle = null
    }

    // Immediately resolve the scan promise with current results
    if (this.#scanResolve && this.#currentScanResults) {
      const currentResults = [...this.#currentScanResults] // Create a copy

      this.#scanResolve(currentResults)
      this.#scanResolve = null
      this.#currentScanResults = null
    }
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

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME) {
      logging.debug('SpectodaSimulatedConnector::sendExecute() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME')
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

  // bool // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendRequest(request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    return this.request(request_bytecode, false, DEFAULT_TIMEOUT)
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendSynchronize(synchronization=${synchronization.origin_address}, source_connection=${source_connection.address_string})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME) {
      logging.debug('SpectodaSimulatedConnector::sendSynchronize() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME')
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      //
      source_connection.connector_type = SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME

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
