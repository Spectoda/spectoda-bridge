import { io, type Socket } from 'socket.io-client'
import customParser from 'socket.io-msgpack-parser'
import { logging } from '../../../logging'
import { allEventsEmitter } from '../../SpectodaRuntime'
import { SpectodaAppEvents } from '../../types/app-events'
import { CONNECTION_STATUS } from '../../types/connect'
import type { SpectodaClass } from '../../types/spectodaClass'
import { WEBSOCKET_URL } from './RemoteControlSender'
import {
  deserializeArgsFromTransport,
  serializeArgsForTransport,
  serializeErrorForTransport,
  serializeValueForTransport,
} from './serialization'

type InstallOptions = {
  signature: string
  key: string
  sessionOnly: boolean
  meta: object
}

/**
 * Remote Control Receiver - handles receiving remote control commands from a sender.
 * Encapsulates all the WebSocket logic for the receiver side.
 */
export class RemoteControlReceiver {
  #spectoda: SpectodaClass | null = null
  #socket: Socket | null = null
  #eventListeners: Array<() => void> = []

  /**
   * Install the remote control receiver on a Spectoda instance.
   */
  async install(spectoda: SpectodaClass, options: InstallOptions) {
    const { signature, key, sessionOnly, meta } = options

    logging.debug(
      `RemoteControlReceiver::install(signature=${signature}, key=${key}, sessionOnly=${sessionOnly}, meta=${JSON.stringify(meta)})`,
    )
    logging.info('> Installing Remote Control Receiver...')

    this.#spectoda = spectoda

    // Clean up existing socket if present
    if (this.#socket) {
      this.#socket.removeAllListeners()
      this.#socket.disconnect()
      this.#cleanupEventListeners()
    }

    this.#socket = io(WEBSOCKET_URL, {
      parser: customParser,
    })

    this.#socket.connect()
    spectoda.requestWakeLock(true)

    // Subscribe to all events and forward them to sender
    this.#eventListeners = [
      allEventsEmitter.on(
        'on',
        ({ name, args }: { name: string; args: unknown[] }) => {
          try {
            logging.verbose('event', name, args)
            this.#socket?.emit('event', {
              name,
              args: serializeArgsForTransport(args),
            })
          } catch (err) {
            console.error(err)
          }
        },
      ),
    ]

    // @ts-expect-error - expose for debugging
    globalThis.allEventsEmitter = allEventsEmitter

    // Set up handler for remote function calls
    this.#setupFuncHandler()

    return await new Promise((resolve, reject) => {
      this.#socket?.on('disconnect', () => {
        logging.info('> RC Receiver disconnected')
      })

      this.#socket?.on('connect', async () => {
        logging.info('> RC Receiver connected')

        this.#setupLoggingCallbacks()

        if (sessionOnly) {
          const response = await this.#socket?.emitWithAck('join-session', null)
          const roomNumber = response?.roomNumber

          if (response?.status === 'success') {
            // Send metadata AFTER joining (join resets socket.data on server)
            this.#socket?.emit('set-meta-data', meta)
            logging.debug(
              'Remote control session joined successfully',
              roomNumber,
            )
            resolve({ status: 'success', roomNumber })
          } else {
            logging.debug('Remote control session join failed, does not exist')
          }
        } else if (signature) {
          try {
            await this.#socket?.emitWithAck('join', { signature, key })
            // Send metadata AFTER joining (join resets socket.data on server)
            this.#socket?.emit('set-meta-data', meta)
            logging.info('> RC Receiver joined')
            await this.#postJoinActions()
            resolve({ status: 'success' })
          } catch (e) {
            reject(e)
          }
        }
      })
    })
  }

  /**
   * Uninstall the remote control receiver.
   * Properly cleans up all resources: socket listeners, event listeners, logging callbacks.
   */
  uninstall() {
    logging.debug('RemoteControlReceiver::uninstall()')
    logging.info('> Uninstalling Remote Control Receiver')

    // Reset logging callbacks first (before disconnecting socket)
    this.#resetLoggingCallbacks()

    // Clean up event emitter subscriptions
    this.#cleanupEventListeners()

    // Clean up socket
    if (this.#socket) {
      this.#socket.removeAllListeners()
      this.#socket.disconnect()
      this.#socket = null
    }

    // Release wake lock
    this.#spectoda?.releaseWakeLock(true)
    this.#spectoda = null
  }

  /**
   * Get the underlying socket (for legacy compatibility with Spectoda.socket)
   */
  get socket(): Socket | null {
    return this.#socket
  }

  // Private methods

  async #postJoinActions() {
    if (!this.#spectoda) return

    try {
      // Emit the current connection state, then reload TNGL.
      this.#spectoda.emit(this.#spectoda.getConnectionState(), null)
      await this.#spectoda.reloadTngl()
    } catch (err) {
      logging.error('RC Receiver postJoinActions() error:', err)
    }
  }

  #setupLoggingCallbacks() {
    if (!this.#socket) return

    const socket = this.#socket

    logging.setLogCallback((...e) => {
      console.log(...e)
      socket.emit('event', { name: 'log', args: serializeArgsForTransport(e) })
    })

    logging.setWarnCallback((...e) => {
      console.warn(...e)
      socket.emit('event', {
        name: 'log-warn',
        args: serializeArgsForTransport(e),
      })
    })

    logging.setErrorCallback((...e) => {
      console.error(...e)
      socket.emit('event', {
        name: 'log-error',
        args: serializeArgsForTransport(e),
      })
    })
  }

  #resetLoggingCallbacks() {
    logging.setLogCallback(console.log)
    logging.setWarnCallback(console.warn)
    logging.setErrorCallback(console.error)
  }

  #setupFuncHandler() {
    if (!this.#socket) return

    this.#socket.on(
      'func',
      async (
        payload: { functionName: string; arguments: unknown[] },
        callback: (response: unknown) => void,
      ) => {
        if (!callback) {
          logging.error('No callback provided')
          return
        }

        const { functionName, arguments: args } = payload
        const deserializedArgs = deserializeArgsFromTransport(args)

        try {
          if (functionName === 'debug') {
            logging.log(...deserializedArgs)
            return callback({
              status: 'success',
              message: 'debug',
              payload: serializeArgsForTransport(deserializedArgs),
            })
          }

          // @ts-expect-error - dynamic method call
          const result = await this.#spectoda?.[functionName](
            ...deserializedArgs,
          )
          callback({
            status: 'success',
            result: serializeValueForTransport(result),
          })
        } catch (e) {
          logging.error(e)
          callback({ status: 'error', error: serializeErrorForTransport(e) })
        }
      },
    )
  }

  #cleanupEventListeners() {
    for (const unsubscribe of this.#eventListeners) {
      unsubscribe()
    }
    this.#eventListeners = []
  }
}
