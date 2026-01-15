import { io } from 'socket.io-client'
import customParser from 'socket.io-msgpack-parser'
import { createNanoEvents } from '../../../functions'
import { logging } from '../../../logging'
import { TimeTrack } from '../../../TimeTrack'
import { ControllerRef } from '../../ControllerRef'
import { SpectodaAppEvents } from '../../types/app-events'
import type { SpectodaClass } from '../../types/spectodaClass'
import { getRemoteControlClientMeta } from '../meta'
import {
  deserializeArgsFromTransport,
  deserializeValueFromTransport,
  serializeArgsForTransport,
} from './serialization'

// TODO rewrite this to initiate connect only when needed

// const WEBSOCKET_URL = "https://tangle-remote-control.glitch.me/"
export const WEBSOCKET_URL = 'https://cloud.host.spectoda.com/'

const eventStream = createNanoEvents()

eventStream.on('log', (...args) => {
  // Deserialize args in case they contain Uint8Array
  const deserialized = deserializeArgsFromTransport(args)
  console.log(...deserialized)
})

eventStream.on('log-warn', (...args) => {
  // Deserialize args in case they contain Uint8Array
  const deserialized = deserializeArgsFromTransport(args)
  console.warn(...deserialized)
})

eventStream.on('log-error', (...args) => {
  // Deserialize args in case they contain Uint8Array
  const deserialized = deserializeArgsFromTransport(args)
  console.error(...deserialized)
})

/////////////////////////////////////////////////////////////////////////////////////

/**
 * Runs after successfully joining a remote control session.
 * Syncs the sender app state with the receiver.
 */
const postJoinActions = (
  spectodaProxy: SpectodaClass,
  localTimeline: TimeTrack,
) => {
  spectodaProxy
    .connected()
    .then((receiverConnectedCriteria: unknown) => {
      logging.info(
        'Spectoda_JS on the receiver side connected to ',
        receiverConnectedCriteria,
      )

      //* if the receiver is connected, emit the connected event on the sender
      if (receiverConnectedCriteria) {
        spectodaProxy.emit(SpectodaAppEvents.CONNECTED, null)
      } else {
        spectodaProxy.emit(SpectodaAppEvents.DISCONNECTED, null)
      }
    })
    .then(() => {
      //* reload tngl to get all event state updates from the receiver
      return spectodaProxy.reloadTngl()
    })
    .then(async () => {
      //* sync initial timeline state from receiver
      try {
        const state = await spectodaProxy.getTimelineState()

        if (state) {
          const { millis, paused, date } = state

          if (typeof millis === 'number') {
            localTimeline.setMillis(millis)
          }
          if (typeof paused === 'boolean') {
            if (paused) {
              localTimeline.pause()
            } else {
              localTimeline.unpause()
            }
          }
          if (typeof date === 'string') {
            localTimeline.setDate(date)
          }
          logging.info(
            'RC Sender: Initial timeline synced from receiver',
            state,
          )
        }
      } catch (err: unknown) {
        logging.error(
          'RC Sender: Failed to sync initial timeline from receiver',
          err,
        )
      }
    })
    .catch((err: unknown) => {
      logging.error('RC Sender postJoinActions() error:', err)
    })
}

export const makeSpectodaVirtualProxy = ({
  signature = '00000000000000000000000000000000',
  key = '00000000000000000000000000000000',
  sessionOnly = false,
  sessionRoomNumber = 0,
} = {}): SpectodaClass => {
  const timeline = new TimeTrack()

  const socket = io(WEBSOCKET_URL, {
    parser: customParser,
  })

  const sendThroughWebsocket = async (data: {
    functionName: string | symbol
    arguments: unknown[]
  }) => {
    const result = await socket.emitWithAck('func', data)
    return result
  }

  // Create the proxy object that will be returned
  const proxy = new Proxy({} as SpectodaClass, {
    get: (_, prop) => {
      // Identify this as a virtual proxy for remote control detection
      if (prop === 'isVirtualProxy') {
        return true
      }
      if (prop === 'on') {
        return (eventName: string, callback: (...args: unknown[]) => void) => {
          return eventStream.on(eventName, callback)
        }
      }
      if (prop === 'timeline') {
        return timeline
      }
      if (prop === 'fetchClients') {
        return () => {
          return socket.emitWithAck('list-clients')
        }
      }

      // Handle .use() to create ControllerRef bound to THIS proxy (not the receiver)
      // This ensures that when using Remote Control, controller operations are
      // forwarded via websocket to the receiver
      if (prop === 'use') {
        return (path: string | string[] = []): ControllerRef => {
          const connectionPath = typeof path === 'string' ? [path] : path
          // Create ControllerRef referencing the proxy, so methods are forwarded via websocket
          return new ControllerRef(proxy, connectionPath)
        }
      }

      // Always return an async function for any property
      return async (...args: unknown[]) => {
        // Serialize Uint8Array instances to a marked format for WebSocket transport
        const serializedArgs = serializeArgsForTransport(args)

        const payload = {
          functionName: prop,
          arguments: serializedArgs,
        }

        const result = await sendThroughWebsocket(payload)

        if (result.status === 'success') {
          // Iterate over each item inside result.data (if any) to check for errors.
          for (const res of result.data ?? []) {
            if (res.status === 'error') {
              // Deserialize the error object back to an Error instance
              const error = deserializeValueFromTransport(res.error)
              if (error instanceof Error) {
                throw error
              }
              throw new Error(String(res.error) ?? 'Unknown error')
            }
          }
          const responseData = result.data?.[0]
          // Handle payload (e.g. from debug) - deserialize array
          if (responseData?.payload) {
            const deserialized = deserializeArgsFromTransport(
              responseData.payload,
            )
            // Return single value directly if only one arg, otherwise return array
            return deserialized.length === 1 ? deserialized[0] : deserialized
          }
          // Deserialize the result in case it contains Uint8Array
          return deserializeValueFromTransport(responseData?.result)
        } else {
          // Deserialize the error object back to an Error instance
          const error = deserializeValueFromTransport(result?.error)
          if (error instanceof Error) {
            throw error
          }
          throw new Error(String(result?.error) ?? 'Unknown error')
        }
      }
    },
  })

  // Set up socket event handlers (proxy is now available)
  socket.on('event', (data) => {
    logging.verbose('event', data)

    // TODO delete this useless event
    if (data.name === SpectodaAppEvents.PRIVATE_WASM_EXECUTE) {
      eventStream.emit(SpectodaAppEvents.PRIVATE_WASM_EXECUTE, data.args[0][1])
      return
    }

    // Handle timeline updates from receiver - sync local timeline state only
    // (UI components should subscribe to TIMELINE_UPDATE event, not local timeline events)
    if (data.name === SpectodaAppEvents.TIMELINE_UPDATE) {
      const { millis, paused, date } = data.args[0] || {}

      if (typeof millis === 'number') {
        timeline.setMillis(millis)
      }
      if (typeof paused === 'boolean') {
        if (paused) {
          timeline.pause()
        } else {
          timeline.unpause()
        }
      }
      if (typeof date === 'string') {
        timeline.setDate(date)
      }
      // Don't emit local timeline events - UI should react to TIMELINE_UPDATE only
      // This prevents duplicate reactions and feedback loops
    }

    eventStream.emit(data.name, ...data.args)
  })

  socket.on('connect', () => {
    logging.log('> RC Sender connected')

    if (sessionOnly) {
      socket
        .emitWithAck('join-session', sessionRoomNumber)
        .then((response) => {
          if (response?.status === 'success') {
            logging.info('RC Sender joined session', response.roomNumber)
            // Send metadata about the sender platform
            socket.emit('set-meta-data', getRemoteControlClientMeta())
            postJoinActions(proxy, timeline)
          } else {
            throw new Error(response?.error)
          }
        })
        .catch((err: unknown) => {
          logging.error('error connecting to websocket server (session)', err)
        })
    } else if (signature && key) {
      const params = [
        {
          signature,
          key,
          type: 'sender',
        },
      ]

      socket
        .emitWithAck('join', params)
        .then((response) => {
          if (response?.status === 'success') {
            logging.log('> RC Sender joined', response)
            // Send metadata about the sender platform
            socket.emit('set-meta-data', getRemoteControlClientMeta())
            postJoinActions(proxy, timeline)
          } else {
            throw new Error(response?.error)
          }
        })
        .catch((err: unknown) => {
          logging.error('error connecting to websocket server', err)
        })
    }
  })

  socket.on('disconnect', () => {
    logging.log('> RC Sender disconnected')
  })

  return proxy
}
