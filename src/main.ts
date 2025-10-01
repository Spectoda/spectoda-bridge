import { logging, SpectodaAppEvents, sleep, type EventState } from './lib/spectoda-js/v012'
import { spectoda } from './communication'
import './server'
import fs from 'node:fs'
import { fetchPiInfo } from './lib/utils/functions'
import { oscSender } from './osc-sender'

// if not exists, create assets folder
if (!fs.existsSync('assets')) {
  fs.mkdirSync('assets')
}

async function main() {
  const gatewayMetadata = await fetchPiInfo()

  await sleep(1000)

  if (fs.existsSync('assets/config.json')) {
    const config = JSON.parse(fs.readFileSync('assets/config.json', 'utf8'))

    /*
     {
       "spectoda": {
           "connect": {
               "connector": "nodeserial",
               "criteria": {
                   "uart": "/dev/ttyS0",
                   "baudrate": 115200
               }
           },
           "network": {
               "signature": "00000000000000000000000000000000",
               "key": "00000000000000000000000000000000"
           },
           "synchronize": {
               "tngl": {
                   "bytecode": "02c2c322bc8813000c8ff",
                   "code": "addDrawing(0s, Infinity, animRainbow(5s, 100%));",
                   "path": "tngl.txt"
               },
               "config": {
                   "json": "{\"DELETE_KEYS\":[\"tohle\", \"tamto\"]}",
                   "path": "config.json"
               },
               "fw": {
                   "path": "0.10.0_20231010.enc"
               }
           },
           "remoteControl": {
               "enabled": true
           }
       }
     }
     */

    if (config?.spectoda) {
      if (config.spectoda.debug) {
        if (config.spectoda.debug.level) {
          spectoda.setDebugLevel(config.spectoda.debug.level)
        }
      }

      if (config.spectoda.remoteControl) {
        if (
          config.spectoda.remoteControl.enable ||
          config.spectoda.remoteControl.enabled
        ) {
          if (
            config.spectoda.network?.signature &&
            config.spectoda.network.key
          ) {
            logging.info('>> Installing Remote Control Receiver...')
            try {
              spectoda.installRemoteControlReceiver({
                signature: config.spectoda.network.signature,
                key: config.spectoda.network.key,
                meta: { gw: gatewayMetadata },
                sessionOnly: config.spectoda.remoteControl.sessionOnly,
              })
            } catch (err) {
              logging.error('Failed to install remote control receiver', err)
            }
          } else {
            logging.error(
              'To enable remoteControl config.spectoda.network.signature && config.spectoda.network.key needs to be defined.',
            )
          }
        }
      }

      if (config.spectoda.connect) {
        const connector = config.spectoda.connect.connector || 'default'

        // Build criteria - include network/key from config if present
        const criteria = {
          ...config.spectoda.connect.criteria,
          // Include network signature and key in criteria if defined
          ...(config.spectoda.network?.signature && {
            network: config.spectoda.network.signature,
          }),
          ...(config.spectoda.network?.key && {
            key: config.spectoda.network.key,
          }),
        }

        const connect = async () => {
          try {
            const connected = await spectoda.connected().catch(() => false)
            if (!connected) {
              logging.info('>> Connecting...')
              // Use new connect signature: connect(connector, criteria, options)
              await spectoda.connect(connector, criteria, {
                autoSelect: true,
              })
            }
          } catch (error) {
            logging.error('Failed to connect', error)
          }
        }

        connect()

        let interval = setInterval(connect, 60000)
        spectoda.on(SpectodaAppEvents.DISCONNECTED, () => {
          clearInterval(interval)
          interval = setInterval(connect, 60000)
        })
      }
    }
  }


  spectoda.on('emittedevents', async (events: EventState[]) => {
    for (const event of events) {
      // Send event via OSC to matching room
      await oscSender.processEvent(event)
    }
  })



}

main()
