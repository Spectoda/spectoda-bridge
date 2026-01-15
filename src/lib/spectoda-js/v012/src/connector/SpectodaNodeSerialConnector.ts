// TODO Fix eslint + typescript [DEV-4738]
// @ts-nocheck

// npm install @types/serialport --save-dev

// ls /dev/cu.*

// add overlays=uart3 to /boot/orangepiEnv.txt
// add overlays=uart0 to /boot/orangepiEnv.txt
// sudo stty -F /dev/ttyS3 1500000
// screen /dev/ttyS3 1500000

import {
  crc32,
  detectProductionBuild,
  numberToBytes,
  sleep,
  toBytes,
} from '../../functions'
import { logging } from '../../logging'
/*
echo 'overlays=uart3' | sudo tee -a /boot/orangepiEnv.txt
cat /boot/orangepiEnv.txt
*/
// @ts-nocheck
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { TnglWriter } from '../../TnglWriter'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import type { Criterium } from '../types/primitives'
import type { Connection, Synchronization } from '../types/wasm'

// ! === TODO fix TSC ===

// import { SerialPort as NodeSerialPort, ReadlineParser as NodeReadlineParser } from "serialport";
import type {
  ReadlineParser as NodeReadlineParserType,
  SerialPort as NodeSerialPortType,
} from 'serialport'
import { SpectodaAppEvents } from '../types/app-events'

let {
  NodeSerialPort,
  NodeReadlineParser,
}: {
  NodeSerialPort: NodeSerialPortType | undefined
  NodeReadlineParser: NodeReadlineParserType | undefined
} = { NodeSerialPort: undefined, NodeReadlineParser: undefined }

if (typeof window === 'undefined' && !detectProductionBuild()) {
  const serialport = require('serialport')

  NodeSerialPort = serialport.SerialPort as NodeSerialPortType
  NodeReadlineParser = serialport.ReadlineParser as NodeReadlineParserType
}

// ! === TODO! fix TSC ===

const _tnglSyncCounter = 0
const _historySyncCounter = 0

///////////////////////////////////////////////////////////////////////////////////

const PORT_OPTIONS = {
  path: '/dev/ttyS3',
  baudRate: 1500000,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false,
  bufferSize: 65535,
  flowControl: 'none',
}

const HEADER_BYTES_SIZE = 20

const CODE_WRITE = 100
const CODE_READ = 200
const CHANNEL_NETWORK = 1
const CHANNEL_DEVICE = 2
const CHANNEL_CLOCK = 3
const COMMAND = 0
const DATA = 10

const _UNKNOWN_PACKET = 0

const NETWORK_WRITE = CODE_WRITE + CHANNEL_NETWORK + COMMAND
const DEVICE_WRITE = CODE_WRITE + CHANNEL_DEVICE + COMMAND
const CLOCK_WRITE = CODE_WRITE + CHANNEL_CLOCK + COMMAND
const _NETWORK_READ = CODE_READ + CHANNEL_NETWORK + COMMAND
const _DEVICE_READ = CODE_READ + CHANNEL_DEVICE + COMMAND
const _CLOCK_READ = CODE_READ + CHANNEL_CLOCK + COMMAND
const _NETWORK_READ_DATA = CODE_READ + CHANNEL_NETWORK + DATA
const _DEVICE_READ_DATA = CODE_READ + CHANNEL_DEVICE + DATA
const _CLOCK_READ_DATA = CODE_READ + CHANNEL_CLOCK + DATA

const startsWith = (buffer: number[], string: string, startOffset = 0) => {
  for (let index = 0; index < string.length; index++) {
    if (buffer[index + startOffset] !== string.charCodeAt(index)) {
      return false
    }
  }

  return true
}

const endsWith = (buffer: number[], string: string, startOffset = 0) => {
  for (let index = 0; index < string.length; index++) {
    if (
      buffer[buffer.length - startOffset - string.length + index] !==
      string.charCodeAt(index)
    ) {
      return false
    }
  }

  return true
}

///////////////////////////////////////////////////////////////////////////////////

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices
export class SpectodaNodeSerialConnector {
  #runtimeReference

  #serialPort: NodeSerialPortType | undefined
  #criteria: Array<Criterium> | undefined

  #interfaceConnected: boolean
  #disconnecting: boolean
  #disconnectingResolve: ((value: unknown) => void) | undefined

  #timeoutMultiplier: number

  #beginCallback: ((result: boolean) => void) | undefined
  #feedbackCallback: ((success: boolean) => void) | undefined
  #dataCallback: ((data: Uint8Array) => void) | undefined

  #writing: boolean

  type: string

  constructor(runtimeReference: SpectodaRuntime) {
    this.type = 'nodeserial'

    this.#runtimeReference = runtimeReference

    this.#serialPort = undefined
    this.#criteria = undefined

    this.#interfaceConnected = false
    this.#disconnecting = false
    this.#disconnectingResolve = undefined

    this.#timeoutMultiplier = 4

    this.#beginCallback = undefined
    this.#feedbackCallback = undefined
    this.#dataCallback = undefined

    this.#writing = false
  }
  // choose one Spectoda device (user chooses which device to connect to via a popup)
  // if no criteria are set, then show all Spectoda devices visible.
  // first bonds the BLE device with the PC/Phone/Tablet if it is needed.
  // Then selects the device
  userSelect(
    criteriumArray: Array<Criterium>,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 60000
    }

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.debug(
      `SpectodaNodeSerialConnector::userSelect(criteria=${criteriaJson}, timeout=${timeoutNumber})`,
    )

    return this.autoSelect(criteriumArray, 1000, timeoutNumber)
  }

  // takes the criteria, scans for scan_period and automatically selects the device,
  // you can then connect to. This works only for BLE devices that are bond with the phone/PC/tablet
  // the app is running on OR doesnt need to be bonded in a special way.
  // if more devices are found matching the criteria, then the strongest signal wins
  // if no device is found within the timeout period, then it returns an error

  // if no criteria are provided, all Spectoda enabled devices (with all different FWs and Owners and such)
  // are eligible.

  autoSelect(
    criteriumArray: Array<Criterium>,
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

    logging.debug(
      `SpectodaNodeSerialConnector::autoSelect(criteria=${JSON.stringify(criteriumArray)}, scan_duration=${scanDurationNumber}, timeout=${timeoutNumber})`,
    )

    if (!NodeSerialPort || !NodeReadlineParser) {
      return Promise.reject('NodeSerialPortNotAvailable')
    }

    if (this.#serialPort?.isOpen) {
      logging.debug('disconnecting from autoSelect()')
      return this.disconnect().then(() => {
        return this.autoSelect(
          criteriumArray,
          scanDurationNumber,
          timeoutNumber,
        )
      })
    }

    // ! to overcome [Error: Error Resource temporarily unavailable Cannot lock port] bug when trying to create new NodeSerialPort object on the same path
    // // if (criteria && Array.isArray(criteria) && criteria.length && this.#criteria && Array.isArray(this.#criteria) && this.#criteria.length) {

    // //   let uart1 = undefined;
    // //   let uart2 = undefined;

    // //   if (criteria[0].uart || criteria[0].port || criteria[0].path) {
    // //     uart1 = criteria[0].uart || criteria[0].port || criteria[0].path || undefined;
    // //   }

    // //   if (this.#criteria[0].uart || this.#criteria[0].port || this.#criteria[0].path) {
    // //     uart2 = this.#criteria[0].uart || this.#criteria[0].port || this.#criteria[0].path || undefined;
    // //   }

    // //   if (uart1 != undefined && uart2 != undefined && uart1 == uart2) {
    // //     logging.debug("criteria is matching, keepin the last serial port object");
    // //     return Promise.resolve({  connector: this.type });
    // //   }
    // // }

    if (this.#serialPort) {
      logging.debug('unselecting from autoSelect()')
      return this.unselect().then(() => {
        return this.autoSelect(
          criteriumArray,
          scanDurationNumber,
          timeoutNumber,
        )
      })
    }

    // step 1. for the scan_period scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout,
    //         then return error

    // criteria.uart == "/dev/ttyS0"

    if (
      criteriumArray &&
      Array.isArray(criteriumArray) &&
      criteriumArray.length > 0
    ) {
      const portOptions = PORT_OPTIONS

      // TODO @immakermatty add type guard for SerialCriteria
      // @ts-expect-error TODO: fix this
      if (criteriumArray[0].baudrate) {
        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        portOptions.baudRate = criteriumArray[0].baudrate || 1500000
      }
      // TODO @immakermatty add type guard for SerialCriteria
      // @ts-expect-error TODO: fix this
      if (criteriumArray[0].path) {
        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        portOptions.path = criteriumArray[0].path
      }

      // TODO! fix TSC
      // @ts-expect-error
      this.#serialPort = new NodeSerialPort(portOptions)
      this.#criteria = criteriumArray
      logging.verbose('this.#serialPort=', this.#serialPort)
      logging.verbose('this.#criteria=', this.#criteria)

      logging.debug('serial port selected')

      return Promise.resolve({ connector: this.type })
    } //
    else {
      return this.scan(criteriumArray, scanDurationNumber).then((ports) => {
        logging.verbose('ports=', ports)

        if (ports.length === 0) {
          throw 'NoDeviceFound'
        }

        const portOptions = PORT_OPTIONS

        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        portOptions.path = ports.at(-1)?.path || ''

        logging.verbose('port_options=', portOptions)

        // TODO! fix TSC
        // @ts-expect-error
        this.#serialPort = new NodeSerialPort(portOptions)
        this.#criteria = criteriumArray
        logging.verbose('this.#serialPort=', this.#serialPort)
        logging.verbose('this.#criteria=', this.#criteria)

        return { connector: this.type }
      })
    }
  }

  selected(): Promise<Criterium | null> {
    logging.debug('SpectodaNodeSerialConnector::selected()')

    return Promise.resolve(this.#serialPort ? { connector: this.type } : null)
  }

  unselect(): Promise<null> {
    logging.debug('SpectodaNodeSerialConnector::unselect()')

    if (!this.#serialPort) {
      logging.debug('already unselected')
      return Promise.resolve(null)
    }

    if (this.#serialPort?.isOpen) {
      logging.debug('disconnecting from unselect()')
      return this.disconnect().then(() => {
        return this.unselect()
      })
    }

    this.#serialPort.removeAllListeners()
    this.#serialPort = undefined
    this.#criteria = undefined

    return Promise.resolve(null)
  }

  scan(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 7000
    }
    logging.debug(
      `SpectodaNodeSerialConnector::scan(criteria=${JSON.stringify(criteriumArray)}, scan_duration=${scanDurationNumber})`,
    )

    // returns devices like autoSelect scan() function
    return new Promise(async (resolve, reject) => {
      try {
        if (!NodeSerialPort) {
          return Promise.reject('NodeSerialPortNotAvailableOnThisPlatform')
        }
        // TODO! fix TSC
        // @ts-expect-error
        const ports = await NodeSerialPort.list()
        logging.verbose('ports=', ports)

        resolve(ports)
      } catch (error) {
        logging.error(error)
        reject(error)
      }
    })
  }

  // connect Connector to the selected Spectoda Device. Also can be used to reconnect.
  // Fails if no device is selected
  connect(
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 60000
    }
    logging.debug(
      `SpectodaNodeSerialConnector::connect(timeout=${timeoutNumber})`,
    )

    if (timeoutNumber <= 0) {
      logging.warn('Connect timeout have expired')
      return Promise.reject('ConnectionFailed')
    }

    const _start = Date.now()

    if (!this.#serialPort) {
      return Promise.reject('NotSelected')
    }

    if (this.#interfaceConnected) {
      logging.warn('Serial device already connected')
      return Promise.resolve({ connector: this.type })
    }

    const openSerialPromise = new Promise((resolve, reject) => {
      this.#serialPort?.open((error) => {
        if (error) {
          logging.error(error)
          reject('OpenSerialError')
        } else {
          logging.debug('Serial port opened')
          resolve(null)
        }
      })
    })

    return openSerialPromise
      .then(() => {
        this.#disconnecting = false

        // TODO! fix TSC
        // @ts-expect-error
        const parser = new NodeReadlineParser()

        this.#serialPort?.pipe(parser)

        const commandBytes: number[] = []

        const headerBytes: number[] = []
        let dataHeader: {
          data_type: number
          data_size: number
          data_receive_timeout: number
          data_crc32: number
          header_crc32: number
        } = {
          data_type: 0,
          data_size: 0,
          data_receive_timeout: 0,
          data_crc32: 0,
          header_crc32: 0,
        }
        const dataBytes: number[] = []

        const _notifyHeader: undefined | object = undefined
        const _notifyBytes: number[] = []

        const lineBytes: number[] = []

        const MODE_UTF8_RECEIVE = 0
        const MODE_DATA_RECEIVE = 1

        let mode = MODE_UTF8_RECEIVE

        const NEWLINE_ASCII_CODE = 10

        const decoder = new TextDecoder()

        this.#serialPort?.removeAllListeners()

        this.#serialPort?.on('open', () => {
          logging.debug('Port Opened')
        })

        this.#serialPort?.on('close', () => {
          logging.debug('Port Closed')

          if (this.#interfaceConnected) {
            this.#interfaceConnected = false
            this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
          }
        })

        this.#serialPort?.on('error', (err) => {
          logging.debug('Port Error: ', err.message)
        })

        this.#serialPort?.on('data', (chunk: Buffer) => {
          // logging.info("[data]", decoder.decode(chunk));

          for (const byte of chunk) {
            if (mode === MODE_UTF8_RECEIVE) {
              const commandBytesLength = commandBytes.push(byte)

              if (commandBytesLength >= 3) {
                if (startsWith(commandBytes, '>>>')) {
                  if (endsWith(commandBytes, '<<<\n')) {
                    if (startsWith(commandBytes, 'BEGIN', 3)) {
                      logging.warn('SERIAL >>>BEGIN<<<')
                      this.#beginCallback?.(true)
                      commandBytes.length = 0
                    } else if (startsWith(commandBytes, 'END', 3)) {
                      logging.warn('SERIAL >>>END<<<')
                      this.#beginCallback?.(false)
                      this.#feedbackCallback?.(false)
                      commandBytes.length = 0
                      this.#disconnect()
                    } else if (startsWith(commandBytes, 'READY', 3)) {
                      logging.warn('SERIAL >>>READY<<<')
                      this.#beginCallback?.(false)
                      this.#feedbackCallback?.(false)
                      commandBytes.length = 0
                      this.#disconnect()
                    } else if (startsWith(commandBytes, 'SUCCESS', 3)) {
                      logging.verbose('SERIAL >>>SUCCESS<<<')
                      this.#feedbackCallback?.(true)
                      commandBytes.length = 0
                    } else if (startsWith(commandBytes, 'FAIL', 3)) {
                      logging.info('SERIAL >>>FAIL<<<')
                      this.#feedbackCallback?.(false)
                      commandBytes.length = 0
                    } else if (startsWith(commandBytes, 'ERROR', 3)) {
                      logging.error('SERIAL >>>ERROR<<<')
                      this.#feedbackCallback?.(false)
                      commandBytes.length = 0
                    } else if (startsWith(commandBytes, 'DATA', 3)) {
                      logging.verbose('SERIAL >>>DATA<<<')
                      this.#dataCallback?.(new Uint8Array(dataBytes))

                      switch (dataHeader.data_type) {
                        case NETWORK_WRITE: {
                          logging.debug('SERIAL >>>NETWORK_WRITE<<<')

                          const DUMMY_NODESERIAL_CONNECTION =
                            SpectodaWasm.Connection.make(
                              '11:11:11:11:11:11',
                              SpectodaWasm.connector_type_t
                                .CONNECTOR_LEGACY_JS_RUNTIME,
                              SpectodaWasm.connection_rssi_t.RSSI_MAX,
                            )

                          this.#runtimeReference.spectoda_js.execute(
                            new Uint8Array(dataBytes),
                            DUMMY_NODESERIAL_CONNECTION,
                          )

                          break
                        }
                        case CLOCK_WRITE: {
                          logging.debug('SERIAL >>>CLOCK_WRITE<<<')

                          const synchronization: Synchronization =
                            SpectodaWasm.Synchronization.makeFromUint8Array(
                              new Uint8Array(dataBytes),
                            )
                          const DUMMY_NODESERIAL_CONNECTION =
                            SpectodaWasm.Connection.make(
                              '11:11:11:11:11:11',
                              SpectodaWasm.connector_type_t
                                .CONNECTOR_LEGACY_JS_RUNTIME,
                              SpectodaWasm.connection_rssi_t.RSSI_MAX,
                            )

                          this.#runtimeReference.spectoda_js.synchronize(
                            synchronization,
                            DUMMY_NODESERIAL_CONNECTION,
                          )

                          break
                        }
                        case DEVICE_WRITE: {
                          logging.debug('SERIAL >>>DEVICE_WRITE<<<')

                          const DUMMY_NODESERIAL_CONNECTION =
                            SpectodaWasm.Connection.make(
                              '11:11:11:11:11:11',
                              SpectodaWasm.connector_type_t
                                .CONNECTOR_LEGACY_JS_RUNTIME,
                              SpectodaWasm.connection_rssi_t.RSSI_MAX,
                            )

                          this.#runtimeReference.spectoda_js.request(
                            new Uint8Array(dataBytes),
                            DUMMY_NODESERIAL_CONNECTION,
                          )

                          break
                        }
                        // No default
                      }

                      commandBytes.length = 0
                      dataHeader = {
                        data_type: 0,
                        data_size: 0,
                        data_receive_timeout: 0,
                        data_crc32: 0,
                        header_crc32: 0,
                      }
                    }
                  } //
                  else if (endsWith(commandBytes, 'DATA=')) {
                    mode = MODE_DATA_RECEIVE
                    dataHeader = {
                      data_type: 0,
                      data_size: 0,
                      data_receive_timeout: 0,
                      data_crc32: 0,
                      header_crc32: 0,
                    }

                    headerBytes.length = 0
                    dataBytes.length = 0
                  } //
                  else if (commandBytes.length > '>>>SUCCESS<<<\n'.length) {
                    // ? >>>SUCCESS<<< is the longest command
                    logging.error(
                      'ERROR 342897cs: command_bytes',
                      commandBytes,
                      'data_header',
                      dataHeader,
                    )
                    commandBytes.length = 0
                  }
                }

                ////
                /* if(!starts_with(command_bytes, ">>>")) */
                else {
                  const character = commandBytes.shift() as number

                  if (character === NEWLINE_ASCII_CODE) {
                    const line = decoder.decode(new Uint8Array(lineBytes))

                    // TODO! process line
                    logging.info(line)
                    lineBytes.length = 0
                  } /* if(character !== NEWLINE_ASCII_CODE) */ else {
                    lineBytes.push(character)
                  }
                }
              }
            } else if (mode === MODE_DATA_RECEIVE) {
              if (headerBytes.length < HEADER_BYTES_SIZE) {
                headerBytes.push(byte)

                if (headerBytes.length >= HEADER_BYTES_SIZE) {
                  const tnglReader = new TnglReader(new Uint8Array(headerBytes))

                  dataHeader.data_type = tnglReader.readUint32()
                  dataHeader.data_size = tnglReader.readUint32()
                  dataHeader.data_receive_timeout = tnglReader.readUint32()
                  dataHeader.data_crc32 = tnglReader.readUint32()
                  dataHeader.header_crc32 = tnglReader.readUint32()

                  logging.verbose('data_header=', dataHeader)

                  if (dataHeader.data_size === 0) {
                    mode = MODE_UTF8_RECEIVE
                  }
                }
              } /* if (data_header) */ else {
                dataBytes.push(byte)

                if (dataBytes.length >= dataHeader.data_size) {
                  mode = MODE_UTF8_RECEIVE
                }
              }
            }
          }
        })

        return new Promise(
          (
            resolve: (result: Criterium) => void,
            reject: (error: string) => void,
          ) => {
            const timeoutHandle = setTimeout(async () => {
              logging.warn('Connection begin timeouted')
              this.#beginCallback = undefined

              await this.#disconnect().finally(() => {
                reject('ConnectTimeout')
              })
            }, timeoutNumber)

            this.#beginCallback = (result) => {
              this.#beginCallback = undefined

              clearTimeout(timeoutHandle)

              if (result) {
                logging.debug('Serial connection connected')

                setTimeout(() => {
                  if (!this.#interfaceConnected) {
                    this.#interfaceConnected = true
                    this.#runtimeReference.emit(
                      SpectodaAppEvents.PRIVATE_CONNECTED,
                    )
                  }
                  resolve({ connector: this.type })
                }, 100)
              } else {
                // logging.warn("Trying to connect again")
                // const passed = new Date().getTime() - start;
                // resolve(this.connect(timeout - passed));

                logging.debug('Serial connection failed')

                setTimeout(() => {
                  this.#disconnect().finally(() => {
                    reject('ConnectFailed')
                  })
                }, 100)
              }
            }

            try {
              this.#serialPort?.write('>>>ENABLE_SERIAL<<<\n')
            } catch {
              logging.error('ERROR asd0sd9f876')
            }
          },
        )
      })
      .catch((error) => {
        logging.error('SerialConnector connect() failed with error:', error)
        throw error
      })
  }

  connected(): Promise<Criterium | null> {
    logging.debug('SpectodaNodeSerialConnector::connected()')

    logging.verbose('this.#serialPort=', this.#serialPort)
    logging.verbose('this.#serialPort.isOpen=', this.#serialPort?.isOpen)

    return Promise.resolve(
      this.#serialPort?.isOpen ? { connector: this.type } : null,
    )
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  #disconnect() {
    logging.verbose('SpectodaNodeSerialConnector::#disconnect()')

    if (!this.#serialPort) {
      logging.debug('No Serial Port selected')
      return Promise.resolve(null)
    }

    logging.debug(
      'this.#serialPort.isOpen',
      this.#serialPort.isOpen ? 'true' : 'false',
    )

    if (this.#serialPort.isOpen) {
      logging.debug('Closing serial port...')

      return new Promise((resolve, _reject) => {
        this.#serialPort?.close((error) => {
          if (error) {
            logging.error(error)
            logging.error('ERROR asd0896fsda', error)
            resolve(null)
          } else {
            logging.debug('serial port closed')
            resolve(null)
          }
        })
      }).finally(() => {
        this.#disconnecting = false
        if (this.#disconnectingResolve !== undefined) {
          this.#disconnectingResolve(null)
        }
        if (this.#interfaceConnected) {
          this.#interfaceConnected = false
          this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
        }
      })
    }

    if (this.#disconnecting) {
      logging.warn('Serial port already disconnecting')
      // return Promise.reject("AlreadyDisconnecting");
      return Promise.resolve(null)
    }

    logging.debug('Serial Port already closed')
    return Promise.resolve(null)
  }

  disconnect(): Promise<unknown> {
    logging.debug('SpectodaNodeSerialConnector::disconnect()')

    if (!this.#serialPort) {
      logging.debug('No Serial Port selected')
      return Promise.resolve(null)
    }

    if (!this.#serialPort.isOpen) {
      logging.debug('Serial Port is not connected')
      return Promise.resolve(null)
    }

    if (this.#disconnecting) {
      logging.error('Serial port already disconnecting')
      // return Promise.reject("AlreadyDisconnecting");
      return Promise.resolve(null)
    }

    this.#disconnecting = true

    const disconnectingPromise = new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(async () => {
        logging.error('Finishing Serial TIMEOUT')

        this.#disconnectingResolve = undefined
        await this.#disconnect().finally(() => {
          reject('DisconnectTimeout')
        })
      }, 5000)

      this.#disconnectingResolve = (value: unknown) => {
        this.#disconnectingResolve = undefined
        clearTimeout(timeoutHandle)
        resolve(value)
      }

      try {
        logging.info('> Finishing Serial...')
        this.#serialPort?.write('>>>FINISH_SERIAL<<<\n')
      } catch (error) {
        logging.error('ERROR 0a9s8d0asd8f', error)
      }
    })

    return disconnectingPromise
  }

  // serial_connector_channel_type_t channel_type;
  // uint32_t packet_size;
  // uint32_t packet_receive_timeout;
  // uint32_t packet_crc32;
  // uint32_t header_crc32;

  // enum serial_connector_channel_type_t : uint32_t {
  //   NETWORK_WRITE = 1,
  //   DEVICE_WRITE = 2,
  //   CLOCK_WRITE = 3
  // };

  #initiate(
    initiateCode: number,
    payload: Uint8Array,
    tries: number,
    timeout: number,
  ): Promise<unknown> {
    logging.verbose(
      `initiate(initiate_code=${initiateCode}, payload=${payload}, tries=${tries}, timeout=${timeout})`,
    )

    if (tries <= 0) {
      logging.error('ERROR nhkw45390')
      return Promise.reject('NoCommunicationTriesLeft')
    }

    if (timeout <= 0) {
      logging.error('ERROR sauioczx98')
      return Promise.reject('CommunicationTimeout')
    }

    // TODO check if the payload is a valid Uint8Array
    if (typeof payload !== 'object' || !payload) {
      logging.error('ERROR xcv90870dsa', typeof payload)
      return Promise.reject('InvalidParameter')
    }

    if (this.#writing) {
      logging.error('Someone is already writing')
    } else {
      this.#writing = true
    }

    const packetTimeoutMin = 50
    let packetTimeout =
      payload.length * this.#timeoutMultiplier + packetTimeoutMin

    if (!packetTimeout || packetTimeout < packetTimeoutMin) {
      logging.warn('Packet Timeout is too small:', packetTimeout)
      packetTimeout = packetTimeoutMin
    }

    if (timeout < packetTimeout) {
      timeout = packetTimeout
    }

    logging.verbose(`initiate_code=${initiateCode}`)
    logging.verbose(`payload.length=${payload.length}`)
    logging.verbose(`packet_timeout=${packetTimeout}`)

    const headerWriter = new TnglWriter(32)

    headerWriter.writeUint32(initiateCode)
    headerWriter.writeUint32(payload.length)
    headerWriter.writeUint32(packetTimeout)
    headerWriter.writeUint32(crc32(payload))
    headerWriter.writeUint32(crc32(new Uint8Array(headerWriter.bytes.buffer)))

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined

      const doWrite = async () => {
        timeoutHandle = setTimeout(() => {
          logging.error('ERROR asvcb8976a', 'Serial response timeout')

          if (this.#feedbackCallback) {
            this.#feedbackCallback(false)
          } else {
            this.#disconnect()
              .catch(() => {
                logging.error('ERROR fdsa8796', 'Failed to disconnect')
              })
              .finally(() => {
                reject('ResponseTimeout')
              })
          }
        }, timeout + 1000) // +1000 for the controller to response timeout if reeive timeoutes

        try {
          await this.#serialPort?.write(Buffer.from(headerWriter.bytes.buffer))
          await this.#serialPort?.write(Buffer.from(payload), 'utf8')
        } catch (e) {
          logging.error('ERROR 0ads8F67', e)
          reject(e)
        }
      }

      this.#feedbackCallback = (success: boolean) => {
        this.#feedbackCallback = undefined

        clearTimeout(timeoutHandle)

        if (success) {
          resolve(null)
        } else {
          //try to write it once more
          setTimeout(() => {
            try {
              tries -= 1
              timeout -= packetTimeout

              if (tries > 0 && timeout > 0) {
                doWrite()
              } else {
                reject('WriteFailed')
              }
            } catch (e) {
              reject(e)
            }
          }, 100) // 100ms to be safe
        }
      }

      doWrite()
    }).finally(() => {
      this.#writing = false
    })
  }

  #write(channelType: number, payload: Uint8Array, timeout: number) {
    return this.#initiate(CODE_WRITE + channelType, payload, 10, timeout)
  }

  #read(channelType: number, timeout: number): Promise<Uint8Array> {
    let response = new Uint8Array()

    this.#dataCallback = (data) => {
      response = data
      this.#dataCallback = undefined
    }

    return this.#initiate(
      CODE_READ + channelType,
      new Uint8Array(),
      10,
      timeout,
    ).then(() => {
      return response
    })
  }

  #request(
    channelType: number,
    payload: Uint8Array,
    readResponse: boolean,
    timeout: number,
  ): Promise<Uint8Array | null> {
    return this.#write(channelType, payload, timeout).then(() => {
      if (readResponse) {
        return this.#read(channelType, timeout)
      } else {
        return null
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
    logging.debug(
      `SpectodaNodeSerialConnector::deliver(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payloadBytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payloadBytes, timeoutNumber)
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
    logging.debug(
      `SpectodaNodeSerialConnector::transmit(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payloadBytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payloadBytes, timeoutNumber)
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
    logging.debug(
      `SpectodaNodeSerialConnector::request(payload.length=${payloadBytes.length}, read_response=${
        readResponse ? 'true' : 'false'
      }, timeout=${timeoutNumber})`,
    )

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    // TODO make this check on Interface level if its not already
    if (!payloadBytes) {
      return Promise.reject('InvalidPayload')
    }

    return this.#request(
      CHANNEL_DEVICE,
      payloadBytes,
      readResponse,
      timeoutNumber,
    )
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug(
      `SpectodaNodeSerialConnector::setClock(clock.millis=${clock.millis()})`,
    )

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          await this.#write(
            CHANNEL_CLOCK,
            new Uint8Array(toBytes(clock.millis(), 8)),
            100,
          )
          logging.debug('Clock write success')
          resolve(null)
          return
        } catch {
          logging.debug('Clock write failed')
          await sleep(100)
        }
      }

      reject('ClockWriteFailed')
      return
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.debug('SpectodaNodeSerialConnector::getClock()')

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          const bytes = await this.#read(CHANNEL_CLOCK, 100)

          const reader = new TnglReader(bytes)
          const timestamp = reader.readUint64()

          // const timestamp = await this.#promise;
          logging.debug('Clock read success:', timestamp)
          resolve(new TimeTrack(timestamp))
          return
        } catch (e) {
          logging.warn('Clock read failed:', e)

          if (e === 'WriteFailed') {
            reject('ClockReadFailed')
            return
          }
        }

        await sleep(100)
      }

      reject('ClockReadFailed')
      return
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers
  updateFW(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false
    logging.debug(
      `SpectodaNodeSerialConnector::updateFW(firmware_bytes.length=${firmwareBytes.length}, skipReboot=${skipReboot})`,
    )

    if (!this.#serialPort) {
      logging.warn('Serial Port is null')
      return Promise.reject('UpdateFailed')
    }

    logging.info('> Writing Firmware to Controller...')

    return new Promise(async (resolve, reject) => {
      const chunkSize = 3984 // must be modulo 16

      this.#timeoutMultiplier = 8

      let indexFrom = 0
      let indexTo = chunkSize

      let written = 0

      logging.setLoggingLevel(logging.level - 1)

      logging.debug('OTA UPDATE')

      const startTimestamp = Date.now()

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.debug('OTA RESET')

          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_OTA_RESET,
            0x00,
            ...numberToBytes(0x00000000, 4),
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.debug('OTA BEGIN')

          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_OTA_BEGIN,
            0x00,
            ...numberToBytes(firmwareBytes.length, 4),
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)
        //===========// WRITE //===========//
        logging.debug('OTA WRITE')

        while (written < firmwareBytes.length) {
          if (indexTo > firmwareBytes.length) {
            indexTo = firmwareBytes.length
          }

          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_OTA_WRITE,
            0x00,
            ...numberToBytes(written, 4),
            ...firmwareBytes.slice(indexFrom, indexTo),
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
          written += indexTo - indexFrom

          const percentage =
            Math.floor((written * 10000) / firmwareBytes.length) / 100

          logging.info(`${percentage}%`)

          this.#runtimeReference.emit(
            SpectodaAppEvents.OTA_PROGRESS,
            percentage,
          )

          indexFrom += chunkSize
          indexTo = indexFrom + chunkSize
        }

        await sleep(100)

        {
          //===========// END //===========//
          logging.debug('OTA END')

          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_OTA_END,
            0x00,
            ...numberToBytes(written, 4),
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        logging.info(
          'Firmware written in ' +
            (Date.now() - startTimestamp) / 1000 +
            ' seconds',
        )

        await sleep(2000)

        if (!skipReboot) {
          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST,
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        } else {
          logging.info('Firmware written, skipping reboot as requested')
        }

        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
        resolve(null)
      } catch (e) {
        logging.error('Error during OTA:', e)
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
        reject('UpdateFailed')
      }
    }).finally(() => {
      this.#timeoutMultiplier = 4
      logging.setLoggingLevel(logging.level + 1)
    })
  }

  cancel(): void {
    logging.debug('SpectodaNodeSerialConnector::cancel()')
    // TODO implement
  }

  destroy(): Promise<unknown> {
    logging.debug('SpectodaNodeSerialConnector::destroy()')

    //this.#runtimeReference = null; // dont know if I need to destroy this reference.. But I guess I dont need to?
    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `SpectodaNodeSerialConnector::sendExecute(command_bytes.length=${commandBytes.length}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_NETWORK, commandBytes, 1000)
  }

  // bool // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.debug(
      `SpectodaNodeSerialConnector::sendRequest(request_bytecode.length=${requestBytecode.length}, destination_connection=${destinationConnection})`,
    )

    // TODO if many connections can be opened, then look for the right one
    if (
      destinationConnection.connector_type !==
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_DEVICE, requestBytecode, 1000)
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(
    synchronization: Synchronization,
    sourceConnection: Connection,
  ) {
    logging.debug(
      `SpectodaNodeSerialConnector::sendSynchronize(synchronization=${JSON.stringify(synchronization)}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_CLOCK, synchronization.toUint8Array(), 1000)
  }
}
