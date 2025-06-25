import { logging } from './logging'
import { sleep } from './functions'
import { TimeTrack } from './TimeTrack.js'
import { COMMAND_FLAGS } from './src/constants'
import { TnglReader } from './TnglReader'
import { TnglWriter } from './TnglWriter'
import { SpectodaAppEvents } from './src/types/app-events'

/////////////////////////////////////////////////////////////////////////////////////

// Connector connects the application with one Spectoda Device, that is then in a
// position of a controller for other Spectoda Devices
export class SpectodaDummyConnector {
  #interfaceReference
  #selected
  #connected
  #enableErrors
  #FWVersion

  #clock

  constructor(interfaceReference, enableErrors = false, dummyFWVersion = 'DUMMY_0.0.0_00000000') {
    this.type = enableErrors ? 'edummy' : 'dummy'

    this.#interfaceReference = interfaceReference
    this.#enableErrors = enableErrors
    this.#FWVersion = dummyFWVersion

    this.#selected = false
    this.#connected = false

    this.#clock = new TimeTrack(0, false)
  }

  #fail(chance) {
    if (this.#enableErrors) {
      return Math.random() < chance
    } else {
      return false // deactivate fail function
    }
  }

  // choose one Spectoda device (user chooses which device to connect to via a popup)
  // if no criteria are set, then show all Spectoda devices visible.
  // first bonds the BLE device with the PC/Phone/Tablet if it is needed.
  // Then selects the device
  userSelect(criteria) {
    logging.verbose('userSelect(criteria=', criteria, ')')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }
      await sleep(Math.random() * 1000) // userSelect logic
      if (this.#fail(0.25)) {
        reject('UserCanceledSelection')
        return
      }
      if (this.#fail(0.1)) {
        reject('SelectionFailed')
        return
      }
      this.#selected = true
      resolve({ connector: this.type })
    })
  }

  // takes the criteria, scans for scan_period and automatically selects the device,
  // you can then connect to. This works only for BLE devices that are bond with the phone/PC/tablet
  // the app is running on OR doesnt need to be bonded in a special way.
  // if more devices are found matching the criteria, then the strongest signal wins
  // if no device is found within the timeout period, then it returns an error

  // if no criteria are provided, all Spectoda enabled devices (with all different FWs and Owners and such)
  // are eligible.

  autoSelect(criteria, scan_period, timeout) {
    logging.verbose('autoSelect(criteria=', criteria, ', scan_period=', scan_period, 'timeout=', timeout, ')')
    // step 1. for the scan_period scan the surroundings for BLE devices.
    // step 2. if some devices matching the criteria are found, then select the one with
    //         the greatest signal strength. If no device is found until the timeout,
    //         then return error

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }
      await sleep(Math.random() * 1000) // autoSelect logic
      if (this.#fail(0.1)) {
        reject('SelectionFailed')
        return
      }
      this.#selected = true
      resolve({ connector: this.type })
    })
  }

  selected() {
    logging.verbose('selected()')

    return new Promise(async (resolve, reject) => {
      if (this.#selected) {
        resolve({ connector: this.type })
      } else {
        resolve()
      }
    })
  }

  unselect() {
    logging.verbose('unselect()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await this.disconnect()
      }
      await sleep(10) // unselect logic
      this.#selected = false
      resolve()
    })
  }

  scan(criteria, scan_period) {
    // returns devices like autoSelect scan() function
    return Promise.resolve('{}')
  }

  connect(timeout) {
    logging.verbose(`connect(timeout=${timeout})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#selected) {
        reject('DeviceNotSelected')
        return
      }
      await sleep(Math.random() * 1000) // connecting logic
      if (this.#fail(0.1)) {
        reject('ConnectionFailed')
        return
      }
      this.#connected = true
      this.#interfaceReference.emit(SpectodaAppEvents.PRIVATE_CONNECTED)
      resolve({ connector: this.type })

      /**  
        // after connection the connector can any time emit #disconnect event.
        setTimeout(() => {
                    this.#interfaceReference.emit("#disconnected");
          //}, Math.random() * 60000);
        }, 60000);
      */
    })
  }

  // disconnect Connector from the connected Spectoda Device. But keep it selected
  disconnect() {
    logging.verbose('disconnect()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        await sleep(100) // disconnecting logic
        this.#connected = false
        this.#interfaceReference.emit(SpectodaAppEvents.PRIVATE_DISCONNECTED)
      }
      resolve() // always resolves even if there are internal errors
    })
  }

  connected() {
    logging.verbose('connected()')

    return new Promise(async (resolve, reject) => {
      if (this.#connected) {
        resolve({ connector: this.type })
      } else {
        resolve()
      }
    })
  }

  // deliver handles the communication with the Spectoda network in a way
  // that the command is guaranteed to arrive
  deliver(payload, timeout) {
    logging.verbose(`deliver(payload=${payload}, timeout=${timeout})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      await sleep(25) // delivering logic

      if (this.#fail(0.1)) {
        reject('DeliverFailed')
        return
      }

      resolve()
    })
  }

  // transmit handles the communication with the Spectoda network in a way
  // that the command is NOT guaranteed to arrive
  transmit(payload, timeout) {
    logging.verbose(`transmit(payload=${payload}, timeout=${timeout})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      await sleep(10) // transmiting logic

      if (this.#fail(0.1)) {
        reject('TransmitFailed')
        return
      }

      resolve()
    })
  }

  // request handles the requests on the Spectoda network. The command request
  // is guaranteed to get a response
  request(payload, read_response = true, timeout) {
    logging.verbose(
      `request(payload=${payload}, read_response=${read_response ? 'true' : 'false'}, timeout=${timeout})`,
    )

    const ERROR_CODE_SUCCESS = 0
    const ERROR_CODE_ERROR = 255
    const DUMMY_MACS = [
      0x111111111111, 0x222222222222, 0x333333333333, 0x444444444444, 0x555555555555, 0x666666666666, 0x777777777777,
      0x888888888888,
    ]

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      await sleep(50) // requesting logic

      if (this.#fail(0.1)) {
        reject('RequestFailed')
        return
      }

      let reader = new TnglReader(new DataView(new Uint8Array(payload).buffer))

      switch (reader.peekFlag()) {
        case COMMAND_FLAGS.FLAG_FW_VERSION_REQUEST:
          {
            // log_d("FLAG_FW_VERSION_REQUEST");
            reader.readFlag() // FLAG_FW_VERSION_REQUEST

            const request_uuid = reader.readUint32()

            let error_code = ERROR_CODE_SUCCESS

            // log_d("error_code=%u", error_code);

            let writer = new TnglWriter(64)

            writer.writeFlag(COMMAND_FLAGS.FLAG_FW_VERSION_RESPONSE)
            writer.writeUint32(request_uuid)
            writer.writeUint8(error_code)

            writer.writeString(this.#FWVersion, 32)

            resolve(writer.bytes)
          }
          break

        default: {
          reader.readFlag() // FLAG_REQUEST
          const request_uuid = reader.readUint32()

          let writer = new TnglWriter(64)

          writer.writeFlag(COMMAND_FLAGS.FLAG_UNSUPPORTED_COMMND_RESPONSE)
          writer.writeUint32(request_uuid)
          writer.writeUint8(ERROR_CODE_ERROR)

          resolve(writer.bytes)
        }
      }
    })
  }

  // synchronizes the device internal clock with the provided TimeTrack clock
  // of the application as precisely as possible
  setClock(clock) {
    logging.verbose(`setClock(clock.millis()=${clock.millis()})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      await sleep(10) // writing clock logic.
      if (this.#fail(0.1)) {
        reject('ClockWriteFailed')
        return
      }
      this.#clock.setMillis(clock.millis())
      logging.verbose(`setClock() -> ${this.#clock.millis()}`)

      resolve()
    })
  }

  // returns a TimeTrack clock object that is synchronized with the internal clock
  // of the device as precisely as possible
  getClock() {
    logging.verbose('getClock()')

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }

      // reject("ClockReadFailed");
      // return;

      await sleep(50) // reading clock logic.
      if (this.#fail(0.1)) {
        reject('ClockReadFailed')
        return
      }

      logging.verbose(`getClock() -> ${this.#clock.millis()}`)
      resolve(this.#clock)
    })
  }

  // handles the firmware updating. Sends "ota" events
  // to all handlers
  updateFW(firmware) {
    logging.verbose(`updateFW(firmware=${firmware})`)

    return new Promise(async (resolve, reject) => {
      if (!this.#connected) {
        reject('DeviceDisconnected')
        return
      }
      this.#interfaceReference.emit(SpectodaAppEvents.OTA_STATUS, 'begin')
      await sleep(10000) // preparing FW logic.
      if (this.#fail(0.1)) {
        this.#interfaceReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
        reject('UpdateFailed')
        return
      }
      for (let i = 1; i <= 100; i++) {
        this.#interfaceReference.emit(SpectodaAppEvents.OTA_PROGRESS, i)
        await sleep(25) // writing FW logic.
        if (this.#fail(0.01)) {
          this.#interfaceReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
          reject('UpdateFailed')
          return
        }
      }
      await sleep(1000) // finishing FW logic.
      if (this.#fail(0.1)) {
        this.#interfaceReference.emit(SpectodaAppEvents.OTA_STATUS, 'fail')
        reject('UpdateFailed')
        return
      }
      this.#interfaceReference.emit(SpectodaAppEvents.OTA_STATUS, 'success')
      resolve()
    })
  }

  cancel() {
    logging.verbose('cancel()')

    // NOP
  }

  destroy() {
    logging.verbose('destroy()')

    return this.disconnect()
      .catch(() => {})
      .then(() => {
        return this.unselect()
      })
      .catch(() => {})

    return Promise.resolve()
  }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, const Connection& source_connection) = 0;

  sendExecute(command_bytes, source_connection) {
    logging.verbose(
      `SpectodaDummyConnector::sendExecute(command_bytes=${command_bytes}, source_connection=${source_connection.address_string})`,
    )

    return Promise.resolve()
  }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, const Connection& destination_connection) = 0;

  sendRequest(request_ticket_number, request_bytecode, destination_connection) {
    logging.verbose(
      `SpectodaDummyConnector::sendRequest(request_ticket_number=${request_ticket_number}, request_bytecode=${request_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.resolve()
  }
  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, const Connection& destination_connection) = 0;

  sendResponse(request_ticket_number, request_result, response_bytecode, destination_connection) {
    logging.verbose(
      `SpectodaDummyConnector::sendResponse(request_ticket_number=${request_ticket_number}, request_result=${request_result}, response_bytecode=${response_bytecode}, destination_connection=${destination_connection})`,
    )

    return Promise.resolve()
  }

  // void _sendSynchronize(const Synchronization& synchronization, const Connection& source_connection) = 0;

  sendSynchronize(synchronization, source_connection) {
    logging.verbose(
      `SpectodaDummyConnector::sendSynchronize(synchronization=${synchronization.origin_address}, source_connection=${source_connection.address_string})`,
    )

    return Promise.resolve()
  }

  //
}
