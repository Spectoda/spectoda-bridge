import { logging } from './logging'

export class TnglWriter {
  #buffer: Uint8Array
  #dataView: DataView
  #index: number

  constructor(buffer_size = 65535) {
    this.#buffer = new Uint8Array(buffer_size)
    this.#dataView = new DataView(this.#buffer.buffer)
    this.#index = 0
  }

  writeValue(value: number, byteCount: number) {
    if (this.#index + byteCount <= this.#dataView.byteLength) {
      for (let i = 0; i < byteCount; i++) {
        this.#dataView.setUint8(this.#index++, value & 0xff)
        value = Math.floor(value / Math.pow(2, 8))
      }
    } else {
      console.trace('WriteOutOfRange')
      throw 'WriteOutOfRange'
    }
  }

  writeBytes(bytes: Uint8Array, size: number | null = null) {
    if (size === null || size === undefined) {
      size = bytes.length
    }

    logging.debug('writeBytes', bytes, size)

    if (this.#index + size <= this.#dataView.byteLength) {
      for (let i = 0; i < size; i++) {
        if (i < bytes.length) {
          this.#dataView.setUint8(this.#index++, bytes[i])
        } else {
          logging.warn('writeBytes: padding with 0')
          this.#dataView.setUint8(this.#index++, 0)
        }
      }
    } else {
      console.trace('WriteOutOfRange')
      throw 'WriteOutOfRange'
    }
  }

  writeString(string: string, length: number | null = null) {
    if (length === null) {
      length = string.length
    }

    if (this.#index + length <= this.#dataView.byteLength) {
      for (let i = 0; i < length; i++) {
        this.#dataView.setUint8(this.#index++, string.charCodeAt(i))
      }
    } else {
      console.trace('WriteOutOfRange')
      throw 'WriteOutOfRange'
    }
  }

  writeFlag(value: number) {
    return this.writeValue(value, 1)
  }

  writeUint8(value: number) {
    return this.writeValue(value, 1)
  }

  writeInt16(value: number) {
    return this.writeValue(value, 2)
  }

  writeUint16(value: number) {
    return this.writeValue(value, 2)
  }

  writeInt32(value: number) {
    return this.writeValue(value, 4)
  }

  writeUint32(value: number) {
    return this.writeValue(value, 4)
  }

  get available() {
    return this.#dataView.byteLength - this.#index
  }

  forward(byteCount: number) {
    if (this.#index + byteCount <= this.#dataView.byteLength) {
      this.#index += byteCount
    } else {
      this.#index = this.#dataView.byteLength
    }
  }

  back(byteCount: number) {
    if (this.#index >= byteCount) {
      this.#index -= byteCount
    } else {
      this.#index = 0
    }
  }

  reset() {
    this.#index = 0
  }

  get bytes() {
    return new Uint8Array(this.#buffer.slice(0, this.#index))
  }

  get written() {
    return this.#index
  }
}
