/**
 * Serialization utilities for WebSocket transport in Remote Control.
 * Handles Uint8Array conversion since WebSocket/msgpack doesn't preserve the type.
 */

/**
 * Serialized Uint8Array payload for WebSocket transport.
 * Original Uint8Array is converted to a plain number array with a type marker.
 */
type SerializedUint8Array = {
  __type: 'Uint8Array'
  data: number[]
}

/**
 * Serialized Error payload for WebSocket transport.
 * Error properties are not enumerable, so we extract them explicitly.
 */
type SerializedError = {
  __type: 'Error'
  message: string
  name: string
  stack?: string
}

const isSerializedUint8Array = (
  value: unknown,
): value is SerializedUint8Array =>
  value !== null &&
  typeof value === 'object' &&
  (value as SerializedUint8Array).__type === 'Uint8Array' &&
  Array.isArray((value as SerializedUint8Array).data)

const isSerializedError = (value: unknown): value is SerializedError =>
  value !== null &&
  typeof value === 'object' &&
  (value as SerializedError).__type === 'Error' &&
  typeof (value as SerializedError).message === 'string'

/**
 * Serialize Uint8Array and Error arguments for WebSocket transport.
 * Handles Uint8Array and Error at the argument level - other types pass through unchanged.
 * Error objects need special handling because their properties are not enumerable.
 */
export const serializeArgsForTransport = (args: unknown[]): unknown[] => {
  const serialized: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Uint8Array) {
      const payload: SerializedUint8Array = {
        __type: 'Uint8Array',
        data: Array.from(arg),
      }
      serialized.push(payload)
    } else if (arg instanceof Error) {
      const payload: SerializedError = {
        __type: 'Error',
        message: arg.message,
        name: arg.name,
        stack: arg.stack,
      }
      serialized.push(payload)
    } else {
      serialized.push(arg)
    }
  }
  return serialized
}

/**
 * Deserialize Uint8Array and Error arguments received from WebSocket transport.
 * Handles marked Uint8Array and Error at the argument level - other types pass through unchanged.
 */
export const deserializeArgsFromTransport = (args: unknown[]): unknown[] => {
  const deserialized: unknown[] = []
  for (const arg of args) {
    if (isSerializedUint8Array(arg)) {
      deserialized.push(new Uint8Array(arg.data))
    } else if (isSerializedError(arg)) {
      const error = new Error(arg.message)
      error.name = arg.name
      if (arg.stack) {
        error.stack = arg.stack
      }
      deserialized.push(error)
    } else {
      deserialized.push(arg)
    }
  }
  return deserialized
}

/**
 * Serialize a single value for WebSocket transport.
 * Converts Uint8Array and Error to marked format.
 */
export const serializeValueForTransport = (value: unknown): unknown => {
  if (value instanceof Uint8Array) {
    const payload: SerializedUint8Array = {
      __type: 'Uint8Array',
      data: Array.from(value),
    }
    return payload
  }
  if (value instanceof Error) {
    const payload: SerializedError = {
      __type: 'Error',
      message: value.message,
      name: value.name,
      stack: value.stack,
    }
    return payload
  }
  return value
}

/**
 * Deserialize a single value from WebSocket transport.
 * Converts marked Uint8Array and Error back to their instances.
 */
export const deserializeValueFromTransport = (value: unknown): unknown => {
  if (isSerializedUint8Array(value)) {
    return new Uint8Array(value.data)
  }
  if (isSerializedError(value)) {
    const error = new Error(value.message)
    error.name = value.name
    if (value.stack) {
      error.stack = value.stack
    }
    return error
  }
  return value
}

/**
 * Serialize an error for WebSocket transport.
 * Error objects don't serialize properly (properties are not enumerable),
 * so we extract the message, name, and stack explicitly.
 * Returns the same marked format as serializeArgsForTransport for consistency.
 */
export const serializeErrorForTransport = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      __type: 'Error',
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }
  return {
    __type: 'Error',
    message: String(error),
    name: 'Error',
  }
}
