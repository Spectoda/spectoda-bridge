// eslint-disable-next-line @typescript-eslint/ban-ts-comment

import { detectAndroid, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import { SpectodaTypes } from '../types/primitives'
import { Connection, Synchronization } from '../types/wasm'

/////////////////////////////////////////////////////////////////////////////////////

const simulatedFails = false

class FlutterConnection {
  #networkNotificationBuffer: Uint8Array | null

  constructor() {
    logging.debug('Initing FlutterConnection')

    this.#networkNotificationBuffer = null

    // @ts-ignore
    if (window.flutterConnection) {
      logging.debug('FlutterConnection already inited')
      return
    }

    // @ts-ignore
    window.flutterConnection = {}

    // @ts-ignore
    window.flutterConnection.resolve = null

    // @ts-ignore
    window.flutterConnection.reject = null

    // @ts-ignore
    window.flutterConnection.emit = null

    // // target="_blank" global handler
    // // @ts-ignore
    // window.flutterConnection.hasOwnProperty("open") &&
    //   /** @type {HTMLBodyElement} */ (document.querySelector("body")).addEventListener("click", function (e) {
    //     e.preventDefault();
    //     // @ts-ignore
    //     for (let el of e.path) {
    //       if (el.tagName === "A" && el.getAttribute("target") === "_blank") {
    //         e.preventDefault();
    //         const url = el.getAttribute("href");
    //         // logging.debug(url);
    //         // @ts-ignore
    //         window.flutterConnection.open(url);
    //         break;
    //       }
    //     }
    //   });

    if (this.available()) {
      logging.debug('Flutter Connector available')

      window.addEventListener('#resolve', (e) => {
        // @ts-ignore
        const value = e.detail.value

        logging.debug(`Triggered #resolve: [${value}]`)

        // @ts-ignore
        window.flutterConnection.resolve(value)
      })

      window.addEventListener('#reject', (e) => {
        // @ts-ignore
        const value = e.detail.value

        logging.debug(`Triggered #reject: [${value}]`)

        // @ts-ignore
        window.flutterConnection.reject(value)
      })

      // ! deprecated, was replaced by #connected and #disconnected
      // // window.addEventListener("#emit", e => {
      // //   // @ts-ignore
      // //   const event = e.detail.value;
      // //   logging.info(`Triggered #emit: ${event}`, event);

      // //   if (event == "#connect" || event == "#disconnect") {
      // //     // ? reset #networkNotificationBuffer
      // //     this.#networkNotificationBuffer = null;
      // //   }

      // //   // @ts-ignore
      // //   window.flutterConnection.emit(event);
      // // });

      window.addEventListener('#connected', (e) => {
        // @ts-ignore
        const value = e.detail.value

        logging.info(`Triggered #connected: ${value}`, value)

        // ? reset #networkNotificationBuffer on connect
        this.#networkNotificationBuffer = null

        // @ts-ignore
        window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_CONNECTED, value)
      })

      window.addEventListener('#disconnected', (e) => {
        // @ts-ignore
        const value = e.detail.value

        logging.info(`Triggered #disconnected: ${value}`, value)

        // ? reset #networkNotificationBuffer on disconnect
        this.#networkNotificationBuffer = null

        // @ts-ignore
        window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED, value)
      })

      // network characteristics notification
      window.addEventListener('#network', (e) => {
        // @ts-ignore
        const payload = new Uint8Array(e.detail.value)

        logging.info(`Triggered #network: [${payload}]`, payload)

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

          // @ts-ignore
          window.flutterConnection.execute(commandBytes)
        }
      })

      // device characteristics notification
      window.addEventListener('#device', (e) => {
        // @ts-ignore
        const bytes = new Uint8Array(e.detail.value)

        logging.info(`Triggered #device: [${bytes}]`, bytes)

        // ? NOP - device characteristics should not notify
      })

      // clock characteristics notification
      window.addEventListener('#clock', (e) => {
        // @ts-ignore
        const synchronizationBytes = new Uint8Array(e.detail.value)

        logging.info(`Triggered #clock: [${synchronizationBytes}]`, synchronizationBytes)

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

        // @ts-ignore
        window.flutterConnection.synchronize(synchronization)
      })

      window.addEventListener('#scan', (e) => {
        // @ts-ignore
        const json = e.detail.value

        logging.debug(`> Triggered #scan: [${json}]`)

        // @ts-ignore
        window.flutterConnection.emit(SpectodaAppEvents.SCAN_RESULTS, json)
      })

      logging.verbose('> FlutterConnection inited')
    } else {
      logging.debug('flutter_inappwebview in window NOT detected')
      logging.info('Simulating Flutter Functions')

      let _connected = false
      let _selected = false

      function _fail(failChance: number) {
        if (simulatedFails) {
          return Math.random() < failChance
        } else {
          return false
        }
      }

      // @ts-ignore
      window.flutter_inappwebview = {}

      // @ts-ignore
      window.flutter_inappwebview.callHandler = async function (handler, a, b, c, d) {
        //
        switch (handler) {
          //
          case 'userSelect': {
            // params: (criteria_json, timeout_number)
            {
              // disconnect if already connected
              if (_connected) {
                // @ts-ignore
                await window.flutter_inappwebview.callHandler('disconnect')
              }
              await sleep(Math.random() * 5000) // do the userSelect task filtering devices by the criteria_json parameter
              if (_fail(0.5)) {
                // @ts-ignore
                window.flutterConnection.reject('UserCanceledSelection') // reject with "UserCanceledSelection" message if user cancels selection
                return
              }
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('SelectionFailed')
                return
              }
              _selected = true
              // @ts-ignore
              window.flutterConnection.resolve('{"connector":"flutterbluetooth"}')
            }
            break
          }

          case 'autoSelect': {
            // params: (criteria_json, scan_period_number, timeout_number)
            {
              if (_connected) {
                // @ts-ignore
                await window.flutter_inappwebview.callHandler('disconnect') // handle disconnection inside the flutter app
              }
              await sleep(Math.random() * 5000) // do the autoSelect task filtering devices by the criteria_json parameter and scanning minimum time scan_period_number, maximum timeout_number
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('SelectionFailed') // if the selection fails, return "SelectionFailed"
                return
              }
              _selected = true
              // @ts-ignore
              window.flutterConnection.resolve('{"connector":"flutterbluetooth"}') // resolve with json containing the information about the connected device
            }
            break
          }

          case 'selected': {
            {
              // params: ()
              if (_selected) {
                // @ts-ignore
                window.flutterConnection.resolve('{"connector":"flutterbluetooth"}') // if the device is selected, return json
              } else {
                // @ts-ignore
                window.flutterConnection.resolve() // if no device is selected resolve nothing
              }
            }
            break
          }

          case 'unselect': {
            {
              // params: ()
              if (_connected) {
                // @ts-ignore
                await window.flutterConnection.disconnect()
              }
              await sleep(10) // unselect logic
              _selected = false
              // @ts-ignore
              window.flutterConnection.resolve()
            }
            break
          }

          case 'scan': {
            // params: (criteria_json, scan_period_number)
            {
              if (_connected) {
                // @ts-ignore
                await window.flutter_inappwebview.callHandler('disconnect') // handle disconnection inside the flutter app
              }
              await sleep(Math.random() * 5000) // do the autoSelect task filtering devices by the criteria_json parameter and scanning minimum time scan_period_number, maximum timeout_number
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('SelectionFailed') // if the selection fails, return "SelectionFailed"
                return
              }
              _selected = true
              // @ts-ignore
              window.flutterConnection.resolve('{"connector":"flutterbluetooth"}') // resolve with json containing the information about the connected device
            }
            break
          }

          case 'connect': {
            {
              // params: (timeout_number)
              if (!_selected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceNotSelected')
                return
              }
              await sleep(Math.random() * 5000) // connecting logic
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('ConnectionFailed')
                return
              }
              _connected = true
              // @ts-ignore
              // @ts-ignore
              window.flutterConnection.resolve('{"connector":"flutterbluetooth"}')
              // after connection the SpectodaConnect can any time emit #disconnect event.

              await sleep(1000) // unselect logic

              // @ts-ignore
              window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_CONNECTED)

              setTimeout(() => {
                // @ts-ignore
                window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
                //}, Math.random() * 60000);
                _connected = false
              }, 60000)
            }
            break
          }

          case 'disconnect': {
            {
              // params: ()
              if (_connected) {
                await sleep(100) // disconnecting logic
                _connected = false
                // @ts-ignore
                window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
              }
              // @ts-ignore
              window.flutterConnection.resolve() // always resolves even if there are internal errors
            }
            break
          }

          case 'connected': {
            {
              // params: ()
              if (_connected) {
                // @ts-ignore
                window.flutterConnection.resolve('{"connector":"flutterbluetooth"}')
              } else {
                // @ts-ignore
                window.flutterConnection.resolve()
              }
            }
            break
          }

          case 'deliver': {
            {
              // params: (payload_bytes)
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              await sleep(25) // delivering logic
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('DeliverFailed')
                return
              }
              // @ts-ignore
              window.flutterConnection.resolve()
            }
            break
          }

          case 'transmit': {
            {
              // params: (payload_bytes)
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              await sleep(10) // transmiting logic
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('TransmitFailed')
                return
              }
              // @ts-ignore
              window.flutterConnection.resolve()
            }
            break
          }

          case 'request': {
            {
              // params: (payload_bytes, read_response)
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              await sleep(50) // requesting logic
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('RequestFailed')
                return
              }

              // @ts-ignore
              window.flutterConnection.resolve([246, 1, 0, 0, 0, 188, 251, 18, 0, 212, 247, 18, 0, 0]) // returns data as an array of bytes: [0,255,123,89]
            }
            break
          }

          case 'writeClock': {
            {
              // params: (clock_bytes)
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              await sleep(10) // writing clock logic.
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('ClockWriteFailed')
                return
              }
              // @ts-ignore
              window.flutterConnection.resolve()
            }
            break
          }

          case 'readClock': {
            {
              // params: ()
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              await sleep(50) // reading clock logic.
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.reject('ClockReadFailed')
                return
              }
              // @ts-ignore
              window.flutterConnection.resolve([0, 0, 0, 0]) // returns timestamp as an 32-bit signed number
            }
            break
          }

          case 'updateFW': {
            {
              // params: (bytes)
              if (!_connected) {
                // @ts-ignore
                window.flutterConnection.reject('DeviceDisconnected')
                return
              }
              // @ts-ignore
              window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'begin')
              await sleep(10000) // preparing FW logic.
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
                // @ts-ignore
                window.flutterConnection.reject('UpdateFailed')
                return
              }
              for (let i = 1; i <= 100; i++) {
                // @ts-ignore
                window.flutterConnection.emit(SpectodaAppEvents.OTA_PROGRESS, i)
                await sleep(25) // writing FW logic.
                if (_fail(0.01)) {
                  // @ts-ignore
                  window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
                  // @ts-ignore
                  window.flutterConnection.reject('UpdateFailed')
                  return
                }
              }
              await sleep(1000) // finishing FW logic.
              if (_fail(0.1)) {
                // @ts-ignore
                window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
                // @ts-ignore
                window.flutterConnection.reject('UpdateFailed')
                return
              }
              // @ts-ignore
              window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'success')
              // @ts-ignore
              window.flutterConnection.resolve()
            }
            break
          }

          default: {
            logging.error('Unknown handler')
            break
          }
        }
      }
    }
  }

  available() {
    return 'flutter_inappwebview' in window
  }
}

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices
export class SpectodaConnectConnector extends FlutterConnection {
  #runtimeReference
  #promise: Promise<any> | null

  type: string

  constructor(runtimeReference: SpectodaRuntime) {
    super()

    this.type = 'flutterbluetooth'

    this.#runtimeReference = runtimeReference
    this.#promise = null

    // @ts-ignore
    window.flutterConnection.emit = (event, value) => {
      this.#runtimeReference.emit(event, value)
    }

    // @ts-ignore
    window.flutterConnection.execute = (commandBytes: Uint8Array) => {
      logging.debug(`flutterConnection.execute(commandBytes=${commandBytes})`)

      const DUMMY_BLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_BLE,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.execute(commandBytes, DUMMY_BLE_CONNECTION)
    }

    // @ts-ignore
    window.flutterConnection.synchronize = (synchronization: Synchronization) => {
      logging.debug(`flutterConnection.synchronize(synchronization=${synchronization})`)

      const DUMMY_BLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_BLE,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.synchronize(synchronization, DUMMY_BLE_CONNECTION)
    }
  }

  #applyTimeout(promise: Promise<any> | null, timeout_number: number, message: string) {
    if (!promise) {
      // ? No promise provided to #applyTimeout()
      return Promise.reject('NoPromiseProvided')
    }

    const handle = setTimeout(() => {
      // @ts-ignore
      window.flutterConnection.reject('FlutterSafeguardTimeout: ' + message)
    }, timeout_number)

    return promise.finally(() => {
      clearTimeout(handle)
    })
  }

  async ping() {
    console.time('ping_measure')
    for (let i = 0; i < 1000; i++) {
      this.#promise = new Promise((resolve, reject) => {
        // @ts-ignore
        window.flutterConnection.resolve = resolve
        // @ts-ignore
        window.flutterConnection.reject = reject
      })

      // logging.debug("ping")
      // @ts-ignore
      window.flutterConnection.ping()
      await this.#promise
      // logging.debug("pong")
    }
    //
    console.timeEnd('ping_measure')

    const FLUTTER_RESPONSE_TIMEOUT = 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'ping')
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

    logging.debug(`userSelect(criteria=${criteria_json}, timeout=${timeout_number})`)

    /**
     * Creates an invisible overlay that blocks all user interactions.
     * This is a workaround for a Flutter bug where the BLE device selection popup
     * does not properly block gestures from reaching the underlying WebView.
     * Ideally this should be handled on the Flutter side, but we have not found
     * a way to do that yet. The overlay prevents any touch, scroll, click or context
     * menu events from reaching the WebView while the device selection popup is shown.
     *
     * call overlay.remove() to disable
     */
    const makeGestureBlockingOverlay = () => {
      const overlay = document.createElement('div')

      overlay.style.position = 'fixed'
      overlay.style.top = '0'
      overlay.style.left = '0'
      overlay.style.width = '100%'
      overlay.style.height = '100%'
      overlay.style.backgroundColor = 'rgba(0,0,0,0)'
      overlay.style.zIndex = '999999'
      // Block all interactions
      overlay.addEventListener('touchstart', (e) => e.preventDefault(), {
        passive: false,
      })
      overlay.addEventListener('touchmove', (e) => e.preventDefault(), {
        passive: false,
      })
      overlay.addEventListener('touchend', (e) => e.preventDefault(), {
        passive: false,
      })
      overlay.addEventListener('wheel', (e) => e.preventDefault(), {
        passive: false,
      })
      overlay.addEventListener('click', (e) => e.preventDefault())
      overlay.addEventListener('contextmenu', (e) => e.preventDefault())
      // apply to document.body
      document.body.append(overlay)
      return overlay
    }

    const overlay = makeGestureBlockingOverlay()

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // Remove blocking overlay
        overlay.remove()

        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }

        resolve(json)
      }
      // @ts-ignore
      window.flutterConnection.reject = function (error) {
        // Remove blocking overlay
        overlay.remove()

        reject(error)
      }
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('userSelect', criteria_json, timeout_number)

    const FLUTTER_RESPONSE_TIMEOUT = timeout_number + 60000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'userSelect')
  }

  // takes the criteria, scans for scan_duration and automatically selects the device,
  // you can then connect to. This works only for BLE devices that are bond with the phone/PC/tablet
  // the app is running on OR doesnt need to be bonded in a special way.
  // if more devices are found matching the criteria, then the strongest signal wins
  // if no device is found within the timeout_number period, then it returns an error

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
    // step 1. for the scan_duration scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout_number,
    //         then return error

    const MINIMAL_AUTOSELECT_SCAN_DURATION = 1200
    const MINIMAL_AUTOSELECT_TIMEOUT = 3000

    const criteria_json = JSON.stringify(criterium_array)

    logging.debug(
      `autoSelect(criteria=${criteria_json}, scan_duration=${scan_duration_number}, timeout=${timeout_number})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }

      // @ts-ignore
      window.flutterConnection.reject = function (e) {
        // on old Androids sometimes the first time you call autoSelect right after bluetooth is turned on, it rejects with a timeout
        logging.warn(e)

        // if the second attempt rejects again, then reject the promise
        // @ts-ignore
        window.flutterConnection.reject = reject

        console.warn('autoSelect() with minimal timeout timeouted, trying it again with the full timeout...')
        // TODO Fix types
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        window.flutter_inappwebview.callHandler(
          'autoSelect',
          criteria_json as any,
          Math.max(MINIMAL_AUTOSELECT_SCAN_DURATION, scan_duration_number),
          Math.max(MINIMAL_AUTOSELECT_TIMEOUT, timeout_number),
        )
      }
    })

    // TODO Fix types
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.flutter_inappwebview.callHandler(
      'autoSelect',
      criteria_json as any,
      Math.max(MINIMAL_AUTOSELECT_SCAN_DURATION, scan_duration_number),
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, scan_duration_number),
    )

    const FLUTTER_RESPONSE_TIMEOUT =
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, scan_duration_number) +
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, timeout_number) +
      5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'autoSelect')
  }

  selected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.debug('selected()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('selected')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'selected')
  }

  unselect(): Promise<null> {
    logging.debug('unselect()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = resolve
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('unselect')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'unselect')
  }

  // takes the criteria, scans for scan_duration and returns the scanning results
  // if no criteria are provided, all Spectoda enabled devices (with all different FWs and Owners and such)
  // are eligible.

  scan(
    criterium_array: Array<SpectodaTypes['Criterium']>,
    scan_duration_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<SpectodaTypes['Criterium']>> {
    if (scan_duration_number === DEFAULT_TIMEOUT) {
      scan_duration_number = 7000
    }
    // step 1. for the scan_duration scan the surroundings for BLE devices.

    const criteria_json = JSON.stringify(criterium_array)

    logging.debug(`scan(criteria=${criteria_json}, scan_duration=${scan_duration_number})`)

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('scan', criteria_json, scan_duration_number)

    const FLUTTER_RESPONSE_TIMEOUT = scan_duration_number + 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'scan')
  }

  /*

  timeout_number ms

  */
  // timeout 20000ms for the old slow devices to be able to connect
  connect(timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT): Promise<SpectodaTypes['Criterium']> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 20000
    }
    logging.debug(`connect(timeout=${timeout_number})`)

    const MINIMAL_CONNECT_TIMEOUT = 5000

    if (timeout_number <= MINIMAL_CONNECT_TIMEOUT) {
      return Promise.reject('InvalidTimeout')
    }

    //? I came across an olf Andoid device that needed a two calls of a connect for a successful connection.
    //? it always timeouted on the first call, but the second call was always successful.
    //? so I am trying to connect with a minimal timeout first and if it fails, then I try it again with the full timeout
    //? becouse other devices needs a long timeout for connection to be successful
    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-ignore
      window.flutterConnection.reject = function (e) {
        logging.warn(e)

        // if the second attempt rejects again, then reject the promise
        // @ts-ignore
        window.flutterConnection.reject = reject

        console.warn('Connect with minimal timeout timeouted, trying it again with the full timeout...')
        // @ts-ignore
        window.flutter_inappwebview.callHandler('connect', Math.max(MINIMAL_CONNECT_TIMEOUT, timeout_number)) // on old Androids the minimal timeout is not enough
      }
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('connect', MINIMAL_CONNECT_TIMEOUT) // first try to connect with the minimal timeout

    //? Leaving this code here for possible benchmarking. Comment out .callHandler("connect" and uncomment this code to use it
    // setTimeout(() => {
    //   window.flutterConnection.reject("SimulatedError");
    // }, MINIMAL_CONNECT_TIMEOUT);

    // the timeout must be long enough to handle the slowest devices
    const FLUTTER_RESPONSE_TIMEOUT = MINIMAL_CONNECT_TIMEOUT + Math.max(MINIMAL_CONNECT_TIMEOUT, timeout_number) + 5000

    // @ts-expect-error TODO: @immakermatty fix missing connector
    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'connect').then(() => {
      logging.debug('Sleeping for 100ms after connect...')
      return sleep(100).then(() => {
        // TODO: @immakermatty fix missing connector
        return { connector: 'spectodaconnect' }
      })
    })
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect(): Promise<unknown> {
    logging.verbose('disconnect()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = resolve
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('disconnect')

    const FLUTTER_RESPONSE_TIMEOUT = 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'disconnect')
  }

  connected(): Promise<SpectodaTypes['Criterium'] | null> {
    logging.verbose('connected()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = function (json) {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          const criteria = JSON.parse(json)

          resolve(criteria)
        } else {
          resolve(null)
        }
      }
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('connected')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'connected')
  }

  // deliver handles the communication with the Spectoda Controller in a way
  // that the command is guaranteed to arrive
  deliver(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.debug(`deliver(payload=[${payload_bytes}], timeout=${timeout_number})`)

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = resolve
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('deliver', payload_bytes, timeout_number)
    // fix bug in spectoda-connect and then enable this line
    // TODO window.flutter_inappwebview.callHandler("deliver", Array.from(payload_bytes), timeout_number);

    const FLUTTER_RESPONSE_TIMEOUT = timeout_number + 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'deliver')
  }

  // transmit handles the communication with the Spectoda Controller in a way
  // that the paylaod is NOT guaranteed to arrive
  transmit(
    payload_bytes: Uint8Array,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 1000
    }
    logging.debug(`transmit(payload=[${payload_bytes}], timeout=${timeout_number})`)

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = resolve
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('transmit', [...payload_bytes], timeout_number)

    const FLUTTER_RESPONSE_TIMEOUT = timeout_number + 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'transmit')
  }

  // request handles the requests on the Spectoda Controller. The payload request
  // is guaranteed to get a response
  request(
    payload_bytes: Uint8Array,
    read_response: boolean,
    timeout_number: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Uint8Array | null> {
    if (timeout_number === DEFAULT_TIMEOUT) {
      timeout_number = 5000
    }
    logging.debug(
      `request(payload=[${payload_bytes}], read_response=${
        read_response ? 'true' : 'false'
      }, timeout=${timeout_number})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-ignore
      window.flutterConnection.resolve = (response) => {
        resolve(new DataView(new Uint8Array(response).buffer))
      }
      // @ts-ignore
      window.flutterConnection.reject = reject
    })

    // @ts-ignore
    window.flutter_inappwebview.callHandler('request', [...payload_bytes], read_response, timeout_number)

    const FLUTTER_RESPONSE_TIMEOUT = timeout_number + 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'request')
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.info(`SpectodaConnectConnector::setClock(clock.millis=${clock.millis()})`)

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 3; tries++) {
        await sleep(100) // ! wait for the controller to be ready
        try {
          // tries to ASAP write a timestamp to the clock characteristics.
          // if the ASAP write fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-ignore
            window.flutterConnection.resolve = resolve
            // @ts-ignore
            window.flutterConnection.reject = reject
          })

          const timestamp = clock.millis()
          const clock_bytes = toBytes(timestamp, 8)

          // @ts-ignore
          window.flutter_inappwebview.callHandler('writeClock', clock_bytes)

          const FLUTTER_RESPONSE_TIMEOUT = 5000

          await this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'writeClock')
          logging.debug('Clock write success:', timestamp)

          // @ts-ignore
          resolve()
          return
        } catch (e) {
          logging.warn('Clock write failed: ' + e)
        }
      }

      reject('Clock write failed')
      return
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.debug('getClock()')

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 3; tries++) {
        await sleep(100) // ! wait for the controller to be ready
        try {
          // tries to ASAP read a timestamp from the clock characteristics.
          // if the ASAP read fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-ignore
            window.flutterConnection.resolve = resolve
            // @ts-ignore
            window.flutterConnection.reject = reject
          })

          // @ts-ignore
          window.flutter_inappwebview.callHandler('readClock')

          const FLUTTER_RESPONSE_TIMEOUT = 5000
          const bytes = await this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'readClock')

          const reader = new TnglReader(new Uint8Array(bytes))
          const timestamp = reader.readUint64()

          // const timestamp = await this.#promise;
          logging.debug('Clock read success:', timestamp)

          resolve(new TimeTrack(timestamp))
          return
        } catch (e) {
          logging.warn('Clock read failed:', e)
        }
      }

      reject('Clock read failed')
      return
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers

  // TODO - emit "ota_progress" events

  updateFW(firmware_bytes: Uint8Array): Promise<unknown> {
    logging.debug(`updateFW(firmware_bytes.length=${firmware_bytes.length})`)

    this.#runtimeReference.spectodaReference.requestWakeLock()

    return new Promise(async (resolve, reject) => {
      const chunk_size = detectAndroid() ? 480 : 3984 // must be modulo 16
      // const chunk_size = 992; // must be modulo 16

      let index_from = 0
      let index_to = chunk_size

      let written = 0

      logging.info('OTA UPDATE')
      logging.verbose(firmware_bytes)

      const start_timestamp = Date.now()

      await sleep(100)

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.info('OTA RESET')

          const device_bytes = [COMMAND_FLAGS.FLAG_OTA_RESET, 0x00, ...numberToBytes(0x00000000, 4)]

          await this.request(new Uint8Array(device_bytes), false, 10000)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.info('OTA BEGIN')

          const device_bytes = [COMMAND_FLAGS.FLAG_OTA_BEGIN, 0x00, ...numberToBytes(firmware_bytes.length, 4)]

          await this.request(new Uint8Array(device_bytes), false, 20000)
        }

        await sleep(8000)

        {
          //===========// WRITE //===========//
          logging.info('OTA WRITE')

          while (written < firmware_bytes.length) {
            if (index_to > firmware_bytes.length) {
              index_to = firmware_bytes.length
            }

            const device_bytes = [
              COMMAND_FLAGS.FLAG_OTA_WRITE,
              0x00,
              ...numberToBytes(written, 4),
              ...firmware_bytes.slice(index_from, index_to),
            ]

            await this.request(new Uint8Array(device_bytes), false, 10000)

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
          logging.info('OTA END')

          const device_bytes = [COMMAND_FLAGS.FLAG_OTA_END, 0x00, ...numberToBytes(written, 4)]

          await this.request(new Uint8Array(device_bytes), false, 10000)
        }

        await sleep(100)

        logging.info('Rebooting device...')

        const device_bytes = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

        await this.request(new Uint8Array(device_bytes), false)

        logging.debug('Firmware written in ' + (Date.now() - start_timestamp) / 1000 + ' seconds')

        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')

        resolve(null)
      } catch (e) {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')

        reject(e)
      }
    })
      .then(() => {
        return this.disconnect()
      })
      .finally(() => {
        this.#runtimeReference.spectodaReference.releaseWakeLock()
      })
  }

  cancel(): void {
    logging.debug('cancel()')

    window.flutter_inappwebview.callHandler('cancel')
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
      `SpectodaConnectConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_BLE) {
      return Promise.resolve()
    }

    return this.deliver(command_bytes, 1000)
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number: number, request_bytecode: Uint8Array, destination_connection: Connection) {
    logging.verbose(
      `SpectodaConnectConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
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
      `SpectodaConnectConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.reject('NotImplemented')
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization: Synchronization, source_connection: Connection) {
    logging.verbose(
      `SpectodaConnectConnector::sendSynchronize(synchronization=${synchronization}, source_connection=${source_connection})`,
    )

    if (source_connection.connector_type == SpectodaWasm.connector_type_t.CONNECTOR_BLE) {
      return Promise.resolve()
    }

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 1; tries++) {
        try {
          // tryes to ASAP write a timestamp to the clock characteristics.
          // if the ASAP write fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-ignore
            window.flutterConnection.resolve = resolve
            // @ts-ignore
            window.flutterConnection.reject = reject
          })

          const synchronization_bytes = [...synchronization.toUint8Array()]

          // @ts-ignore
          window.flutter_inappwebview.callHandler('writeClock', synchronization_bytes)

          await this.#applyTimeout(this.#promise, 5000, 'synchronization')

          // @ts-ignore
          resolve()
          return
        } catch (e) {
          logging.warn('Clock write failed: ' + e)
        }
      }

      reject('Clock write failed')
      return
    })
  }
}
