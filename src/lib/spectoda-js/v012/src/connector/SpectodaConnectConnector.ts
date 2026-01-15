import { detectAndroid, numberToBytes, sleep, toBytes } from '../../functions'
import { logging } from '../../logging'
import { TimeTrack } from '../../TimeTrack'
import { TnglReader } from '../../TnglReader'
import { COMMAND_FLAGS, DEFAULT_TIMEOUT } from '../constants'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import { SpectodaWasm } from '../SpectodaWasm'
import { SpectodaAppEvents } from '../types/app-events'
import type { Criterium } from '../types/primitives'
import type { Connection, Synchronization } from '../types/wasm'

/////////////////////////////////////////////////////////////////////////////////////

const PACKET_SIZE_INDICATING_MULTIPACKET_MESSAGE = 512

const simulatedFails = false

class FlutterConnection {
  #networkNotificationBuffer: Uint8Array | null

  constructor() {
    logging.debug('Initing FlutterConnection')

    this.#networkNotificationBuffer = null

    // @ts-expect-error
    if (window.flutterConnection) {
      logging.debug('FlutterConnection already inited')
      return
    }

    // @ts-expect-error
    window.flutterConnection = {}

    // @ts-expect-error
    window.flutterConnection.resolve = null

    // @ts-expect-error
    window.flutterConnection.reject = null

    // @ts-expect-error
    window.flutterConnection.emit = null

    // // target="_blank" global handler
    // // @ts-expect-error
    // window.flutterConnection.hasOwnProperty("open") &&
    //   /** @type {HTMLBodyElement} */ (document.querySelector("body")).addEventListener("click", function (e) {
    //     e.preventDefault();
    //     // @ts-expect-error
    //     for (let el of e.path) {
    //       if (el.tagName === "A" && el.getAttribute("target") === "_blank") {
    //         e.preventDefault();
    //         const url = el.getAttribute("href");
    //         // logging.debug(url);
    //         // @ts-expect-error
    //         window.flutterConnection.open(url);
    //         break;
    //       }
    //     }
    //   });

    if (this.available()) {
      logging.debug('Flutter Connector available')

      window.addEventListener('#resolve', (e) => {
        // @ts-expect-error
        const value = e.detail.value

        logging.verbose(`Triggered #resolve: [${value}]`)

        // @ts-expect-error
        window.flutterConnection.resolve(value)
      })

      window.addEventListener('#reject', (e) => {
        // @ts-expect-error
        const value = e.detail.value

        logging.verbose(`Triggered #reject: [${value}]`)

        // @ts-expect-error
        window.flutterConnection.reject(value)
      })

      // ! deprecated, was replaced by #connected and #disconnected
      // // window.addEventListener("#emit", e => {
      // //   // @ts-expect-error
      // //   const event = e.detail.value;
      // //   logging.verbose(`Triggered #emit: ${event}`, event);

      // //   if (event == "#connect" || event == "#disconnect") {
      // //     // ? reset #networkNotificationBuffer
      // //     this.#networkNotificationBuffer = null;
      // //   }

      // //   // @ts-expect-error
      // //   window.flutterConnection.emit(event);
      // // });

      window.addEventListener('#connected', (e) => {
        // @ts-expect-error
        const value = e.detail.value

        logging.verbose(`Triggered #connected: ${value}`, value)

        // ? reset #networkNotificationBuffer on connect
        this.#networkNotificationBuffer = null

        // @ts-expect-error
        window.flutterConnection.emit(
          SpectodaAppEvents.PRIVATE_CONNECTED,
          value,
        )
      })

      window.addEventListener('#disconnected', (e) => {
        // @ts-expect-error
        const value = e.detail.value

        logging.verbose(`Triggered #disconnected: ${value}`, value)

        // ? reset #networkNotificationBuffer on disconnect
        this.#networkNotificationBuffer = null

        // @ts-expect-error
        window.flutterConnection.emit(
          SpectodaAppEvents.PRIVATE_DISCONNECTED,
          value,
        )
      })

      // network characteristics notification
      window.addEventListener('#network', (e) => {
        // @ts-expect-error
        const payload = new Uint8Array(e.detail.value)

        logging.verbose(`Triggered #network: [${payload}]`, payload)

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

          // @ts-expect-error
          window.flutterConnection.request(commandBytes)
        }
      })

      // device characteristics notification
      window.addEventListener('#device', (e) => {
        // @ts-expect-error
        const bytes = new Uint8Array(e.detail.value)

        logging.verbose(`Triggered #device: [${bytes}]`, bytes)

        // ? NOP - device characteristics should not notify
      })

      // clock characteristics notification
      window.addEventListener('#clock', (e) => {
        // @ts-expect-error
        const synchronizationBytes = new Uint8Array(e.detail.value)

        logging.verbose(
          `Triggered #clock: [${synchronizationBytes}]`,
          synchronizationBytes,
        )

        // uint64_t clock_timestamp;
        // uint64_t origin_address_handle;
        // uint32_t history_fingerprint;
        // uint32_t tngl_fingerprint;
        // uint64_t timeline_clock_timestamp;
        // uint64_t tngl_clock_timestamp;

        const SYNCHRONIZATION_BYTE_SIZE = 48

        if (synchronizationBytes.length < SYNCHRONIZATION_BYTE_SIZE) {
          logging.error(
            'synchronizationBytes.length < SYNCHRONIZATION_BYTE_SIZE',
          )
          return
        }

        const synchronization =
          SpectodaWasm.Synchronization.makeFromUint8Array(synchronizationBytes)

        // @ts-expect-error
        window.flutterConnection.synchronize(synchronization)
      })

      window.addEventListener('#scan', (e) => {
        // @ts-expect-error
        const json = e.detail.value

        logging.verbose(`Triggered #scan: [${json}]`)

        // @ts-expect-error
        window.flutterConnection.emit(SpectodaAppEvents.SCAN_RESULTS, json)
      })

      logging.debug('> FlutterConnection inited')
    } else {
      logging.debug('flutter_inappwebview in window NOT detected')
      logging.info('Simulating Flutter Functions')

      let CONNECTED = false
      let SELECTED = false

      function fail(failChance: number) {
        if (simulatedFails) {
          return Math.random() < failChance
        } else {
          return false
        }
      }

      // @ts-expect-error
      window.flutter_inappwebview = {}

      // @ts-expect-error
      window.flutter_inappwebview.callHandler = async (
        handler,
        _a,
        _b,
        _c,
        _d,
      ) => {
        //
        switch (handler) {
          //
          case 'userSelect': {
            // disconnect if already connected
            if (CONNECTED) {
              await window.flutter_inappwebview.callHandler('disconnect')
            }
            await sleep(Math.random() * 5000) // do the userSelect task filtering devices by the criteria_json parameter
            if (fail(0.5)) {
              // @ts-expect-error
              window.flutterConnection.reject('UserCanceledSelection') // reject with "UserCanceledSelection" message if user cancels selection
              return
            }
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('SelectionFailed')
              return
            }
            SELECTED = true
            // @ts-expect-error
            window.flutterConnection.resolve('{"connector":"flutterbluetooth"}')
            break
          }

          case 'autoSelect': {
            if (CONNECTED) {
              await window.flutter_inappwebview.callHandler('disconnect') // handle disconnection inside the flutter app
            }
            await sleep(Math.random() * 5000) // do the autoSelect task filtering devices by the criteria_json parameter and scanning minimum time scan_period_number, maximum timeout_number
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('SelectionFailed') // if the selection fails, return "SelectionFailed"
              return
            }
            SELECTED = true
            // @ts-expect-error
            window.flutterConnection.resolve('{"connector":"flutterbluetooth"}') // resolve with json containing the information about the connected device
            break
          }

          case 'selected': {
            // params: ()
            if (SELECTED) {
              // @ts-expect-error
              window.flutterConnection.resolve(
                '{"connector":"flutterbluetooth"}',
              ) // if the device is selected, return json
            } else {
              // @ts-expect-error
              window.flutterConnection.resolve() // if no device is selected resolve nothing
            }
            break
          }

          case 'unselect': {
            // params: ()
            if (CONNECTED) {
              // @ts-expect-error
              await window.flutterConnection.disconnect()
            }
            await sleep(10) // unselect logic
            SELECTED = false
            // @ts-expect-error
            window.flutterConnection.resolve()
            break
          }

          case 'scan': {
            if (CONNECTED) {
              await window.flutter_inappwebview.callHandler('disconnect') // handle disconnection inside the flutter app
            }
            await sleep(Math.random() * 5000) // do the autoSelect task filtering devices by the criteria_json parameter and scanning minimum time scan_period_number, maximum timeout_number
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('SelectionFailed') // if the selection fails, return "SelectionFailed"
              return
            }
            SELECTED = true
            // @ts-expect-error
            window.flutterConnection.resolve('{"connector":"flutterbluetooth"}') // resolve with json containing the information about the connected device
            break
          }

          case 'connect': {
            // params: (timeout_number)
            if (!SELECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceNotSelected')
              return
            }
            await sleep(Math.random() * 5000) // connecting logic
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('ConnectionFailed')
              return
            }
            CONNECTED = true
            // @ts-expect-error
            window.flutterConnection.resolve('{"connector":"flutterbluetooth"}')
            // after connection the SpectodaConnect can any time emit #disconnect event.

            await sleep(1000) // unselect logic

            // @ts-expect-error
            window.flutterConnection.emit(SpectodaAppEvents.PRIVATE_CONNECTED)

            setTimeout(() => {
              // @ts-expect-error
              window.flutterConnection.emit(
                SpectodaAppEvents.PRIVATE_DISCONNECTED,
              )
              //}, Math.random() * 60000);
              CONNECTED = false
            }, 60000)
            break
          }

          case 'disconnect': {
            // params: ()
            if (CONNECTED) {
              await sleep(100) // disconnecting logic
              CONNECTED = false
              // @ts-expect-error
              window.flutterConnection.emit(
                SpectodaAppEvents.PRIVATE_DISCONNECTED,
              )
            }
            // @ts-expect-error
            window.flutterConnection.resolve() // always resolves even if there are internal errors
            break
          }

          case 'connected': {
            // params: ()
            if (CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.resolve(
                '{"connector":"flutterbluetooth"}',
              )
            } else {
              // @ts-expect-error
              window.flutterConnection.resolve()
            }
            break
          }

          case 'deliver': {
            // params: (payload_bytes)
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            await sleep(25) // delivering logic
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('DeliverFailed')
              return
            }
            // @ts-expect-error
            window.flutterConnection.resolve()
            break
          }

          case 'transmit': {
            // params: (payload_bytes)
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            await sleep(10) // transmiting logic
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('TransmitFailed')
              return
            }
            // @ts-expect-error
            window.flutterConnection.resolve()
            break
          }

          case 'request': {
            // params: (payload_bytes, read_response)
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            await sleep(50) // requesting logic
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('RequestFailed')
              return
            }

            // @ts-expect-error
            window.flutterConnection.resolve([
              246, 1, 0, 0, 0, 188, 251, 18, 0, 212, 247, 18, 0, 0,
            ]) // returns data as an array of bytes: [0,255,123,89]
            break
          }

          case 'writeClock': {
            // params: (clock_bytes)
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            await sleep(10) // writing clock logic.
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('ClockWriteFailed')
              return
            }
            // @ts-expect-error
            window.flutterConnection.resolve()
            break
          }

          case 'readClock': {
            // params: ()
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            await sleep(50) // reading clock logic.
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.reject('ClockReadFailed')
              return
            }
            // @ts-expect-error
            window.flutterConnection.resolve([0, 0, 0, 0]) // returns timestamp as an 32-bit signed number
            break
          }

          case 'updateFW': {
            // params: (bytes)
            if (!CONNECTED) {
              // @ts-expect-error
              window.flutterConnection.reject('DeviceDisconnected')
              return
            }
            // @ts-expect-error
            window.flutterConnection.emit(SpectodaAppEvents.OTA_STATUS, 'begin')
            await sleep(10000) // preparing FW logic.
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.emit(
                SpectodaAppEvents.OTA_STATUS,
                'fail',
              )
              // @ts-expect-error
              window.flutterConnection.reject('UpdateFailed')
              return
            }
            for (let i = 1; i <= 100; i++) {
              // @ts-expect-error
              window.flutterConnection.emit(SpectodaAppEvents.OTA_PROGRESS, i)
              await sleep(25) // writing FW logic.
              if (fail(0.01)) {
                // @ts-expect-error
                window.flutterConnection.emit(
                  SpectodaAppEvents.OTA_STATUS,
                  'fail',
                )
                // @ts-expect-error
                window.flutterConnection.reject('UpdateFailed')
                return
              }
            }
            await sleep(1000) // finishing FW logic.
            if (fail(0.1)) {
              // @ts-expect-error
              window.flutterConnection.emit(
                SpectodaAppEvents.OTA_STATUS,
                'fail',
              )
              // @ts-expect-error
              window.flutterConnection.reject('UpdateFailed')
              return
            }
            // @ts-expect-error
            window.flutterConnection.emit(
              SpectodaAppEvents.OTA_STATUS,
              'success',
            )
            // @ts-expect-error
            window.flutterConnection.resolve()
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
    return Object.keys(window).some((v) => v.includes('flutter'))
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

    // @ts-expect-error
    window.flutterConnection.emit = (event, value) => {
      this.#runtimeReference.emit(event, value)
    }

    // @ts-expect-error
    window.flutterConnection.execute = (commandBytes: Uint8Array) => {
      logging.debug(`flutterConnection.execute(commandBytes=${commandBytes})`)

      const DUMMY_BLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.execute(
        commandBytes,
        DUMMY_BLE_CONNECTION,
      )
    }

    // @ts-expect-error
    window.flutterConnection.request = (commandBytes: Uint8Array) => {
      logging.debug(`flutterConnection.request(commandBytes=${commandBytes})`)

      const DUMMY_BLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.request(
        commandBytes,
        DUMMY_BLE_CONNECTION,
      )
    }

    // @ts-expect-error
    window.flutterConnection.synchronize = (
      synchronization: Synchronization,
    ) => {
      logging.debug(
        `flutterConnection.synchronize(synchronization=${JSON.stringify(synchronization)})`,
      )

      const DUMMY_BLE_CONNECTION = SpectodaWasm.Connection.make(
        '11:11:11:11:11:11',
        SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME,
        SpectodaWasm.connection_rssi_t.RSSI_MAX,
      )

      this.#runtimeReference.spectoda_js.synchronize(
        synchronization,
        DUMMY_BLE_CONNECTION,
      )
    }
  }

  #applyTimeout(
    promise: Promise<any> | null,
    timeoutNumber: number,
    message: string,
  ) {
    if (!promise) {
      // ? No promise provided to #applyTimeout()
      return Promise.reject('NoPromiseProvided')
    }

    const handle = setTimeout(() => {
      // @ts-expect-error
      window.flutterConnection.reject(`FlutterSafeguardTimeout: ${message}`)
    }, timeoutNumber)

    return promise.finally(() => {
      clearTimeout(handle)
    })
  }

  async ping() {
    console.time('ping_measure')
    for (let i = 0; i < 1000; i++) {
      this.#promise = new Promise((resolve, reject) => {
        // @ts-expect-error
        window.flutterConnection.resolve = resolve
        // @ts-expect-error
        window.flutterConnection.reject = reject
      })

      // logging.debug("ping")
      // @ts-expect-error
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
    criteriumArray: Array<Criterium>,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium | null> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 60000
    }

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.debug(
      `SpectodaConnectConnector::userSelect(criteria=${criteriaJson}, timeout=${timeoutNumber})`,
    )

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
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // Remove blocking overlay
        overlay.remove()

        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }

        resolve(json)
      }
      // @ts-expect-error
      window.flutterConnection.reject = (error) => {
        // Remove blocking overlay
        overlay.remove()

        reject(error)
      }
    })

    window.flutter_inappwebview.callHandler(
      'userSelect',
      criteriaJson as any,
      timeoutNumber,
    )

    const FLUTTER_RESPONSE_TIMEOUT = timeoutNumber + 60000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'userSelect',
    )
  }

  // takes the criteria, scans for scan_duration and automatically selects the device,
  // you can then connect to. This works only for BLE devices that are bond with the phone/PC/tablet
  // the app is running on OR doesnt need to be bonded in a special way.
  // if more devices are found matching the criteria, then the strongest signal wins
  // if no device is found within the timeout_number period, then it returns an error

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
    // step 1. for the scan_duration scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout_number,
    //         then return error

    const MINIMAL_AUTOSELECT_SCAN_DURATION = 1200
    const MINIMAL_AUTOSELECT_TIMEOUT = 3000

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.debug(
      `SpectodaConnectConnector::autoSelect(criteria=${criteriaJson}, scan_duration=${scanDurationNumber}, timeout=${timeoutNumber})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }

      // @ts-expect-error
      window.flutterConnection.reject = (e) => {
        // on old Androids sometimes the first time you call autoSelect right after bluetooth is turned on, it rejects with a timeout
        logging.warn(e)

        // if the second attempt rejects again, then reject the promise
        // @ts-expect-error
        window.flutterConnection.reject = reject

        console.warn(
          'autoSelect() with minimal timeout timeouted, trying it again with the full timeout...',
        )
        // TODO Fix types
        window.flutter_inappwebview.callHandler(
          'autoSelect',
          criteriaJson as any,
          Math.max(MINIMAL_AUTOSELECT_SCAN_DURATION, scanDurationNumber),
          Math.max(MINIMAL_AUTOSELECT_TIMEOUT, timeoutNumber),
        )
      }
    })

    // TODO Fix types
    window.flutter_inappwebview.callHandler(
      'autoSelect',
      criteriaJson as any,
      Math.max(MINIMAL_AUTOSELECT_SCAN_DURATION, scanDurationNumber),
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, scanDurationNumber),
    )

    const FLUTTER_RESPONSE_TIMEOUT =
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, scanDurationNumber) +
      Math.max(MINIMAL_AUTOSELECT_TIMEOUT, timeoutNumber) +
      5000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'autoSelect',
    )
  }

  selected(): Promise<Criterium | null> {
    logging.debug('SpectodaConnectConnector::selected()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler('selected')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'selected',
    )
  }

  unselect(): Promise<null> {
    logging.debug('SpectodaConnectConnector::unselect()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = resolve
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler('unselect')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'unselect',
    )
  }

  // takes the criteria, scans for scan_duration and returns the scanning results
  // if no criteria are provided, all Spectoda enabled devices (with all different FWs and Owners and such)
  // are eligible.

  scan(
    criteriumArray: Array<Criterium>,
    scanDurationNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Array<Criterium>> {
    if (scanDurationNumber === DEFAULT_TIMEOUT) {
      scanDurationNumber = 7000
    }
    // step 1. for the scan_duration scan the surroundings for BLE devices.

    const criteriaJson = JSON.stringify(criteriumArray)

    logging.debug(
      `SpectodaConnectConnector::scan(criteria=${criteriaJson}, scan_duration=${scanDurationNumber})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler(
      'scan',
      criteriaJson as any,
      scanDurationNumber,
    )

    const FLUTTER_RESPONSE_TIMEOUT = scanDurationNumber + 5000

    return this.#applyTimeout(this.#promise, FLUTTER_RESPONSE_TIMEOUT, 'scan')
  }

  /*

  timeout_number ms

  */
  // timeout 20000ms for the old slow devices to be able to connect
  connect(
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<Criterium> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 20000
    }
    logging.debug(`SpectodaConnectConnector::connect(timeout=${timeoutNumber})`)

    const MINIMAL_CONNECT_TIMEOUT = 5000

    if (timeoutNumber <= MINIMAL_CONNECT_TIMEOUT) {
      return Promise.reject('InvalidTimeout')
    }

    //? I came across an olf Andoid device that needed a two calls of a connect for a successful connection.
    //? it always timeouted on the first call, but the second call was always successful.
    //? so I am trying to connect with a minimal timeout first and if it fails, then I try it again with the full timeout
    //? becouse other devices needs a long timeout for connection to be successful
    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          json = JSON.parse(json)
        }
        resolve(json)
      }
      // @ts-expect-error
      window.flutterConnection.reject = (e) => {
        logging.warn(e)

        // if the second attempt rejects again, then reject the promise
        // @ts-expect-error
        window.flutterConnection.reject = reject

        console.warn(
          'Connect with minimal timeout timeouted, trying it again with the full timeout...',
        )
        window.flutter_inappwebview.callHandler(
          'connect',
          Math.max(MINIMAL_CONNECT_TIMEOUT, timeoutNumber),
        ) // on old Androids the minimal timeout is not enough
      }
    })

    window.flutter_inappwebview.callHandler('connect', MINIMAL_CONNECT_TIMEOUT) // first try to connect with the minimal timeout

    //? Leaving this code here for possible benchmarking. Comment out .callHandler("connect" and uncomment this code to use it
    // setTimeout(() => {
    //   window.flutterConnection.reject("SimulatedError");
    // }, MINIMAL_CONNECT_TIMEOUT);

    // the timeout must be long enough to handle the slowest devices
    const FLUTTER_RESPONSE_TIMEOUT =
      MINIMAL_CONNECT_TIMEOUT +
      Math.max(MINIMAL_CONNECT_TIMEOUT, timeoutNumber) +
      5000

    // @ts-expect-error TODO: @immakermatty fix missing connector
    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'connect',
    ).then(() => {
      logging.debug('Sleeping for 100ms after connect...')
      return sleep(100).then(() => {
        // TODO: @immakermatty fix missing connector
        return { connector: 'spectodaconnect' }
      })
    })
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect(): Promise<unknown> {
    logging.debug('SpectodaConnectConnector::disconnect()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = resolve
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler('disconnect')

    const FLUTTER_RESPONSE_TIMEOUT = 5000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'disconnect',
    )
  }

  connected(): Promise<Criterium | null> {
    logging.debug('SpectodaConnectConnector::connected()')

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (json) => {
        // the resolve returns JSON string or null
        if (json) {
          json = json.replace(/\0/g, '') //! [BUG] Flutter app on Android tends to return nulls as strings with a null character at the end. This is a workaround for that.
          const criteria = JSON.parse(json)

          resolve(criteria)
        } else {
          resolve(null)
        }
      }
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler('connected')

    const FLUTTER_RESPONSE_TIMEOUT = 1000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'connected',
    )
  }

  // deliver handles the communication with the Spectoda Controller in a way
  // that the command is guaranteed to arrive
  deliver(
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 5000
    }
    logging.debug(
      `SpectodaConnectConnector::deliver(payload=[${payloadBytes}], timeout=${timeoutNumber})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = resolve
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler(
      'deliver',
      // TODO! This should be Array.from(payloadBytes), but requires a fix in the Flutter app first to support the correct argument type.
      // eslint-disable-next-line
      payloadBytes as any,
      timeoutNumber,
    )

    const FLUTTER_RESPONSE_TIMEOUT = timeoutNumber + 5000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'deliver',
    )
  }

  // transmit handles the communication with the Spectoda Controller in a way
  // that the paylaod is NOT guaranteed to arrive
  transmit(
    payloadBytes: Uint8Array,
    timeoutNumber: number | typeof DEFAULT_TIMEOUT = DEFAULT_TIMEOUT,
  ): Promise<unknown> {
    if (timeoutNumber === DEFAULT_TIMEOUT) {
      timeoutNumber = 1000
    }
    logging.debug(
      `SpectodaConnectConnector::transmit(payload=[${payloadBytes}], timeout=${timeoutNumber})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = resolve
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler(
      'transmit',
      [...payloadBytes],
      timeoutNumber,
    )

    const FLUTTER_RESPONSE_TIMEOUT = timeoutNumber + 5000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'transmit',
    )
  }

  // request handles the requests on the Spectoda Controller. The payload request
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
      `SpectodaConnectConnector::request(payload=[${payloadBytes}], read_response=${
        readResponse ? 'true' : 'false'
      }, timeout=${timeoutNumber})`,
    )

    this.#promise = new Promise((resolve, reject) => {
      // @ts-expect-error
      window.flutterConnection.resolve = (response) => {
        resolve(new DataView(new Uint8Array(response).buffer))
      }
      // @ts-expect-error
      window.flutterConnection.reject = reject
    })

    window.flutter_inappwebview.callHandler(
      'request',
      [...payloadBytes],
      readResponse,
    )

    const FLUTTER_RESPONSE_TIMEOUT = timeoutNumber + 5000

    return this.#applyTimeout(
      this.#promise,
      FLUTTER_RESPONSE_TIMEOUT,
      'request',
    )
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock: TimeTrack): Promise<unknown> {
    logging.debug(
      `SpectodaConnectConnector::setClock(clock.millis=${clock.millis()})`,
    )

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 3; tries++) {
        await sleep(100) // ! wait for the controller to be ready
        try {
          // tries to ASAP write a timestamp to the clock characteristics.
          // if the ASAP write fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-expect-error
            window.flutterConnection.resolve = resolve
            // @ts-expect-error
            window.flutterConnection.reject = reject
          })

          const timestamp = clock.millis()
          const clockBytes = toBytes(timestamp, 8)

          window.flutter_inappwebview.callHandler('writeClock', clockBytes)

          const FLUTTER_RESPONSE_TIMEOUT = 5000

          await this.#applyTimeout(
            this.#promise,
            FLUTTER_RESPONSE_TIMEOUT,
            'writeClock',
          )
          logging.debug('Clock write success:', timestamp)

          // @ts-expect-error
          resolve()
          return
        } catch (e) {
          logging.debug(`Clock write failed: ${e}`)
        }
      }

      reject('ClockWriteFailed')
      return
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock(): Promise<TimeTrack> {
    logging.debug('SpectodaConnectConnector::getClock()')

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 3; tries++) {
        await sleep(100) // ! wait for the controller to be ready
        try {
          // tries to ASAP read a timestamp from the clock characteristics.
          // if the ASAP read fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-expect-error
            window.flutterConnection.resolve = resolve
            // @ts-expect-error
            window.flutterConnection.reject = reject
          })

          window.flutter_inappwebview.callHandler('readClock')

          const FLUTTER_RESPONSE_TIMEOUT = 5000
          const bytes = await this.#applyTimeout(
            this.#promise,
            FLUTTER_RESPONSE_TIMEOUT,
            'readClock',
          )

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

      reject('ClockReadFailed')
      return
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers

  // TODO - emit "ota_progress" events

  updateFW(
    firmwareBytes: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<unknown> {
    const skipReboot = options?.skipReboot ?? false

    logging.debug(
      `SpectodaConnectConnector::updateFW(firmware_bytes.length=${firmwareBytes.length}, skipReboot=${skipReboot})`,
    )

    this.#runtimeReference.spectodaReference.requestWakeLock()

    return new Promise(async (resolve, reject) => {
      const chunkSize = detectAndroid() ? 480 : 3984 // must be modulo 16
      // const chunk_size = 992; // must be modulo 16

      let indexFrom = 0
      let indexTo = chunkSize

      let written = 0

      logging.info('OTA UPDATE')

      const startTimestamp = Date.now()

      await sleep(100)

      try {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')

        {
          //===========// RESET //===========//
          logging.info('OTA RESET')

          const deviceBytes = [
            COMMAND_FLAGS.FLAG_OTA_RESET,
            0x00,
            ...numberToBytes(0x00000000, 4),
          ]

          await this.request(new Uint8Array(deviceBytes), false, 10000)
        }

        await sleep(100)

        {
          //===========// BEGIN //===========//
          logging.info('OTA BEGIN')

          const deviceBytes = [
            COMMAND_FLAGS.FLAG_OTA_BEGIN,
            0x00,
            ...numberToBytes(firmwareBytes.length, 4),
          ]

          await this.request(new Uint8Array(deviceBytes), false, 20000)
        }

        await sleep(8000)
        //===========// WRITE //===========//
        logging.info('OTA WRITE')

        while (written < firmwareBytes.length) {
          if (indexTo > firmwareBytes.length) {
            indexTo = firmwareBytes.length
          }

          const deviceBytes = [
            COMMAND_FLAGS.FLAG_OTA_WRITE,
            0x00,
            ...numberToBytes(written, 4),
            ...firmwareBytes.slice(indexFrom, indexTo),
          ]

          await this.request(new Uint8Array(deviceBytes), false, 10000)

          written += indexTo - indexFrom

          const percentage =
            Math.floor((written * 10000) / firmwareBytes.length) / 100

          logging.debug(`${percentage}%`)
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
          logging.info('OTA END')

          const deviceBytes = [
            COMMAND_FLAGS.FLAG_OTA_END,
            0x00,
            ...numberToBytes(written, 4),
          ]

          await this.request(new Uint8Array(deviceBytes), false, 10000)
        }

        await sleep(100)

        if (!skipReboot) {
          logging.info('Rebooting device...')

          const deviceBytes = [COMMAND_FLAGS.FLAG_DEVICE_REBOOT_REQUEST]

          await this.request(new Uint8Array(deviceBytes), false)
        } else {
          logging.info('Firmware written, skipping reboot as requested')
        }

        logging.debug(
          'Firmware written in ' +
            (Date.now() - startTimestamp) / 1000 +
            ' seconds',
        )

        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')

        resolve(null)
      } catch (e) {
        this.#runtimeReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')

        reject(e)
      }
    })
      .then(() => {
        if (!skipReboot) {
          return this.disconnect()
        }
        return Promise.resolve()
      })
      .finally(() => {
        this.#runtimeReference.spectodaReference.releaseWakeLock()
      })
  }

  cancel(): void {
    logging.debug('SpectodaConnectConnector::cancel()')

    window.flutter_inappwebview.callHandler('cancel')
  }

  destroy(): unknown {
    logging.debug('SpectodaConnectConnector::destroy()')

    //this.#runtimeReference = null; // dont know if I need to destroy this reference.. But I guess I dont need to?
    try {
      this.cancel()
      return this.disconnect().catch()
    } catch {
      return this.unselect().catch()
    }
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(commandBytes: Uint8Array, sourceConnection: Connection) {
    logging.debug(
      `SpectodaConnectConnector::sendExecute(command_bytes=${commandBytes}, source_connection=${JSON.stringify(
        sourceConnection,
      )})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    return this.deliver(commandBytes, 1000)
  }

  // bool _sendRequest(std::vector<uint8_t>& request_bytecode, const Connection& destinationConnection) = 0;

  sendRequest(requestBytecode: Uint8Array, destinationConnection: Connection) {
    logging.debug(
      `SpectodaConnectConnector::sendRequest(request_bytecode.length=${requestBytecode.length}, destinationConnection=${destinationConnection})`,
    )
    logging.verbose('request_bytecode=', requestBytecode)

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
    logging.debug(
      `SpectodaConnectConnector::sendSynchronize(synchronization=${JSON.stringify(
        synchronization,
      )}, source_connection=${JSON.stringify(sourceConnection)})`,
    )

    if (
      sourceConnection.connector_type ===
      SpectodaWasm.connector_type_t.CONNECTOR_LEGACY_JS_RUNTIME
    ) {
      return Promise.resolve()
    }

    return new Promise(async (resolve, reject) => {
      for (let tries = 0; tries < 1; tries++) {
        try {
          // tryes to ASAP write a timestamp to the clock characteristics.
          // if the ASAP write fails, then try it once more

          this.#promise = new Promise((resolve, reject) => {
            // @ts-expect-error
            window.flutterConnection.resolve = resolve
            // @ts-expect-error
            window.flutterConnection.reject = reject
          })

          const synchronizationBytes = [...synchronization.toUint8Array()]

          window.flutter_inappwebview.callHandler(
            'writeClock',
            synchronizationBytes,
          )

          await this.#applyTimeout(this.#promise, 5000, 'synchronization')

          // @ts-expect-error
          resolve()
          return
        } catch (e) {
          logging.debug(`Synchronization write failed: ${e}`)
        }
      }

      reject('SendSynchronizeFailed')
      return
    })
  }
}
