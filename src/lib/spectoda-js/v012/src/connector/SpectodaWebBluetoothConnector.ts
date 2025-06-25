// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// npm install --save-dev @types/web-bluetooth
/// <reference types="web-bluetooth" />

import { detectAndroid, hexStringToUint8Array, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack.js'
import { TnglReader } from '../../TnglReader'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import { SpectodaTypes } from '../types/primitives'
import { Connection, Synchronization } from '../types/wasm'

// od 0.8.0 maji vsechny spectoda enabled BLE zarizeni jednotne SPECTODA_DEVICE_UUID.
// kazdy typ (produkt) Spectoda Zarizeni ma svuj kod v manufacturer data
// verze FW lze získat také z manufacturer data

// xxConnection.js udržuje komunikaci vždy pouze s
// jedním zařízením v jednu chvíli

//////////////////////////////////////////////////////////////////////////

/*
    is renamed Transmitter. Helper class for WebBluetoothConnector.js
*/
export class WebBLEConnection {
  #connectedDeviceMacAddress: string

  #runtimeReference
  // private fields
  #service: BluetoothRemoteGATTService | null
  #networkChar: BluetoothRemoteGATTCharacteristic | null
  #clockChar: BluetoothRemoteGATTCharacteristic | null
  #deviceChar: BluetoothRemoteGATTCharacteristic | null
  #writing
  #uuidCounter

  #networkNotificationBuffer: Uint8Array | null

  constructor(runtimeReference: SpectodaRuntime) {
    this.#runtimeReference = runtimeReference

    this.#connectedDeviceMacAddress = '00:00:00:00:00:00'

    /*
      BLE Spectoda Service
    */
    this.#service = /** @type {BluetoothRemoteGATTService} */ null

    /*
      Network Characteristics governs the communication with the Spectoda Netwok.
      That means tngl uploads, timeline manipulation, event emitting...
      You can access it only if you are authenticated via the Device Characteristics
    */
    this.#networkChar = /** @type {BluetoothRemoteGATTCharacteristic} */ null // ? only accesable when connected to the mesh network

    /*
      The whole purpuse of clock characteristics is to synchronize clock time
      of the application with the Spectoda network
    */
    this.#clockChar = /** @type {BluetoothRemoteGATTCharacteristic} */ null // ? always accesable

    /*
      Device Characteristics is renamed Update Characteristics
      Device Characteristics handles ALL CONCEPTS WITH THE
      PHYSICAL CONNECTED CONTROLLER. On the other hand Network Characteristics
      handles concepts connected with the whole spectoda network - all devices
      With Device Charactristics you can upload FW to the single device,
      access and manipulate json config of the device, adopt device,
      and authenticate the application client with the spectoda network
    */
    this.#deviceChar = /** @type {BluetoothRemoteGATTCharacteristic} */ null

    /*
      simple mutex indicating that communication over BLE is in progress
    */
    this.#writing = false

    this.#uuidCounter = Math.floor(Math.random() * 4294967295)

    this.#networkNotificationBuffer = null
  }

  #getUUID() {
    // valid UUIDs are in range [1..4294967295] (32 bit number)
    if (this.#uuidCounter >= 4294967295) {
      this.#uuidCounter = 0
    }

    return ++this.#uuidCounter
  }

  #writeBytes(characteristic: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array, reliable: boolean) {
    const write_uuid = this.#getUUID() // two messages near to each other must not have the same UUID!
    const packet_header_size = 12 // 3x 4byte integers: write_uuid, index_from, payload.length
    const packet_size = detectAndroid() ? 212 : 512 // min size packet_header_size + 1 !!!! ANDROID NEEDS PACKET SIZE <= 212!!!!
    const bytes_size = packet_size - packet_header_size

    if (reliable) {
      return new Promise(async (resolve, reject) => {
        let index_from = 0
        let index_to = bytes_size

        while (index_from < bytes.length) {
          if (index_to > bytes.length) {
            index_to = bytes.length
          }

          const payload = [
            ...numberToBytes(write_uuid, 4),
            ...numberToBytes(index_from, 4),
            ...numberToBytes(bytes.length, 4),
            ...bytes.slice(index_from, index_to),
          ]

          try {
            await characteristic.writeValueWithResponse(new Uint8Array(payload))
          } catch (e) {
            logging.warn('characteristic.writeValueWithResponse() exception:', e)
            reject(e)
            return
          }

          index_from += bytes_size
          index_to = index_from + bytes_size
        }
        resolve(null)
        return
      })
    } else {
      if (bytes.length > bytes_size) {
        logging.error('The maximum bytes that can be written without response is ' + bytes_size)
        return Promise.reject('WriteError')
      }
      const payload = [
        ...numberToBytes(write_uuid, 4),
        ...numberToBytes(0, 4),
        ...numberToBytes(bytes.length, 4),
        ...bytes.slice(0, bytes.length),
      ]

      return characteristic.writeValueWithoutResponse(new Uint8Array(payload))
    }
  }

  #readBytes(characteristic: BluetoothRemoteGATTCharacteristic): Promise<Uint8Array> {
    // read the requested value

    // TODO write this function effectivelly
    return new Promise(async (resolve, reject) => {
      try {
        let bytes = new Uint8Array((await characteristic.readValue()).buffer)

        // logging.verbose(bytes);

        let total_bytes = [...bytes]

        while (bytes.length == 512) {
          bytes = new Uint8Array((await characteristic.readValue()).buffer)
          total_bytes = [...total_bytes, ...bytes]
        }

        // logging.verbose(total_bytes);

        resolve(new Uint8Array(total_bytes))
      } catch (e) {
        logging.error(e)
        reject('ReadError')
      }
    })
  }

  // WIP, event handling from spectoda network to application
  // timeline changes from spectoda network to application ...
  #onNetworkNotification(event: Event) {
    logging.verbose('WebBLEConnection::#onNetworkNotification()', event)

    const bluetoothCharacteristic = event.target as BluetoothRemoteGATTCharacteristic | null

    if (!bluetoothCharacteristic?.value?.buffer) {
      return
    }

    const payload = new Uint8Array(bluetoothCharacteristic.value.buffer)

    logging.debug(`payload.length=${payload.length}`, payload)

    if (this.#networkNotificationBuffer == null) {
      this.#networkNotificationBuffer = payload
    } else {
      // Create new array with combined length
      const newBuffer = new Uint8Array(this.#networkNotificationBuffer.length + payload.length)

      // Copy existing buffer
      newBuffer.set(this.#networkNotificationBuffer)
      // Append new payload at the end
      newBuffer.set(payload, this.#networkNotificationBuffer.length)
      this.#networkNotificationBuffer = newBuffer
    }

    const PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE = 208

    if (payload.length == PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE) {
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
        SpectodaWasm.connector_type_t.CONNECTOR_BLE,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.execute(commandBytes, DUMMY_WEBBLE_CONNECTION)
    }
  }

  #onClockNotification(event: Event) {
    logging.debug('WebBLEConnection::#onClockNotification', event)

    const bluetoothCharacteristic = event.target as BluetoothRemoteGATTCharacteristic | null

    if (!bluetoothCharacteristic?.value?.buffer) {
      return
    }

    const synchronizationBytes = new Uint8Array(bluetoothCharacteristic.value.buffer)

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

    const synchronization = SpectodaWasm.Synchronization.makeFromUint8Array(synchronizationBytes)

    const DUMMY_WEBBLE_CONNECTION = SpectodaWasm.Connection.make(
      '11:11:11:11:11:11',
      SpectodaWasm.connector_type_t.CONNECTOR_BLE,
      SpectodaWasm.connection_rssi_t.RSSI_MAX,
    )

    this.#runtimeReference.spectoda_js.synchronize(synchronization, DUMMY_WEBBLE_CONNECTION)
  }

  attach(
    service: BluetoothRemoteGATTService,
    networkUUID: BluetoothCharacteristicUUID,
    clockUUID: BluetoothCharacteristicUUID,
    deviceUUID: BluetoothCharacteristicUUID,
  ) {
    this.#service = service

    logging.info('> Getting Network Characteristics...')
    return this.#service
      .getCharacteristic(networkUUID)
      .then((characteristic) => {
        this.#networkChar = characteristic

        return this.#networkChar
          .startNotifications()
          .then(() => {
            logging.info('> Network notifications started')
            if (!this.#networkChar) {
              throw 'NetworkCharactristicsNull'
            }
            this.#networkChar.oncharacteristicvaluechanged = (event) => {
              this.#onNetworkNotification(event)
            }
          })
          .catch((e) => {
            logging.warn('this.#networkChar.startNotifications() exception:', e)
          })
      })
      .catch((e) => {
        logging.warn(e)
        throw 'ConnectionFailed'
      })
      .then(() => {
        logging.info('> Getting Clock Characteristics...')
        if (!this.#service) {
          throw 'ServiceNull'
        }
        return this.#service.getCharacteristic(clockUUID)
      })
      .then((characteristic) => {
        this.#clockChar = characteristic

        return this.#clockChar
          .startNotifications()
          .then(() => {
            logging.info('> Clock notifications started')
            if (!this.#clockChar) {
              throw 'ClockCharactristicsNull'
            }
            this.#clockChar.oncharacteristicvaluechanged = (event) => {
              this.#onClockNotification(event)
            }
          })
          .catch((e) => {
            logging.warn('this.#clockChar.startNotifications() exception:', e)
          })
      })
      .catch((e) => {
        logging.warn(e)
        throw 'ConnectionFailed'
      })
      .then(() => {
        logging.info('> Getting Device Characteristics...')
        if (!this.#service) {
          throw 'ServiceNull'
        }
        return this.#service.getCharacteristic(deviceUUID)
      })
      .then((characteristic) => {
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
  deliver(payload_bytes: Uint8Array, timeout_number: number): Promise<unknown> {
    if (!this.#networkChar) {
      logging.warn('Network characteristics is null')
      return Promise.reject('DeliverFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('DeliverFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#networkChar, payload_bytes, true)
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
  transmit(payload_bytes: Uint8Array, timeout_number: number): Promise<unknown> {
    if (!this.#networkChar) {
      logging.warn('Network characteristics is null')
      return Promise.reject('TransmitFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('TransmitFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#networkChar, payload_bytes, false)
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
  request(payload_bytes: Uint8Array, read_response: boolean, timeout_number: number): Promise<Uint8Array | null> {
    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      return Promise.reject('RequestFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('RequestFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#deviceChar, payload_bytes, true)
      .then(() => {
        if (read_response) {
          if (!this.#deviceChar) {
            throw 'DeviceCharactristicsNull'
          }
          return this.#readBytes(this.#deviceChar)
        } else {
          return null
        }
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
  writeClock(timestamp: number) {
    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('ClockWriteFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('ClockWriteFailed')
    }

    this.#writing = true

    const bytes = toBytes(timestamp, 8)

    return this.#clockChar
      .writeValueWithoutResponse(new Uint8Array(bytes))
      .then(() => {
        logging.debug('Clock characteristics written')
      })
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
  readClock(): Promise<number> {
    // return Promise.reject("SimulatedFail");

    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('ClockReadFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('ClockReadFailed')
    }

    this.#writing = true

    return this.#clockChar
      .readValue()
      .then((dataView) => {
        const reader = new TnglReader(new Uint8Array(dataView.buffer))

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

  updateFirmware(firmware_bytes: Uint8Array): Promise<unknown> {
    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      return Promise.reject('UpdateFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('UpdateFailed')
    }

    logging.info('> Writing firmware to controller...')

    this.#writing = true

    return new Promise(async (resolve, reject) => {
      const chunk_size = detectAndroid() ? 1008 : 4992 // must be modulo 16

      let index_from = 0
      let index_to = chunk_size

      let written = 0

      logging.debug('OTA UPDATE')
      logging.debug(firmware_bytes)

      const start_timestamp = Date.now()

      if (!this.#deviceChar) {
        throw 'DeviceCharactristicsNull'
      }

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.debug('OTA RESET')

          const bytes = [COMMAND_FLAGS.FLAG_OTA_RESET, 0x00, ...numberToBytes(0x00000000, 4)]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.debug('OTA BEGIN')

          const bytes = [COMMAND_FLAGS.FLAG_OTA_BEGIN, 0x00, ...numberToBytes(firmware_bytes.length, 4)]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(8000) // need to wait 10 seconds to let the ESP erase the flash.

        {
          //===========// WRITE //===========//
          logging.debug('OTA WRITE')

          while (written < firmware_bytes.length) {
            if (index_to > firmware_bytes.length) {
              index_to = firmware_bytes.length
            }

            const bytes = [
              COMMAND_FLAGS.FLAG_OTA_WRITE,
              0x00,
              ...numberToBytes(written, 4),
              ...firmware_bytes.slice(index_from, index_to),
            ]

            await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
            written += index_to - index_from

            const percentage = Math.floor((written * 10000) / firmware_bytes.length) / 100

            logging.debug(percentage + '%')

            this.#runtimeReference.emit(SpectodaAppEvents.OTA_PROGRESS, percentage)

            index_from += chunk_size
            index_to = index_from + chunk_size
          }
        }

        await sleep(100)

        {
          //===========// END //===========//
          logging.debug('OTA END')

          const bytes = [COMMAND_FLAGS.FLAG_OTA_END, 0x00, ...numberToBytes(written, 4)]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(2000)

        logging.info('> Firmware written in ' + (Date.now() - start_timestamp) / 1000 + ' seconds')

        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
        resolve(null)
      } catch (e) {
        logging.error(e)
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
        reject('UpdateFailed')
      }
    }).finally(() => {
      this.#writing = false
    })
  }

  // resets the Communations, discarding command queue
  reset(): void {
    this.#service = null
    this.#networkChar = null
    this.#clockChar = null
    this.#deviceChar = null
    this.#writing = false
    this.#networkNotificationBuffer = null
  }

  destroy(): void {
    this.reset()
  }

  // write timestamp to clock characteristics as fast as possible
  sendSynchronize(synchronization: Synchronization) {
    if (!this.#clockChar) {
      logging.warn('Sync characteristics is null')
      return Promise.reject('sendSynchronizeFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('sendSynchronizeFailed')
    }

    this.#writing = true

    const bytes_uint8array = synchronization.toUint8Array()

    return this.#clockChar
      .writeValueWithoutResponse(bytes_uint8array)
      .then(() => {
        logging.debug('Clock characteristics written')
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
export class SpectodaWebBluetoothConnector {
  #runtimeReference

  #webBTDevice: BluetoothDevice | null
  #connection: WebBLEConnection
  #reconection: boolean
  #criteria: SpectodaTypes['Criteria']
  #connectedGuard: boolean

  type: string
  SPECTODA_SERVICE_UUID: string
  SPECTODA_ADOPTING_SERVICE_UUID: string
  NETWORK_CHAR_UUID: string
  CLOCK_CHAR_UUID: string
  DEVICE_CHAR_UUID: string

  constructor(runtimeReference: SpectodaRuntime) {
    this.type = 'webbluetooth'

    this.#runtimeReference = runtimeReference

    this.SPECTODA_SERVICE_UUID = 'cc540e31-80be-44af-b64a-5d2def886bf5'
    this.SPECTODA_ADOPTING_SERVICE_UUID = '723247e6-3e2d-4279-ad8e-85a13b74d4a5'

    this.NETWORK_CHAR_UUID = '33a0937e-0c61-41ea-b770-007ade2c79fa'
    this.CLOCK_CHAR_UUID = '7a1e0e3a-6b9b-49ef-b9b7-65c81b714a19'
    this.DEVICE_CHAR_UUID = '9ebe2e4b-10c7-4a81-ac83-49540d1135a5'

    this.#webBTDevice = null
    this.#connection = new WebBLEConnection(runtimeReference)
    this.#reconection = false
    this.#criteria = [{}]

    this.#connectedGuard = false

    // TODO unregister event listener on connector destroy
    this.#runtimeReference.on(SpectodaAppEvents.PRIVATE_CONNECTED, () => {
      this.#connectedGuard = true
    })

    // TODO unregister event listener on connector destroy
    this.#runtimeReference.on(SpectodaAppEvents.PRIVATE_DISCONNECTED, () => {
      this.#connectedGuard = false
    })
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
    logging.debug(`userSelect(criteria=${criterium_array}, timeout=${timeout_number})`)

    if (this.#connected()) {
      return this.disconnect()
        .then(() => {
          return sleep(1000)
        })
        .then(() => {
          return this.userSelect(criterium_array, timeout_number)
        })
    }

    this.#criteria = criterium_array

    let web_ble_options: RequestDeviceOptions = {
      filters: [],
      optionalServices: [this.SPECTODA_SERVICE_UUID],
    }

    //
    if (this.#criteria.length === 0) {
      web_ble_options.filters.push({ services: [this.SPECTODA_SERVICE_UUID] })
      // web_ble_options.filters.push({ services: [this.SPECTODA_ADOPTING_SERVICE_UUID] });
    }

    //
    else {
      const legacy_filters_applied = false

      for (let i = 0; i < this.#criteria.length; i++) {
        const criterium = this.#criteria[i]

        const filter: any = { services: [this.SPECTODA_SERVICE_UUID] }

        if (criterium.name) {
          filter.name = criterium.name
        } else if (criterium.nameprefix) {
          filter.nameprefix = criterium.nameprefix
        }

        // if any of these criteria are required, then we need to build a manufacturer data filter.
        if (criterium.fw || criterium.network || criterium.product || criterium.commisionable) {
          const company_identifier = 0x02e5 // Bluetooth SIG company identifier of Espressif

          delete filter.services

          const prefix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
          const mask = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

          if (criterium.product) {
            if (criterium.product < 0 || criterium.product > 0xffff) {
              throw 'InvalidProductCode'
            }

            const product_code_byte_offset = 2
            const product_code_bytes = [criterium.product & 0xff, (criterium.product >> 8) & 0xff]

            for (let i = 0; i < 2; i++) {
              prefix[product_code_byte_offset + i] = product_code_bytes[i]
              mask[product_code_byte_offset + i] = 0xff
            }
          }

          if (criterium.network) {
            if (criterium.network.length != 32) {
              throw 'InvalidOwnerSignature'
            }

            const owner_signature_byte_offset = 4
            const owner_signature_code_bytes = hexStringToUint8Array(criterium.network, 32)

            for (let i = 0; i < 16; i++) {
              prefix[owner_signature_byte_offset + i] = owner_signature_code_bytes[i]
              mask[owner_signature_byte_offset + i] = 0xff
            }
          }

          if (criterium.commisionable) {
            const other_flags_offset = 20

            let flags_prefix = 0b00000000
            const flags_mask = 0b11111111

            if (criterium.commisionable === true) {
              const adoption_flag_bit_pos = 0

              flags_prefix |= 1 << adoption_flag_bit_pos
            }

            prefix[other_flags_offset] = flags_prefix
            mask[other_flags_offset] = flags_mask
          }

          if (criterium.fw) {
            const fw_version_byte_offset = 0
            const reg = criterium.fw.match(/(!?)(\d+).(\d+).(\d+)/)

            if (!reg) {
              throw 'InvalidFirmwareVersion'
            }

            const version_code = Number(reg[2]) * 10000 + Number(reg[3]) * 100 + Number(reg[4]) * 1
            const version_bytes = [version_code & 0xff, (version_code >> 8) & 0xff]

            if (reg[1] === '!') {
              // workaround for web bluetooth not having a filter for "if the manufacturer data are not this, then show me the device"
              // we will generate 16 filters, each filtering one of the 16 bits that is different from my version.
              // if the one bit is different, then the version of the found device is different than mine.
              // and thats what we need.

              filter.manufacturerData = []

              for (let i = 0; i < 2; i++) {
                // version is defined as 2 bytes
                for (let j = 0; j < 8; j++) {
                  // each byte 8 bits

                  for (let k = 0; k < 2; k++) {
                    prefix[fw_version_byte_offset + k] = 0
                    mask[fw_version_byte_offset + k] = 0
                  }

                  prefix[fw_version_byte_offset + i] = ~(version_bytes[i] & (1 << j))
                  mask[fw_version_byte_offset + i] = 1 << j

                  // TODO Add data validation
                  const filter_clone = JSON.parse(JSON.stringify(filter)) as any

                  filter_clone.manufacturerData = [
                    {
                      companyIdentifier: company_identifier,
                      dataPrefix: new Uint8Array(prefix),
                      mask: new Uint8Array(mask),
                    },
                  ]
                  web_ble_options.filters.push(filter_clone)
                }
              }
            } else {
              for (let i = 0; i < 2; i++) {
                prefix[fw_version_byte_offset + i] = version_bytes[i]
                mask[fw_version_byte_offset + i] = 0xff
              }
              filter.manufacturerData = [
                {
                  companyIdentifier: company_identifier,
                  dataPrefix: new Uint8Array(prefix),
                  mask: new Uint8Array(mask),
                },
              ]
              web_ble_options.filters.push(filter)
            }
          } else {
            filter.manufacturerData = [
              {
                companyIdentifier: company_identifier,
                dataPrefix: new Uint8Array(prefix),
                mask: new Uint8Array(mask),
              },
            ]
            web_ble_options.filters.push(filter)
          }
        } else {
          web_ble_options.filters.push(filter)
        }
      }
    }

    if (web_ble_options.filters.length === 0) {
      web_ble_options = {
        // TODO Remove "allDevices" reference
        acceptAllDevices: true,
        optionalServices: [this.SPECTODA_SERVICE_UUID],
      }
    }

    // logging.debug(web_ble_options);

    return navigator.bluetooth
      .requestDevice(web_ble_options)
      .catch((e) => {
        logging.error(e)
        throw 'UserCanceledSelection'
      })
      .then((device) => {
        // logging.debug(device);

        this.#webBTDevice = device

        this.#webBTDevice.ongattserverdisconnected = () => {
          this.#onDisconnected(null)
        }

        return { connector: this.type }
      })
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

    // step 1. for the scan_period scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout,
    //         then return error

    if (this.#connected()) {
      return this.disconnect()
        .then(() => {
          return sleep(1000)
        })
        .then(() => {
          return this.autoSelect(criterium_array, scan_duration_number, timeout_number)
        })
    }

    // // web bluetooth cant really auto select bluetooth device. This is the closest you can get.
    // if (this.#selected() && criteria.network === this.#criteria.network) {
    //   return Promise.resolve();
    // }

    // If the device was choosen previously, then do not show popup
    if (this.#criteria == criterium_array && this.#webBTDevice) {
      return Promise.resolve({ connector: this.type })
    }

    this.#criteria = criterium_array

    // Web Bluetooth nepodporuje možnost automatické volby zařízení.
    // Proto je to tady implementováno totožně jako userSelect.

    // Since we cannot auto-select, we fallback to userSelect
    return this.userSelect(criterium_array, timeout_number)
  }

  // if device is conneced, then disconnect it
  unselect(): Promise<null> {
    return (this.#connected() ? this.disconnect() : Promise.resolve()).then(() => {
      this.#webBTDevice = null
      this.#connection.reset()
      return null
    })
  }

  // #selected returns boolean if a device is selected
  #selected() {
    return this.#webBTDevice ? true : false
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    return Promise.resolve(this.#selected() ? { connector: this.type } : null)
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
    return Promise.resolve([])
  }

  // connect Connector to the selected Spectoda Device. Also can be used to reconnect.
  // Fails if no device is selected
  connect(timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium'] | null> {
    if (timeout === DEFAULT_TIMEOUT) {
      timeout = 10000
    }
    logging.verbose(`connect(timeout=${timeout})`)

    if (timeout <= 0) {
      logging.debug('> Connect timeout has expired')
      return Promise.reject('ConnectionTimeout')
    }

    const start = Date.now()

    this.#reconection = true

    if (!this.#selected()) {
      return Promise.reject('DeviceNotSelected')
    }

    const MINIMUM_CONNECT_TIMEOUT = 10000
    const effectiveTimeout = Math.max(timeout, MINIMUM_CONNECT_TIMEOUT)

    // Create a promise that rejects after the timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject('ConnectionTimeout')
      }, effectiveTimeout)
    })

    // Create the connection promise
    const connectionPromise = (async () => {
      try {
        logging.debug('> Connecting to Bluetooth device...')
        const server = await this.#webBTDevice?.gatt?.connect()

        if (!server) {
          throw new Error('Failed to connect')
        }

        this.#connection.reset()
        logging.debug('> Getting the Bluetooth Service...')
        const service = await server.getPrimaryService(this.SPECTODA_SERVICE_UUID)

        logging.debug('> Getting the Service Characteristic...')
        await this.#connection.attach(service, this.NETWORK_CHAR_UUID, this.CLOCK_CHAR_UUID, this.DEVICE_CHAR_UUID)

        logging.debug('> Bluetooth Device Connected')
        if (!this.#connectedGuard) {
          this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
        }
        return { connector: 'webbluetooth' }
      } catch (error: any) {
        logging.error(error)

        logging.debug(this.#webBTDevice)
        this.#webBTDevice?.gatt?.disconnect()

        if (error.toString().includes('Bluetooth Device is no longer in range')) {
          throw 'ConnectionFailed'
        }

        // If the device is far away, sometimes this "NetworkError" happens
        if (error.name === 'NetworkError') {
          await sleep(1000)
          if (this.#reconection) {
            const passed = Date.now() - start
            const remainingTimeout = timeout - passed

            return this.connect(remainingTimeout)
          }
          throw 'ConnectionFailed'
        }
        throw error
      }
    })()

    // Race between the connection attempt and the timeout
    return Promise.race([connectionPromise, timeoutPromise])
  }

  // there #connected returns boolean true if connected, false if not connected
  #connected() {
    return this.#webBTDevice && this.#webBTDevice?.gatt?.connected
  }

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('connected()')
    return Promise.resolve(this.#connected() ? { connector: this.type } : null)
  }

  #disconnect() {
    this.#webBTDevice?.gatt?.disconnect()
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect(): Promise<unknown> {
    logging.verbose('disconnect()')

    this.#reconection = false

    logging.info('> Disconnecting from Bluetooth Device...')

    this.#connection.reset()

    if (this.#connected()) {
      this.#disconnect()
    } else {
      logging.debug('Bluetooth Device is already disconnected')
    }

    return Promise.resolve()
  }

  // when the device is disconnected, the javascript Connector.js layer decides
  // if it should be revonnected. Here is implemented that it should be
  // reconnected only if the this.#reconection is true. The event handlers are fired
  // synchronously. So that only after all event handlers (one after the other) are done,
  // only then start this.connect() to reconnect to the bluetooth device
  #onDisconnected = (event: any) => {
    logging.info('> Bluetooth Device disconnected')
    this.#connection.reset()
    if (this.#connectedGuard) {
      logging.verbose('emitting #disconnected')
      this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
    }
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

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.deliver(payload_bytes, timeout_number)
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

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.transmit(payload_bytes, timeout_number)
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
    logging.verbose(`request(payload=${payload_bytes}, read_response=${read_response}, timeout=${timeout_number})`)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.request(payload_bytes, read_response, timeout_number)
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.verbose('setClock()')

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        try {
          await this.#connection.writeClock(clock.millis())
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

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return new Promise(async (resolve, reject) => {
      for (let index = 0; index < 3; index++) {
        await sleep(100)
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
  updateFW(firmware_bytes: Uint8Array): Promise<unknown> {
    logging.debug('updateFW()', firmware_bytes)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.updateFirmware(firmware_bytes)
  }

  cancel(): void {
    // TODO implement
  }

  destroy(): Promise<unknown> {
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
      `SpectodaWebBluetoothConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_BLE) {
      return Promise.resolve()
    }

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.deliver(command_bytes, 1000)
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaWebBluetoothConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    return this.request(request_bytecode, false, 10000)
  }
  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

  sendResponse(
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Array,
    destination_connection: Connection,
  ) {
    logging.verbose(
      `SpectodaWebBluetoothConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.reject('NotImplemented')
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaWebBluetoothConnector::sendSynchronize(synchronization=${synchronization}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_BLE) {
      return Promise.resolve()
    }

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.sendSynchronize(synchronization)
  }
}
