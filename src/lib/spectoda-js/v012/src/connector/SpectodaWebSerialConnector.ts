// TODO Fix eslint + typescript [DEV-4737]
// @ts-nocheck
// npm install --save @types/w3c-web-serial

import { crc32, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { TnglWriter } from '../../TnglWriter'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import type { Criterium } from '../types/primitives'
import type { Connection, Synchronization } from '../types/wasm'

// ! ======= from "@types/w3c-web-serial" =======

/*~ https://wicg.github.io/serial/#dom-paritytype */
type ParityType = 'none' | 'even' | 'odd'

/*~ https://wicg.github.io/serial/#dom-flowcontroltype */
type FlowControlType = 'none' | 'hardware'

/*~ https://wicg.github.io/serial/#dom-serialoptions */
type SerialOptions = {
  baudRate: number
  dataBits?: number | undefined
  stopBits?: number | undefined
  parity?: ParityType | undefined
  bufferSize?: number | undefined
  flowControl?: FlowControlType | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialoutputsignals */
type SerialOutputSignals = {
  dataTerminalReady?: boolean | undefined
  requestToSend?: boolean | undefined
  break?: boolean | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialinputsignals */
type SerialInputSignals = {
  dataCarrierDetect: boolean
  clearToSend: boolean
  ringIndicator: boolean
  dataSetReady: boolean
}

/*~ https://wicg.github.io/serial/#serialportinfo-dictionary */
type SerialPortInfo = {
  usbVendorId?: number | undefined
  usbProductId?: number | undefined
  /** If the port is a service on a Bluetooth device this member will be a BluetoothServiceUUID
   * containing the service class UUID. Otherwise it will be undefined. */
  bluetoothServiceClassId?: number | string | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialport */
declare class SerialPort extends EventTarget {
  onconnect: ((this: this, ev: Event) => any) | null
  ondisconnect: ((this: this, ev: Event) => any) | null
  /** A flag indicating the logical connection state of serial port */
  readonly connected: boolean
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null

  open(options: SerialOptions): Promise<void>
  setSignals(signals: SerialOutputSignals): Promise<void>
  getSignals(): Promise<SerialInputSignals>
  getInfo(): SerialPortInfo
  close(): Promise<void>
  forget(): Promise<void>

  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (this: this, ev: Event) => any,
    useCapture?: boolean,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'connect' | 'disconnect',
    callback: (this: this, ev: Event) => any,
    useCapture?: boolean,
  ): void
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void
}

/*~ https://wicg.github.io/serial/#dom-serialportfilter */
type SerialPortFilter = {
  usbVendorId?: number | undefined
  usbProductId?: number | undefined
  bluetoothServiceClassId?: number | string | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialportrequestoptions */
type SerialPortRequestOptions = {
  filters?: SerialPortFilter[] | undefined
  /** A list of BluetoothServiceUUID values representing Bluetooth service class IDs.
   * Bluetooth ports with custom service class IDs are excluded from the list of ports
   * presented to the user unless the service class ID is included in this list.
   *
   * {@link https://wicg.github.io/serial/#serialportrequestoptions-dictionary} */
  allowedBluetoothServiceClassIds?: Array<number | string> | undefined
}

/*~ https://wicg.github.io/serial/#dom-serial */
declare class Serial extends EventTarget {
  onconnect: ((this: this, ev: Event) => any) | null
  ondisconnect: ((this: this, ev: Event) => any) | null

  getPorts(): Promise<SerialPort[]>
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (this: this, ev: Event) => any,
    useCapture?: boolean,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'connect' | 'disconnect',
    callback: (this: this, ev: Event) => any,
    useCapture?: boolean,
  ): void
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void
}

/*~ https://wicg.github.io/serial/#extensions-to-the-navigator-interface */
type Navigator = {
  readonly serial: Serial
}

/*~ https://wicg.github.io/serial/#extensions-to-workernavigator-interface */
type WorkerNavigator = {
  readonly serial: Serial
}

// ! ======= from "@types/w3c-web-serial" =======

type WebSerialPort = SerialPort

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_PORT_OPTIONS: SerialOptions = {
  baudRate: 1500000,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
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

export class SpectodaWebSerialConnector {
  #runtimeReference

  #serialPort: SerialPort | undefined
  #criteria: Array<Criterium> | undefined
  #portOptions: SerialOptions

  #interfaceConnected: boolean
  #disconnecting: boolean

  #timeoutMultiplier: number

  #beginCallback: ((result: boolean) => void) | undefined
  #feedbackCallback: ((success: boolean) => void) | undefined
  #dataCallback: ((data: Uint8Array) => void) | undefined

  #writing: boolean

  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  type: string

  constructor(runtimeReference: SpectodaRuntime) {
    this.type = 'webserial'

    this.#runtimeReference = runtimeReference

    this.#serialPort = undefined
    this.#criteria = undefined
    this.#portOptions = DEFAULT_PORT_OPTIONS

    this.#interfaceConnected = false
    this.#disconnecting = false

    this.#timeoutMultiplier = 4

    this.#beginCallback = undefined
    this.#feedbackCallback = undefined
    this.#dataCallback = undefined

    this.#writing = false
  }

  userSelect(
    criteriumArray: Array<Criterium>,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 60000
    }

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.debug(
      `SpectodaWebSerialConnector::userSelect(criteria=${criteriaJson}, timeout=${timeoutNumber})`,
    )

    return new Promise(async (resolve, reject) => {
      try {
        const port = await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FTDI
            { usbVendorId: 0x0403, usbProductId: 0x6010 }, // FTDI 2232
            { usbVendorId: 0x0403, usbProductId: 0x6011 }, // FTDI 4232
            { usbVendorId: 0x0403, usbProductId: 0x6014 }, // FTDI 232H
            { usbVendorId: 0x0403, usbProductId: 0x6015 }, // FTDI 230X
            { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
            { usbVendorId: 0x1a86, usbProductId: 0x5523 }, // CH341
            { usbVendorId: 0x1a86, usbProductId: 0x55d4 }, // CH9102F
            { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP210x
            { usbVendorId: 0x10c4, usbProductId: 0xea61 }, // CP210x
            { usbVendorId: 0x10c4, usbProductId: 0xea63 }, // CP210x
            { usbVendorId: 0x067b, usbProductId: 0x2303 }, // Prolific
            { usbVendorId: 0x067b, usbProductId: 0x2304 }, // Prolific
            { usbVendorId: 0x067b, usbProductId: 0x0611 }, // Prolific
            { usbVendorId: 0x04b4, usbProductId: 0x0002 }, // Cypress
            { usbVendorId: 0x04b4, usbProductId: 0x0003 }, // Cypress
            { usbVendorId: 0x04b4, usbProductId: 0xf139 }, // Cypress
            { usbVendorId: 0x04b4, usbProductId: 0xea61 }, // Cypress
            { usbVendorId: 0x1bc7, usbProductId: 0x0020 }, // Teensyduino
            { usbVendorId: 0x1bc7, usbProductId: 0x0021 }, // Teensyduino
            { usbVendorId: 0x1bc7, usbProductId: 0x0023 }, // Teensyduino
          ],
        })

        this.#serialPort = port
        this.#criteria = criteriumArray
        resolve({ connector: this.type })
      } catch (error) {
        logging.error('userSelect failed:', error)
        reject(error)
      }
    })
  }

  autoSelect(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    logging.debug(
      `SpectodaWebSerialConnector::autoSelect(criteria=${JSON.stringify(criteriumArray)}, scan_duration=${scanDurationNumber}, timeout=${timeoutNumber})`,
    )

    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 1500
    }
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
    }

    logging.debug(
      `SpectodaWebSerialConnector::autoSelect(criteria=${JSON.stringify(criteriumArray)}, scan_duration=${scanDurationNumber}, timeout=${timeoutNumber})`,
    )

    return new Promise<Criterium | null>(async (resolve, reject) => {
      try {
        const ports = await navigator.serial.getPorts()

        logging.debug('Available ports:', ports)

        if (ports.length === 0) {
          logging.warn('No previously selected ports available')
          reject('NoDeviceFound')
          return
        }

        this.#serialPort = ports[0]
        this.#criteria = criteriumArray
        resolve({ connector: this.type })
      } catch (error) {
        logging.error('autoSelect failed:', error)
        reject(error)
      }
    }).catch((_error) => {
      // TODO remove this once we have a proper auto-select mechanism
      // TODO it is not desirable to call userSelect() if you want to auto-select
      logging.warn(
        'SpectodaWebSerialConnector: autoSelect() failed. Calling userSelect() instead.',
      )
      return this.userSelect(criteriumArray, timeoutNumber)
    })
  }

  selected(): Promise<Criterium | null> {
    logging.debug('SpectodaWebSerialConnector::selected()')

    return Promise.resolve(this.#serialPort ? { connector: this.type } : null)
  }

  unselect(): Promise<null> {
    logging.debug('SpectodaWebSerialConnector::unselect()')

    if (!this.#serialPort) {
      logging.debug('already unselected')
      return Promise.resolve(null)
    }

    if (this.#serialPort && this.#interfaceConnected) {
      logging.debug('disconnecting from unselect()')
      return this.disconnect().then(() => {
        return this.unselect()
      })
    }

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
      `SpectodaWebSerialConnector::scan(criteria=${JSON.stringify(criteriumArray)}, scan_duration=${scanDurationNumber})`,
    )

    return new Promise(async (resolve, reject) => {
      try {
        const ports = await navigator.serial.getPorts()

        logging.debug('ports=', ports)
        resolve(ports.map((port) => ({ connector: this.type, port })))
      } catch (error) {
        logging.error(error)
        reject(error)
      }
    })
  }

  async connect(
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 2500
    }
    logging.debug(
      `SpectodaWebSerialConnector::connect(timeout=${timeoutNumber})`,
    )

    if (timeoutNumber <= 0) {
      logging.warn('Connect timeout has expired')
      throw 'ConnectionFailed'
    }

    if (!this.#serialPort) {
      throw 'NotSelected'
    }

    if (this.#interfaceConnected) {
      logging.warn('Serial device already connected')
      return { connector: this.type }
    }

    return new Promise(async (resolve, reject) => {
      let isResolved = false

      const cleanup = async () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        this.#beginCallback = undefined
        await this.#disconnect()
      }

      const resolveOnce = (value: Criterium) => {
        if (!isResolved) {
          isResolved = true
          resolve(value)
        }
      }

      const rejectOnce = (reason: any) => {
        if (!isResolved) {
          isResolved = true
          reject(reason)
        }
      }

      let timeoutHandle: NodeJS.Timeout | undefined = setTimeout(async () => {
        logging.warn('Connection begin timeout')
        await cleanup()
        rejectOnce('ConnectTimeout')
      }, timeoutNumber)

      try {
        const port = this.#serialPort

        if (!port) {
          await cleanup()
          rejectOnce('InternalError')
          return
        }

        logging.debug('this.#criteria=', this.#criteria)

        // TODO properly handle the criteria
        if (this.#criteria && this.#criteria.length > 0) {
          // TODO Fix types
          // @ts-expect-error
          if (this.#criteria[0].baudrate) {
            // TODO Fix types
            // @ts-expect-error
            this.#portOptions.baudRate = this.#criteria[0].baudrate
          }
          // TODO Fix types
          // @ts-expect-error
          if (this.#criteria[0].baudRate) {
            // TODO Fix types
            // @ts-expect-error
            this.#portOptions.baudRate = this.#criteria[0].baudRate
          }
        }

        logging.info(
          `> Opening Serial at baudrate ${this.#portOptions.baudRate}...`,
        )
        await port.open(this.#portOptions)
        logging.debug('serial port opened')

        if (!port.readable || !port.writable) {
          logging.error('port.readable or port.writable == null')
          await cleanup()
          rejectOnce('InternalError')
          return
        }

        // Flush the serial buffer with timeout
        try {
          logging.debug('Flushing Serial...')
          const tempReader = port.readable.getReader()

          try {
            // Add timeout to the read operation
            await Promise.race([
              tempReader.read(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('FlushTimeout')), 1000),
              ),
            ])
          } catch (error) {
            logging.warn('Flush timeout or error:', error)
          } finally {
            // Always release the reader
            try {
              await tempReader.cancel()
              tempReader.releaseLock()
            } catch (releaseError) {
              logging.warn('Error releasing temp reader:', releaseError)
            }
          }
          logging.debug('Serial buffer flushed.')
        } catch (error) {
          logging.error('Error during serial buffer flush:', error)
          // Continue even if flush fails - not critical
        }

        this.#disconnecting = false

        try {
          this.#writer = port.writable.getWriter()
          this.#reader = port.readable.getReader()
        } catch (error) {
          logging.error('Error getting reader/writer:', error)
          await cleanup()
          rejectOnce('ConnectionFailed')
          return
        }

        const decoder = new TextDecoder()

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
        const lineBytes: number[] = []

        const MODE_UTF8_RECEIVE = 0
        const MODE_DATA_RECEIVE = 1

        let mode = MODE_UTF8_RECEIVE

        const NEWLINE_ASCII_CODE = 10

        const readLoop = async () => {
          if (!this.#reader) {
            logging.error('this.#reader == null')
            await cleanup()
            rejectOnce('InternalError')
            return
          }

          try {
            while (true) {
              const { value, done } = await this.#reader.read()

              if (done) {
                logging.warn('Serial read stream closed')
                // Stream closed - trigger proper disconnect
                if (this.#interfaceConnected) {
                  this.#interfaceConnected = false
                  this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
                }
                break
              }
              if (value) {
                for (const byte of value) {
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
                            logging.debug('SERIAL >>>SUCCESS<<<')
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
                            logging.debug('SERIAL >>>DATA<<<')
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
                        } else if (endsWith(commandBytes, 'DATA=')) {
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
                        } else if (
                          commandBytes.length > '>>>SUCCESS<<<\n'.length
                        ) {
                          logging.error(
                            'ERROR 342897cs: command_bytes',
                            commandBytes,
                            'data_header',
                            dataHeader,
                          )
                          commandBytes.length = 0
                        }
                      } else {
                        const character = commandBytes.shift() as number

                        if (character === NEWLINE_ASCII_CODE) {
                          const line = decoder.decode(new Uint8Array(lineBytes))

                          logging.info(line)
                          lineBytes.length = 0
                        } else {
                          lineBytes.push(character)
                        }
                      }
                    }
                  } else if (mode === MODE_DATA_RECEIVE) {
                    if (headerBytes.length < HEADER_BYTES_SIZE) {
                      headerBytes.push(byte)

                      if (headerBytes.length >= HEADER_BYTES_SIZE) {
                        const tnglReader = new TnglReader(
                          new Uint8Array(headerBytes),
                        )

                        dataHeader.data_type = tnglReader.readUint32()
                        dataHeader.data_size = tnglReader.readUint32()
                        dataHeader.data_receive_timeout =
                          tnglReader.readUint32()
                        dataHeader.data_crc32 = tnglReader.readUint32()
                        dataHeader.header_crc32 = tnglReader.readUint32()

                        logging.debug('data_header=', dataHeader)

                        if (dataHeader.data_size === 0) {
                          mode = MODE_UTF8_RECEIVE
                        }
                      }
                    } else {
                      dataBytes.push(byte)

                      if (dataBytes.length >= dataHeader.data_size) {
                        mode = MODE_UTF8_RECEIVE
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            logging.error('Read loop error:', error)

            if (
              error instanceof Error &&
              (error.message.includes('device has been lost') ||
                error.message.includes('device was disconnected'))
            ) {
              logging.warn('Device disconnected unexpectedly')
            }

            await cleanup()
            rejectOnce('DeviceDisconnected')
          }
        }

        readLoop().catch(async (error) => {
          logging.error('Read loop failed:', error)
          await cleanup()
          rejectOnce('ReadLoopFailed')
        })

        this.#beginCallback = (result) => {
          this.#beginCallback = undefined
          clearTimeout(timeoutHandle)
          timeoutHandle = undefined

          if (result) {
            logging.debug('Serial connection connected')

            // Set connected state and resolve
            this.#interfaceConnected = true
            this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
            resolveOnce({ connector: this.type })
          } else {
            logging.warn('Serial connection failed')
            cleanup().then(() => {
              rejectOnce('ConnectFailed')
            })
          }
        }

        try {
          await this.#writeString('>>>ENABLE_SERIAL<<<\n')
        } catch (error) {
          logging.error('Error sending initial command:', error)
          await cleanup()
          rejectOnce(error)
        }
      } catch (error) {
        logging.error('Connect failed:', error)
        await cleanup()
        rejectOnce(error)
      }
    })
  }

  connected(): Promise<Criterium | null> {
    logging.debug('SpectodaWebSerialConnector::connected()')
    return Promise.resolve(
      this.#serialPort && this.#interfaceConnected
        ? { connector: this.type }
        : null,
    )
  }

  disconnect(): Promise<unknown> {
    logging.debug('SpectodaWebSerialConnector::disconnect()')

    if (!this.#serialPort) {
      logging.warn('No Serial Port selected to disconnect')
      return Promise.resolve(null)
    }

    // Check if the port is open
    if (!this.#serialPort.readable && !this.#serialPort.writable) {
      logging.warn('Serial Port is not open to disconnect')
      return Promise.resolve(null)
    }

    if (this.#disconnecting) {
      logging.warn('Serial port already disconnecting')
      return Promise.resolve(null)
    }

    this.#disconnecting = true

    return new Promise(async (resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        logging.error('Finishing Serial TIMEOUT')
        this.#disconnecting = false
        reject('DisconnectTimeout')
      }, 5000)

      try {
        logging.debug('Finishing Serial...')
        await this.#writeString('>>>FINISH_SERIAL<<<\n')
      } catch (error) {
        logging.error('Error during finish:', error)
      }

      try {
        logging.debug('Disconnecting Serial...')

        await this.#writer?.close()
        this.#writer = undefined
        await this.#reader?.cancel()
        this.#reader = undefined
        await this.#serialPort?.close()
        resolve(null)
      } catch (error) {
        logging.error('Error during disconnect:', error)
        reject(error)
      } finally {
        clearTimeout(timeoutHandle)
        this.#disconnecting = false
        if (this.#interfaceConnected) {
          this.#interfaceConnected = false
          this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
        }
      }
    })
  }

  async #disconnect(): Promise<unknown> {
    if (!this.#serialPort) {
      logging.debug('No Serial Port selected')
      return null
    }

    if (this.#disconnecting) {
      logging.warn('Serial port already disconnecting')
      return null
    }

    this.#disconnecting = true

    try {
      logging.debug('Closing serial port...')

      // Close writer if it exists
      if (this.#writer) {
        try {
          await this.#writer.close()
        } catch (error) {
          logging.warn('Error closing writer:', error)
        }
        this.#writer = undefined
      }

      // Cancel reader if it exists
      if (this.#reader) {
        try {
          await this.#reader.cancel()
        } catch (error) {
          logging.warn('Error canceling reader:', error)
        }
        this.#reader = undefined
      }

      // Close port if it's still open
      if (this.#serialPort.readable || this.#serialPort.writable) {
        try {
          await this.#serialPort.close()
        } catch (error) {
          logging.warn('Error closing serial port:', error)
        }
      }

      return null
    } catch (error) {
      logging.error('Error during #disconnect:', error)
      throw error
    } finally {
      this.#disconnecting = false
      if (this.#interfaceConnected) {
        this.#interfaceConnected = false
        this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
      }
    }
  }

  #writeString(data: string): Promise<void> {
    const encoder = new TextEncoder()
    const encodedData = encoder.encode(data)

    return this.#writer?.write(encodedData) || Promise.resolve()
  }

  #initiate(
    initiateCode: number,
    payload: Uint8Array,
    tries: number,
    timeout: number,
  ): Promise<unknown> {
    // Early check for connection state
    if (!this.#interfaceConnected || !this.#writer) {
      logging.warn('Serial not connected, cannot initiate')
      return Promise.reject('DeviceDisconnected')
    }

    if (tries <= 0) {
      logging.error('ERROR nhkw45390')
      return Promise.reject('NoCommunicationTriesLeft')
    }

    if (timeout <= 0) {
      logging.error('ERROR sauioczx98')
      return Promise.reject('CommunicationTimeout')
    }

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

    logging.debug(`initiate_code=${initiateCode}`)
    logging.debug(`payload.length=${payload.length}`)
    logging.debug(`packet_timeout=${packetTimeout}`)

    const headerWriter = new TnglWriter(32)

    headerWriter.writeUint32(initiateCode)
    headerWriter.writeUint32(payload.length)
    headerWriter.writeUint32(packetTimeout)
    headerWriter.writeUint32(crc32(payload))
    headerWriter.writeUint32(crc32(new Uint8Array(headerWriter.bytes.buffer)))

    return new Promise(async (resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined
      let isResolved = false

      const rejectOnce = (reason: unknown) => {
        if (!isResolved) {
          isResolved = true
          this.#feedbackCallback = undefined
          clearTimeout(timeoutHandle)
          reject(reason)
        }
      }

      const resolveOnce = (value: unknown) => {
        if (!isResolved) {
          isResolved = true
          this.#feedbackCallback = undefined
          clearTimeout(timeoutHandle)
          resolve(value)
        }
      }

      const setupFeedbackCallback = () => {
        this.#feedbackCallback = (success: boolean) => {
          clearTimeout(timeoutHandle)

          if (success) {
            resolveOnce(null)
          } else {
            // Check if we should retry
            if (!this.#interfaceConnected || !this.#writer) {
              rejectOnce('DeviceDisconnected')
              return
            }

            setTimeout(() => {
              try {
                tries -= 1
                timeout -= packetTimeout

                if (tries > 0 && timeout > 0 && this.#interfaceConnected) {
                  doWrite()
                } else {
                  rejectOnce('WriteFailed')
                }
              } catch (e) {
                rejectOnce(e)
              }
            }, 100)
          }
        }
      }

      const doWrite = async () => {
        if (isResolved) {
          return
        }

        // Check connection state before each write attempt
        if (!this.#interfaceConnected) {
          logging.warn('Connection lost before write attempt')
          rejectOnce('DeviceDisconnected')
          return
        }

        if (!this.#writer) {
          logging.warn('Writer not available')
          rejectOnce('DeviceDisconnected')
          return
        }

        // Set up feedback callback before each write attempt
        setupFeedbackCallback()

        timeoutHandle = setTimeout(() => {
          logging.error('Serial response timeout')

          if (this.#feedbackCallback) {
            this.#feedbackCallback(false)
          } else {
            this.#disconnect()
              .catch(() => {
                logging.error('Failed to disconnect')
              })
              .finally(() => {
                rejectOnce('ResponseTimeout')
              })
          }
        }, timeout + 1000)

        try {
          const writer = this.#writer
          if (!writer) {
            rejectOnce('DeviceDisconnected')
            return
          }

          await writer.write(new Uint8Array(headerWriter.bytes.buffer))
          
          if (isResolved) {
            return
          }
          
          // Re-check writer in case it was closed during the first write
          if (!this.#writer) {
            rejectOnce('DeviceDisconnected')
            return
          }
          
          await this.#writer.write(payload)
        } catch (e) {
          logging.error('Serial write error:', e)
          rejectOnce(e)
          return
        }
      }

      doWrite()
    }).finally(() => {
      this.#writing = false
    })
  }

  #write(
    channelType: number,
    payload: Uint8Array,
    timeout: number,
  ): Promise<unknown> {
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

  deliver(
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
    }
    logging.debug(
      `SpectodaWebSerialConnector::deliver(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payloadBytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payloadBytes, timeoutNumber)
  }

  transmit(
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 1000
    }
    logging.debug(
      `SpectodaWebSerialConnector::transmit(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payloadBytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payloadBytes, timeoutNumber)
  }

  request(
    payloadBytes: Uint8Array,
    readResponse: boolean,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 10000
    }
    logging.debug(
      `SpectodaWebSerialConnector::request(payload.length=${payloadBytes.length}, read_response=${
        readResponse ? 'true' : 'false'
      }, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

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

  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug(
      `SpectodaWebSerialConnector::setClock(clock.millis=${clock.millis()})`,
    )

    if (!this.#serialPort || !this.#interfaceConnected) {
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

  getClock(): Promise<TimeTrack> {
    logging.debug('SpectodaWebSerialConnector::getClock()')

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          const bytes = await this.#read(CHANNEL_CLOCK, 100)

          const reader = new TnglReader(bytes)
          const timestamp = reader.readUint64()

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

  updateFW(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false
    logging.debug(
      `SpectodaWebSerialConnector::updateFW(firmware_bytes.length=${firmwareBytes.length}, skipReboot=${skipReboot})`,
    )

    if (!this.#serialPort) {
      logging.warn('Serial Port is null')
      return Promise.reject('UpdateFailed')
    }

    logging.info('> Writing Firmware to Controller...')

    return new Promise(async (resolve, reject) => {
      const chunkSize = 3984

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
          logging.debug('OTA BEGIN')

          const bytes = new Uint8Array([
            COMMAND_FLAGS.FLAG_OTA_BEGIN,
            0x00,
            ...numberToBytes(firmwareBytes.length, 4),
          ])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)
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
    logging.debug('SpectodaWebSerialConnector::cancel()')
    // TODO implement
  }

  destroy(): Promise<unknown> {
    logging.debug('SpectodaWebSerialConnector::destroy()')

    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
  }

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `SpectodaWebSerialConnector::sendExecute(command_bytes=${commandBytes}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_NETWORK, commandBytes, 1000)
  }

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.debug(
      `SpectodaWebSerialConnector::sendRequest(request_bytecode=${requestBytecode}, destination_connection=${destinationConnection})`,
    )

    if (
      destinationConnection.connector_type !==
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_DEVICE, requestBytecode, 1000)
  }

  sendSynchronize(
    synchronization: Synchronization,
    sourceConnection: Connection,
  ) {
    logging.debug(
      `SpectodaWebSerialConnector::sendSynchronize(synchronization=${JSON.stringify(synchronization)}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_CLOCK, synchronization.toUint8Array(), 1000)
  }
}
