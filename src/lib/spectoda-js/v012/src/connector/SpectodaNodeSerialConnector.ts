// TODO Fix eslint + typescript [DEV-4738]
/* eslint-disable */
// @ts-nocheck

// npm install @types/serialport --save-dev

// ls /dev/cu.*

// add overlays=uart3 to /boot/orangepiEnv.txt
// add overlays=uart0 to /boot/orangepiEnv.txt
// sudo stty -F /dev/ttyS3 1500000
// screen /dev/ttyS3 1500000

/*
echo 'overlays=uart3' | sudo tee -a /boot/orangepiEnv.txt
cat /boot/orangepiEnv.txt
*/
// @ts-nocheck
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { TnglWriter } from '../../TnglWriter'
import { crc32, detectProductionBuild, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaTypes } from '../types/primitives'
import { Connection, Synchronization } from '../types/wasm'

// ! === TODO fix TSC ===

// import { SerialPort as NodeSerialPort, ReadlineParser as NodeReadlineParser } from "serialport";
import type {
  SerialPort as NodeSerialPortType,
  ReadlineParser as NodeReadlineParserType,
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

const tngl_sync_counter = 0
const history_sync_counter = 0

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

///////////////////////////////////////////////////////////////////////////////////

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices
export class SpectodaNodeSerialConnector {
  #runtimeReference

  #serialPort: NodeSerialPortType | undefined
  #criteria: Array<SpectodaTypes['Criterium']> | undefined

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
    criterium_array: Array<SpectodaTypes['Criterium']>,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<SpectodaTypes['Criterium'] | null> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 60000
    }

    const criteria_json = JSON.stringify(criterium_array)

    logging.verbose('userSelect(criteria=' + criteria_json + ')')

    return this.autoSelect(criterium_array, 1000, timeout_number)
  }

  // takes the criteria, scans for scan_period and automatically selects the device,
  // you can then connect to. This works only for BLE devices that are bond with the phone/PC/tablet
  // the app is running on OR doesnt need to be bonded in a special way.
  // if more devices are found matching the criteria, then the strongest signal wins
  // if no device is found within the timeout period, then it returns an error

  // if no criteria are provided, all Spectoda enabled devices (with all different FWs and Owners and such)
  // are eligible.

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

    if (!NodeSerialPort || !NodeReadlineParser) {
      return Promise.reject('NodeSerialPortNotAvailable')
    }

    if (this.#serialPort && this.#serialPort.isOpen) {
      logging.debug('disconnecting from autoSelect()')
      return this.disconnect().then(() => {
        return this.autoSelect(criterium_array, scan_duration_number, timeout_number)
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
        return this.autoSelect(criterium_array, scan_duration_number, timeout_number)
      })
    }

    // step 1. for the scan_period scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout,
    //         then return error

    // criteria.uart == "/dev/ttyS0"

    if (criterium_array && Array.isArray(criterium_array) && criterium_array.length > 0) {
      const port_options = PORT_OPTIONS

      // TODO @immakermatty add type guard for SerialCriteria
      // @ts-expect-error TODO: fix this
      if (criterium_array[0].baudrate) {
        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        port_options.baudRate = criterium_array[0].baudrate || 1500000
      }
      // TODO @immakermatty add type guard for SerialCriteria
      // @ts-expect-error TODO: fix this
      if (criterium_array[0].path) {
        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        port_options.path = criterium_array[0].path
      }

      // TODO! fix TSC
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.#serialPort = new NodeSerialPort(port_options)
      this.#criteria = criterium_array
      logging.verbose('this.#serialPort=', this.#serialPort)
      logging.verbose('this.#criteria=', this.#criteria)

      logging.debug('serial port selected')

      return Promise.resolve({ connector: this.type })
    } //
    else {
      return this.scan(criterium_array, scan_duration_number).then((ports) => {
        logging.verbose('ports=', ports)

        if (ports.length === 0) {
          throw 'NoDeviceFound'
        }

        const port_options = PORT_OPTIONS

        // TODO @immakermatty add type guard for SerialCriteria
        // @ts-expect-error TODO: fix this
        port_options.path = ports.at(-1)?.path || ''

        logging.verbose('port_options=', port_options)

        // TODO! fix TSC
        // @ts-ignore
        this.#serialPort = new NodeSerialPort(port_options)
        this.#criteria = criterium_array
        logging.verbose('this.#serialPort=', this.#serialPort)
        logging.verbose('this.#criteria=', this.#criteria)

        return { connector: this.type }
      })
    }
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('selected()')

    return Promise.resolve(this.#serialPort ? { connector: this.type } : null)
  }

  unselect(): Promise<null> {
    logging.verbose('unselect()')

    if (!this.#serialPort) {
      logging.debug('already unselected')
      return Promise.resolve(null)
    }

    if (this.#serialPort && this.#serialPort.isOpen) {
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

    // returns devices like autoSelect scan() function
    return new Promise(async (resolve, reject) => {
      try {
        if (!NodeSerialPort) {
          return Promise.reject('NodeSerialPortNotAvailableOnThisPlatform')
        }
        // TODO! fix TSC
        // @ts-ignore
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
  connect(timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium']> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 60000
    }
    logging.debug(`connect(timeout_number=${timeout_number})`)

    if (timeout_number <= 0) {
      logging.warn('Connect timeout have expired')
      return Promise.reject('ConnectionFailed')
    }

    const start = Date.now()

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
          logging.info('Serial port opened')
          resolve(null)
        }
      })
    })

    return openSerialPromise
      .then(() => {
        this.#disconnecting = false

        // TODO! fix TSC
        // @ts-ignore
        const parser = new NodeReadlineParser()

        this.#serialPort?.pipe(parser)

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

        const notify_header: undefined | object = undefined
        const notify_bytes: number[] = []

        const line_bytes: number[] = []

        const MODE_UTF8_RECEIVE = 0
        const MODE_DATA_RECEIVE = 1

        let mode = MODE_UTF8_RECEIVE

        const NEWLINE_ASCII_CODE = 10

        const decoder = new TextDecoder()

        this.#serialPort?.removeAllListeners()

        this.#serialPort?.on('open', () => {
          logging.info('Port Opened')
        })

        this.#serialPort?.on('close', () => {
          logging.info('Port Closed')

          if (this.#interfaceConnected) {
            this.#interfaceConnected = false
            this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
          }
        })

        this.#serialPort?.on('error', (err) => {
          logging.info('Port Error: ', err.message)
        })

        this.#serialPort?.on('data', (chunk: Buffer) => {
          // logging.info("[data]", decoder.decode(chunk));

          for (const byte of chunk) {
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
                      logging.verbose('SERIAL >>>SUCCESS<<<')
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
                      logging.verbose('SERIAL >>>DATA<<<')
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

                          const synchronization: Synchronization = SpectodaWasm.Synchronization.makeFromUint8Array(
                            new Uint8Array(data_bytes),
                          )
                          const DUMMY_NODESERIAL_CONNECTION = SpectodaWasm.Connection.make(
                            '11:11:11:11:11:11',
                            SpectodaWasm.connector_type_t.CONNECTOR_SERIAL,
                            SpectodaWasm.connection_rssi_t.RSSI_MAX,
                          )

                          this.#runtimeReference.spectoda_js.synchronize(synchronization, DUMMY_NODESERIAL_CONNECTION)

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
                        // No default
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
                  } //
                  else if (ends_with(command_bytes, 'DATA=')) {
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
                  } //
                  else if (command_bytes.length > '>>>SUCCESS<<<\n'.length) {
                    // ? >>>SUCCESS<<< is the longest command
                    logging.error('ERROR 342897cs: command_bytes', command_bytes, 'data_header', data_header)
                    command_bytes.length = 0
                  }
                }

                ////
                /* if(!starts_with(command_bytes, ">>>")) */
                else {
                  const character = command_bytes.shift() as number

                  if (character === NEWLINE_ASCII_CODE) {
                    const line = decoder.decode(new Uint8Array(line_bytes))

                    // TODO! process line
                    logging.info(line)
                    line_bytes.length = 0
                  } /* if(character !== NEWLINE_ASCII_CODE) */ else {
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

                  logging.verbose('data_header=', data_header)

                  if (data_header.data_size == 0) {
                    mode = MODE_UTF8_RECEIVE
                  }
                }
              } /* if (data_header) */ else {
                data_bytes.push(byte)

                if (data_bytes.length >= data_header.data_size) {
                  mode = MODE_UTF8_RECEIVE
                }
              }
            }
          }
        })

        return new Promise((resolve: (result: SpectodaTypes['Criterium']) => void, reject: (error: string) => void) => {
          const timeout_handle = setTimeout(async () => {
            logging.warn('Connection begin timeouted')
            this.#beginCallback = undefined

            await this.#disconnect().finally(() => {
              reject('ConnectTimeout')
            })
          }, timeout_number)

          this.#beginCallback = (result) => {
            this.#beginCallback = undefined

            clearTimeout(timeout_handle)

            if (result) {
              logging.info('Serial connection connected')

              setTimeout(() => {
                if (!this.#interfaceConnected) {
                  this.#interfaceConnected = true
                  this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
                }
                resolve({ connector: this.type })
              }, 100)
            } else {
              // logging.warn("Trying to connect again")
              // const passed = new Date().getTime() - start;
              // resolve(this.connect(timeout - passed));

              logging.info('Serial connection failed')

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
        })
      })
      .catch((error) => {
        logging.error('SerialConnector connect() failed with error:', error)
        throw error
      })
  }

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('connected()')

    logging.verbose('this.#serialPort=', this.#serialPort)
    logging.verbose('this.#serialPort.isOpen=', this.#serialPort?.isOpen)

    return Promise.resolve(this.#serialPort && this.#serialPort.isOpen ? { connector: this.type } : null)
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  #disconnect() {
    logging.verbose('#disconnect()')

    if (!this.#serialPort) {
      logging.debug('No Serial Port selected')
      return Promise.resolve(null)
    }

    logging.debug('this.#serialPort.isOpen', this.#serialPort.isOpen ? 'true' : 'false')

    if (this.#serialPort.isOpen) {
      logging.debug('> Closing serial port...')

      return new Promise((resolve, reject) => {
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

    logging.debug('> Serial Port already closed')
    return Promise.resolve(null)
  }

  disconnect(): Promise<unknown> {
    logging.verbose('disconnect()')

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
      const timeout_handle = setTimeout(async () => {
        logging.error('Finishing Serial TIMEOUT')

        this.#disconnectingResolve = undefined
        await this.#disconnect().finally(() => {
          reject('DisconnectTimeout')
        })
      }, 5000)

      this.#disconnectingResolve = (value: unknown) => {
        this.#disconnectingResolve = undefined
        clearTimeout(timeout_handle)
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

  #initiate(initiate_code: number, payload: Uint8Array, tries: number, timeout: number): Promise<unknown> {
    logging.verbose(`initiate(initiate_code=${initiate_code}, payload=${payload}, tries=${tries}, timeout=${timeout})`)

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

    const packet_timeout_min = 50
    let packet_timeout = payload.length * this.#timeoutMultiplier + packet_timeout_min

    if (!packet_timeout || packet_timeout < packet_timeout_min) {
      logging.warn('Packet Timeout is too small:', packet_timeout)
      packet_timeout = packet_timeout_min
    }

    if (timeout < packet_timeout) {
      timeout = packet_timeout
    }

    logging.verbose(`initiate_code=${initiate_code}`)
    logging.verbose(`payload.length=${payload.length}`)
    logging.verbose(`packet_timeout=${packet_timeout}`)

    const header_writer = new TnglWriter(32)

    header_writer.writeUint32(initiate_code)
    header_writer.writeUint32(payload.length)
    header_writer.writeUint32(packet_timeout)
    header_writer.writeUint32(crc32(payload))
    header_writer.writeUint32(crc32(new Uint8Array(header_writer.bytes.buffer)))

    return new Promise((resolve, reject) => {
      let timeout_handle: NodeJS.Timeout | undefined = undefined

      const do_write = async () => {
        timeout_handle = setTimeout(() => {
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
          await this.#serialPort?.write(Buffer.from(header_writer.bytes.buffer))
          await this.#serialPort?.write(Buffer.from(payload), 'utf8')
        } catch (e) {
          logging.error('ERROR 0ads8F67', e)
          reject(e)
        }
      }

      this.#feedbackCallback = (success: boolean) => {
        this.#feedbackCallback = undefined

        clearInterval(timeout_handle)

        if (success) {
          resolve(null)
        } else {
          //try to write it once more
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
          }, 100) // 100ms to be safe
        }
      }

      do_write()
    }).finally(() => {
      this.#writing = false
    })
  }

  #write(channel_type: number, payload: Uint8Array, timeout: number) {
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

  // deliver handles the communication with the Spectoda network in a way
  // that the command is guaranteed to arrive
  deliver(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.verbose(`deliver(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payload_bytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payload_bytes, timeout_number)
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
    logging.verbose(`transmit(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    if (!payload_bytes) {
      return Promise.resolve()
    }

    return this.#write(CHANNEL_NETWORK, payload_bytes, timeout_number)
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
    logging.verbose(`request(payload=${payload_bytes})`)

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    // TODO make this check on Interface level if its not already
    if (!payload_bytes) {
      return Promise.reject('InvalidPayload')
    }

    return this.#request(CHANNEL_DEVICE, payload_bytes, read_response, timeout_number)
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.verbose(`setClock(clock.millis()=${clock.millis()})`)

    if (!this.#serialPort || !this.#serialPort.isOpen) {
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

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.verbose('getClock()')

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

  // handles the firmware updating. Sends "ota" events
  // to all handlers
  updateFW(firmware_bytes: Uint8Array): Promise<unknown> {
    logging.debug('updateFW()', firmware_bytes)

    if (!this.#serialPort) {
      logging.warn('Serial Port is null')
      return Promise.reject('UpdateFailed')
    }

    return new Promise(async (resolve, reject) => {
      const chunk_size = 3984 // must be modulo 16

      this.#timeoutMultiplier = 8

      let index_from = 0
      let index_to = chunk_size

      let written = 0

      logging.setLoggingLevel(logging.level - 1)

      logging.info('OTA UPDATE')
      logging.verbose(firmware_bytes)

      const start_timestamp = Date.now()

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.info('OTA RESET')

          const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_OTA_RESET, 0x00, ...numberToBytes(0x00000000, 4)])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.info('OTA BEGIN')

          const bytes = new Uint8Array([COMMAND_FLAGS.FLAG_OTA_BEGIN, 0x00, ...numberToBytes(firmware_bytes.length, 4)])

          await this.#write(CHANNEL_DEVICE, bytes, 10000)
        }

        await sleep(100)

        {
          //===========// WRITE //===========//
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
          //===========// END //===========//
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

  cancel(): void {
    // TODO implement
  }

  destroy(): Promise<unknown> {
    logging.verbose('destroy()')

    //this.#runtimeReference = null; // dont know if I need to destroy this reference.. But I guess I dont need to?
    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(command_bytes: Uint8Array, source_connection: Connection) {
    logging.verbose(
      `SpectodaNodeSerialConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_NETWORK, command_bytes, 1000)
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaNodeSerialConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    // TODO if many connections can be opened, then look for the right one
    if (destination_connection.connector_type != SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_DEVICE, request_bytecode, 1000)
  }
  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

  sendResponse(
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Array,
    destination_connection: Connection,
  ) {
    logging.verbose(
      `SpectodaNodeSerialConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.reject('NotImplemented')
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaNodeSerialConnector::sendSynchronize(synchronization=${synchronization}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_SERIAL) {
      return Promise.resolve()
    }

    if (!this.#serialPort || !this.#serialPort.isOpen) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#write(CHANNEL_CLOCK, synchronization.toUint8Array(), 1000)
  }
}
