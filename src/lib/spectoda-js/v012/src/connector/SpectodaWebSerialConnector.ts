// TODO Fix eslint + typescript [DEV-4737]
/* eslint-disable */
// @ts-nocheck
// npm install --save @types/w3c-web-serial

import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { TnglWriter } from '../../TnglWriter'
import { crc32, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaTypes } from '../types/primitives'
import { Connection, Synchronization } from '../types/wasm'
import { SpectodaAppEvents } from '../types/app-events'

// ! ======= from "@types/w3c-web-serial" =======

/*~ https://wicg.github.io/serial/#dom-paritytype */
type ParityType = 'none' | 'even' | 'odd'

/*~ https://wicg.github.io/serial/#dom-flowcontroltype */
type FlowControlType = 'none' | 'hardware'

/*~ https://wicg.github.io/serial/#dom-serialoptions */
interface SerialOptions {
  baudRate: number
  dataBits?: number | undefined
  stopBits?: number | undefined
  parity?: ParityType | undefined
  bufferSize?: number | undefined
  flowControl?: FlowControlType | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialoutputsignals */
interface SerialOutputSignals {
  dataTerminalReady?: boolean | undefined
  requestToSend?: boolean | undefined
  break?: boolean | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialinputsignals */
interface SerialInputSignals {
  dataCarrierDetect: boolean
  clearToSend: boolean
  ringIndicator: boolean
  dataSetReady: boolean
}

/*~ https://wicg.github.io/serial/#serialportinfo-dictionary */
interface SerialPortInfo {
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

  addEventListener(type: 'connect' | 'disconnect', listener: (this: this, ev: Event) => any, useCapture?: boolean): void
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
interface SerialPortFilter {
  usbVendorId?: number | undefined
  usbProductId?: number | undefined
  bluetoothServiceClassId?: number | string | undefined
}

/*~ https://wicg.github.io/serial/#dom-serialportrequestoptions */
interface SerialPortRequestOptions {
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
  addEventListener(type: 'connect' | 'disconnect', listener: (this: this, ev: Event) => any, useCapture?: boolean): void
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
interface Navigator {
  readonly serial: Serial
}

/*~ https://wicg.github.io/serial/#extensions-to-workernavigator-interface */
interface WorkerNavigator {
  readonly serial: Serial
}

// ! ======= from "@types/w3c-web-serial" =======

type WebSerialPort = SerialPort

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_PORT_OPTIONS: SerialOptions = {
  baudRate: 921600,
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

const UNKNOWN_PACKET = 0

const NETWORK_WRITE = CODE_WRITE + CHANNEL_NETWORK + COMMAND
const DEVICE_WRITE = CODE_WRITE + CHANNEL_DEVICE + COMMAND
const CLOCK_WRITE = CODE_WRITE + CHANNEL_CLOCK + COMMAND
const NETWORK_READ = CODE_READ + CHANNEL_NETWORK + COMMAND
const DEVICE_READ = CODE_READ + CHANNEL_DEVICE + COMMAND
const CLOCK_READ = CODE_READ + CHANNEL_CLOCK + COMMAND
const NETWORK_READ_DATA = CODE_READ + CHANNEL_NETWORK + DATA
const DEVICE_READ_DATA = CODE_READ + CHANNEL_DEVICE + DATA
const CLOCK_READ_DATA = CODE_READ + CHANNEL_CLOCK + DATA

const starts_with = function (buffer: number[], string: string, start_offset = 0) {
  for (let index = 0; index < string.length; index++) {
    if (buffer[index + start_offset] !== string.charCodeAt(index)) {
      return false
    }
  }

  return true
}

const ends_with = function (buffer: number[], string: string, start_offset = 0) {
  for (let index = 0; index < string.length; index++) {
    if (buffer[buffer.length - start_offset - string.length + index] !== string.charCodeAt(index)) {
      return false
    }
  }

  return true
}

export class SpectodaWebSerialConnector {
  #runtimeReference

  #serialPort: SerialPort | undefined
  #criteria: Array<SpectodaTypes['Criterium']> | undefined
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
    criterium_array: Array<SpectodaTypes['Criterium']>,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    logging.debug('userSelect(criteria=' + JSON.stringify(criterium_array) + ', timeout=' + timeout_number + ')')

    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 60000
    }

    const criteria_json = JSON.stringify(criterium_array)

    logging.debug('userSelect(criteria=' + criteria_json + ')')

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
        this.#criteria = criterium_array
        resolve({ connector: this.type })
      } catch (error) {
        logging.error('userSelect failed:', error)
        reject(error)
      }
    })
  }

  autoSelect(
    criterium_array: Array<SpectodaTypes['Criterium']>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    logging.debug(
      'autoSelect(criteria=' +
        JSON.stringify(criterium_array) +
        ', scan_duration=' +
        scan_duration_number +
        ', timeout=' +
        timeout_number +
        ')',
    )

    if (scan_duration_number === DEFAULT_TIMEOUT) {
      scan_duration_number = 1500
    }
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }

    logging.debug(
      'autoSelect(criteria=' +
        JSON.stringify(criterium_array) +
        ', scan_duration=' +
        scan_duration_number +
        ', timeout=' +
        timeout_number +
        ')',
    )

    return new Promise<SpectodaTypes['Criterium'] | null>(async (resolve, reject) => {
      try {
        const ports = await navigator.serial.getPorts()

        logging.debug('Available ports:', ports)

        if (ports.length === 0) {
          logging.warn('No previously selected ports available')
          reject('NoDeviceFound')
          return
        }

        this.#serialPort = ports[0]
        this.#criteria = criterium_array
        resolve({ connector: this.type })
      } catch (error) {
        logging.error('autoSelect failed:', error)
        reject(error)
      }
    }).catch((error) => {
      // TODO remove this once we have a proper auto-select mechanism
      // TODO it is not desirable to call userSelect() if you want to auto-select
      logging.warn('SpectodaWebSerialConnector: autoSelect() failed. Calling userSelect() instead.')
      return this.userSelect(criterium_array, timeout_number)
    })
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.debug('selected()')

    return Promise.resolve(this.#serialPort ? { connector: this.type } : null)
  }

  unselect(): Promise<null> {
    logging.debug('unselect()')

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
    criterium_array: Array<SpectodaTypes['Criterium']>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<SpectodaTypes['Criterium']>> {
    if (scan_duration_number === DEFAULT_TIMEOUT) {
      scan_duration_number = 7000
    }

    logging.debug(
      'scan(criterium_array=' +
        JSON.stringify(criterium_array) +
        ', scan_duration_number=' +
        scan_duration_number +
        ')',
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

  async connect(timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium']> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 2500
    }
    logging.debug(`connect(timeout_number=${timeout_number})`)

    if (timeout_number <= 0) {
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
        if (timeout_handle) {
          clearTimeout(timeout_handle)
        }
        this.#beginCallback = undefined
        await this.#disconnect()
      }

      const resolveOnce = (value: SpectodaTypes['Criterium']) => {
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

      let timeout_handle: NodeJS.Timeout | undefined = setTimeout(async () => {
        logging.warn('Connection begin timeout')
        await cleanup()
        rejectOnce('ConnectTimeout')
      }, timeout_number)

      try {
        const port = this.#serialPort

        if (!port) {
          await cleanup()
          rejectOnce('InternalError')
          return
        }

        logging.info('this.#criteria=', this.#criteria)

        // TODO properly handle the criteria
        if (this.#criteria && this.#criteria.length > 0) {
          // TODO Fix types
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (this.#criteria[0].baudrate) {
            // TODO Fix types
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.#portOptions.baudRate = this.#criteria[0].baudrate
          }
          // TODO Fix types
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (this.#criteria[0].baudRate) {
            // TODO Fix types
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.#portOptions.baudRate = this.#criteria[0].baudRate
          }
        }

        logging.info('> Opening Serial at baudrate ' + this.#portOptions.baudRate + '...')
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
          logging.info('> Flushing Serial...')
          const tempReader = port.readable.getReader()

          try {
            // Add timeout to the read operation
            await Promise.race([
              tempReader.read(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('FlushTimeout')), 1000)),
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

        const command_bytes: number[] = []
        const header_bytes: number[] = []
        let data_header: {
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
        const data_bytes: number[] = []
        const line_bytes: number[] = []

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
                break
              }
              if (value) {
                for (const byte of value) {
                  if (mode === MODE_UTF8_RECEIVE) {
                    const command_bytes_length = command_bytes.push(byte)

                    if (command_bytes_length >= 3) {
                      if (starts_with(command_bytes, '>>>')) {
                        if (ends_with(command_bytes, '<<<\n')) {
                          if (starts_with(command_bytes, 'BEGIN', 3)) {
                            logging.warn('SERIAL >>>BEGIN<<<')
                            this.#beginCallback && this.#beginCallback(true)
                            command_bytes.length = 0
                          } else if (starts_with(command_bytes, 'END', 3)) {
                            logging.warn('SERIAL >>>END<<<')
                            this.#beginCallback && this.#beginCallback(false)
                            this.#feedbackCallback && this.#feedbackCallback(false)
                            command_bytes.length = 0
                            this.#disconnect()
                          } else if (starts_with(command_bytes, 'READY', 3)) {
                            logging.warn('SERIAL >>>READY<<<')
                            this.#beginCallback && this.#beginCallback(false)
                            this.#feedbackCallback && this.#feedbackCallback(false)
                            command_bytes.length = 0
                            this.#disconnect()
                          } else if (starts_with(command_bytes, 'SUCCESS', 3)) {
                            logging.debug('SERIAL >>>SUCCESS<<<')
                            this.#feedbackCallback && this.#feedbackCallback(true)
                            command_bytes.length = 0
                          } else if (starts_with(command_bytes, 'FAIL', 3)) {
                            logging.info('SERIAL >>>FAIL<<<')
                            this.#feedbackCallback && this.#feedbackCallback(false)
                            command_bytes.length = 0
                          } else if (starts_with(command_bytes, 'ERROR', 3)) {
                            logging.error('SERIAL >>>ERROR<<<')
                            this.#feedbackCallback && this.#feedbackCallback(false)
                            command_bytes.length = 0
                          } else if (starts_with(command_bytes, 'DATA', 3)) {
                            logging.debug('SERIAL >>>DATA<<<')
                            this.#dataCallback && this.#dataCallback(new Uint8Array(data_bytes))

                            switch (data_header.data_type) {
                              case NETWORK_WRITE: {
                                logging.debug('SERIAL >>>NETWORK_WRITE<<<')

                                const DUMMY_NODESERIAL_CONNECTION = SpectodaWasm.Connection.make(
                                  '11:11:11:11:11:11',
                                  SpectodaWasm.connector_type_t.CONNECTOR_SERIAL,
                                  SpectodaWasm.connection_rssi_t.RSSI_MAX,
                                )

                                this.#runtimeReference.spectoda_js.execute(
                                  new Uint8Array(data_bytes),
                                  DUMMY_NODESERIAL_CONNECTION,
                                )

                                break
                              }
                              case CLOCK_WRITE: {
                                logging.debug('SERIAL >>>CLOCK_WRITE<<<')

                                const synchronization: Synchronization =
                                  SpectodaWasm.Synchronization.makeFromUint8Array(new Uint8Array(data_bytes))
                                const DUMMY_NODESERIAL_CONNECTION = SpectodaWasm.Connection.make(
                                  '11:11:11:11:11:11',
                                  SpectodaWasm.connector_type_t.CONNECTOR_SERIAL,
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

                                const DUMMY_NODESERIAL_CONNECTION = SpectodaWasm.Connection.make(
                                  '11:11:11:11:11:11',
                                  SpectodaWasm.connector_type_t.CONNECTOR_SERIAL,
                                  SpectodaWasm.connection_rssi_t.RSSI_MAX,
                                )

                                this.#runtimeReference.spectoda_js.request(
                                  new Uint8Array(data_bytes),
                                  DUMMY_NODESERIAL_CONNECTION,
                                )

                                break
                              }
                            }

                            command_bytes.length = 0
                            data_header = {
                              data_type: 0,
                              data_size: 0,
                              data_receive_timeout: 0,
                              data_crc32: 0,
                              header_crc32: 0,
                            }
                          }
                        } else if (ends_with(command_bytes, 'DATA=')) {
                          mode = MODE_DATA_RECEIVE
                          data_header = {
                            data_type: 0,
                            data_size: 0,
                            data_receive_timeout: 0,
                            data_crc32: 0,
                            header_crc32: 0,
                          }

                          header_bytes.length = 0
                          data_bytes.length = 0
                        } else if (command_bytes.length > '>>>SUCCESS<<<\n'.length) {
                          logging.error('ERROR 342897cs: command_bytes', command_bytes, 'data_header', data_header)
                          command_bytes.length = 0
                        }
                      } else {
                        const character = command_bytes.shift() as number

                        if (character === NEWLINE_ASCII_CODE) {
                          const line = decoder.decode(new Uint8Array(line_bytes))

                          logging.info(line)
                          line_bytes.length = 0
                        } else {
                          line_bytes.push(character)
                        }
                      }
                    }
                  } else if (mode == MODE_DATA_RECEIVE) {
                    if (header_bytes.length < HEADER_BYTES_SIZE) {
                      header_bytes.push(byte)

                      if (header_bytes.length >= HEADER_BYTES_SIZE) {
                        const tnglReader = new TnglReader(new Uint8Array(header_bytes))

                        data_header.data_type = tnglReader.readUint32()
                        data_header.data_size = tnglReader.readUint32()
                        data_header.data_receive_timeout = tnglReader.readUint32()
                        data_header.data_crc32 = tnglReader.readUint32()
                        data_header.header_crc32 = tnglReader.readUint32()

                        logging.debug('data_header=', data_header)

                        if (data_header.data_size == 0) {
                          mode = MODE_UTF8_RECEIVE
                        }
                      }
                    } else {
                      data_bytes.push(byte)

                      if (data_bytes.length >= data_header.data_size) {
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
              (error.message.includes('device has been lost') || error.message.includes('device was disconnected'))
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
          clearTimeout(timeout_handle)
          timeout_handle = undefined

          if (result) {
            logging.info('Serial connection connected')

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

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.debug('connected()')
    return Promise.resolve(this.#serialPort && this.#interfaceConnected ? { connector: this.type } : null)
  }

  disconnect(): Promise<unknown> {
    logging.info('disconnect()')

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
      const timeout_handle = setTimeout(() => {
        logging.error('Finishing Serial TIMEOUT')
        this.#disconnecting = false
        reject('DisconnectTimeout')
      }, 5000)

      try {
        logging.info('> Finishing Serial...')
        await this.#writeString('>>>FINISH_SERIAL<<<\n')
      } catch (error) {
        logging.error('Error during finish:', error)
      }

      try {
        logging.info('> Disconnecting Serial...')

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
        clearTimeout(timeout_handle)
        this.#disconnecting = false
        if (this.#interfaceConnected) {
          this.#interfaceConnected = false
          this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
        }
      }
    })
  }

  async #disconnect(): Promise<unknown> {
    logging.debug('#disconnect()')

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
      logging.debug('> Closing serial port...')

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

  #initiate(initiate_code: number, payload: Uint8Array, tries: number, timeout: number): Promise<unknown> {
    logging.debug(`initiate(initiate_code=${initiate_code}, payload=${payload}, tries=${tries}, timeout=${timeout})`)

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

    const packet_timeout_min = 50
    let packet_timeout = payload.length * this.#timeoutMultiplier + packet_timeout_min

    if (!packet_timeout || packet_timeout < packet_timeout_min) {
      logging.warn('Packet Timeout is too small:', packet_timeout)
      packet_timeout = packet_timeout_min
    }

    if (timeout < packet_timeout) {
      timeout = packet_timeout
    }

    logging.debug(`initiate_code=${initiate_code}`)
    logging.debug(`payload.length=${payload.length}`)
    logging.debug(`packet_timeout=${packet_timeout}`)

    const header_writer = new TnglWriter(32)

    header_writer.writeUint32(initiate_code)
    header_writer.writeUint32(payload.length)
    header_writer.writeUint32(packet_timeout)
    header_writer.writeUint32(crc32(payload))
    header_writer.writeUint32(crc32(new Uint8Array(header_writer.bytes.buffer)))

    return new Promise(async (resolve, reject) => {
      let timeout_handle: NodeJS.Timeout | undefined = undefined

      const do_write = async () => {
        timeout_handle = setTimeout(() => {
          logging.error('Serial response timeout')

          if (this.#feedbackCallback) {
            this.#feedbackCallback(false)
          } else {
            this.#disconnect()
              .catch(() => {
                logging.error('Failed to disconnect')
              })
              .finally(() => {
                reject('ResponseTimeout')
              })
          }
        }, timeout + 1000)

        if (!this.#writer) {
          logging.error('SERIAL_ERROR 65432789')
          reject('InternalError')
          return
        }

        try {
          await this.#writer.write(new Uint8Array(header_writer.bytes.buffer)).catch((e) => {
            logging.error('SERIAL_ERROR 65239083', e)
            reject(e)
            return
          })
          await this.#writer.write(payload).catch((e) => {
            logging.error('SERIAL_ERROR 23074934', e)
            reject(e)
            return
          })
        } catch (e) {
          logging.error('SERIAL_ERROR 25340789', e)
          reject(e)
          return
        }
      }

      this.#feedbackCallback = (success: boolean) => {
        this.#feedbackCallback = undefined

        clearTimeout(timeout_handle)

        if (success) {
          resolve(null)
        } else {
          setTimeout(() => {
            try {
              tries -= 1
              timeout -= packet_timeout

              if (tries > 0 && timeout > 0) {
                do_write()
              } else {
                reject('WriteFailed')
              }
            } catch (e) {
              reject(e)
            }
          }, 100)
        }
      }

      do_write()
    }).finally(() => {
      this.#writing = false
    })
  }

  #write(channel_type: number, payload: Uint8Array, timeout: number): Promise<unknown> {
    return this.#initiate(CODE_WRITE + channel_type, payload, 10, timeout)
  }

  #read(channel_type: number, timeout: number): Promise<Uint8Array> {
    let response = new Uint8Array()

    this.#dataCallback = (data) => {
      response = data
      this.#dataCallback = undefined
    }

    return this.#initiate(CODE_READ + channel_type, new Uint8Array(), 10, timeout).then(() => {
      return response
    })
  }

  #request(
    channel_type: number,
    payload: Uint8Array,
    read_response: boolean,
    timeout: number,
  ): Promise<Uint8Array | null> {
    return this.#write(channel_type, payload, timeout).then(() => {
      if (read_response) {
        return this.#read(channel_type, timeout)
      } else {
        return null
      }
    })
  }

  deliver(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.debug(`deliver(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payload_bytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payload_bytes, timeout_number)
  }

  transmit(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 1000
    }
    logging.debug(`transmit(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payload_bytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payload_bytes, timeout_number)
  }

  request(
    payload_bytes: Uint8Array,
    read_response: boolean,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 10000
    }
    logging.debug(`request(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payload_bytes) {
      return Promise.reject('InvalidPayload')
    }

    return this.#request(CHANNEL_DEVICE, payload_bytes, read_response, timeout_number)
  }

  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug(`setClock(clock.millis()=${clock.millis()})`)

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          await this.#write(CHANNEL_CLOCK, new Uint8Array(toBytes(clock.millis(), 8)), 100)
          logging.debug('Clock write success')
          resolve(null)
          return
        } catch {
          logging.warn('Clock write failed')
          await sleep(100)
        }
      }

      reject('ClockWriteFailed')
      return
    })
  }

  getClock(): Promise<TimeTrack> {
    logging.debug('getClock()')

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          const bytes = await this.#read(CHANNEL_CLOCK, 100)

          const reader = new TnglReader(bytes)
          const timestamp = reader.readUint64()

          logging.debug('> Clock read success:', timestamp)
          resolve(new TimeTrack(timestamp))
          return
        } catch (e) {
          logging.warn('Clock read failed:', e)

          if (e == 'WriteFailed') {
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

  updateFW(firmware_bytes: Uint8Array): Promise<unknown> {
    logging.debug('updateFW()', firmware_bytes)

    if (!this.#serialPort) {
      logging.warn('Serial Port is null')
      return Promise.reject('UpdateFailed')
    }

    return new Promise(async (resolve, reject) => {
      const chunk_size = 3984

      this.#timeoutMultiplier = 8

      let index_from = 0
      let index_to = chunk_size

      let written = 0

      logging.setLoggingLevel(logging.level - 1)

      logging.info('OTA UPDATE')
      logging.debug(firmware_bytes)

      const start_timestamp = Date.now()

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          logging.info('OTA RESET')

          const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_OTA_RESET, 0x00, ...numberToBytes(0x00000000, 4)])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)

        {
          logging.info('OTA BEGIN')

          const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_OTA_BEGIN, 0x00, ...numberToBytes(firmware_bytes.length, 4)])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)

        {
          logging.info('OTA WRITE')

          while (written < firmware_bytes.length) {
            if (index_to > firmware_bytes.length) {
              index_to = firmware_bytes.length
            }

            const bytes = new Uint8Array([
              COMMAND_FLAGS.FLAG_OTA_WRITE,
              0x00,
              ...numberToBytes(written, 4),
              ...firmware_bytes.slice(index_from, index_to),
            ])

            await this.#write(CHANNEL_DEVICE, bytes, 10000)
            written += index_to - index_from

            const percentage = Math.floor((written * 10000) / firmware_bytes.length) / 100

            logging.info(percentage + '%')

            this.#runtimeReference.emit(SpectodaAppEvents.OTA_PROGRESS, percentage)

            index_from += chunk_size
            index_to = index_from + chunk_size
          }
        }

        await sleep(100)

        {
          logging.info('OTA END')

          const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_OTA_END, 0x00, ...numberToBytes(written, 4)])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        logging.info('Firmware written in ' + (Date.now() - start_timestamp) / 1000 + ' seconds')

        await sleep(2000)

        const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST])

        await this.#write(CHANNEL_DEVICE, bytes, 10000)

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

  cancel(): void {}

  destroy(): Promise<unknown> {
    logging.debug('destroy()')

    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
  }

  sendExecute(command_bytes: Uint8Array, source_connection: Connection) {
    logging.debug(
      `SpectodaWebSerialConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_NETWORK, command_bytes, 1000)
  }

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.debug(
      `SpectodaWebSerialConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    if (destination_connection.connector_type != SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_DEVICE, request_bytecode, 1000)
  }

  sendResponse(
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Array,
    destination_connection: Connection,
  ) {
    logging.debug(
      `SpectodaWebSerialConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.reject('NotImplemented')
  }

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.debug(
      `SpectodaWebSerialConnector::sendSynchronize(synchronization=${synchronization}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#interfaceConnected) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_CLOCK, synchronization.toUint8Array(), 1000)
  }
}
