// @ts-nocheck
// npm install --save-dev @types/web-bluetooth
/// <reference types="web-bluetooth" />

import {
  detectAndroid,
  hexStringToUint8Array,
  numberToBytes,
  sleep,
  toBytes,
} from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack.js'
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

/////////////////////////////////////////////////////////////////////////////////////
// WebBluetooth device cache
//
// WebBluetooth doesn't provide background scanning, but it *can* return previously
// permitted devices via `navigator.bluetooth.getDevices()`.
//
// We additionally persist a mapping between a controller MAC (provided via strict
// criterium.mac) and BluetoothDevice.id, so later calls to autoSelect({mac})
// can select the device without showing the chooser popup.

type WebBluetoothCacheEntry = {
  deviceId: string
  lastUsedUnixMs: number
  name?: string
}

type WebBluetoothCacheStorage = {
  version: 1
  byMac: Record<string, WebBluetoothCacheEntry>
}

const WEB_BLUETOOTH_CACHE_STORAGE_KEY = 'spectoda.webbluetooth.cachedDevices.v1'
const WEB_BLUETOOTH_CACHE_TTL_UNIX_MS = 10 * 60 * 1000

const normalizeMac = (mac: string): string => {
  return mac.replace(/[\n\r\s\t]+/g, '').toUpperCase()
}

const isStrictMacCriteria = (
  criteriumArray: Array<Criterium>,
): string | null => {
  if (!Array.isArray(criteriumArray) || criteriumArray.length !== 1) {
    return null
  }

  const criterium = criteriumArray[0] as unknown

  if (!criterium || typeof criterium !== 'object') {
    return null
  }

  const mac = (criterium as { mac?: unknown }).mac

  if (typeof mac !== 'string') {
    return null
  }

  return normalizeMac(mac)
}

const readWebBluetoothCacheStorage = (): WebBluetoothCacheStorage => {
  if (typeof localStorage === 'undefined') {
    return { version: 1, byMac: {} }
  }

  try {
    const raw = localStorage.getItem(WEB_BLUETOOTH_CACHE_STORAGE_KEY)

    if (!raw) {
      return { version: 1, byMac: {} }
    }

    const parsed = JSON.parse(raw) as WebBluetoothCacheStorage

    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.byMac !== 'object' ||
      parsed.byMac == null
    ) {
      return { version: 1, byMac: {} }
    }

    return parsed
  } catch {
    return { version: 1, byMac: {} }
  }
}

const writeWebBluetoothCacheStorage = (
  storage: WebBluetoothCacheStorage,
): void => {
  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.setItem(
      WEB_BLUETOOTH_CACHE_STORAGE_KEY,
      JSON.stringify(storage),
    )
  } catch {
    // ignore (storage quota / privacy mode)
  }
}

const getBluetoothDeviceId = (device: unknown): string | null => {
  if (!device || typeof device !== 'object') {
    return null
  }

  const id = (device as { id?: unknown }).id

  return typeof id === 'string' ? id : null
}

const getBluetoothDeviceName = (device: unknown): string | undefined => {
  if (!device || typeof device !== 'object') {
    return undefined
  }

  const name = (device as { name?: unknown }).name

  return typeof name === 'string' ? name : undefined
}

const WEB_BLUETOOTH_DEVICE_BY_MAC = new Map<string, unknown>()

let WEB_BLUETOOTH_CACHE_LOADED = false
let WEB_BLUETOOTH_CACHE_LOADING: Promise<void> | null = null

const pruneWebBluetoothCache = (): void => {
  const now = Date.now()
  const storage = readWebBluetoothCacheStorage()

  let changed = false

  for (const mac of Object.keys(storage.byMac)) {
    const entry = storage.byMac[mac]

    if (!entry || typeof entry.lastUsedUnixMs !== 'number') {
      delete storage.byMac[mac]
      WEB_BLUETOOTH_DEVICE_BY_MAC.delete(normalizeMac(mac))
      changed = true
      continue
    }

    if (now - entry.lastUsedUnixMs > WEB_BLUETOOTH_CACHE_TTL_UNIX_MS) {
      delete storage.byMac[mac]
      WEB_BLUETOOTH_DEVICE_BY_MAC.delete(normalizeMac(mac))
      changed = true
    }
  }

  if (changed) {
    writeWebBluetoothCacheStorage(storage)
  }
}

const loadPermittedWebBluetoothDevicesIntoCache = async (): Promise<void> => {
  if (WEB_BLUETOOTH_CACHE_LOADED) {
    return
  }

  if (WEB_BLUETOOTH_CACHE_LOADING) {
    return WEB_BLUETOOTH_CACHE_LOADING
  }

  WEB_BLUETOOTH_CACHE_LOADING = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const getDevices = navigator?.bluetooth?.getDevices

      if (typeof getDevices !== 'function') {
        WEB_BLUETOOTH_CACHE_LOADED = true
        return
      }

      const permittedDevices = (await getDevices.call(
        navigator.bluetooth,
      )) as unknown[]

      pruneWebBluetoothCache()
      const storage = readWebBluetoothCacheStorage()

      const deviceById = new Map<string, unknown>()

      for (const device of permittedDevices) {
        const id = getBluetoothDeviceId(device)

        if (id) {
          deviceById.set(id, device)
        }
      }

      for (const mac of Object.keys(storage.byMac)) {
        const entry = storage.byMac[mac]

        if (!entry || typeof entry.deviceId !== 'string') {
          continue
        }

        const device = deviceById.get(entry.deviceId)

        if (!device) {
          continue
        }

        WEB_BLUETOOTH_DEVICE_BY_MAC.set(normalizeMac(mac), device)
      }

      WEB_BLUETOOTH_CACHE_LOADED = true
    } catch (e) {
      logging.warn('WebBluetooth getDevices() cache init failed:', e)
      WEB_BLUETOOTH_CACHE_LOADED = true
    } finally {
      WEB_BLUETOOTH_CACHE_LOADING = null
    }
  })()

  return WEB_BLUETOOTH_CACHE_LOADING
}

const rememberWebBluetoothDeviceForMac = (
  mac: string,
  device: unknown,
): void => {
  const normalizedMac = normalizeMac(mac)

  const deviceId = getBluetoothDeviceId(device)

  if (!deviceId) {
    return
  }

  WEB_BLUETOOTH_DEVICE_BY_MAC.set(normalizedMac, device)

  const storage = readWebBluetoothCacheStorage()

  storage.byMac[normalizedMac] = {
    deviceId,
    lastUsedUnixMs: Date.now(),
    name: getBluetoothDeviceName(device),
  }

  writeWebBluetoothCacheStorage(storage)
}

const removeWebBluetoothDeviceForMac = (mac: string): void => {
  const normalizedMac = normalizeMac(mac)

  WEB_BLUETOOTH_DEVICE_BY_MAC.delete(normalizedMac)

  const storage = readWebBluetoothCacheStorage()

  delete storage.byMac[normalizedMac]
  writeWebBluetoothCacheStorage(storage)
}

const getErrorName = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null
  }

  const name = (error as { name?: unknown }).name

  return typeof name === 'string' ? name : null
}

const getErrorString = (error: unknown): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(error)
  } catch {
    return ''
  }
}

const isWebBluetoothOutOfRangeLikeError = (error: unknown): boolean => {
  const message = getErrorString(error)

  if (message.includes('Bluetooth Device is no longer in range')) {
    return true
  }

  // Chrome sometimes surfaces this as NetworkError for similar conditions
  const name = getErrorName(error)

  if (name === 'NetworkError') {
    return true
  }

  return false
}

// NOTE: We intentionally do not keep a "refresh device handle" helper here.
// If the cached device object becomes stale, we remove the mapping and force
// a fresh chooser selection on the next autoSelect/userSelect.

/*
    is renamed Transmitter. Helper class for WebBluetoothConnector.js
*/
export class WebBLEConnection {
  #runtimeReference
  // private fields
  #service: BluetoothRemoteGATTService | null
  #networkChar: BluetoothRemoteGATTCharacteristic | null
  #clockChar: BluetoothRemoteGATTCharacteristic | null
  #deviceChar: BluetoothRemoteGATTCharacteristic | null
  #writing
  #uuidCounter
  #connectedDeviceMacAddress: string

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

  #writeBytes(
    characteristic: BluetoothRemoteGATTCharacteristic,
    bytes: Uint8Array,
    reliable: boolean,
  ) {
    const writeUuid = this.#getUUID() // two messages near to each other must not have the same UUID!
    const packetHeaderSize = 12 // 3x 4byte integers: write_uuid, index_from, payload.length
    const packetSize = detectAndroid() ? 212 : 512 // min size packet_header_size + 1 !!!! ANDROID NEEDS PACKET SIZE <= 212!!!!
    const bytesSize = packetSize - packetHeaderSize

    if (reliable) {
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
            await characteristic.writeValueWithResponse(new Uint8Array(payload))
          } catch (e) {
            logging.warn(
              'characteristic.writeValueWithResponse() exception:',
              e,
            )
            reject(e)
            return
          }

          indexFrom += bytesSize
          indexTo = indexFrom + bytesSize
        }
        resolve(null)
        return
      })
    } else {
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

      return characteristic.writeValueWithoutResponse(new Uint8Array(payload))
    }
  }

  #readBytes(
    characteristic: BluetoothRemoteGATTCharacteristic,
  ): Promise<Uint8Array> {
    // read the requested value

    // TODO write this function effectivelly
    return new Promise(async (resolve, reject) => {
      try {
        let bytes = new Uint8Array((await characteristic.readValue()).buffer)

        // logging.verbose(bytes);

        let totalBytes = [...bytes]

        while (bytes.length === PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE) {
          bytes = new Uint8Array((await characteristic.readValue()).buffer)
          totalBytes = [...totalBytes, ...bytes]
        }

        // logging.verbose(total_bytes);

        resolve(new Uint8Array(totalBytes))
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

    const bluetoothCharacteristic =
      event.target as BluetoothRemoteGATTCharacteristic | null

    if (!bluetoothCharacteristic?.value?.buffer) {
      return
    }

    const payload = new Uint8Array(bluetoothCharacteristic.value.buffer)

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

  #onClockNotification(event: Event) {
    logging.debug('WebBLEConnection::#onClockNotification', event)

    const bluetoothCharacteristic =
      event.target as BluetoothRemoteGATTCharacteristic | null

    if (!bluetoothCharacteristic?.value?.buffer) {
      return
    }

    const synchronizationBytes = new Uint8Array(
      bluetoothCharacteristic.value.buffer,
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
    service: BluetoothRemoteGATTService,
    networkUUID: BluetoothCharacteristicUUID,
    clockUUID: BluetoothCharacteristicUUID,
    deviceUUID: BluetoothCharacteristicUUID,
  ) {
    this.#service = service

    logging.debug('Getting Network Characteristics...')
    return this.#service
      .getCharacteristic(networkUUID)
      .then((characteristic) => {
        this.#networkChar = characteristic

        return this.#networkChar
          .startNotifications()
          .then(() => {
            logging.debug('Network notifications started')
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
        logging.debug('Getting Clock Characteristics...')
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
            logging.debug('Clock notifications started')
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
        logging.debug('Getting Device Characteristics...')
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
  deliver(payloadBytes: Uint8Array, _timeoutNumber: number): Promise<unknown> {
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
  transmit(payloadBytes: Uint8Array, _timeoutNumber: number): Promise<unknown> {
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
    _timeoutNumber: number,
  ): Promise<Uint8Array | null> {
    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      return Promise.reject('RequestFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('RequestFailed')
    }

    this.#writing = true

    return this.#writeBytes(this.#deviceChar, payloadBytes, true)
      .then(() => {
        if (readResponse) {
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
        logging.verbose('Clock characteristics written')
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

  updateFirmware(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    if (!this.#deviceChar) {
      logging.warn('Device characteristics is null')
      return Promise.reject('UpdateFailed')
    }

    if (this.#writing) {
      logging.warn('Communication in proccess')
      return Promise.reject('UpdateFailed')
    }

    logging.info('> Writing Firmware to Controller...')

    this.#writing = true

    return new Promise(async (resolve, reject) => {
      const chunkSize = detectAndroid() ? 1008 : 4992 // must be modulo 16

      let indexFrom = 0
      let indexTo = chunkSize

      let written = 0

      logging.debug('OTA UPDATE')

      const startTimestamp = Date.now()

      if (!this.#deviceChar) {
        throw 'DeviceCharactristicsNull'
      }

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.debug('OTA RESET')

          const bytes = [
            COMMAND_FLAGS.FLAG_OTA_RESET,
            0x00,
            ...numberToBytes(0x00000000, 4),
          ]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.debug('OTA BEGIN')

          const bytes = [
            COMMAND_FLAGS.FLAG_OTA_BEGIN,
            0x00,
            ...numberToBytes(firmwareBytes.length, 4),
          ]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(8000) // need to wait 10 seconds to let the ESP erase the flash.
        //===========// WRITE //===========//
        logging.debug('OTA WRITE')

        while (written < firmwareBytes.length) {
          if (indexTo > firmwareBytes.length) {
            indexTo = firmwareBytes.length
          }

          const bytes = [
            COMMAND_FLAGS.FLAG_OTA_WRITE,
            0x00,
            ...numberToBytes(written, 4),
            ...firmwareBytes.slice(indexFrom, indexTo),
          ]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
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

          const bytes = [
            COMMAND_FLAGS.FLAG_OTA_END,
            0x00,
            ...numberToBytes(written, 4),
          ]

          await this.#writeBytes(this.#deviceChar, new Uint8Array(bytes), true)
        }

        await sleep(2000)

        logging.info(
          '> Firmware written in ' +
            (Date.now() - startTimestamp) / 1000 +
            ' seconds',
        )

        if (skipReboot) {
          logging.info('Firmware written, skipping reboot as requested')
        }

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

    const bytesUint8array = synchronization.toUint8Array()

    return this.#clockChar
      .writeValueWithoutResponse(bytesUint8array)
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
// State for the user gesture dialog used when WebBluetooth popup requires a user gesture
type UserGestureDialogState = {
  dialogElement: HTMLElement
  resolve: () => void
  reject: (reason: string) => void
}

export class SpectodaWebBluetoothConnector {
  #runtimeReference

  #webBTDevice: BluetoothDevice | null
  #connection: WebBLEConnection
  #reconection: boolean
  #criteria: Criteria
  #connectedGuard: boolean

  // State for the user gesture dialog that can be dismissed via cancel()
  #userGestureDialogState: UserGestureDialogState | null

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
    this.#userGestureDialogState = null

    // TODO unregister event listener on connector destroy
    this.#runtimeReference.on(SpectodaAppEvents.PRIVATE_CONNECTED, () => {
      this.#connectedGuard = true
    })

    // TODO unregister event listener on connector destroy
    this.#runtimeReference.on(SpectodaAppEvents.PRIVATE_DISCONNECTED, () => {
      this.#connectedGuard = false
    })
  }

  /**
   * Shows a dialog prompting the user to click OK before showing the WebBluetooth popup.
   * This is needed when userSelect is called programmatically (e.g., via Remote Control)
   * because WebBluetooth requires a user gesture to show the device selection popup.
   *
   * The dialog can be dismissed by calling cancel().
   *
   * IMPORTANT: The webBleOptions are passed in and requestDevice is called directly
   * in the click handler to ensure the user gesture is still "fresh" when the
   * WebBluetooth API is invoked.
   *
   * @param webBleOptions - The options to pass to navigator.bluetooth.requestDevice()
   * @returns Promise that resolves with the selected BluetoothDevice, or rejects with 'UserCanceledSelection'
   */
  #showUserGestureDialog(
    webBleOptions: RequestDeviceOptions,
  ): Promise<BluetoothDevice> {
    return new Promise((resolve, reject) => {
      // Clean up any existing dialog
      this.#dismissUserGestureDialog()

      // Create overlay - matches Spectoda app's dialog overlay (bg-black opacity-60)
      const overlay = document.createElement('div')

      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        padding: 24px;
        box-sizing: border-box;
      `

      // Create dialog box - matches Spectoda app's DialogContent styling
      const dialog = document.createElement('div')

      dialog.style.cssText = `
        background: #242424;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        padding: 16px;
        max-width: 320px;
        width: 100%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      `

      // Title - matches Spectoda app's R.Title styling
      const title = document.createElement('h2')

      title.textContent = 'Select Controller'
      title.style.cssText = `
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 500;
        color: rgba(255, 255, 255, 1);
        line-height: 1.4;
      `

      // Message - matches Spectoda app's description styling (text-white-48 text-sm)
      const message = document.createElement('p')

      message.textContent =
        'Click OK to open the Bluetooth device selector. Select your Controller from the list and click "Pair" to connect.'
      message.style.cssText = `
        margin: 0 0 16px 0;
        font-size: 14px;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.48);
      `

      // Button container - matches Spectoda app's button layout
      const buttonContainer = document.createElement('div')

      buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      `

      // Cancel button - matches Spectoda app's secondary button (bg-white-12)
      const cancelButton = document.createElement('button')

      cancelButton.textContent = 'Cancel'
      cancelButton.style.cssText = `
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        border: none;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 1);
        cursor: pointer;
        transition: background-color 0.15s ease;
        flex: 1;
      `
      cancelButton.addEventListener('mouseenter', () => {
        cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.16)'
      })
      cancelButton.addEventListener('mouseleave', () => {
        cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'
      })

      // OK button - matches Spectoda app's primary button (bg-white-100 text-black)
      const okButton = document.createElement('button')

      okButton.textContent = 'OK'
      okButton.style.cssText = `
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        border: none;
        border-radius: 12px;
        background: rgba(255, 255, 255, 1);
        color: #000000;
        cursor: pointer;
        transition: background-color 0.15s ease;
        flex: 1;
      `
      okButton.addEventListener('mouseenter', () => {
        okButton.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      })
      okButton.addEventListener('mouseleave', () => {
        okButton.style.backgroundColor = 'rgba(255, 255, 255, 1)'
      })

      // Assemble dialog
      buttonContainer.appendChild(cancelButton)
      buttonContainer.appendChild(okButton)
      dialog.appendChild(title)
      dialog.appendChild(message)
      dialog.appendChild(buttonContainer)
      overlay.appendChild(dialog)

      // Store state so cancel() can dismiss the dialog
      this.#userGestureDialogState = {
        dialogElement: overlay,
        resolve: () => {
          // This won't be called directly - see handleOk
        },
        reject: (reason: string) => reject(reason),
      }

      // Event handlers
      const handleOk = () => {
        this.#dismissUserGestureDialog()

        // Call requestDevice DIRECTLY in the click handler to ensure user gesture is fresh
        navigator.bluetooth
          .requestDevice(webBleOptions)
          .then((device) => {
            resolve(device)
          })
          .catch((e) => {
            logging.error(e)
            reject('UserCanceledSelection')
          })
      }

      const handleCancel = () => {
        this.#dismissUserGestureDialog()
        reject('UserCanceledSelection')
      }

      okButton.addEventListener('click', handleOk)
      cancelButton.addEventListener('click', handleCancel)

      // Also allow closing by clicking the overlay background
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel()
        }
      })

      // Append to body
      document.body.appendChild(overlay)

      // Focus the OK button for accessibility
      okButton.focus()
    })
  }

  /**
   * Dismisses the user gesture dialog if it's currently shown.
   */
  #dismissUserGestureDialog(): void {
    if (this.#userGestureDialogState) {
      this.#userGestureDialogState.dialogElement.remove()
      this.#userGestureDialogState = null
    }
  }

  #selectWebBluetoothDevice(device: BluetoothDevice) {
    this.#webBTDevice = device

    this.#webBTDevice.ongattserverdisconnected = () => {
      this.#onDisconnected(null)
    }
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
    logging.debug(
      `SpectodaWebBluetoothConnector::userSelect(criteria=${JSON.stringify(
        criteriumArray,
      )}, timeout=${timeoutNumber})`,
    )

    if (this.#connected()) {
      return this.disconnect()
        .then(() => {
          return sleep(1000)
        })
        .then(() => {
          return this.userSelect(criteriumArray, timeoutNumber)
        })
    }

    this.#criteria = criteriumArray

    let webBleOptions: RequestDeviceOptions = {
      filters: [],
      optionalServices: [this.SPECTODA_SERVICE_UUID],
    }

    //
    if (this.#criteria.length === 0) {
      webBleOptions.filters.push({ services: [this.SPECTODA_SERVICE_UUID] })
      // web_ble_options.filters.push({ services: [this.SPECTODA_ADOPTING_SERVICE_UUID] });
    }

    //
    else {
      const _legacyFiltersApplied = false

      for (let i = 0; i < this.#criteria.length; i++) {
        const criterium = this.#criteria[i]

        const filter: any = { services: [this.SPECTODA_SERVICE_UUID] }

        if (criterium.name) {
          filter.name = criterium.name
        } else if (criterium.nameprefix) {
          filter.nameprefix = criterium.nameprefix
        }

        // if any of these criteria are required, then we need to build a manufacturer data filter.
        if (
          criterium.fw ||
          criterium.network ||
          criterium.product ||
          criterium.commissionable ||
          criterium.mac
        ) {
          const companyIdentifier = 0x02e5 // Bluetooth SIG company identifier of Espressif

          delete filter.services

          // Extended to 27 bytes to include MAC address (6 bytes at offset 21)
          // Layout: [fw:2][product:2][network:16][flags:1][mac:6] = 27 bytes
          const prefix = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0,
          ]
          const mask = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0,
          ]

          if (criterium.product) {
            if (criterium.product < 0 || criterium.product > 0xffff) {
              throw 'InvalidProductCode'
            }

            const productCodeByteOffset = 2
            const productCodeBytes = [
              criterium.product & 0xff,
              (criterium.product >> 8) & 0xff,
            ]

            for (let i = 0; i < 2; i++) {
              prefix[productCodeByteOffset + i] = productCodeBytes[i]
              mask[productCodeByteOffset + i] = 0xff
            }
          }

          if (criterium.network) {
            if (criterium.network.length !== 32) {
              throw 'InvalidOwnerSignature'
            }

            const ownerSignatureByteOffset = 4
            const ownerSignatureCodeBytes = hexStringToUint8Array(
              criterium.network,
              32,
            )

            for (let i = 0; i < 16; i++) {
              prefix[ownerSignatureByteOffset + i] = ownerSignatureCodeBytes[i]
              mask[ownerSignatureByteOffset + i] = 0xff
            }
          }

          if (criterium.commissionable) {
            const otherFlagsOffset = 20

            let flagsPrefix = 0b00000000
            const flagsMask = 0b11111111

            if (criterium.commissionable === true) {
              const adoptionFlagBitPos = 0

              flagsPrefix |= 1 << adoptionFlagBitPos
            }

            prefix[otherFlagsOffset] = flagsPrefix
            mask[otherFlagsOffset] = flagsMask
          }

          if (criterium.mac) {
            // MAC address format: "XX:XX:XX:XX:XX:XX"
            const macByteOffset = 21
            const macParts = criterium.mac.split(':')

            if (macParts.length !== 6) {
              throw 'InvalidMacAddress'
            }

            for (let i = 0; i < 6; i++) {
              const byte = parseInt(macParts[i], 16)

              if (Number.isNaN(byte) || byte < 0 || byte > 255) {
                throw 'InvalidMacAddress'
              }

              prefix[macByteOffset + i] = byte
              mask[macByteOffset + i] = 0xff
            }
          }

          if (criterium.fw) {
            const fwVersionByteOffset = 0
            const reg = criterium.fw.match(/(!?)(\d+).(\d+).(\d+)/)

            if (!reg) {
              throw 'InvalidFirmwareVersion'
            }

            const versionCode =
              Number(reg[2]) * 10000 + Number(reg[3]) * 100 + Number(reg[4]) * 1
            const versionBytes = [versionCode & 0xff, (versionCode >> 8) & 0xff]

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
                    prefix[fwVersionByteOffset + k] = 0
                    mask[fwVersionByteOffset + k] = 0
                  }

                  prefix[fwVersionByteOffset + i] = ~(
                    versionBytes[i] &
                    (1 << j)
                  )
                  mask[fwVersionByteOffset + i] = 1 << j

                  // TODO Add data validation
                  const filterClone = JSON.parse(JSON.stringify(filter)) as any

                  filterClone.manufacturerData = [
                    {
                      companyIdentifier: companyIdentifier,
                      dataPrefix: new Uint8Array(prefix),
                      mask: new Uint8Array(mask),
                    },
                  ]
                  webBleOptions.filters.push(filterClone)
                }
              }
            } else {
              for (let i = 0; i < 2; i++) {
                prefix[fwVersionByteOffset + i] = versionBytes[i]
                mask[fwVersionByteOffset + i] = 0xff
              }
              filter.manufacturerData = [
                {
                  companyIdentifier: companyIdentifier,
                  dataPrefix: new Uint8Array(prefix),
                  mask: new Uint8Array(mask),
                },
              ]
              webBleOptions.filters.push(filter)
            }
          } else {
            filter.manufacturerData = [
              {
                companyIdentifier: companyIdentifier,
                dataPrefix: new Uint8Array(prefix),
                mask: new Uint8Array(mask),
              },
            ]
            webBleOptions.filters.push(filter)
          }
        } else {
          webBleOptions.filters.push(filter)
        }
      }
    }

    if (webBleOptions.filters.length === 0) {
      webBleOptions = {
        // TODO Remove "allDevices" reference
        acceptAllDevices: true,
        optionalServices: [this.SPECTODA_SERVICE_UUID],
      }
    }

    // logging.debug(web_ble_options);

    // Helper to check if an error is due to missing user gesture
    const isUserGestureError = (error: unknown): boolean => {
      if (!error || typeof error !== 'object') {
        return false
      }

      const e = error as { name?: string; message?: string }

      // Chrome throws SecurityError with "user gesture" message
      if (e.name === 'SecurityError' && e.message?.includes('user gesture')) {
        return true
      }

      // Also check for the specific message pattern
      if (e.message?.includes('Must be handling a user gesture')) {
        return true
      }

      return false
    }

    // Helper to handle the selected device
    const handleSelectedDevice = (device: BluetoothDevice): Criterium => {
      this.#selectWebBluetoothDevice(device)

      const strictMac = isStrictMacCriteria(criteriumArray)

      if (strictMac) {
        rememberWebBluetoothDeviceForMac(strictMac, device)
      }

      return { connector: this.type }
    }

    return navigator.bluetooth
      .requestDevice(webBleOptions)
      .then((device) => {
        return handleSelectedDevice(device)
      })
      .catch((e) => {
        // If the error is due to missing user gesture, show our dialog
        // to get a fresh user gesture, then retry requestDevice
        if (isUserGestureError(e)) {
          logging.debug(
            'WebBluetooth requestDevice failed due to missing user gesture, showing dialog',
          )

          return this.#showUserGestureDialog(webBleOptions).then((device) => {
            return handleSelectedDevice(device)
          })
        }

        // For all other errors (including user cancellation), throw
        logging.error(e)
        throw 'UserCanceledSelection'
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
      `SpectodaWebBluetoothConnector::autoSelect(criteria=${JSON.stringify(
        criteriumArray,
      )}, scan_duration=${scanDurationNumber}, timeout=${timeoutNumber})`,
    )

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
          return this.autoSelect(
            criteriumArray,
            scanDurationNumber,
            timeoutNumber,
          )
        })
    }

    // // web bluetooth cant really auto select bluetooth device. This is the closest you can get.
    // if (this.#selected() && criteria.network === this.#criteria.network) {
    //   return Promise.resolve();
    // }

    // If the device was choosen previously, then do not show popup
    if (this.#criteria === criteriumArray && this.#webBTDevice) {
      return Promise.resolve({ connector: this.type })
    }

    this.#criteria = criteriumArray

    // Web Bluetooth nepodporuje možnost automatické volby zařízení (background scan).
    // We can, however, use `navigator.bluetooth.getDevices()` to retrieve previously
    // permitted devices and pair that with our stored MAC <-> deviceId mapping.
    const strictMac = isStrictMacCriteria(criteriumArray)

    if (strictMac) {
      return loadPermittedWebBluetoothDevicesIntoCache().then(
        () => {
          pruneWebBluetoothCache()
          const cachedDevice = WEB_BLUETOOTH_DEVICE_BY_MAC.get(strictMac)

          if (cachedDevice) {
            this.#selectWebBluetoothDevice(/** @type {any} */ cachedDevice)
            // Touch the cache (MRU) so scan() orders this device first
            rememberWebBluetoothDeviceForMac(strictMac, cachedDevice)
            return { connector: this.type }
          }

          // No cached permitted device found -> fall back to chooser (first-time permission grant)
          return this.userSelect(criteriumArray, timeoutNumber)
        },
        () => {
          // In case getDevices() fails for any reason, fall back to chooser.
          // Using the second argument to .then() ensures this only catches errors from
          // loadPermittedWebBluetoothDevicesIntoCache, not from userSelect.
          return this.userSelect(criteriumArray, timeoutNumber)
        },
      )
    }

    // Since we cannot auto-select without a strict MAC, we fallback to userSelect
    return this.userSelect(criteriumArray, timeoutNumber)
  }

  // if device is conneced, then disconnect it
  unselect(): Promise<null> {
    logging.debug('SpectodaWebBluetoothConnector::unselect()')
    return (this.#connected() ? this.disconnect() : Promise.resolve()).then(
      () => {
        this.#webBTDevice = null
        this.#connection.reset()
        return null
      },
    )
  }

  // #selected returns boolean if a device is selected
  #selected() {
    return !!this.#webBTDevice
  }

  selected(): Promise<Criterium | null> {
    logging.debug('SpectodaWebBluetoothConnector::selected()')
    return Promise.resolve(this.#selected() ? { connector: this.type } : null)
  }

  scan(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 7000
    }

    logging.debug(
      `SpectodaWebBluetoothConnector::scan(criteria=${JSON.stringify(
        criteriumArray,
      )}, scan_duration=${scanDurationNumber})`,
    )

    // returns devices like autoSelect scan() function
    return Promise.resolve([])
  }

  // connect Connector to the selected Spectoda Device. Also can be used to reconnect.
  // Fails if no device is selected
  connect(
    timeout: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (timeout === DEFAULT_TIMEOUT) {
      timeout = 10000
    }
    logging.debug(`SpectodaWebBluetoothConnector::connect(timeout=${timeout})`)
    logging.verbose(`connect(timeout=${timeout})`)

    if (timeout <= 0) {
      logging.debug('Connect timeout has expired')
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
        const strictMac = isStrictMacCriteria(
          Array.isArray(this.#criteria) ? this.#criteria : [],
        )

        // Single attempt (no retries)
        // Reset gatt state before connecting (can get stuck on some platforms)
        if (this.#webBTDevice?.gatt?.connected) {
          this.#webBTDevice.gatt.disconnect()
          await sleep(150)
        }

        logging.debug('Connecting to Bluetooth device...')
        const server = await this.#webBTDevice?.gatt?.connect()

        if (!server) {
          throw new Error('Failed to connect')
        }

        this.#connection.reset()
        logging.debug('Getting the Bluetooth Service...')
        const service = await server.getPrimaryService(
          this.SPECTODA_SERVICE_UUID,
        )

        logging.debug('Getting the Service Characteristic...')
        await this.#connection.attach(
          service,
          this.NETWORK_CHAR_UUID,
          this.CLOCK_CHAR_UUID,
          this.DEVICE_CHAR_UUID,
        )

        logging.debug('Bluetooth Device Connected')
        if (!this.#connectedGuard) {
          this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
        }

        // Successful connect -> refresh MRU
        if (strictMac && this.#webBTDevice) {
          rememberWebBluetoothDeviceForMac(strictMac, this.#webBTDevice)
        }

        return { connector: 'webbluetooth' }
      } catch (error: unknown) {
        logging.error(error)

        logging.debug(this.#webBTDevice)
        this.#webBTDevice?.gatt?.disconnect()

        if (isWebBluetoothOutOfRangeLikeError(error)) {
          // If we failed with a stale cached handle, drop it so next select can refresh.
          const strictMac = isStrictMacCriteria(
            Array.isArray(this.#criteria) ? (this.#criteria as any) : [],
          )

          if (strictMac) {
            removeWebBluetoothDeviceForMac(strictMac)
          }
          throw 'ConnectionFailed'
        }

        // If the device is far away, sometimes this "NetworkError" happens
        if (getErrorName(error) === 'NetworkError') {
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
    return this.#webBTDevice?.gatt?.connected
  }

  connected(): Promise<Criterium | null> {
    logging.verbose('connected()')
    return Promise.resolve(this.#connected() ? { connector: this.type } : null)
  }

  #disconnect() {
    this.#webBTDevice?.gatt?.disconnect()
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect(): Promise<unknown> {
    logging.debug('SpectodaWebBluetoothConnector::disconnect()')

    this.#reconection = false

    this.#connection.reset()

    if (this.#connected()) {
      this.#disconnect()
    }

    return Promise.resolve()
  }

  // when the device is disconnected, the javascript Connector.js layer decides
  // if it should be revonnected. Here is implemented that it should be
  // reconnected only if the this.#reconection is true. The event handlers are fired
  // synchronously. So that only after all event handlers (one after the other) are done,
  // only then start this.connect() to reconnect to the bluetooth device
  #onDisconnected = (_event: any) => {
    this.#connection.reset()
    if (this.#connectedGuard) {
      logging.verbose('emitting #disconnected')
      this.#runtimeReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
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
    logging.debug(
      `SpectodaWebBluetoothConnector::deliver(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

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
    logging.debug(
      `SpectodaWebBluetoothConnector::transmit(payload.length=${payloadBytes.length}, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

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
    logging.debug(
      `SpectodaWebBluetoothConnector::request(payload.length=${payloadBytes.length}, read_response=${
        readResponse ? 'true' : 'false'
      }, timeout=${timeoutNumber})`,
    )
    logging.verbose('payload_bytes=', payloadBytes)

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.request(payloadBytes, readResponse, timeoutNumber)
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug(
      `SpectodaWebBluetoothConnector::setClock(clock.millis=${clock.millis()})`,
    )

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
    logging.debug('SpectodaWebBluetoothConnector::getClock()')

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
  updateFW(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `SpectodaWebBluetoothConnector::updateFW(firmware_bytes.length=${firmwareBytes.length}, skipReboot=${skipReboot})`,
    )

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.#connection.updateFirmware(firmwareBytes, { skipReboot })
  }

  cancel(): void {
    logging.debug('SpectodaWebBluetoothConnector::cancel()')

    // Dismiss the user gesture dialog if it's currently shown
    if (this.#userGestureDialogState) {
      const { reject } = this.#userGestureDialogState

      this.#dismissUserGestureDialog()
      reject('UserCanceledSelection')
    }
  }

  destroy(): Promise<unknown> {
    logging.debug('SpectodaWebBluetoothConnector::destroy()')
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
      `SpectodaWebBluetoothConnector::sendExecute(command_bytes.length=${
        commandBytes.length
      }, source_connection=${JSON.stringify(sourceConnection)})`,
    )
    logging.verbose('command_bytes=', commandBytes)

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

  // bool // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destinationConnection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.debug(
      `SpectodaWebBluetoothConnector::sendRequest(request_bytecode.length=${requestBytecode.length}, destinationConnection=${destinationConnection})`,
    )
    logging.verbose('request_bytecode=', requestBytecode)

    if (
      destinationConnection.connector_type !==
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    if (!this.#connected()) {
      return Promise.reject('DeviceDisconnected')
    }

    return this.request(requestBytecode, false, DEFAULT_TIMEOUT)
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(
    synchronization: Synchronization,
    sourceConnection: Connection,
  ) {
    logging.debug(
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
