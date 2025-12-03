import { io } from 'socket.io-client'
import customParser from 'socket.io-msgpack-parser'

import { SpectodaAppEvents } from './src/types/app-events'
import { TimeTrack } from './TimeTrack'
import { createNanoEvents } from './functions'
import { logging } from './logging'
import { REMOTECONTROL_STATUS } from './src/types/connect'

// TODO rewrite this to initiate connect only when needed

// const WEBSOCKET_URL = "https://tangle-remote-control.glitch.me/"
export const WEBSOCKET_URL = 'https://cloud.host.spectoda.com/'

const eventStream = createNanoEvents()

eventStream.on('log', (a, b, c, d) => {
  // TODO: if (typeof d !== "undefined") of if (d === undefined) something like that rather than checking for truthiness
  if (d) {
    console.log(a, b, c, d)
  } else if (c) {
    console.log(a, b, c)
  } else if (b) {
    console.log(a, b)
  } else {
    console.log(a)
  }
})

// TODO: .on("warn", (a, b, c, d) => {
eventStream.on('log-warn', (a, b, c, d) => {
  // TODO: if (typeof d !== "undefined") of if (d === undefined) something like that rather than checking for truthiness
  if (d) {
    console.log(a, b, c, d)
  } else if (c) {
    console.log(a, b, c)
  } else if (b) {
    console.log(a, b)
  } else {
    console.log(a)
  }
})

// TODO: .on("error", (a, b, c, d) => {
eventStream.on('log-error', (a, b, c, d) => {
  // TODO: if (typeof d !== "undefined") of if (d === undefined) something like that rather than checking for truthiness
  if (d) {
    console.log(a, b, c, d)
  } else if (c) {
    console.log(a, b, c)
  } else if (b) {
    console.log(a, b)
  } else {
    console.log(a)
  }
})

if (typeof window !== 'undefined') {
  window.sockets = []
}
/////////////////////////////////////////////////////////////////////////////////////

export const isCurrentSpectodaInstanceLocal = () => {
  return typeof spectoda.init === 'undefined'
}

//** Added by @immakermatty to automatically connect the sender app if the receiver is connected */
//* if receiver is connected, emit the connected event on the sender
const postJoinActions = (localTimeline) => {
  if (typeof window !== 'undefined' && window.spectoda) {
    //* if the receiver is connected, emit the connected event on the sender
    //* so that sender will switch to connected state
    window.spectoda
      .connected() ////
      .then((receiverConnectedCriteria) => {
        logging.info('Spectoda_JS on the receiver side connected to ', receiverConnectedCriteria)

        //* if the receiver is connected, emit the connected event on the sender
        if (receiverConnectedCriteria) {
          //* emit the connected event to the sender app
          window.spectoda.emit(SpectodaAppEvents.CONNECTED)
        } else {
          //* emit the disconnected event to the sender app
          window.spectoda.emit(SpectodaAppEvents.DISCONNECTED)
        }
      }) ////
      .then(() => {
        //* reload tngl to get all event state updates from the receiver
        return window.spectoda.reloadTngl()
      }) ////
      .then(async () => {
        //* sync initial timeline state from receiver
        if (localTimeline) {
          try {
            const state = await window.spectoda.getTimelineState()

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
              logging.info('RC Sender: Initial timeline synced from receiver', state)
            }
          } catch (err) {
            logging.error('RC Sender: Failed to sync initial timeline from receiver', err)
          }
        }
      }) ////
      .catch((err) => {
        logging.error('RC Sender postJoinActions() error:', err)
      })
  }
}

export const createSpectodaWebsocket = ({
  signature = '00000000000000000000000000000000',
  key = '00000000000000000000000000000000',
  sessionOnly = false,
  sessionRoomNumber = 0,
} = {}) => {
  const timeline = new TimeTrack()

  const socket = io(WEBSOCKET_URL, {
    parser: customParser,
  })

  if (typeof window !== 'undefined') {
    window.sockets.push(socket)
  }

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

    eventStream.emit(SpectodaAppEvents.REMOTECONTROL_CONNECTING)

    if (sessionOnly) {
      socket
        .emitWithAck('join-session', sessionRoomNumber)
        .then((response) => {
          if (response?.status === 'success') {
            logging.info('RC Sender joined session', response.roomNumber)
            postJoinActions(timeline)
            eventStream.emit(SpectodaAppEvents.REMOTECONTROL_CONNECTED)
          } else {
            throw new Error(response?.error)
          }
        })
        .catch((err) => {
          logging.error('error connecting to websocket server (session)', err)
        })
    }
    //
    else if (signature && key) {
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
            eventStream.emit(SpectodaAppEvents.REMOTECONTROL_CONNECTED)
            postJoinActions(timeline)
          } else {
            throw new Error(response?.error)
          }
        })
        .catch((err) => {
          logging.error('error connecting to websocket server', err)
        })
    }
  })

  socket.on('disconnect', () => {
    logging.log('> RC Sender disconnected')

    eventStream.emit(SpectodaAppEvents.REMOTECONTROL_DISCONNECTED)
  })

  class SpectodaVirtualProxy {
    constructor() {
      return new Proxy(this, {
        get: (_, prop) => {
          if (prop === 'on') {
            // Special handling for "on" method
            return (eventName, callback) => {
              logging.verbose('Subscribing to event', eventName)

              const unsub = eventStream.on(eventName, callback)

              // nanoid subscribe to event stream

              // unsubscribe from previous event
              return unsub
            }
          } else if (prop === 'timeline') {
            return timeline
          } else if (prop === 'fetchClients') {
            return () => {
              return socket.emitWithAck('list-clients')
            }
          } else if (prop === 'connectionState') {
            if (typeof window !== 'undefined' && window.spectoda) {
              return window.spectoda.getRemoteControlConnectionState()
            } else {
              return REMOTECONTROL_STATUS.REMOTECONTROL_DISCONNECTED
            }
          }

          // Always return an async function for any property
          return async (...args) => {
            const payload = {
              functionName: prop,
              arguments: args,
            }

            if (prop === 'updateDeviceFirmware' || prop === 'updateNetworkFirmware') {
              if (Array.isArray(args?.[0])) {
                args[0] = Uint8Array.from(args[0]).buffer
              }
            }

            const result = await this.sendThroughWebsocket(payload)

            if (result.status === 'success') {
              // Iterate over each item inside result.data (if any) to check for errors.
              for (const res of result.data ?? []) {
                if (res.status === 'error') {
                  logging.error(res)
                  throw new Error(res.error)
                }
              }
              return result.data?.[0]?.result
            } else {
              logging.error('[WEBSOCKET]', result)

              if (Array.isArray(result)) {
                throw new Error(result[0])
              } else {
                throw new Error(result?.error)
              }
            }
          }
        },
      })
    }

    async sendThroughWebsocket(data) {
      const result = await socket.emitWithAck('func', data)

      return result
    }
  }

  return new SpectodaVirtualProxy()
}
