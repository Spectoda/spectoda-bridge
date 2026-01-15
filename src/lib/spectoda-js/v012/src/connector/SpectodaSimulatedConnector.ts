import { sleep } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { APP_MAC_ADDRESS, DEFAULT_TIMEOUT } from '../constants'
import { PreviewController } from '../PreviewController'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import type { Criterium } from '../types/primitives'
import type { Connection, Synchronization, Uint8Vector } from '../types/wasm'

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
  #currentScanResults: Array<
    Criterium & { connector: string; rssi: number; product: number }
  > | null

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
      const SIMULATED_CONTROLLER_MAC_ADDRESS = SIMULATED_MAC_ADDRESS

      const SIMULATED_CONTROLLER_CONFIG = {
        controller: { name: 'SIMUL' },
        console: { debug: 3 },
      }

      const SIMULATED_CONNECTOR_IMPLEMENTATION = {
        _scan: (criteriaJson: string, scanPeriod: number, resultOut: any) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_scan(criteria_json=${criteriaJson}, scan_period=${scanPeriod}, result_out=${resultOut})`,
          )

          return false
        },
        _autoConnect: (
          criteriaJson: string,
          scanPeriod: number,
          timeout: number,
          resultOut: any,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_autoConnect(criteria_json=${criteriaJson}, scan_period=${scanPeriod}, timeout=${timeout}, result_out=${resultOut})`,
          )

          return false
        },
        _userConnect: (
          criteriaJson: string,
          timeout: number,
          resultOut: any,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_userConnect(criteria_json=${criteriaJson}, timeout=${timeout}, result_out=${resultOut})`,
          )

          return false
        },
        _disconnect: (connection: Connection) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_disconnect(connection=${connection.address_string})`,
          )

          return false
        },
        _sendExecute: (
          commandBytecode: Uint8Vector,
          sourceConnection: Connection,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendExecute(source_connection:${sourceConnection.address_string})`,
          )

          const commandBytecodeArray =
            SpectodaWasm.convertUint8VectorUint8Array(commandBytecode)

          if (
            sourceConnection.connector_type ===
            SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
          ) {
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
            if (sourceConnection.address_string === '00:00:00:00:00:00') {
              sourceConnection.connector_type =
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              sourceConnection.address_string = SIMULATED_CONTROLLER_MAC_ADDRESS

              return this.#runtimeReference.spectoda_js.execute(
                commandBytecodeArray,
                sourceConnection,
              )
            } else {
              sourceConnection.connector_type =
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              this.#runtimeReference
                .sendExecute(commandBytecodeArray, sourceConnection)
                .catch((e) => {
                  logging.error(e)
                })
              return true
            }
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _sendRequest: (
          requestBytecode: Uint8Vector,
          destinationConnection: Connection,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendRequest(destination_connection: ${destinationConnection.address_string})`,
          )

          // TODO! figure out what to do when the simulated controller is not connected
          if (!this.#connected) {
            return true
          }

          // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00

          try {
            destinationConnection.connector_type =
              SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
            destinationConnection.address_string =
              SIMULATED_CONTROLLER_MAC_ADDRESS

            return this.#runtimeReference.spectoda_js.request(
              SpectodaWasm.convertUint8VectorUint8Array(requestBytecode),
              destinationConnection,
            )
          } catch (e) {
            logging.error(e)
            return false
          }
        },
        _sendSynchronize: (
          synchronization: Synchronization,
          sourceConnection: Connection,
        ) => {
          logging.verbose(
            `SpectodaSimulatedConnector::_sendSynchronize(synchronization:${synchronization}, source_connection=${sourceConnection.address_string})`,
          )

          if (
            sourceConnection.connector_type ===
            SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
          ) {
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
            if (sourceConnection.address_string === '00:00:00:00:00:00') {
              sourceConnection.address_string = SIMULATED_CONTROLLER_MAC_ADDRESS
              sourceConnection.connector_type =
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME

              return this.#runtimeReference.spectoda_js.synchronize(
                synchronization,
                sourceConnection,
              )
            } else {
              sourceConnection.connector_type =
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
              this.#runtimeReference
                .sendSynchronize(synchronization, sourceConnection)
                .catch((e) => {
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
        SIMULATED_CONNECTOR_IMPLEMENTATION,
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
      )
      const controller = new PreviewController(SIMULATED_CONTROLLER_MAC_ADDRESS)

      await controller.construct(SIMULATED_CONTROLLER_CONFIG, connector)

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

      const PROCESS = async () => {
        for (const controller of this.controllers) {
          try {
            controller.process()
          } catch (e) {
            logging.error(e)
          }
        }
      }

      const RENDER = async () => {
        for (const controller of this.controllers) {
          try {
            controller.render()
          } catch (e) {
            logging.error(e)
          }
        }
      }

      // TODO if the ups was set to 0 and then back to some value, then the render loop should be started again
      this.#processIntervalHandle = setInterval(PROCESS, 1000 / this.#ups)
      // TODO if the fps was set to 0 and then back to some value, then the render loop should be started again
      this.#renderIntervalHandle = setInterval(RENDER, 1000 / this.#fps)
    }
  }

  userSelect(
    criteriumArray: Array<Criterium>,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 60000
    }

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.verbose(`userSelect(criteria=${criteriaJson})`)

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
    _criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      // ? 1200ms seems to be the minimum for the scan_duration if the controller is rebooted
      scanDurationNumber = 1500
    }
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
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

    return new Promise(async (resolve, _reject) => {
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

    return new Promise(async (resolve, _reject) => {
      if (this.#connected) {
        await this.disconnect()
      }
      await sleep(10) // unselect logic
      this.#selected = false
      resolve(null)
    })
  }

  scan(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 7000
    }

    logging.verbose(
      'scan(criterium_array=' +
        JSON.stringify(criteriumArray) +
        ', scan_duration_number=' +
        scanDurationNumber +
        ')',
    )

    return new Promise(async (resolve) => {
      // Reset cancellation flag
      this.#scanCancelled = false
      this.#scanResolve = resolve

      const matchingControllers: Array<
        Criterium & { connector: string; rssi: number; product: number }
      > = []
      const scanResults: Array<
        Criterium & { connector: string; rssi: number; product: number }
      > = []

      // Store reference to current results so cancel() can access them
      this.#currentScanResults = matchingControllers

      // Helper function to check if controller matches criteria
      const controllerMatchesCriteria = (
        controller: PreviewController,
        criterium: Criterium,
      ): boolean => {
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
        if (
          criterium.nameprefix !== undefined &&
          !controllerName.startsWith(criterium.nameprefix)
        ) {
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
        const rssi =
          Math.floor(Math.random() * (RSSI_MAX - RSSI_MIN + 1)) + RSSI_MIN

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
        const variation =
          Math.floor(
            Math.random() * (RSSI_VARIATION * VARIATION_MULTIPLIER + 1),
          ) - RSSI_VARIATION
        const newRSSI = currentRSSI + variation

        // Clamp to valid range
        return Math.max(RSSI_MIN, Math.min(RSSI_MAX, newRSSI))
      }

      // Simulate scanning process - emit scan events during the scan duration
      const scanStartTime = Date.now()
      const SCAN_EVENT_INTERVAL = 500 // Emit scan events every 500ms

      // Emit initial empty array to simulate scan starting with no results
      this.#runtimeReference.emit(
        SpectodaAppEvents.SCAN_RESULTS,
        JSON.stringify([]),
      )

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

        if (elapsed >= scanDurationNumber) {
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

        this.#runtimeReference.emit(
          SpectodaAppEvents.SCAN_RESULTS,
          JSON.stringify(currentResults),
        )
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
      this.#runtimeReference.emit(
        SpectodaAppEvents.SCAN_RESULTS,
        JSON.stringify([]),
      )

      // Simulate progressive discovery - discover controllers quickly (early in scan)
      const controllersToDiscover =
        criteriumArray.length === 0
          ? this.controllers
          : this.controllers.filter((controller) =>
              criteriumArray.some((criterium) =>
                controllerMatchesCriteria(controller, criterium),
              ),
            )

      // Discover controllers quickly with short delays (100-200ms between each)
      const DISCOVERY_DELAY = 150 // Fast discovery delay
      const DISCOVERY_TIME_PERCENTAGE = 0.3 // Discover within first 30% of scan duration
      const MAX_DISCOVERY_TIME_MS = 2000 // Maximum discovery time in milliseconds
      const MAX_DISCOVERY_TIME = Math.min(
        scanDurationNumber * DISCOVERY_TIME_PERCENTAGE,
        MAX_DISCOVERY_TIME_MS,
      )

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

        this.#runtimeReference.emit(
          SpectodaAppEvents.SCAN_RESULTS,
          JSON.stringify(currentResults),
        )
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

      if (elapsed < scanDurationNumber) {
        await sleep(scanDurationNumber - elapsed)
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

      this.#runtimeReference.emit(
        SpectodaAppEvents.SCAN_RESULTS,
        JSON.stringify(finalResults),
      )

      // Only resolve if not already resolved by cancel()
      if (this.#scanResolve !== null) {
        this.#scanResolve = null
        this.#currentScanResults = null
        resolve(matchingControllers)
      }
    })
  }

  connect(
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 20000
    }
    logging.debug(`connect(timeout=${timeoutNumber})`)

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

    return new Promise(async (resolve, _reject) => {
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

    return new Promise(async (resolve, _reject) => {
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
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
    }
    logging.verbose(
      `deliver(payload=${payloadBytes}, timeout=${timeoutNumber})`,
    )

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      for (const controller of this.controllers) {
        await controller.execute(
          payloadBytes,
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
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 1000
    }
    logging.verbose(
      `transmit(payload=${payloadBytes}, timeout=${timeoutNumber})`,
    )

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      for (const controller of this.controllers) {
        await controller.execute(
          payloadBytes,
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
    payloadBytes: Uint8Array,
    readResponse: boolean,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
    }
    logging.verbose(
      `request(payload=${payloadBytes}, read_response=${readResponse ? 'true' : 'false'}, timeout=${timeoutNumber})`,
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
              payloadBytes,
              SpectodaWasm.Connection.make(
                APP_MAC_ADDRESS,
                SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
                SpectodaWasm.connection_rssi_t.RSSI_MAX,
              ),
            )
          : new Uint8Array()

      if (readResponse) {
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

      const clockTimestamp =
        this.controllers.length > 0
          ? this.controllers[0].getClockTimestamp()
          : 0

      this.#clock.setMillis(clockTimestamp)

      await sleep(50) // reading clock logic.

      logging.verbose(`getClock() -> ${this.#clock.millis()}`)
      resolve(this.#clock)
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers
  updateFW(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    logging.debug('updateFW()', firmwareBytes, { skipReboot })

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

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendExecute(command_bytes=${commandBytes}, source_connection=${sourceConnection.address_string})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      logging.debug(
        'SpectodaSimulatedConnector::sendExecute() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME',
      )
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    // TODO simulated connector needs the other side to receive the executed

    // ! This is a hack to make the simulated connector work with the preview controllers
    return new Promise(async (resolve, _reject) => {
      //
      // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
      if (sourceConnection.address_string === '00:00:00:00:00:00') {
        sourceConnection.address_string = APP_MAC_ADDRESS
      }

      for (const controller of this.controllers) {
        if (controller.mac !== sourceConnection.address_string) {
          try {
            controller.execute(commandBytes, sourceConnection)
          } catch (e) {
            logging.error(e)
          }
        }
      }

      resolve(null)
    })
  }

  // bool // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendRequest(request_bytecode=${requestBytecode}, destination_connection=${destinationConnection})`,
    )

    if (
      destinationConnection.connector_type !==
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    return this.request(requestBytecode, false, DEFAULT_TIMEOUT)
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(
    synchronization: Synchronization,
    sourceConnection: Connection,
  ) {
    logging.verbose(
      `SpectodaSimulatedConnector::sendSynchronize(synchronization=${synchronization.origin_address}, source_connection=${sourceConnection.address_string})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      logging.debug(
        'SpectodaSimulatedConnector::sendSynchronize() - source_connection is CONNECTOR_LEGACY_JS_RUNTIME',
      )
      return Promise.resolve()
    }

    // TODO! figure out what to do when the simulated controller is not connected
    if (!this.#connected) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      //
      sourceConnection.connector_type =
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME

      // TODO! SOURCE_CONNECTION_THIS_CONTROLLER should have the actual mac address of the controller. Not 00:00:00:00:00:00
      if (sourceConnection.address_string === '00:00:00:00:00:00') {
        sourceConnection.address_string = APP_MAC_ADDRESS
      }

      for (const controller of this.controllers) {
        if (controller.mac !== sourceConnection.address_string) {
          try {
            controller.synchronize(synchronization, sourceConnection)
          } catch (e) {
            logging.error(e)
          }
        }
      }

      resolve(null)
    })
  }
}
