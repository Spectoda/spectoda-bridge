import { type PrivateError, privateError } from '../../../error/src/private'

import type { EventState } from '..'
import { sleep } from '../functions'
import { logging } from '../logging'

import type { SpectodaRuntime } from './SpectodaRuntime'
import { SpectodaWasm } from './SpectodaWasm'
import { SpectodaAppEvents } from './types/app-events'
import type {
  ControllerInfo,
  NetworkStorageData,
  NetworkStorageMetadata,
  ValueTypeLabel,
} from './types/primitives'
import type {
  Connection,
  ConnectionInfo,
  ControllerInfoWasm,
  IConnector_WASM,
  IConnector_WASMImplementation,
  interface_error_t,
  Spectoda_WASM,
  Spectoda_WASMImplementation,
  Synchronization,
  Uint8Vector,
  Value,
} from './types/wasm'

/**
 * SOURCE_CONNECTION_THIS_CONTROLLER is tied to C++ functionality in the WASM module and will be refactored
 * @see Spectoda_Firmware/components/spectoda-library/src/types.h
 */
export const SOURCE_CONNECTION_THIS_CONTROLLER = () =>
  SpectodaWasm.Connection.make(
    '00:00:00:00:00:00',
    SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED,
    SpectodaWasm.connection_rssi_t.RSSI_MAX,
  )

// Implements Spectoda_JS in javascript
// We can make many objects of Spectoda_JS if we desire (for simulation purposes for example)

// InterfaceWrapper
export class Spectoda_JS {
  #runtimeReference

  #spectoda_wasm: Spectoda_WASM | undefined
  #connectors: IConnector_WASM[]

  #eventSaveFsTimeoutHandle: NodeJS.Timeout | null

  constructor(runtimeReference: SpectodaRuntime) {
    this.#runtimeReference = runtimeReference

    this.#spectoda_wasm = undefined
    this.#connectors = []

    this.#eventSaveFsTimeoutHandle = null
  }

  inicilize() {
    // TODO pass WASM version to load
    SpectodaWasm.initialize()
    return SpectodaWasm.waitForInitilize()
  }

  waitForInitilize() {
    return SpectodaWasm.waitForInitilize()
  }

  construct(controllerConfig: object, constrollerMacAddress: string) {
    logging.debug(
      `Spectoda_JS::construct(controller_config=${JSON.stringify(
        controllerConfig,
      )}, constroller_mac_address=${constrollerMacAddress})`,
    )

    if (this.#spectoda_wasm) {
      throw 'AlreadyContructed'
    }

    return SpectodaWasm.waitForInitilize().then(() => {
      const WASM_INTERFACE_IMPLEMENTATION: Spectoda_WASMImplementation = {
        /* Constructor function is optional */
        // __construct: function () {
        //   this.__parent.__construct.call(this);
        // },

        /* Destructor function is optional */
        // __destruct: function () {
        //   this.__parent.__destruct.call(this);
        // },

        _onTnglLoad: (tnglBytesVector, usedIdsVector) => {
          logging.verbose(
            'Spectoda_JS::_onTnglLoad',
            tnglBytesVector,
            usedIdsVector,
          )

          {
            const SAVE_FS_AFTER_MS = 1000

            // Save FS 1s after TNGL upload
            setTimeout(() => {
              SpectodaWasm.saveFS().catch((e) => {
                logging.error('SpectodaWasm::_onTnglLoad():', e)
              })
            }, SAVE_FS_AFTER_MS)
          }

          try {
            // dont know how to make Uint8Array in C++ yet. So I am forced to give data out in C++ std::vector
            const tnglBytes =
              SpectodaWasm.convertUint8VectorUint8Array(tnglBytesVector)
            const usedIds =
              SpectodaWasm.convertUint8VectorUint8Array(usedIdsVector)

            this.#runtimeReference.emit(SpectodaAppEvents.TNGL_UPDATE, {
              tngl_bytes: tnglBytes,
              used_ids: usedIds,
            })
          } catch {
            //
          }

          return true
        },

        _onNetworkStorageDataUpdate: (
          dataName: string,
          dataVersion: number,
          dataFingerprint: string,
          dataBytesVector: Uint8Vector,
        ) => {
          logging.verbose(
            'Spectoda_JS::_onNetworkStorageDataUpdate',
            dataName,
            dataVersion,
            dataFingerprint,
            dataBytesVector,
          )

          {
            const SAVE_FS_AFTER_MS = 1000

            // Save FS 1s after TNGL upload
            setTimeout(() => {
              SpectodaWasm.saveFS().catch((e) => {
                logging.error('SpectodaWasm::_onTnglLoad():', e)
              })
            }, SAVE_FS_AFTER_MS)
          }

          try {
            // dont know how to make Uint8Array in C++ yet. So I am forced to give data out in C++ std::vector
            const dataBytes =
              SpectodaWasm.convertUint8VectorUint8Array(dataBytesVector)

            this.#runtimeReference.emit(
              SpectodaAppEvents.NETWORK_STORAGE_DATA_UPDATE,
              {
                data_name: dataName,
                data_version: dataVersion,
                data_fingerprint: dataFingerprint,
                data_bytes: dataBytes,
              },
            )
          } catch {
            //
          }

          return true
        },

        _onEvents: (eventArray: EventState[]) => {
          logging.verbose('Spectoda_JS::_onEvents', eventArray)

          {
            // Save FW after 2.5 seconds of Event Inactivity
            const SAVE_FS_AFTER_MS = 2500

            // if event is called in the 11s window, then reset the timeout
            if (this.#eventSaveFsTimeoutHandle) {
              clearTimeout(this.#eventSaveFsTimeoutHandle)
            }
            // after events are emitted wait and if it is quiet, then save FS
            this.#eventSaveFsTimeoutHandle = setTimeout(() => {
              SpectodaWasm.saveFS().catch((e) => {
                logging.error('SpectodaWasm::_onEvents():', e)
              })

              this.#eventSaveFsTimeoutHandle = null
            }, SAVE_FS_AFTER_MS)
          }

          if (logging.level >= 1 && eventArray.length > 0) {
            let debugLog = ''

            {
              const e = eventArray[0]

              debugLog += `🕹️ $${e.label.padEnd(5)} -> ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            for (let i = 1; i < eventArray.length; i++) {
              const e = eventArray[i]

              debugLog += `\n🕹️ $${e.label.padEnd(5)} -> ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            logging.log(debugLog)
          }

          this.#runtimeReference.emit(
            SpectodaAppEvents.EMITTED_EVENTS,
            eventArray,
          )

          return true
        },

        _onEventStateUpdates: (eventStateUpdatesArray: EventState[]) => {
          logging.verbose(
            'Spectoda_JS::_onEventStateUpdates',
            eventStateUpdatesArray,
          )

          if (logging.level >= 3 && eventStateUpdatesArray.length > 0) {
            let debugLog = ''

            const name = this.#spectoda_wasm?.getLabel()

            {
              const e = eventStateUpdatesArray[0]

              debugLog += `🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            for (let i = 1; i < eventStateUpdatesArray.length; i++) {
              const e = eventStateUpdatesArray[i]

              debugLog += `\n🖥️ $${name}: \t📍 $${e.label.padEnd(5)} <- ${e.id}: ${e.debug} [🕒 ${e.timestamp}]`
            }

            logging.log(debugLog)
          }

          this.#runtimeReference.emit(
            SpectodaAppEvents.EVENT_STATE_UPDATES,
            eventStateUpdatesArray,
          )

          return true
        },

        _onExecute: (commandsBytecodeVector: Uint8Vector) => {
          logging.verbose('Spectoda_JS::_onExecute', commandsBytecodeVector)

          // dont know how to make Uint8Array in C++ yet. So I am forced to give data out in C++ std::vector
          // const commands_bytecode = SpectodaWasm.convertUint8VectorUint8Array(commands_bytecode_vector);

          // try {
          //   const command_bytecode = SpectodaWasm.convertUint8VectorUint8Array(commands_bytecode_vector);
          //   const THIS_CONTROLLER_CONNECTION = SpectodaWasm.Connection.make("00:00:00:00:00:00", SpectodaWasm.connector_type_t.CONNECTOR_UNDEFINED, SpectodaWasm.connection_rssi_t.RSSI_MAX);
          //   this.#runtimeReference.sendExecute(command_bytecode, THIS_CONTROLLER_CONNECTION).catch(e => {
          //     logging.error(e);
          //     return false;
          //   });
          // } catch (e) {
          //   logging.error(e);
          //   return false;
          // }

          return true
        },

        _onSynchronize: (synchronization: Synchronization) => {
          logging.debug(
            `Spectoda_JS::_onSynchronize(synchronization=${JSON.stringify(synchronization)})`,
          )

          try {
            this.#runtimeReference.emit(
              SpectodaAppEvents.PRIVATE_WASM_CLOCK,
              synchronization.clock_timestamp,
            )

            if (
              Math.abs(
                this.#runtimeReference.clock.millis() -
                  synchronization.clock_timestamp,
              ) > 10
            ) {
              this.#runtimeReference.clock.setMillis(
                synchronization.clock_timestamp,
              )
            }
          } catch (e) {
            logging.error(e)
          }

          // TODO IMPLEMENT SENDING TO OTHER CONNECTIONS
          return true
        },

        _onProcess: (options) => {
          logging.verbose('Spectoda_JS::_onProcess', options)

          return true
        },

        _onLog: (level, filename, message) => {
          // if (level - 1 < logging.level) {
          //   return;
          // }

          const name = this.#spectoda_wasm?.getLabel()

          switch (level) {
            case 5: {
              logging.verbose(`🖥️ $${name}: \t[V][${filename}]: ${message}`)
              break
            }
            case 4: {
              logging.debug(`🖥️ $${name}: \t[D][${filename}]: ${message}`)
              break
            }
            case 3: {
              logging.debug(`🖥️ $${name}: \t[I][${filename}]: ${message}`)
              break
            }
            case 2: {
              logging.warn(`🖥️ $${name}: \t[W][${filename}]: ${message}`)
              break
            }
            case 1: {
              logging.error(`🖥️ $${name}: \t[E][${filename}]: ${message}`)
              break
            }
            default: {
              logging.log(`🖥️ $${name}: \t[?][${filename}]: ${message}`)
              break
            }
          }
        },

        _handlePeerConnected: (peerMac) => {
          logging.debug('Spectoda_JS::_handlePeerConnected', peerMac)

          logging.info(`> Peer ${peerMac} connected`)
          this.#runtimeReference.emit(SpectodaAppEvents.PEER_CONNECTED, peerMac)

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        _handlePeerDisconnected: (peerMac) => {
          logging.debug('Spectoda_JS::_handlePeerDisconnected', peerMac)

          logging.info(`> Peer ${peerMac} disconnected`)
          this.#runtimeReference.emit(
            SpectodaAppEvents.PEER_DISCONNECTED,
            peerMac,
          )

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        // virtual interface_error_t _handleTimelineManipulation(const int32_t timeline_timestamp, const bool timeline_paused, const double clock_timestamp) = 0;
        _handleTimelineManipulation: (
          timelineTimestamp: number,
          timelinePaused: boolean,
          timelineDate: string,
        ): interface_error_t => {
          logging.debug(
            `Spectoda_JS::_handleTimelineManipulation(timeline_timestamp=${timelineTimestamp}, timeline_paused=${timelinePaused}, timeline_date=${timelineDate})`,
          )

          // Update timeline state without emitting local events to prevent duplicate reactions
          // (TIMELINE_UPDATE event will be emitted instead for unified handling)
          this.#runtimeReference.spectodaReference.timeline.setMillis(
            timelineTimestamp,
          )
          if (timelinePaused) {
            this.#runtimeReference.spectodaReference.timeline.pause()
          } else {
            this.#runtimeReference.spectodaReference.timeline.unpause()
          }
          this.#runtimeReference.spectodaReference.timeline.setDate(
            timelineDate,
          )

          // Emit timeline update event for UI synchronization (both local and remote control)
          this.#runtimeReference.emit(SpectodaAppEvents.TIMELINE_UPDATE, {
            millis: timelineTimestamp,
            paused: timelinePaused,
            date: timelineDate,
          })

          return SpectodaWasm.interface_error_t.SUCCESS
        },

        _handleReboot: () => {
          logging.debug('Spectoda_JS::_handleReboot')

          setTimeout(async () => {
            this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
            await sleep(1)

            try {
              this.destruct()
            } catch (e) {
              logging.error(e)
            }

            this.construct(controllerConfig, constrollerMacAddress)
          }, 1000)

          return SpectodaWasm.interface_error_t.SUCCESS
        },
      }

      const WASM_CONNECTOR_IMPLEMENTATION: IConnector_WASMImplementation = {
        // _scan: (criteria_json: string, scan_period: number, result_out: any) => boolean;
        _scan: (
          _criteriaJson: string,
          _scanPeriod: number,
          _resultOut: any,
        ) => {
          return false
        },

        // _autoConnect: (criteria_json: string, scan_period: number, timeout: number, result_out: any) => boolean;
        _autoConnect: (
          _criteriaJson: string,
          _scanPeriod: number,
          _timeout: number,
          _resultOut: any,
        ) => {
          return false
        },

        // _userConnect: (criteria_json: string, timeout: number, result_out: any) => boolean;
        _userConnect: (
          _criteriaJson: string,
          _timeout: number,
          _resultOut: any,
        ) => {
          return false
        },

        // _disconnect: (connection: Connection) => boolean;
        _disconnect: (connection: Connection) => {
          logging.debug(`Spectoda_JS::_disconnect(connection=${connection}`)

          return false
        },

        // _sendExecute: (command_bytes: Uint8Vector, source_connection: Connection) => void;
        _sendExecute: (
          commandBytecode: Uint8Vector,
          sourceConnection: Connection,
        ) => {
          logging.debug(
            `Spectoda_JS::_sendExecute(command_bytecode=${commandBytecode}, source_connection=${JSON.stringify(
              sourceConnection,
            )}`,
          )

          try {
            const commandBytecodeArray =
              SpectodaWasm.convertUint8VectorUint8Array(commandBytecode)

            this.#runtimeReference
              .sendExecute(commandBytecodeArray, sourceConnection)
              .catch((e) => {
                if (
                  e !== 'DeviceDisconnected' &&
                  e !== 'ConnectorNotAssigned'
                ) {
                  logging.error(e)
                }
                return false
              })
          } catch (e) {
            logging.error(e)
            return false
          }
        },

        // _sendRequest: (request_bytecode: Uint8Vector, destination_connection: Connection) => boolean;
        _sendRequest: (
          requestBytecode: Uint8Vector,
          destinationConnection: Connection,
        ) => {
          logging.debug(
            `Spectoda_JS::_sendRequest(request_bytecode=${requestBytecode}, destination_connection=${destinationConnection}`,
          )

          try {
            const requestBytecodeArray =
              SpectodaWasm.convertUint8VectorUint8Array(requestBytecode)

            this.#runtimeReference
              .sendRequest(requestBytecodeArray, destinationConnection)
              .catch((e) => {
                logging.error(e)
                return false
              })
          } catch (e) {
            logging.error(e)
            return false
          }

          return true
        },

        // _sendSynchronize: (synchronization: Synchronization, source_connection: Connection) => void;
        _sendSynchronize: (
          synchronization: Synchronization,
          sourceConnection: Connection,
        ) => {
          logging.verbose(
            `Spectoda_JS::_sendSynchronize(synchronization=${JSON.stringify(
              synchronization,
            )}, source_connection=${JSON.stringify(sourceConnection)}`,
          )

          // history_fingerprint: number;
          // tngl_fingerprint: number;
          // clock_timestamp: number;
          // timeline_clock_timestamp: number;
          // tngl_clock_timestamp: number;
          // fw_compilation_unix_timestamp: number;
          // origin_address: number

          // logging.info(`history_fingerprint=${synchronization.history_fingerprint}, tngl_fingerprint=${synchronization.tngl_fingerprint}, clock_timestamp=${synchronization.clock_timestamp}
          //   , timeline_clock_timestamp=${synchronization.tngl_fingerprint}, tngl_clock_timestamp=${synchronization.tngl_clock_timestamp}, fw_compilation_unix_timestamp=${synchronization.fw_compilation_unix_timestamp}, origin_address${synchronization.origin_address}`);
          // logging.info(`address_string=${source_connection.address_string.toString()}, connector_type=${source_connection.connector_type.value.toString()}, connection_rssi=${source_connection.connection_rssi.value.toString()}`);

          this.#runtimeReference
            .sendSynchronize(synchronization, sourceConnection)
            .catch((e) => {
              // ! DISABLED 11. 9. 2024 By @mchlkucera
              // Because of console.error spamming on frontend
              if (e !== 'DeviceDisconnected' && e !== 'ConnectorNotAssigned') {
                logging.error(e)
              }
            })
        },

        // _process: () => void;
        _process: () => {
          // logging.info(`process()`);
        },
      }

      this.#spectoda_wasm = SpectodaWasm.Spectoda_WASM.implement(
        WASM_INTERFACE_IMPLEMENTATION,
      )

      const cosntrollerConfigJson = JSON.stringify(controllerConfig)

      logging.verbose(`cosntroller_config_json=${cosntrollerConfigJson}`)

      this.#spectoda_wasm.init(constrollerMacAddress, cosntrollerConfigJson)

      this.#connectors = []

      const connector = SpectodaWasm.IConnector_WASM.implement(
        WASM_CONNECTOR_IMPLEMENTATION,
      )

      connector.init(SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME)
      this.registerConnector(connector)

      this.#connectors.push(connector)

      this.#spectoda_wasm.begin(
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
      )
    })
  }

  destruct() {
    if (!this.#spectoda_wasm) {
      throw 'AlreadyDestructed'
    }

    this.#spectoda_wasm.end() // end the spectoda stuff
    this.#spectoda_wasm.delete() // delete (free) C++ object
    this.#spectoda_wasm = undefined // remove javascript reference

    for (let i = 0; i < this.#connectors.length; i++) {
      this.#connectors[i].delete()
      delete this.#connectors[i] // remove javascript reference
    }
  }

  makePort(portLabel: string, portConfig: string): Uint32Array {
    logging.info(
      `Spectoda_JS::makePort(port_label=${portLabel}, port_config=${portConfig})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.makePort(portLabel, portConfig)
  }

  registerConnector(connector: IConnector_WASM) {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.registerConnector(connector)
  }

  setClockTimestamp(clockTimestamp: number) {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.setClockTimestamp(clockTimestamp)
  }

  getClockTimestamp() {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getClockTimestamp()
  }

  execute(executeBytecode: Uint8Array, sourceConnection: Connection): void {
    logging.debug(
      `Spectoda_JS::execute(execute_bytecode=${executeBytecode}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    const executeSucess = this.#spectoda_wasm.execute(
      SpectodaWasm.toHandle(executeBytecode),
      sourceConnection,
    )

    if (!executeSucess) {
      throw 'EvaluateError'
    }
  }

  request(requestBytecode: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `Spectoda_JS::request(request_bytecode=${requestBytecode}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    const responseBytecodeVector = new SpectodaWasm.Uint8Vector()
    let responseBytecode

    try {
      const requestSucess = this.#spectoda_wasm.request(
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
      `Spectoda_JS::synchronize(synchronization=${JSON.stringify(synchronization)}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.synchronize(synchronization, sourceConnection)
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
    logging.verbose('Spectoda_JS::process()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.process(
      options.skip_berry_plugin_update,
      options.skip_eventstate_updates,
      options.force_event_emittion,
      options.skip_event_emittion,
    )
  }

  // ? render() is forcing a render cycle
  render(options: { power: number } = { power: 255 }) {
    logging.verbose('Spectoda_JS::render()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.render(options.power)
  }

  readVariableAddress(variableAddress: number, deviceId: number) {
    logging.verbose(
      `Spectoda_JS::readVariableAddress(variable_address=${variableAddress}, device_id=${deviceId})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.readVariableAddress(variableAddress, deviceId)
  }

  emitValue(eventLabel: string, eventValue: Value, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitValue(event_label=${eventLabel}, event_value=${eventValue}, event_id=${eventId})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.emitValue(eventLabel, eventValue, eventId, true)
  }

  emitNumber(eventLabel: string, eventNumberValue: number, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitNumber(event_label=${eventLabel}, event_number_value=${eventNumberValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeNumber(eventNumberValue),
      eventId,
    )
  }

  emitLabel(eventLabel: string, eventLabelValue: string, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitLabel(event_label=${eventLabel}, event_label_value=${eventLabelValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeLabel(eventLabelValue),
      eventId,
    )
  }

  emitTimestamp(
    eventLabel: string,
    eventTimestampValue: number,
    eventId: number,
  ) {
    logging.verbose(
      `Spectoda_JS::emitTimestamp(event_label=${eventLabel}, event_timestamp_value=${eventTimestampValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeTimestamp(eventTimestampValue),
      eventId,
    )
  }

  emitPercentage(
    eventLabel: string,
    eventPercentageValue: number,
    eventId: number,
  ) {
    logging.verbose(
      `Spectoda_JS::emitPercentage(event_label=${eventLabel}, event_percentage_value=${eventPercentageValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makePercentage(eventPercentageValue),
      eventId,
    )
  }

  emitDate(eventLabel: string, eventDateValue: string, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitDate(event_label=${eventLabel}, event_date_value=${eventDateValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeDate(eventDateValue),
      eventId,
    )
  }

  emitColor(eventLabel: string, eventColorValue: string, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitColor(event_label=${eventLabel}, event_color_value=${eventColorValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeColor(eventColorValue),
      eventId,
    )
  }

  emitPixels(eventLabel: string, eventPixelsValue: number, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitPixels(event_label=${eventLabel}, event_pixels_value=${eventPixelsValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makePixels(eventPixelsValue),
      eventId,
    )
  }

  emitBoolean(eventLabel: string, eventBooleanValue: boolean, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitBoolean(event_label=${eventLabel}, event_boolean_value=${eventBooleanValue}, event_id=${eventId})`,
    )

    return this.emitValue(
      eventLabel,
      SpectodaWasm.Value.makeBoolean(eventBooleanValue),
      eventId,
    )
  }

  emitNull(eventLabel: string, eventId: number) {
    logging.verbose(
      `Spectoda_JS::emitNull(event_label=${eventLabel}, event_id=${eventId})`,
    )

    return this.emitValue(eventLabel, SpectodaWasm.Value.makeNull(), eventId)
  }

  eraseHistory() {
    logging.verbose('Spectoda_JS::eraseHistory()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.eraseHistory()
  }

  eraseTimeline() {
    logging.verbose('Spectoda_JS::eraseTimeline()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.eraseTimeline()
  }

  eraseTngl() {
    logging.verbose('Spectoda_JS::eraseTngl()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.eraseTngl()
  }

  /**
   * Erases all NetworkStorage data from all connected controllers in the Network.
   *
   * This function attempts to remove all NetworkStorage data, but does not guarantee
   * that the data is permanently deleted. If another controller wakes up later,
   * its data may be synchronized back to the NetworkStorage to other Controllers.
   * For proper data deletion, set data to an empty bytes with a high version number.
   *
   * @throws {string} Throws "NotConstructed" if the WASM module is not initialized.
   */
  eraseNetworkStorage() {
    logging.verbose('Spectoda_JS::eraseNetworkStorage()')

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    this.#spectoda_wasm.eraseNetworkStorage()
  }

  getEventState(
    eventStateName: string,
    eventStateId: number,
  ): EventState | undefined {
    logging.verbose(
      `Spectoda_JS::getEventState(event_state_name=${eventStateName}, event_state_id=${eventStateId})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getEventState(eventStateName, eventStateId)
  }

  getDateTime(): { time: number; date: string } {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getDateTime()
  }

  /**
   * Retrieves the currently running TNGL fingerprint.
   * This function returns a 32-byte hash of the TNGL in hex string format.
   *
   * @throws {string} Throws "NotConstructed" if the WASM module is not initialized.
   * @returns {string} The TNGL fingerprint as a hex string.
   */
  getTnglFingerprint(): string {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getTnglFingerprint()
  }

  /**
   * Retrieves the fingerprint or EventStore.
   * This function returns a 32-byte hash of the EventStore in hex string format.
   *
   * @throws {string} Throws "NotConstructed" if the WASM module is not initialized.
   * @returns {string} The EventStore fingerprint as a hex string.
   */
  getEventStoreFingerprint(): string {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getEventStoreFingerprint()
  }

  /**
   * Retrieves the fingerprint or NetworkStorage.
   * This function returns a 32-byte hash of the NetworkStorage in hex string format.
   *
   * @throws {string} Throws "NotConstructed" if the WASM module is not initialized.
   * @returns {string} The NetworkStorage fingerprint as a hex string.
   */
  getNetworkStorageFingerprint(): string {
    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.getNetworkStorageFingerprint()
  }

  registerDeviceContext(deviceId: number): boolean {
    logging.verbose(`Spectoda_JS::registerDeviceContext(device_id=${deviceId})`)

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    return this.#spectoda_wasm.registerDeviceContext(deviceId)
  }

  // === REQUESTS ===

  /**
   * Emits the TNGL bytecode to Network from the given connection.
   *
   * @param connection - The connection to emit the TNGL bytecode from.
   * @param request - The request object containing the TNGL bytecode.
   * @returns {boolean} True if the TNGL bytecode was emitted successfully, false otherwise.
   */
  // TODO! rename to requestEmitWriteTnglBytecode()
  requestEmitTnglBytecode(
    connection: string,
    request: { args: { bytecode: Uint8Array } },
  ): boolean {
    logging.debug(
      `Spectoda_JS::requestEmitTnglBytecode(connection=${connection}, bytecode=${request.args.bytecode})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    // TODO: Implement controller actions in WASM
    if (connection !== '/') {
      throw 'ConnectionNotImplemented'
    }

    return this.#spectoda_wasm.requestEmitTnglBytecode(
      connection,
      SpectodaWasm.toHandle(request.args.bytecode),
    )
  }

  /**
   * Reloads the TNGL on given controller
   *
   * @param connection - The connection to reload the TNGL on.
   * @returns {boolean} True if the TNGL was reloaded successfully, false otherwise.
   */
  requestReloadTngl(connection: string) {
    logging.debug(`Spectoda_JS::requestReloadTngl(connection=${connection})`)

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    // TODO: Implement controller actions in WASM
    if (connection !== '/') {
      throw 'ConnectionNotImplemented'
    }

    return this.#spectoda_wasm.requestReloadTngl(connection)
  }

  /**
   * Writes the IO variant to the given IO through the given connection.
   *
   * @param connection - The connection to write the IO variant to.
   * @param ioLabel - The IO label to write the variant to.
   * @param variant - The variant to write to the IO.
   * @returns {boolean} True if the IO variant was written successfully, false otherwise.
   */
  requestWriteIoVariant(
    connection: string,
    request: {
      args: {
        label: ValueTypeLabel
        variant: string
        remove_io_variant: boolean
      }
    },
  ): boolean {
    logging.debug(
      `Spectoda_JS::requestWriteIoVariant(connection=${connection}, ioLabel=${request.args.label}, variant=${request.args.variant}, option_remove_io_variant=${request.args.remove_io_variant})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    // TODO: Implement controller actions in WASM
    if (connection !== '/') {
      throw 'ConnectionNotImplemented'
    }

    return this.#spectoda_wasm.requestWriteIoVariant(
      connection,
      request.args.label,
      request.args.variant,
      request.args.remove_io_variant,
    )
  }

  /**
   * Writes the IO mapping to the given IO through the given connection.
   *
   * @param connection - The connection to write the IO mapping to.
   * @param ioLabel - The IO label to write the mapping to.
   * @param mapping - The mapping to write to the IO.
   * @param option_remove_io_mapping - Whether to remove the IO mapping.
   * @returns {boolean} True if the IO mapping was written successfully, false otherwise.
   */
  requestWriteIoMapping(
    connection: string,
    request: {
      args: {
        label: ValueTypeLabel
        mapping: Int16Array
        remove_io_mapping: boolean
      }
    },
  ): boolean {
    logging.debug(
      `Spectoda_JS::requestWriteIoMapping(connection=${connection}, ioLabel=${request.args.label}, mapping=${request.args.mapping}, option_remove_io_mapping=${request.args.remove_io_mapping})`,
    )

    if (!this.#spectoda_wasm) {
      throw 'NotConstructed'
    }

    // TODO: Implement controller actions in WASM
    if (connection !== '/') {
      throw 'ConnectionNotImplemented'
    }

    return this.#spectoda_wasm.requestWriteIoMapping(
      connection,
      request.args.label,
      SpectodaWasm.toHandle(request.args.mapping),
      request.args.remove_io_mapping,
    )
  }

  /**
   * Writes configuration to a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param config - Configuration JSON string to write
   * @param options - timeout (ms), rebootAfterWrite (bool)
   */
  requestWriteConfig(
    connectionPath: string[],
    config: string,
    options?: { rebootAfterWrite?: boolean; timeout?: number },
  ): Promise<Uint8Array> {
    logging.debug(
      `Spectoda_JS::requestWriteConfig(connectionPath=${JSON.stringify(connectionPath)}, config=${config}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      
      const callback = (errorCode: number, responseArray: number[]) => {
        if (errorCode === 0) {
          resolve(new Uint8Array(responseArray));
        } else {
          // Make errors globally searchable by using their full capitalized string
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_WRITE_CONFIG_FAILED_SUCCESS',
            1: 'REQUEST_WRITE_CONFIG_FAILED_INVALID_PATH',
            2: 'REQUEST_WRITE_CONFIG_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_WRITE_CONFIG_FAILED_TIMEOUT',
            4: 'REQUEST_WRITE_CONFIG_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_WRITE_CONFIG_FAILED_SEND_FAILED',
            6: 'REQUEST_WRITE_CONFIG_FAILED_WRAPPED_FAILED',
          };
          const errorString = errorStrings[errorCode] ?? 'REQUEST_WRITE_CONFIG_FAILED_UNKNOWN';
          reject(privateError(errorString));
        }
      };

      const success = this.#spectoda_wasm!.requestWriteConfig(
        callback,
        pathJson,
        config,
        timeout,
      );

      if (!success) {
        reject(privateError('REQUEST_WRITE_CONFIG_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Reads configuration from a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to config JSON string
   */
  requestReadConfig(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    logging.debug(
      `Spectoda_JS::requestReadConfig(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number, configString: string) => {
        if (errorCode === 0) {
          resolve(configString)
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_READ_CONFIG_FAILED_SUCCESS',
            1: 'REQUEST_READ_CONFIG_FAILED_INVALID_PATH',
            2: 'REQUEST_READ_CONFIG_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_READ_CONFIG_FAILED_TIMEOUT',
            4: 'REQUEST_READ_CONFIG_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_READ_CONFIG_FAILED_SEND_FAILED',
            6: 'REQUEST_READ_CONFIG_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_READ_CONFIG_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReadConfig(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_READ_CONFIG_INITIATION_FAILED'))
      }
    })
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
  requestReadConnections(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ConnectionInfo[]> {
    logging.debug(
      `Spectoda_JS::requestReadConnections(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number, connections: ConnectionInfo[]) => {
        if (errorCode === 0) {
          resolve(connections)
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_READ_CONNECTIONS_FAILED_SUCCESS',
            1: 'REQUEST_READ_CONNECTIONS_FAILED_INVALID_PATH',
            2: 'REQUEST_READ_CONNECTIONS_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_READ_CONNECTIONS_FAILED_TIMEOUT',
            4: 'REQUEST_READ_CONNECTIONS_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_READ_CONNECTIONS_FAILED_SEND_FAILED',
            6: 'REQUEST_READ_CONNECTIONS_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_READ_CONNECTIONS_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReadConnections(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_READ_CONNECTIONS_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Reads controller info from a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to ControllerInfo object
   */
  requestReadControllerInfo(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ControllerInfo> {
    logging.debug(
      `Spectoda_JS::requestReadControllerInfo(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number, controllerInfo: ControllerInfoWasm | null) => {
        if (errorCode === 0 && controllerInfo !== null) {
          // Convert WASM format to ControllerInfo type
          const info: ControllerInfo = {
            fullName: controllerInfo.fullName,
            controllerLabel: controllerInfo.controllerLabel,
            macAddress: controllerInfo.macAddress,
            commissionable: controllerInfo.commissionable,
            pcbCode: controllerInfo.pcbCode,
            productCode: controllerInfo.productCode,
            fwVersionCode: controllerInfo.fwVersionCode,
            fwPlatformCode: controllerInfo.fwPlatformCode,
            fwCompilationUnixTimestamp: controllerInfo.fwCompilationUnixTimestamp,
            fwVersionFull: controllerInfo.fwVersionFull,
            fwVersion: controllerInfo.fwVersion,
            networkSignature: controllerInfo.networkSignature,
            tnglFingerprint: controllerInfo.tnglFingerprint,
            eventStoreFingerprint: controllerInfo.eventStoreFingerprint,
            configFingerprint: controllerInfo.configFingerprint,
            networkStorageFingerprint: controllerInfo.networkStorageFingerprint,
            controllerStoreFingerprint: controllerInfo.controllerStoreFingerprint,
            notificationStoreFingerprint: controllerInfo.notificationStoreFingerprint,
          }
          resolve(info)
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_READ_CONTROLLER_INFO_FAILED_SUCCESS',
            1: 'REQUEST_READ_CONTROLLER_INFO_FAILED_INVALID_PATH',
            2: 'REQUEST_READ_CONTROLLER_INFO_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_READ_CONTROLLER_INFO_FAILED_TIMEOUT',
            4: 'REQUEST_READ_CONTROLLER_INFO_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_READ_CONTROLLER_INFO_FAILED_SEND_FAILED',
            6: 'REQUEST_READ_CONTROLLER_INFO_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_READ_CONTROLLER_INFO_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReadControllerInfo(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_READ_CONTROLLER_INFO_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Reboots a controller via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when reboot command is sent
   */
  requestRestart(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda_JS::requestRestart(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number) => {
        if (errorCode === 0) {
          resolve()
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_RESTART_FAILED_SUCCESS',
            1: 'REQUEST_RESTART_FAILED_INVALID_PATH',
            2: 'REQUEST_RESTART_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_RESTART_FAILED_TIMEOUT',
            4: 'REQUEST_RESTART_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_RESTART_FAILED_SEND_FAILED',
            6: 'REQUEST_RESTART_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_RESTART_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReboot(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_RESTART_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Puts a controller to sleep via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms), duration (ms) - sleep duration, 0 for indefinite (requires power cycle)
   * @returns Promise resolving when sleep command is sent
   */
  requestSleep(
    connectionPath: string[],
    options?: { timeout?: number; duration?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda_JS::requestSleep(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const duration = options?.duration ?? 0
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number) => {
        if (errorCode === 0) {
          resolve()
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_SLEEP_FAILED_SUCCESS',
            1: 'REQUEST_SLEEP_FAILED_INVALID_PATH',
            2: 'REQUEST_SLEEP_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_SLEEP_FAILED_TIMEOUT',
            4: 'REQUEST_SLEEP_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_SLEEP_FAILED_SEND_FAILED',
            6: 'REQUEST_SLEEP_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_SLEEP_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestSleep(
        callback,
        pathJson,
        timeout,
        duration,
      )

      if (!success) {
        reject(privateError('REQUEST_SLEEP_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Erases network ownership from a controller via connection path.
   * Controller will need to be commissioned again after this operation.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when network is erased
   */
  requestEraseNetwork(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda_JS::requestEraseNetwork(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number) => {
        if (errorCode === 0) {
          resolve()
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_ERASE_NETWORK_FAILED_SUCCESS',
            1: 'REQUEST_ERASE_NETWORK_FAILED_INVALID_PATH',
            2: 'REQUEST_ERASE_NETWORK_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_ERASE_NETWORK_FAILED_TIMEOUT',
            4: 'REQUEST_ERASE_NETWORK_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_ERASE_NETWORK_FAILED_SEND_FAILED',
            6: 'REQUEST_ERASE_NETWORK_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_ERASE_NETWORK_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestEraseNetwork(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_ERASE_NETWORK_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Reads the controller label (short name) via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the controller label string
   */
  requestReadControllerLabel(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    logging.debug(
      `Spectoda_JS::requestReadControllerLabel(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number, label: string) => {
        if (errorCode === 0) {
          resolve(label)
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_SUCCESS',
            1: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_INVALID_PATH',
            2: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_TIMEOUT',
            4: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_SEND_FAILED',
            6: 'REQUEST_READ_CONTROLLER_LABEL_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_READ_CONTROLLER_LABEL_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReadControllerLabel(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_READ_CONTROLLER_LABEL_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Writes the controller label (short name) via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param label - The new controller label to write
   * @param options - timeout (ms)
   * @returns Promise resolving when label is written
   */
  requestWriteControllerLabel(
    connectionPath: string[],
    label: string,
    options?: { timeout?: number },
  ): Promise<void> {
    logging.debug(
      `Spectoda_JS::requestWriteControllerLabel(connectionPath=${JSON.stringify(connectionPath)}, label=${label}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number) => {
        if (errorCode === 0) {
          resolve()
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_SUCCESS',
            1: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_INVALID_PATH',
            2: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_TIMEOUT',
            4: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_SEND_FAILED',
            6: 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_WRITE_CONTROLLER_LABEL_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestWriteControllerLabel(
        callback,
        pathJson,
        label,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_WRITE_CONTROLLER_LABEL_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Reads the firmware version via connection path.
   * Uses callback-first async API for multi-hop support.
   *
   * @param connectionPath - Array of hops, e.g., ["/"] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the firmware version string
   */
  requestReadFwVersion(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string> {
    logging.debug(
      `Spectoda_JS::requestReadFwVersion(connectionPath=${JSON.stringify(connectionPath)}, options=${JSON.stringify(options)})`,
    )

    if (!this.#spectoda_wasm) {
      return Promise.reject(privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'))
    }

    const timeout = options?.timeout ?? 10000
    const pathJson = JSON.stringify(connectionPath)

    return new Promise((resolve, reject) => {
      const callback = (errorCode: number, fwVersion: string) => {
        if (errorCode === 0) {
          resolve(fwVersion)
        } else {
          const errorStrings: Record<number, string> = {
            0: 'REQUEST_READ_FW_VERSION_FAILED_SUCCESS',
            1: 'REQUEST_READ_FW_VERSION_FAILED_INVALID_PATH',
            2: 'REQUEST_READ_FW_VERSION_FAILED_HOP_UNREACHABLE',
            3: 'REQUEST_READ_FW_VERSION_FAILED_TIMEOUT',
            4: 'REQUEST_READ_FW_VERSION_FAILED_CONNECTOR_NOT_FOUND',
            5: 'REQUEST_READ_FW_VERSION_FAILED_SEND_FAILED',
            6: 'REQUEST_READ_FW_VERSION_FAILED_WRAPPED_FAILED',
          }
          const errorString = errorStrings[errorCode] ?? 'REQUEST_READ_FW_VERSION_FAILED_UNKNOWN'
          reject(privateError(errorString))
        }
      }

      const success = this.#spectoda_wasm!.requestReadFwVersion(
        callback,
        pathJson,
        timeout,
      )

      if (!success) {
        reject(privateError('REQUEST_READ_FW_VERSION_INITIATION_FAILED'))
      }
    })
  }

  /**
   * Lists all available network storage data present in the App Controller.
   *
   * This method retrieves metadata for all NetworkStorageData currently stored in the App Controller.
   * The metadata includes information such as the name, version and data fingerprint of each data bytes. For reading the
   * actual data, see {@link getNetworkStorageData}. For emitting or setting data, see {@link emitNetworkStorageData}
   * and {@link setNetworkStorageData}.
   *
   * @returns {PrivateError<string> | NetworkStorageMetadata[]} An array of network storage metadata if successful, or a PrivateError if the operation fails.
   */
  listNetworkStorageData():
    | PrivateError<'CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'>
    | PrivateError<'LIST_NETWORK_STORAGE_DATA_FAILED'>
    | NetworkStorageMetadata[] {
    if (!this.#spectoda_wasm) {
      return privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED')
    }

    const metadata: NetworkStorageMetadata[] = []

    if (!this.#spectoda_wasm.listNetworkStorageData(metadata)) {
      return privateError('LIST_NETWORK_STORAGE_DATA_FAILED')
    }

    return metadata
  }

  /**
   * Emits (spreads) the provided network storage data through the Network using the execute command,
   * which floods the Network with this new data. This approach ensures that the data is rapidly
   * propagated to all nodes, utilizing higher peak network bandwidth for immediate synchronization.
   *
   * Note: The data bytes will only be written into the storage if its version is higher than the version
   * of the data bytes that is already present in the storage. If the provided data has a lower version,
   * it will not overwrite the existing data. If the provided data has the same version as the existing data,
   * then the data will only be overwritten if its fingerprint is different and, based on the comparison
   * between fingerprints, it is determined to be newer/preferred.
   *
   * In contrast, {@link setNetworkStorageData} only sets the network data into App Controller and then
   * synchronizes it to other Controllers in the Network via requests at a slower pace, which does not
   * flood the network and uses less peak bandwidth. For reading and listing data, see {@link getNetworkStorageData}
   * and {@link listNetworkStorageData}.
   *
   * @param data - The network storage data to emit across the network.
   * @returns {PrivateError<string> | void} Returns a PrivateError if the operation fails, otherwise void.
   */
  emitNetworkStorageData(
    data: NetworkStorageData,
  ):
    | PrivateError<'CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'>
    | PrivateError<'EMIT_NETWORK_STORAGE_DATA_FAILED'>
    | undefined {
    if (!this.#spectoda_wasm) {
      return privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED')
    }

    if (!this.#spectoda_wasm.emitNetworkStorageData(data)) {
      return privateError('EMIT_NETWORK_STORAGE_DATA_FAILED')
    }
  }

  /**
   * Sets (stores) the provided network storage data into the App Controller.
   *
   * This method only sets the network data into WASM and then synchronizes it via requests at a slower pace, to
   * other Controllers in the Network, which does not flood the network and uses less peak bandwidth. For
   * immediate network-wide propagation, see {@link emitNetworkStorageData}. For reading and listing data,
   * see {@link getNetworkStorageData} and {@link listNetworkStorageData}.
   *
   * Note: The data bytes will only be written into the storage if its version is higher than the version
   * of the data bytes that is already present in the storage. If the provided data has a lower version,
   * it will not overwrite the existing data. If the provided data has the same version as the existing data,
   * then the data will only be overwritten if its fingerprint is different and, based on the comparison
   * between fingerprints, it is determined to be newer/preferred.
   *
   * @param data - The network storage data to set in the controller.
   * @returns {PrivateError<string> | void} Returns a PrivateError if the operation fails, otherwise void.
   */
  setNetworkStorageData(
    data: NetworkStorageData,
  ):
    | PrivateError<'CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'>
    | PrivateError<'SET_NETWORK_STORAGE_DATA_FAILED'>
    | undefined {
    if (!this.#spectoda_wasm) {
      return privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED')
    }

    if (!this.#spectoda_wasm.setNetworkStorageData(data)) {
      return privateError('SET_NETWORK_STORAGE_DATA_FAILED')
    }
  }

  /**
   * Reads the specified network storage data from the App Controller.
   *
   * This method retrieves the network storage data bytes with the given name from the App Controller.
   * For listing available data, see {@link listNetworkStorageData}. For emitting or setting data, see
   * {@link emitNetworkStorageData} and {@link setNetworkStorageData}.
   *
   * @param name - The name of the network storage data to retrieve.
   * @returns {PrivateError<string> | NetworkStorageData} The network storage data if successful, or a PrivateError if the operation fails.
   */
  getNetworkStorageData(
    name: string,
  ):
    | PrivateError<'CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED'>
    | PrivateError<'GET_NETWORK_STORAGE_DATA_FAILED'>
    | NetworkStorageData {
    if (!this.#spectoda_wasm) {
      return privateError('CONTROLLER_WASM_INSTANCE_NOT_CONSTRUCTED')
    }

    const data: NetworkStorageData = {
      name,
      version: 0,
      bytes: new Uint8Array(0),
    }

    if (!this.#spectoda_wasm.getNetworkStorageData(name, data)) {
      return privateError('GET_NETWORK_STORAGE_DATA_FAILED')
    }

    return data
  }
}
