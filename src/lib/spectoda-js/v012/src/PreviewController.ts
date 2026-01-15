// @ts-nocheck
import { createNanoEvents, sleep } from '../functions'
import { logging } from '../logging'
import type { IConnector_JS } from './connector/IConnector_JS'
import { LogEntry, RingLogBuffer } from './LogBuffer'
import { SpectodaWasm } from './SpectodaWasm'
import type {
  Connection,
  interface_error_t,
  Spectoda_WASM,
  Spectoda_WASMImplementation,
  Synchronization,
  Uint8Vector,
} from './types/wasm'

// TODO: Deprecate and instead use SimulatedController
export class PreviewController {
  logging: typeof logging // ? each instance should be able to be logged separatelly

  #macAddress
  #connector: IConnector_JS | undefined

  #instance: Spectoda_WASM | undefined
  #config:
    | {
        controller?: { name?: string }
        ports?: [
          {
            tag?: string
            size?: number
            brightness?: number
            power?: number
            visible?: boolean
            reversed?: boolean
          },
        ]
      }
    | undefined

  #ports: { [key: string]: Uint32Array }
  #ringLogBuffer: RingLogBuffer
  #eventEmitter

  constructor(controllerMacAddress: string) {
    this.logging = logging // TODO! refactor logging to be able to create individual instances to be able to debug each Simulated controller separatelly

    this.#macAddress = controllerMacAddress

    this.#instance = undefined
    this.#config = undefined

    this.#ports = {}
    this.#eventEmitter = createNanoEvents()

    this.#ringLogBuffer = new RingLogBuffer(1000)
  }

  construct(
    config: object,
    SimulatedConnector: IConnector_JS | undefined = undefined,
  ) {
    this.logging.info(`construct(config=${JSON.stringify(config)}`)

    if (this.#instance) {
      throw 'AlreadyContructed'
    }

    this.#config = config

    SpectodaWasm.initialize()

    return SpectodaWasm.waitForInitilize().then(() => {
      //

      this.#connector = SimulatedConnector

      const PREVIEW_CONTROLLER_IMPLEMENTATION: Spectoda_WASMImplementation = {
        /* Constructor function is optional */
        // __construct: function () {
        //   this.__parent.__construct.call(this);
        // }

        /* Destructor function is optional */
        // __destruct: function () {
        //   this.__parent.__destruct.call(this);
        // },

        _onTnglLoad: (tnglBytesVector, usedIdsVector) => {
          this.logging.verbose(
            'PreviewController::_onTnglLoad',
            tnglBytesVector,
            usedIdsVector,
          )

          return true
        },

        _onEvents: (eventArray) => {
          this.logging.verbose('PreviewController::_onEvents', eventArray)

          return true
        },

        _onEventStateUpdates: (eventStateUpdatesArray) => {
          this.logging.verbose(
            'PreviewController::_onEventStateUpdates',
            eventStateUpdatesArray,
          )

          if (this.logging.level >= 3 && eventStateUpdatesArray.length > 0) {
            let debugLog = ''

            const name = this.#instance?.getLabel()

            {
              const e = eventStateUpdatesArray[0]

              debugLog += `🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            for (let i = 1; i < eventStateUpdatesArray.length; i++) {
              const e = eventStateUpdatesArray[i]

              debugLog += `\n🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            this.logging.log(debugLog)
          }

          return true
        },

        _onExecute: (commandsBytecodeVector: Uint8Vector) => {
          this.logging.verbose(
            'PreviewController::_onExecute',
            commandsBytecodeVector,
          )

          return true
        },

        _onRequest: () => {
          this.logging.verbose('PreviewController::_onRequest')

          return true
        },

        _onSynchronize: (synchronization) => {
          this.logging.verbose(
            'PreviewController::_onSynchronize',
            synchronization,
          )

          return true
        },

        _onProcess: (options) => {
          this.logging.verbose('PreviewController::_onProcess', options)

          return true
        },

        _handlePeerConnected: (peerMac) => {
          this.logging.verbose(
            'PreviewController::_handlePeerConnected',
            peerMac,
          )

          // this.#runtimeReference.emit("peer_connected", peer_mac);

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        _handlePeerDisconnected: (peerMac) => {
          this.logging.verbose(
            'PreviewController::_handlePeerDisconnected',
            peerMac,
          )

          // this.#runtimeReference.emit("peer_disconnected", peer_mac);

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        // virtual interface_error_t _handleTimelineManipulation(const int32_t timeline_timestamp, const bool timeline_paused, const double clock_timestamp) = 0;
        _handleTimelineManipulation: (
          timelineTimestamp: number,
          timelinePaused: boolean,
          timelineDate: string,
        ): interface_error_t => {
          this.logging.verbose(
            `PreviewController::_handleTimelineManipulation(timeline_timestamp=${timelineTimestamp}, timeline_paused=${timelinePaused}, timeline_date=${timelineDate})`,
          )

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        _onLog: (level, filename, message) => {
          const logEntry = new LogEntry(level, filename, message)

          this.#ringLogBuffer.push(logEntry)
          // this.#eventEmitter.emit("log", logEntry);

          const name = this.#instance?.getLabel()

          switch (level) {
            case 5: {
              this.logging.verbose(`🖥️ $${name}: \t[V][${filename}]: ${message}`)
              break
            }
            case 4: {
              this.logging.debug(`🖥️ $${name}: \t[D][${filename}]: ${message}`)
              break
            }
            case 3: {
              this.logging.debug(`🖥️ $${name}: \t[I][${filename}]: ${message}`)
              break
            }
            case 2: {
              this.logging.warn(`🖥️ $${name}:\t[W][${filename}]: ${message}`)
              // this.#eventEmitter.emit("warn", logEntry);
              break
            }
            case 1: {
              this.logging.error(`🖥️ $${name}: \t[E][${filename}]: ${message}`)
              // this.#eventEmitter.emit("error", logEntry);
              break
            }
            default: {
              logging.log(`🖥️ $${name}: \t[?][${filename}]: ${message}`)
              break
            }
          }
        },

        _handleReboot: () => {
          this.logging.verbose('PreviewController::_handleReboot')

          setTimeout(async () => {
            await sleep(1)

            this.#instance?.end()
            {
              this.#instance = SpectodaWasm.Spectoda_WASM.implement(
                PREVIEW_CONTROLLER_IMPLEMENTATION,
              )

              this.#instance.init(
                this.#macAddress,
                JSON.stringify(this.#config),
              )
              this.#instance.begin(
                '00000000000000000000000000000000',
                '00000000000000000000000000000000',
              )

              if (this.#connector !== undefined) {
                this.#instance.registerConnector(
                  this.#connector.getWasmInstance(),
                )
              }

              // TODO! refactor to not need to build ports manually from JS
              let currentTag = 'A'

              if (this.#config?.ports) {
                for (const port of this.#config.ports) {
                  const portTag = port.tag ? port.tag : currentTag

                  currentTag = String.fromCharCode(portTag.charCodeAt(0) + 1)
                  this.#ports[portTag] = this.makePort(
                    `PORT${currentTag}`,
                    JSON.stringify(port),
                  )
                }
              }
            }
          }, 1000)

          return SpectodaWasm.interface_error_t.SUCCESS
        },
      }

      this.#instance = SpectodaWasm.Spectoda_WASM.implement(
        PREVIEW_CONTROLLER_IMPLEMENTATION,
      )

      this.#instance.init(this.#macAddress, JSON.stringify(this.#config))
      this.#instance.begin(
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
      )

      if (this.#connector !== undefined) {
        // logging.info('PreviewController::construct() registering connector');
        this.#instance.registerConnector(this.#connector.getWasmInstance())
      }

      // TODO! refactor to not need to build ports manually from JS
      let currentTag = 'A'

      if (this.#config?.ports) {
        for (const port of this.#config.ports) {
          const portTag = port.tag ? port.tag : currentTag

          currentTag = String.fromCharCode(portTag.charCodeAt(0) + 1)
          this.#ports[portTag] = this.makePort(
            `PORT${currentTag}`,
            JSON.stringify(port),
          )
        }
      }
    })
  }

  destruct() {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.end() // end the spectoda stuff
    this.#instance.delete() // delete (free) C++ object
    this.#instance = undefined // remove javascript reference
  }

  makePort(portLabel: string, portConfig: string): Uint32Array {
    logging.info(
      `PreviewController::makePort(port_label=${portLabel}, port_config=${portConfig})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance.makePort(portLabel, portConfig)
  }

  getPort(portTag: string) {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    // TODO get config constructed ports from WASM
    return this.#ports[portTag]
  }

  getPorts() {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    // TODO get config constructed ports from WASM
    return this.#ports
  }

  /**
   * @param {number} clock_timestamp
   * @return {null}
   */
  setClockTimestamp(clockTimestamp: number) {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.setClockTimestamp(clockTimestamp)
  }

  /**
   * @return {number}
   */
  getClockTimestamp() {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance.getClockTimestamp()
  }

  execute(executeBytecode: Uint8Array, sourceConnection: Connection): void {
    logging.debug(
      `PreviewController::execute(execute_bytecode=${executeBytecode}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    const executeSucess = this.#instance.execute(
      SpectodaWasm.toHandle(executeBytecode),
      sourceConnection,
    )

    if (!executeSucess) {
      throw 'EvaluateError'
    }
  }

  request(requestBytecode: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `PreviewController::request(request_bytecode=${requestBytecode}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    const responseBytecodeVector = new SpectodaWasm.Uint8Vector()
    let responseBytecode

    try {
      const requestSucess = this.#instance.request(
        SpectodaWasm.toHandle(requestBytecode),
        responseBytecodeVector,
        sourceConnection,
      )

      if (!requestSucess) {
        throw 'EvaluateError'
      }

      responseBytecode = SpectodaWasm.convertUint8VectorUint8Array(
        responseBytecodeVector,
      )
    } finally {
      responseBytecodeVector.delete()
    }

    return responseBytecode
  }

  synchronize(synchronization: Synchronization, sourceConnection: Connection) {
    logging.debug(
      `PreviewController::synchronize(synchronization=${JSON.stringify(
        synchronization,
      )}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.synchronize(synchronization, sourceConnection)
  }

  // ? process() is calling compute() and render() in the right order
  process(
    options: {
      skip_berry_plugin_update: boolean
      skip_eventstate_updates: boolean
      force_event_emittion: boolean
      skip_event_emittion: boolean
    } = {
      skip_berry_plugin_update: false,
      skip_eventstate_updates: false,
      force_event_emittion: true, // Allow same event values to be emitted consecutively
      skip_event_emittion: false,
    },
  ) {
    logging.debug('PreviewController::process()')

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.process(
      options.skip_berry_plugin_update,
      options.skip_eventstate_updates,
      options.force_event_emittion,
      options.skip_event_emittion,
    )
  }

  // ? render() is forcing a render cycle
  render(options: { power: number } = { power: 255 }) {
    logging.verbose('PreviewController::render()')

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.render(options.power)
  }

  getLogs() {
    return this.#ringLogBuffer.getAllLogs()
  }

  // TODO! remove this
  clearLogs() {
    this.#ringLogBuffer.clear()
    this.#eventEmitter.emit('clear_logs')
  }

  on(event: string, callback: (...args: any[]) => void) {
    return this.#eventEmitter.on(event, callback)
  }

  // returns string
  get mac() {
    // this.logging.debug("get mac()");

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#macAddress
  }

  // returns std::string a.k.a string
  get label() {
    // this.logging.debug("get label()");

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance.getLabel()
  }

  get identifier() {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance.getIdentifier()
  }
}
