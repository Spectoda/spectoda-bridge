// @ts-nocheck
import type {
  Adapter,
  Bluetooth,
  Device,
  GattCharacteristic,
  GattService,
} from 'node-ble'

import { numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import type { Criteria, Criterium } from '../types/primitives'
import type { Connection, Synchronization } from '../types/wasm'

// od 0.8.0 maji vsechny spectoda enabled BLE zarizeni jednotne SPECTODA_DEVICE_UUID.
// kazdy typ (produkt) Spectoda Zarizeni ma svuj kod v manufacturer data
// verze FW lze získat také z manufacturer data

// xxConnection.js udržuje komunikaci vždy pouze s
// jedním zařízením v jednu chvíli

//////////////////////////////////////////////////////////////////////////

const PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE = 512

// ESP Registered MAC address ranges used for device scanning
const ESP_MAC_PREFIXES = [
  '08:3A:8D',
  '08:3A:F2',
  '08:A6:F7',
  '08:B6:1F',
  '08:D1:F9',
  '08:F9:E0',
  '0C:8B:95',
  '0C:B8:15',
  '0C:DC:7E',
  '10:06:1C',
  '10:52:1C',
  '10:91:A8',
  '10:97:BD',
  '14:2B:2F',
  '18:8B:0E',
  '18:FE:34',
  '1C:69:20',
  '1C:9D:C2',
  '24:0A:C4',
  '24:4C:AB',
  '24:58:7C',
  '24:62:AB',
  '24:6F:28',
  '24:A1:60',
  '24:B2:DE',
  '24:D7:EB',
  '24:DC:C3',
  '24:EC:4A',
  '2C:3A:E8',
  '2C:BC:BB',
  '2C:F4:32',
  '30:30:F9',
  '30:83:98',
  '30:AE:A4',
  '30:C6:F7',
  '30:C9:22',
  '34:5F:45',
  '34:85:18',
  '34:86:5D',
  '34:94:54',
  '34:98:7A',
  '34:AB:95',
  '34:B4:72',
  '34:B7:DA',
  '3C:61:05',
  '3C:71:BF',
  '3C:84:27',
  '3C:E9:0E',
  '40:22:D8',
  '40:4C:CA',
  '40:91:51',
  '40:F5:20',
  '44:17:93',
  '48:27:E2',
  '48:31:B7',
  '48:3F:DA',
  '48:55:19',
  '48:CA:43',
  '48:E7:29',
  '4C:11:AE',
  '4C:75:25',
  '4C:EB:D6',
  '50:02:91',
  '54:32:04',
  '54:43:B2',
  '54:5A:A6',
  '58:BF:25',
  '58:CF:79',
  '5C:CF:7F',
  '60:01:94',
  '60:55:F9',
  '64:B7:08',
  '64:E8:33',
  '68:67:25',
  '68:B6:B3',
  '68:C6:3A',
  '6C:B4:56',
  '70:03:9F',
  '70:04:1D',
  '70:B8:F6',
  '74:4D:BD',
  '78:21:84',
  '78:E3:6D',
  '78:EE:4C',
  '7C:73:98',
  '7C:87:CE',
  '7C:9E:BD',
  '7C:DF:A1',
  '80:64:6F',
  '80:65:99',
  '80:7D:3A',
  '84:0D:8E',
  '84:CC:A8',
  '84:F3:EB',
  '84:F7:03',
  '84:FC:E6',
  '88:13:BF',
  '8C:4B:14',
  '8C:AA:B5',
  '8C:CE:4E',
  '90:15:06',
  '90:38:0C',
  '90:97:D5',
  '94:3C:C6',
  '94:B5:55',
  '94:B9:7E',
  '94:E6:86',
  '98:CD:AC',
  '98:F4:AB',
  '9C:9C:1F',
  '9C:9E:6E',
  'A0:20:A6',
  'A0:76:4E',
  'A0:A3:B3',
  'A0:B7:65',
  'A0:DD:6C',
  'A4:7B:9D',
  'A4:CF:12',
  'A4:E5:7C',
  'A8:03:2A',
  'A8:42:E3',
  'A8:48:FA',
  'AC:0B:FB',
  'AC:15:18',
  'AC:67:B2',
  'AC:D0:74',
  'B0:A7:32',
  'B0:B2:1C',
  'B4:8A:0A',
  'B4:E6:2D',
  'B8:D6:1A',
  'B8:F0:09',
  'BC:DD:C2',
  'BC:FF:4D',
  'C0:49:EF',
  'C0:4E:30',
  'C4:4F:33',
  'C4:5B:BE',
  'C4:D8:D5',
  'C4:DD:57',
  'C4:DE:E2',
  'C8:2B:96',
  'C8:2E:18',
  'C8:C9:A3',
  'C8:F0:9E',
  'CC:50:E3',
  'CC:7B:5C',
  'CC:8D:A2',
  'CC:DB:A7',
  'D0:EF:76',
  'D4:8A:FC',
  'D4:D4:DA',
  'D4:F9:8D',
  'D8:13:2A',
  'D8:A0:1D',
  'D8:BC:38',
  'D8:BF:C0',
  'D8:F1:5B',
  'DC:4F:22',
  'DC:54:75',
  'DC:DA:0C',
  'E0:5A:1B',
  'E0:98:06',
  'E0:E2:E6',
  'E4:65:B8',
  'E4:B0:63',
  'E8:06:90',
  'E8:31:CD',
  'E8:68:E7',
  'E8:6B:EA',
  'E8:9F:6D',
  'E8:DB:84',
  'EC:62:60',
  'EC:64:C9',
  'EC:94:CB',
  'EC:C9:FF',
  'EC:DA:3B',
  'EC:FA:BC',
  'F0:08:D1',
  'F0:9E:9E',
  'F0:F5:BD',
  'F4:12:FA',
  'F4:CF:A2',
  'FC:B4:67',
  'FC:E8:C0',
  'FC:F5:C4',
]

/*
    is renamed Transmitter. Helper class for WebBluetoothConnector.js
*/
export class NodeBLEConnection {
  #runtimeReference: SpectodaRuntime
  // private fields
  #service: GattService | undefined
  #networkChar: GattCharacteristic | undefined
  #clockChar: GattCharacteristic | undefined
  #deviceChar: GattCharacteristic | undefined
  #writing
  #uuidCounter

  #networkNotificationBuffer: Uint8Array | null

  constructor(runtimeReference: SpectodaRuntime) {
    this.#runtimeReference = runtimeReference

    /*
      BLE Spectoda Service
    */
    this.#service = undefined

    /*  
      Network Characteristics governs the communication with the Spectoda Netwok.
      That means tngl uploads, timeline manipulation, event emitting...
      You can access it only if you are authenticated via the Device Characteristics
    */
    this.#networkChar = undefined // ? only accesable when connected to the mesh network

    /*  
      The whole purpuse of clock characteristics is to synchronize clock time
      of the application with the Spectoda network
    */
    this.#clockChar = undefined // ? always accesable

    /*  
      Device Characteristics is renamed Update Characteristics
      Device Characteristics handles ALL CONCEPTS WITH THE 
      PHYSICAL CONNECTED CONTROLLER. On the other hand Network Characteristics 
      handles concepts connected with the whole spectoda network - all devices 
      With Device Charactristics you can upload FW to the single device, 
      access and manipulate json config of the device, adopt device, 
      and authenticate the application client with the spectoda network
    */
    this.#deviceChar = undefined

    /*
      simple mutex indicating that communication over BLE is in progress
    */
    this.#writing = false

    this.#uuidCounter = Math.floor(Math.random() * 4294967295)

    this.#networkNotificationBuffer = null
  }

  #getUUID() {
    logging.verbose('#getUUID()')

    // valid UUIDs are in range [1..4294967295] (32 bit number)
    if (this.#uuidCounter >= 4294967295) {
      this.#uuidCounter = 0
    }

    return ++this.#uuidCounter
  }

  #writeBytes(
    characteristic: GattCharacteristic,
    bytes: Uint8Array,
    response: boolean,
  ): Promise<unknown> {
    logging.verbose('#writeBytes()', bytes, response)

    const writeUuid = this.#getUUID() // two messages near to each other must not have the same UUID!
    const packetHeaderSize = 12 // 3x 4byte integers: write_uuid, index_from, payload.length
    const packetSize = 512 // min size packet_header_size + 1 !!!! ANDROID NEEDS PACKET SIZE <= 212!!!!
    const bytesSize = packetSize - packetHeaderSize

    if (!response) {
      if (bytes.length > bytesSize) {
        logging.error(
          'The maximum bytes that can be written without response is ' +
            bytesSize,
        )
        return Promise.reject('WriteError')
      }

      const payload = [
        ...numberToBytes(writeUuid, 4),
        ...numberToBytes(0, 4),
        ...numberToBytes(bytes.length, 4),
        ...bytes.slice(0, bytes.length),
      ]

      return characteristic.writeValue(Buffer.from(payload), {
        offset: 0,
        type: 'command',
      })
    }

    return new Promise(async (resolve, reject) => {
      let indexFrom = 0
      let indexTo = bytesSize

      while (indexFrom < bytes.length) {
        if (indexTo > bytes.length) {
          indexTo = bytes.length
        }

        const payload = [
          ...numberToBytes(writeUuid, 4),
          ...numberToBytes(indexFrom, 4),
          ...numberToBytes(bytes.length, 4),
          ...bytes.slice(indexFrom, indexTo),
        ]

        try {
          await characteristic.writeValue(Buffer.from(payload), {
            offset: 0,
            type: 'request',
          })
        } catch (e) {
          logging.warn(e)

          reject(e)
          return
        }

        indexFrom += bytesSize
        indexTo = indexFrom + bytesSize
      }

      resolve(undefined)
      return
    })
  }

  #readBytes(characteristic: GattCharacteristic): Promise<Uint8Array> {
    logging.debug('#readBytes()')
    // read the requested value

    // TODO write this function effectivelly
    return new Promise(async (resolve, reject) => {
      let value
      let bytes

      let totalBytes: number[] = []

      do {
        try {
          value = await characteristic.readValue()
          logging.debug('value', value)
        } catch (e) {
          logging.warn(e)

          reject(e)
          return
        }

        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        logging.verbose('bytes', bytes)

        totalBytes = [...totalBytes, ...bytes]
        logging.verbose('total_bytes', totalBytes)
      } while (bytes.length === PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE)

      resolve(new Uint8Array(totalBytes))
      return
    })
  }

  // WIP, event handling from spectoda network to application
  // timeline changes from spectoda network to application ...
  #onNetworkNotification(data: Buffer) {
    logging.verbose('onNetworkNotification()', data)

    // logging.warn(event);

    // const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const payload = new Uint8Array(
      dataView.buffer,
      dataView.byteOffset,
      dataView.byteLength,
    )

    logging.debug(`payload.length=${payload.length}`, payload)

    if (this.#networkNotificationBuffer == null) {
      this.#networkNotificationBuffer = payload
    } else {
      // Create new array with combined length
      const newBuffer = new Uint8Array(
        this.#networkNotificationBuffer.length + payload.length,
      )

      // Copy existing buffer
      newBuffer.set(this.#networkNotificationBuffer)
      // Append new payload at the end
      newBuffer.set(payload, this.#networkNotificationBuffer.length)
      this.#networkNotificationBuffer = newBuffer
    }

    if (payload.length === PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE) {
      // if the payload is equal to PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE, then another payload will be send that continues the overall message.
      return
    }
    //
    else {
      // this was the last payload of the message and the message is complete
      const commandBytes = this.#networkNotificationBuffer

      this.#networkNotificationBuffer = null

      if (commandBytes.length === 0) {
        return
      }

      const DUMMY_WEBBLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.request(
        commandBytes,
        DUMMY_WEBBLE_CONNECTION,
      )
    }
  }

  // WIP
  #onClockNotification(data: Buffer) {
    logging.verbose('onClockNotification()', data)

    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const synchronizationBytes = new Uint8Array(
      dataView.buffer,
      dataView.byteOffset,
      dataView.byteLength,
    )

    // uint64_t clock_timestamp;
    // uint64_t origin_address_handle;
    // uint32_t history_fingerprint;
    // uint32_t tngl_fingerprint;
    // uint64_t timeline_clock_timestamp;
    // uint64_t tngl_clock_timestamp;

    const SYNCHRONIZATION_BYTE_SIZE = 48

    if (synchronizationBytes.length < SYNCHRONIZATION_BYTE_SIZE) {
      logging.error('synchronizationBytes.length < SYNCHRONIZATION_BYTE_SIZE')
      return
    }

    const synchronization =
      SpectodaWasm.Synchronization.makeFromUint8Array(synchronizationBytes)

    const DUMMY_WEBBLE_CONNECTION = SpectodaWasm.Connection.make(
      '11:11:11:11:11:11',
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
      SpectodaWasm.connection_rssi_t.RSSI_MAX,
    )

    this.#runtimeReference.spectoda_js.synchronize(
      synchronization,
      DUMMY_WEBBLE_CONNECTION,
    )
  }

  attach(
    service: GattService,
    networkUUID: string,
    clockUUID: string,
    deviceUUID: string,
  ) {
    logging.verbose('attach()', service, networkUUID, clockUUID, deviceUUID)

    this.#service = service

    logging.info('> Getting Network Characteristics...')
    return this.#service
      .getCharacteristic(networkUUID)
      .then((characteristic) => {
        logging.verbose('#networkChar', characteristic)
        this.#networkChar = characteristic

        return this.#networkChar
          .startNotifications()
          .then(() => {
            logging.info('> Network notifications started')
            this.#networkChar?.on('valuechanged', (event) => {
              this.#onNetworkNotification(event)
            })
          })
          .catch((e) => {
            logging.info('> Network notifications failed')
            logging.warn(e)
          })
      })
      .catch((e) => {
        logging.warn(e)
        throw 'ConnectionFailed'
      })
      .then(() => {
        logging.info('> Getting Clock Characteristics...')
        return this.#service?.getCharacteristic(clockUUID)
      })
      .then((characteristic) => {
        logging.verbose('#clockChar', characteristic)
        this.#clockChar = characteristic

        return this.#clockChar
          ?.startNotifications()
          .then(() => {
            logging.info('> Clock notifications started')
            this.#clockChar?.on('valuechanged', (event) => {
              this.#onClockNotification(event)
            })
          })
          .catch((e) => {
            logging.info('> Clock notifications failed')
            logging.warn(e)
          })
      })
      .catch((e) => {
        logging.warn(e)
        throw 'ConnectionFailed'
      })
      .then(() => {
        logging.info('> Getting Device Characteristics...')
        return this.#service?.getCharacteristic(deviceUUID)
      })
      .then((characteristic) => {
        logging.verbose('#deviceChar', characteristic)
        this.#deviceChar = characteristic

        // ! Device characteristics does not implement notifications as it collides with write/read functionality
      })
      .catch((e) => {
        logging.warn(e)
        throw 'ConnectionFailed'
      })
  }

  // deliver() thansfers data reliably to the Bluetooth Device. It might not be instant.
  // It may even take ages to get to the device, but it will! (in theory)
  // returns promise that resolves when message is physically send, but you
  // dont need to wait for it to resolve, and spam deliver() as you please.
  // transmering queue will handle it
  deliver(payloadBytes: Uint8Array, timeoutNumber: number): Promise<unknown> {
    logging.verbose('deliver()', payloadBytes, timeoutNumber)

    if (!this.#networkChar) {
      logging.warn('Network characteristics is null')
      return Promise.reject('DeliverFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('DeliverFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#networkChar, payloadBytes, true)
      .catch((e) => {
        logging.error(e)
        throw 'DeliverFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }

  // transmit() tryes to transmit data NOW. ASAP. It will fail,
  // if deliver or another transmit is being executed at the moment
  // returns promise that will be resolved when message is physically send (only transmittion, not receive)
  transmit(payloadBytes: Uint8Array, timeoutNumber: number): Promise<unknown> {
    logging.verbose('transmit()', payloadBytes, timeoutNumber)

    if (!this.#networkChar) {
      logging.warn('Network characteristics is null')
      return Promise.reject('TransmitFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('TransmitFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#networkChar, payloadBytes, false)
      .catch((e) => {
        logging.error(e)
        throw 'TransmitFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }

  // request first writes the request to the Device Characteristics
  // and then reads the response also from the Device Characteristics
  request(
    payloadBytes: Uint8Array,
    readResponse: boolean,
    timeoutNumber: number,
  ): Promise<Uint8Array | null> {
    logging.verbose('request()', payloadBytes, readResponse, timeoutNumber)

    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      return Promise.reject('RequestFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('RequestFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#deviceChar, payloadBytes, readResponse)
      .then(() => {
        if (!readResponse) {
          return null
        }
        if (!this.#deviceChar) {
          return null
        }
        return this.#readBytes(this.#deviceChar)
      })
      .catch((e) => {
        logging.error(e)
        throw 'RequestFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }

  // write timestamp to clock characteristics as fast as possible
  writeClock(timestamp: number): Promise<unknown> {
    logging.verbose('writeClock()', timestamp)

    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('ClockWriteFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('ClockWriteFailed')
    }

    this.#writing = true

    const bytes = Buffer.from(toBytes(timestamp, 8))

    return this.#clockChar
      .writeValue(bytes, { offset: 0, type: 'reliable' })
      .catch((e) => {
        logging.error(e)
        throw 'ClockWriteFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }

  // reads the current clock characteristics timestamp from the device
  // as fast as possible
  readClock(): Promise<number | undefined> {
    logging.debug('readClock()')

    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('ClockReadFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('ClockReadFailed')
    }

    this.#writing = true

    return this.#readBytes(this.#clockChar)
      .then((dataView) => {
        logging.debug(dataView)
        const reader = new TnglReader(dataView)

        return reader.readUint64()
      })
      .catch((e) => {
        logging.error(e)
        throw 'ClockReadFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }

  async updateFirmware(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    logging.verbose('updateFirmware()', firmwareBytes, { skipReboot })

    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      throw 'UpdateFailed'
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      throw 'UpdateFailed'
    }

    this.#writing = true

    const chunkSize = 4992 // must be modulo 16

    let indexFrom = 0
    let indexTo = chunkSize

    let written = 0

    logging.debug('OTA UPDATE')
    logging.debug(firmwareBytes)

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

        await this.#writeBytes(this.#deviceChar, bytes, true)
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

        await this.#writeBytes(this.#deviceChar, bytes, true)
      }

      await sleep(8000) // need to wait 10 seconds to let the ESP erase the flash.
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

        await this.#writeBytes(this.#deviceChar, bytes, true)
        written += indexTo - indexFrom

        const percentage =
          Math.floor((written * 10000) / firmwareBytes.length) / 100

        logging.debug(`${percentage}%`)

        this.#runtimeReference.emit(SpectodaAppEvents.OTA_PROGRESS, percentage)

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

        await this.#writeBytes(this.#deviceChar, bytes, true)
      }

      await sleep(2000)

      logging.info(
        'Firmware written in ' +
          (Date.now() - startTimestamp) / 1000 +
          ' seconds',
      )

      if (skipReboot) {
        logging.info('Firmware written, skipping reboot as requested')
      }

      this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
      return
    } catch (e) {
      logging.error(e)
      this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
      throw 'UpdateFailed'
    } finally {
      this.#writing = false
    }
  }

  // resets the Communations, discarding command queue
  reset(): void {
    logging.verbose('reset()')

    this.#networkChar?.stopNotifications()
    this.#networkChar?.removeAllListeners('valuechanged')
    this.#clockChar?.stopNotifications()
    this.#clockChar?.removeAllListeners('valuechanged')
    this.#deviceChar?.stopNotifications()
    this.#deviceChar?.removeAllListeners('valuechanged')

    this.#service = undefined
    this.#networkChar = undefined
    this.#clockChar = undefined
    this.#deviceChar = undefined

    this.#service = undefined
    this.#writing = false

    this.#networkNotificationBuffer = null
  }

  destroy(): void {
    logging.verbose('destroy()')
    this.reset()
  }

  // write timestamp to clock characteristics as fast as possible
  sendSynchronize(synchronization: Synchronization): Promise<unknown> {
    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('sendSynchronizeFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('sendSynchronizeFailed')
    }

    this.#writing = true

    const synchronizationBytes = Buffer.from(synchronization.toUint8Array())

    return this.#clockChar
      .writeValue(synchronizationBytes, { offset: 0, type: 'reliable' })
      .then(() => {
        logging.verbose('Clock characteristics written')
      })
      .catch((e) => {
        logging.error(e)
        throw 'sendSynchronizeFailed'
      })
      .finally(() => {
        this.#writing = false
      })
  }
}

/////////////////////////////////////////////////////////////////////////////////////

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices

export class SpectodaNodeBluetoothConnector {
  readonly type = 'nodebluetooth'

  readonly SPECTODA_SERVICE_UUID = 'cc540e31-80be-44af-b64a-5d2def886bf5'
  readonly TERMINAL_CHAR_UUID = '33a0937e-0c61-41ea-b770-007ade2c79fa'
  readonly CLOCK_CHAR_UUID = '7a1e0e3a-6b9b-49ef-b9b7-65c81b714a19'
  readonly DEVICE_CHAR_UUID = '9ebe2e4b-10c7-4a81-ac83-49540d1135a5'

  #runtimeReference

  #bluetooth: Bluetooth
  #bluetoothDestroy: () => void
  #bluetoothAdapter: Adapter | undefined
  #bluetoothDevice: Device | undefined

  #connection
  #connectedGuard
  #reconection: boolean
  #criteria: Criteria

  constructor(runtimeReference: SpectodaRuntime) {
    import(/* webpackIgnore: true */ /* @vite-ignore */ 'node-ble').then(
      ({ createBluetooth }) => {
        this.#runtimeReference = runtimeReference

        const { bluetooth: bluetoothDevice, destroy: bluetoothDestroy } =
          createBluetooth()

        this.#bluetooth = bluetoothDevice
        this.#bluetoothDestroy = bluetoothDestroy
        this.#bluetoothAdapter = undefined
        this.#bluetoothDevice = undefined

        this.#connection = new NodeBLEConnection(runtimeReference)
        this.#reconection = false
        this.#criteria = []

        this.#connectedGuard = false

        // TODO unregister event listener on connector destroy
        this.#runtimeReference.on(SpectodaAppEvents.PRIVATE_CONNECTED, () => {
          this.#connectedGuard = true
        })

        // TODO unregister event listener on connector destroy
        this.#runtimeReference.on(
          SpectodaAppEvents.PRIVATE_DISCONNECTED,
          () => {
            this.#connectedGuard = false
          },
        )
      },
    )
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

    logging.verbose('userSelect()', criteriaJson, timeoutNumber)

    throw 'NotImplemented'
  }

  // takes the criteria, scans for scanPeriod and automatically selects the device,
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

    const criteria = criteriumArray

    return new Promise(async (resolve, reject) => {
      try {
        // step 1. for the scanPeriod scan the surroundings for BLE devices.
        // step 2. if some devices matching the criteria are found, then select the one with
        //         the greatest signal strength. If no device is found until the timeout,
        //         then return error

        if (
          !criteria ||
          criteria.length === 0 ||
          typeof criteria[0]?.mac !== 'string'
        ) {
          logging.error(
            "Criteria must be an array of at least 1 object with specified MAC address: [{mac:'AA:BB:CC:DD:EE:FF'}]",
          )
          throw 'CriteriaNotSupported'
        }

        this.#criteria = criteria

        if (await this.connected()) {
          logging.verbose('> Disconnecting device')
          await this.disconnect().catch((e) => logging.error(e))
          await sleep(1000)
        }

        if (!this.#bluetoothAdapter) {
          logging.verbose('> Requesting default bluetooth adapter')
          this.#bluetoothAdapter = await this.#bluetooth.defaultAdapter()
        }

        if (await this.#bluetoothAdapter.isDiscovering()) {
          logging.info('> Restarting BLE scanner')
          await this.#bluetoothAdapter.stopDiscovery()
          await this.#bluetoothAdapter.startDiscovery()
        } else {
          logging.info('> Starting BLE scanner')
          await this.#bluetoothAdapter.startDiscovery()
        }

        // Device UUID === Device MAC address
        const deviceMacAddress = criteria[0].mac.toUpperCase()

        this.#bluetoothDevice?.removeAllListeners('connect')
        this.#bluetoothDevice?.removeAllListeners('disconnect')

        logging.debug(`> Waiting for the device ${deviceMacAddress} to show up`)
        this.#bluetoothDevice = await this.#bluetoothAdapter.waitDevice(
          deviceMacAddress,
          timeoutNumber,
          scanDurationNumber,
        )

        await sleep(100)

        logging.info('> Getting BLE device mac address')
        const _mac = await this.#bluetoothDevice
          .getAddress()
          .catch((e) => logging.error(e))

        logging.info('> Getting BLE device name')
        const _name = await this.#bluetoothDevice
          .getName()
          .catch((e) => logging.error(e))

        // logging.verbose("stopping scanner");
        // await this.#bluetoothAdapter.stopDiscovery();
        this.#bluetoothDevice.on('connect', this.#onConnected)
        this.#bluetoothDevice.on('disconnect', this.#onDisconnected)

        resolve({ connector: this.type })
      } catch (e) {
        logging.warn(e)
        reject('SelectionFailed')
      }
    })
  }

  // if device is conneced, then disconnect it
  unselect(): Promise<null> {
    logging.debug('unselect()')

    return new Promise(async (resolve, reject) => {
      try {
        if (await this.connected()) {
          await this.disconnect()
        }

        this.#bluetoothDevice?.removeAllListeners('connect')
        this.#bluetoothDevice?.removeAllListeners('disconnect')
        this.#bluetoothDevice = undefined
        this.#connection.reset()

        resolve(null)
      } catch (e) {
        reject(e)
      }
    })
  }

  // // #selected returns boolean if a device is selected
  // #selected() {
  //   return Promise.resolve(this.#bluetoothDevice ? true : false);
  // }

  selected(): Promise<Criterium | null> {
    logging.debug('selected()')

    return new Promise(async (resolve, reject) => {
      try {
        if (!this.#bluetoothDevice) {
          resolve(null)
          return
        }

        logging.info('> Getting BLE device mac address')
        const _mac = await this.#bluetoothDevice
          .getAddress()
          .catch((e) => logging.error(e))

        logging.info('> Getting BLE device name')
        const _name = await this.#bluetoothDevice
          .getName()
          .catch((e) => logging.error(e))

        resolve({
          connector: this.type,
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  //
  scan(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 7000
    }

    return new Promise(async (resolve, reject) => {
      try {
        // if (!criteria || criteria.length != 1 || typeof criteria[0]?.mac !== "string") {
        //   logging.error("Criteria must be an array of 1 object with specified MAC address: [{mac:'AA:BB:CC:DD:EE:FF'}]");
        //   throw "CriteriaNotSupported";
        // }

        // this.#criteria = criteria;

        if (await this.connected()) {
          logging.info('> Disconnecting device')
          await this.disconnect().catch((e) => logging.error(e))
          await sleep(1000)
        }

        if (!this.#bluetoothAdapter) {
          logging.info('> Requesting default bluetooth adapter')
          this.#bluetoothAdapter = await this.#bluetooth.defaultAdapter()
        }

        if (await this.#bluetoothAdapter.isDiscovering()) {
          logging.info('> Restarting BLE scanner')
          await this.#bluetoothAdapter.stopDiscovery()
          await this.#bluetoothAdapter.startDiscovery()
        } else {
          logging.info('> Starting BLE scanner')
          await this.#bluetoothAdapter.startDiscovery()
        }

        await sleep(scanDurationNumber)

        const devices = await this.#bluetoothAdapter.devices()

        logging.info('> Devices Scanned:', devices)

        const eligibleControllersFound = []

        for (const mac of devices) {
          if (!ESP_MAC_PREFIXES.some((prefix) => mac.startsWith(prefix))) {
            continue
          }

          try {
            const device = await this.#bluetoothAdapter.getDevice(mac)
            const name = await device.getName()
            // const rssi = await device.getRSSI(); // Seems like RSSI is not available in dbus
            // const gatt = await device.gatt(); // Seems like this function freezes

            const foundInCriteria = criteriumArray.some(
              (criterium) => criterium.name === name,
            )
            const foundEmptyCriteria = criteriumArray.some(
              (criterium) => Object.keys(criterium).length === 0,
            )

            if (foundInCriteria || foundEmptyCriteria) {
              eligibleControllersFound.push({
                connector: this.type,
                mac: mac,
                name: name,
                // rssi: rssi
              })
            }
          } catch (e) {
            logging.error(e)
          }
        }

        // eligibleControllersFound.sort((a, b) => a.rssi - b.rssi);
        logging.info('> Controlles Found:', eligibleControllersFound)
        resolve(eligibleControllersFound)
      } catch (e) {
        logging.error(e)
        reject('ScanFailed')
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
    logging.debug(`connect(timeout_number=${timeoutNumber})`)

    if (timeoutNumber <= 0) {
      logging.info('> Connect timeout have expired')
      throw 'ConnectionFailed'
    }

    const _start = Date.now()

    this.#reconection = true

    return new Promise(async (resolve, reject) => {
      if (!this.#bluetoothDevice) {
        reject('DeviceNotSelected')
        return
      }

      await this.#bluetoothDevice.disconnect().catch((e) => logging.error(e))

      logging.info('> Connecting to Bluetooth device...')
      await this.#bluetoothDevice.connect().catch((e) => {
        logging.error(e)
        reject('ConnectionFailed')
        return
      })

      logging.info('> Getting the GATT server...')

      return this.#bluetoothDevice
        .gatt()
        .then((server) => {
          this.#connection.reset()

          if (!server) {
            reject('ConnectionFailed')
            return
          }

          logging.info('> Getting the Bluetooth Service...')
          return server.getPrimaryService(this.SPECTODA_SERVICE_UUID)
        })
        .then((service) => {
          if (!service) {
            reject('ConnectionFailed')
            return
          }

          logging.info('> Getting the Service Characteristic...')
          return this.#connection.attach(
            service,
            this.TERMINAL_CHAR_UUID,
            this.CLOCK_CHAR_UUID,
            this.DEVICE_CHAR_UUID,
          )
        })
        .then(() => {
          logging.info('> Bluetooth Device Connected')
          if (!this.#connectedGuard) {
            this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
          }
          resolve({ connector: this.type })
        })
        .catch((error) => {
          logging.error(error)
          reject('ConnectionFailed')
        })
    })
  }

  // there #connected returns boolean true if connected, false if not connected
  #connected(): boolean {
    logging.debug('#connected()')

    return this.#connectedGuard
  }

  // connected() is an runtime function that needs to return a Promise
  connected(): Promise<Criterium | null> {
    logging.verbose('connected()')

    if (!this.#bluetoothDevice) {
      return Promise.resolve(null)
    }

    return this.#bluetoothDevice
      .isConnected()
      .then((connected) => (connected ? { connector: this.type } : null))
  }

  #disconnect() {
    logging.debug('#disconnect()')

    if (!this.#bluetoothDevice) {
      logging.debug('No BLE device to disconnect')
      this.#onDisconnected()
      return Promise.resolve()
    }

    return this.#bluetoothDevice.disconnect().then(() => this.#onDisconnected())
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  async disconnect(): Promise<unknown> {
    logging.verbose('disconnect()')

    this.#reconection = false

    logging.info('> Disconnecting from Bluetooth Device...')

    this.#connection.reset()

    if (this.#connected()) {
      await this.#disconnect()
    } else {
      logging.debug('Bluetooth Device is already disconnected')
    }

    return
  }

  // when the device is disconnected, the javascript Connector.js layer decides
  // if it should be revonnected. Here is implemented that it should be
  // reconnected only if the this.#reconection is true. The event handlers are fired
  // synchronously. So that only after all event handlers (one after the other) are done,
  // only then start this.connect() to reconnect to the bluetooth device
  #onDisconnected = () => {
    logging.info('> NodeBLE Device disconnected')
    this.#connection.reset()
    if (this.#connectedGuard) {
      logging.verbose('emitting #disconnected')
      this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
    }
  }

  // when the device is disconnected, the javascript Connector.js layer decides
  // if it should be revonnected. Here is implemented that it should be
  // reconnected only if the this.#reconection is true. The event handlers are fired
  // synchronously. So that only after all event handlers (one after the other) are done,
  // only then start this.connect() to reconnect to the bluetooth device
  #onConnected = () => {
    logging.info('> NodeBLE Device Connected')
    if (!this.#connectedGuard) {
      logging.verbose('emitting #connected')
      this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
    }
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
    logging.verbose('deliver()', payloadBytes, timeoutNumber)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.deliver(payloadBytes, timeoutNumber)
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
    logging.verbose('transmit()', payloadBytes, timeoutNumber)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.transmit(payloadBytes, timeoutNumber)
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
    logging.verbose('request()', payloadBytes, readResponse, timeoutNumber)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.request(payloadBytes, readResponse, timeoutNumber)
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug('setClock()', clock)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          await this.#connection.writeClock(clock.millis())
          logging.debug('Clock write success')
          resolve(undefined)
          return
        } catch {
          logging.debug('Clock write failed')
          await sleep(1000)
        }
      }

      reject('ClockWriteFailed')
      return
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.debug('getClock()')

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        await sleep(1000)
        try {
          const timestamp = await this.#connection.readClock()

          logging.debug('Clock read success:', timestamp)
          resolve(new TimeTrack(timestamp))
          return
        } catch (e) {
          logging.warn('Clock read failed:', e)
        }
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

    logging.debug('updateFW()', firmwareBytes, { skipReboot })

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.updateFirmware(firmwareBytes, { skipReboot })
  }

  cancel(): void {
    // TODO implement
  }

  destroy(): Promise<unknown> {
    logging.debug('destroy()')

    //this.#runtimeReference = null; // dont know if I need to destroy this reference.. But I guess I dont need to?
    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})
      .finally(() => {
        this.#bluetoothDestroy()
      })
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.verbose(
      `SpectodaWebBluetoothConnector::sendExecute(command_bytes=${commandBytes}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.deliver(commandBytes, 1000)
  }

  // bool // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.verbose(
      `SpectodaWebBluetoothConnector::sendRequest(request_bytecode=${requestBytecode}, destination_connection=${destinationConnection})`,
    )

    if (
      destinationConnection.connector_type !==
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
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
      `SpectodaWebBluetoothConnector::sendSynchronize(synchronization=${JSON.stringify(
        synchronization,
      )}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.sendSynchronize(synchronization)
  }
}
