import { logging } from './logging'

export class TnglReader {
  #dataView: DataView
  #index: number

  constructor(bytecode: Uint8Array) {
    this.#dataView = new DataView(bytecode.buffer)
    this.#index = 0
  }

  // TODO optimize and test this function
  peekValue(byteCount: number, unsigned = true) {
    if (byteCount > 8) {
      logging.error('peekValue(): ByteCountOutOfRange byteCount=', byteCount)
      throw new RangeError('ByteCountOutOfRange')
    }

    if (this.#index + byteCount > this.#dataView.byteLength) {
      console.error(
        'peekValue(): ReadOutOfRange index=',
        this.#index,
        'byteCount=',
        byteCount,
        'byteLength=',
        this.#dataView.byteLength,
      )
      throw new RangeError('ReadOutOfRange')
    }

    let value = 0n

    for (let i = byteCount; i > 0; i--) {
      value <<= 8n
      value |= BigInt(this.#dataView.getUint8(this.#index + i - 1))
    }

    let result = value

    // Check if the sign bit is set
    if (!unsigned && value & (1n << (BigInt(byteCount * 8) - 1n))) {
      // Two's complement conversion
      result = value - (1n << BigInt(byteCount * 8))
    }

    if (
      result > BigInt(Number.MAX_SAFE_INTEGER) ||
      result < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      logging.error('peekValue(): Value is outside of safe integer range')
      // TODO handle this error better than loosing precision in conversion to Number
      throw new RangeError('ValueOutOfRange')
    }

    return Number(result)
  }

  readValue(byteCount: number, unsigned: boolean) {
    try {
      const val = this.peekValue(byteCount, unsigned)

      this.forward(byteCount)
      return val
    } catch {
      console.error(
        'readValue(): ReadOutOfRange index=',
        this.#index,
        'byteCount=',
        byteCount,
        'byteLength=',
        this.#dataView.byteLength,
      )
      throw 'ReadOutOfRange'
    }
  }

  readBytes(byteCount: number) {
    if (this.#index + byteCount <= this.#dataView.byteLength) {
      const bytes = []

      for (let i = 0; i < byteCount; i++) {
        bytes.push(this.#dataView.getUint8(this.#index + i))
      }

      this.forward(byteCount)

      return bytes
    } else {
      console.error(
        'readBytes(): ReadOutOfRange index=',
        this.#index,
        'byteCount=',
        byteCount,
        'byteLength=',
        this.#dataView.byteLength,
      )
      throw 'ReadOutOfRange'
    }
  }

  readString(byteCount: number) {
    if (this.#index + byteCount <= this.#dataView.byteLength) {
      let string = ''
      let endOfTheString = false

      for (let i = 0; i < byteCount; i++) {
        const charCode = this.#dataView.getUint8(this.#index + i)

        if (charCode === 0) {
          endOfTheString = true
        }
        if (!endOfTheString) {
          string += String.fromCharCode(charCode)
        }
      }

      this.forward(byteCount)

      return string
    } else {
      console.error(
        'readString(): ReadOutOfRange index=',
        this.#index,
        'byteCount=',
        byteCount,
        'byteLength=',
        this.#dataView.byteLength,
      )
      throw 'ReadOutOfRange'
    }
  }

  peekFlag() {
    return this.peekValue(1, true)
  }

  readFlag() {
    return this.readValue(1, true)
  }

  readInt8() {
    return this.readValue(1, false)
  }

  readUint8() {
    return this.readValue(1, true)
  }

  readInt16() {
    return this.readValue(2, false)
  }

  readUint16() {
    return this.readValue(2, true)
  }

  readInt32() {
    return this.readValue(4, false)
  }

  readUint32() {
    return this.readValue(4, true)
  }

  readInt48() {
    return this.readValue(6, false)
  }

  readUint48() {
    return this.readValue(6, true)
  }

  readInt64() {
    return this.readValue(8, false)
  }

  readUint64() {
    return this.readValue(8, true)
  }

  get available() {
    return this.#dataView.byteLength - this.#index
  }

  moveForward(byteCount: number) {
    if (this.#index + byteCount <= this.#dataView.byteLength) {
      this.#index += byteCount
    } else {
      this.#index = this.#dataView.byteLength
    }
  }

  /* @deprecated use moveForward instead */
  forward(byteCount: number) {
    this.moveForward(byteCount)
  }

  moveBack(byteCount: number) {
    if (this.#index >= byteCount) {
      this.#index -= byteCount
    } else {
      this.#index = 0
    }
  }

  /* @deprecated use moveBack instead */
  back(byteCount: number) {
    this.moveBack(byteCount)
  }
}
