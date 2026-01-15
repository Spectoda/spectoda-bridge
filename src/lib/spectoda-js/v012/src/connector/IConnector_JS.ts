import { logging } from '../../logging'
import { SpectodaWasm } from '../SpectodaWasm'
import type { connector_type_t, IConnector_WASM } from '../types/wasm'

export class IConnector_JS {
  #instance: IConnector_WASM | undefined

  constructor() {
    this.#instance = undefined
  }
  construct(implementation: object, connectorType: connector_type_t) {
    logging.debug('construct(implementation=', implementation, ')')

    if (this.#instance) {
      throw 'AlreadyContructed'
    }

    return SpectodaWasm.waitForInitilize().then(() => {
      this.#instance = SpectodaWasm.IConnector_WASM.implement(implementation)
      this.#instance.init(connectorType)
    })
  }

  destruct() {
    if (!this.#instance) {
      throw 'AlreadyDestructed'
    }

    this.#instance.delete() // delete (free) C++ object
    this.#instance = undefined // remove javascript reference
  }

  getWasmInstance(): IConnector_WASM {
    if (!this.#instance) {
      throw 'NotConstructed'
    }

    return this.#instance
  }
}
