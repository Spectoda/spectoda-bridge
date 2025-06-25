// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { createNanoEvents, sleep } from '../functions'
import { logging } from '../logging'

import { LogEntry, RingLogBuffer } from './LogBuffer'
import {
  Connection,
  interface_error_t,
  Spectoda_WASM,
  Spectoda_WASMImplementation,
  Synchronization,
  Uint8Vector,
} from './types/wasm'
import { IConnector_JS } from './connector/IConnector_JS'
import { SpectodaWasm } from './SpectodaWasm'

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

  constructor(controller_mac_address: string) {
    this.logging = logging // TODO! refactor logging to be able to create individual instances to be able to debug each Simulated controller separatelly

    this.#macAddress = controller_mac_address

    this.#instance = undefined
    this.#config = undefined

    this.#ports = {}
    this.#eventEmitter = createNanoEvents()

    this.#ringLogBuffer = new RingLogBuffer(1000)
  }

  construct(config: object, SimulatedConnector: IConnector_JS | undefined = undefined) {
    this.logging.info(`construct(config=${JSON.stringify(config)}`)

    if (this.#instance) {
      throw 'AlreadyContructed'
    }

    this.#config = config

    SpectodaWasm.initialize()

    return SpectodaWasm.waitForInitilize().then(() => {
      //

      this.#connector = SimulatedConnector

      const PreviewControllerImplementation: Spectoda_WASMImplementation = {
        /* Constructor function is optional */
        // __construct: function () {
        //   this.__parent.__construct.call(this);
        // }

        /* Destructor function is optional */
        // __destruct: function () {
        //   this.__parent.__destruct.call(this);
        // },

        _onTnglLoad: (tngl_bytes_vector, used_ids_vector) => {
          this.logging.verbose('PreviewController::_onTnglLoad', tngl_bytes_vector, used_ids_vector)

          return true
        },

        _onEvents: (event_array) => {
          this.logging.verbose('PreviewController::_onEvents', event_array)

          return true
        },

        _onEventStateUpdates: (event_state_updates_array) => {
          this.logging.verbose('PreviewController::_onEventStateUpdates', event_state_updates_array)

          if (this.logging.level >= 3 && event_state_updates_array.length > 0) {
            let debug_log = ''

            const name = this.#instance?.getLabel()

            {
              const e = event_state_updates_array[0]

              debug_log += `🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            for (let i = 1; i < event_state_updates_array.length; i++) {
              const e = event_state_updates_array[i]

              debug_log += `\n🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            this.logging.log(debug_log)
          }

          return true
        },

        _onExecute: (commands_bytecode_vector: Uint8Vector) => {
          this.logging.verbose('PreviewController::_onExecute', commands_bytecode_vector)

          return true
        },

        _onRequest: () => {
          this.logging.verbose('PreviewController::_onRequest')

          return true
        },

        _onSynchronize: (synchronization) => {
          this.logging.verbose('PreviewController::_onSynchronize', synchronization)

          return true
        },

        _onProcess: (options) => {
          this.logging.verbose('PreviewController::_onProcess', options)

          return true
        },

        _handlePeerConnected: (peer_mac) => {
          this.logging.verbose('PreviewController::_handlePeerConnected', peer_mac)

          // this.#runtimeReference.emit("peer_connected", peer_mac);

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        _handlePeerDisconnected: (peer_mac) => {
          this.logging.verbose('PreviewController::_handlePeerDisconnected', peer_mac)

          // this.#runtimeReference.emit("peer_disconnected", peer_mac);

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        // virtual interface_error_t _handleTimelineManipulation(const int32_t timeline_timestamp, const bool timeline_paused, const double clock_timestamp) = 0;
        _handleTimelineManipulation: (
          timeline_timestamp: number,
          timeline_paused: boolean,
          timeline_date: string,
        ): interface_error_t => {
          this.logging.verbose(
            'PreviewController::_handleTimelineManipulation',
            timeline_timestamp,
            timeline_paused,
            timeline_date,
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
              this.logging.info(`🖥️ $${name}: \t[I][${filename}]: ${message}`)
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
              console.warn(`🖥️ $${name}: \t[?][${filename}]: ${message}`)
              break
            }
          }
        },

        _handleReboot: () => {
          this.logging.debug('PreviewController::_handleReboot')

          setTimeout(async () => {
            await sleep(1)

            this.#instance?.end()
            {
              this.#instance = SpectodaWasm.Spectoda_WASM.implement(PreviewControllerImplementation)

              this.#instance.init(this.#macAddress, JSON.stringify(this.#config))
              this.#instance.begin('00000000000000000000000000000000', '00000000000000000000000000000000')

              if (this.#connector !== undefined) {
                this.#instance.registerConnector(this.#connector.getWasmInstance())
              }

              // TODO! refactor to not need to build ports manually from JS
              let current_tag = 'A'

              if (this.#config?.ports) {
                for (const port of this.#config.ports) {
                  const port_tag = port.tag ? port.tag : current_tag

                  current_tag = String.fromCharCode(port_tag.charCodeAt(0) + 1)
                  this.#ports[port_tag] = this.makePort(`PORT${current_tag}`, JSON.stringify(port))
                }
              }
            }
          }, 1000)

          return SpectodaWasm.interface_error_t.SUCCESS
        },
      }

      this.#instance = SpectodaWasm.Spectoda_WASM.implement(PreviewControllerImplementation)

      this.#instance.init(this.#macAddress, JSON.stringify(this.#config))
      this.#instance.begin('00000000000000000000000000000000', '00000000000000000000000000000000')

      if (this.#connector !== undefined) {
        // logging.info('PreviewController::construct() registering connector');
        this.#instance.registerConnector(this.#connector.getWasmInstance())
      }

      // TODO! refactor to not need to build ports manually from JS
      let current_tag = 'A'

      if (this.#config?.ports) {
        for (const port of this.#config.ports) {
          const port_tag = port.tag ? port.tag : current_tag

          current_tag = String.fromCharCode(port_tag.charCodeAt(0) + 1)
          this.#ports[port_tag] = this.makePort(`PORT${current_tag}`, JSON.stringify(port))
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

  makePort(port_label: string, port_config: string): Uint32Array {
    logging.info(`PreviewController::makePort(port_label=${port_label}, port_config=${port_config})`)

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance.makePort(port_label, port_config)
  }

  getPort(port_tag: string) {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    // TODO get config constructed ports from WASM
    return this.#ports[port_tag]
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
  setClockTimestamp(clock_timestamp: number) {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.setClockTimestamp(clock_timestamp)
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

  execute(execute_bytecode: Uint8Array, source_connection: Connection): void {
    logging.debug(
      `PreviewController::execute(execute_bytecode=${execute_bytecode}, source_connection=${source_connection})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    const execute_sucess = this.#instance.execute(SpectodaWasm.toHandle(execute_bytecode), source_connection)

    if (!execute_sucess) {
      throw 'EvaluateError'
    }
  }

  request(request_bytecode: Uint8Array, source_connection: Connection) {
    logging.debug(
      `PreviewController::request(request_bytecode=${request_bytecode}, source_connection=${source_connection})`,
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    const response_bytecode_vector = new SpectodaWasm.Uint8Vector()
    let response_bytecode = undefined

    try {
      const request_sucess = this.#instance.request(
        SpectodaWasm.toHandle(request_bytecode),
        response_bytecode_vector,
        source_connection,
      )

      if (!request_sucess) {
        throw 'EvaluateError'
      }

      response_bytecode = SpectodaWasm.convertUint8VectorUint8Array(response_bytecode_vector)
    } finally {
      response_bytecode_vector.delete()
    }

    return response_bytecode
  }

  synchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.debug(
      'PreviewController::synchronize(synchronization=',
      synchronization,
      'source_connection=',
      source_connection,
      ')',
    )

    if (!this.#instance) {
      throw 'NotConstructed'
    }

    this.#instance.synchronize(synchronization, source_connection)
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
      force_event_emittion: false,
      skip_event_emittion: false,
    },
  ) {
    logging.verbose('PreviewController::process()')

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
