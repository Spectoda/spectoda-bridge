/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import {
  useRemoteControlStore,
  REMOTE_CONTROL_TYPES,
  addEventListeners,
} from '@spectoda/spectoda-core'
import { CONNECTORS, Spectoda } from '@spectoda/spectoda-js/v012'
import { simpleError } from '../../../error/index'
import {
  handleInitializeReceiver,
  handleInitializeSenderAndReturnProxySpectodaObject,
} from '@spectoda/spectoda-core/src/js/remoteControl'

// TODO The whole communication initialization should be handled by spectoda-core
let spectoda = new Spectoda(CONNECTORS.NONE)

// TODO Add the remoteDebug-related code below to its own `remoteDebug.ts` file
// Right now its not possible because importing `spectoda` from `communication.ts` will cause a dependency cycle
export const DEBUG_LEVEL = 4
export const ON_LOAD_TIMEOUT = 2_000
export const REMOTE_DEBUG_SCRIPT_URL =
  'https://chii.host.spectoda.com/target.js'
export const REMOTE_DEBUG_PARAM = 'remotedebug'
export const isRemoteDebugEnabled = (): boolean => {
  const urlParams = new URLSearchParams(window.location.search)

  return urlParams.has(REMOTE_DEBUG_PARAM)
}
export const initializeRemoteDebug = (): void => {
  const script = document.createElement('script')

  script.src = REMOTE_DEBUG_SCRIPT_URL
  document.body.append(script)

  script.addEventListener('load', () => {
    setTimeout(() => {
      spectoda.setDebugLevel(DEBUG_LEVEL)
    }, ON_LOAD_TIMEOUT)
  })
}

const waitForUseRemoteControlStoreInitialization = () => {
  return new Promise<void>((resolve) => {
    /** Use requestAnimationFrame to ensure we're in the next frame */
    requestAnimationFrame(() => {
      /** Add a small delay to ensure store is initialized */
      setTimeout(resolve, 0)
    })
  })
}

const initializeSpectodaCommunication = async () => {
  if (typeof window === 'undefined') {
    return simpleError('SPECTODA_UTILS.COMMUNICATION:NOT_BROWSER_ENV')
  }

  await waitForUseRemoteControlStoreInitialization()

  if (isRemoteDebugEnabled()) {
    initializeRemoteDebug()
  }

  const { enabled, type, networkData } = useRemoteControlStore.getState()

  if (enabled && type === REMOTE_CONTROL_TYPES.RECEIVER) {
    const result = await handleInitializeReceiver(networkData)

    if (result.isErr()) {
      throw result.error
    }
  } else if (enabled && type === REMOTE_CONTROL_TYPES.SENDER) {
    const result = await handleInitializeSenderAndReturnProxySpectodaObject({
      networkData,
    })

    if (result.isErr()) {
      throw result.error
    }

    //@ts-ignore-next-line TODO refactor spectoda-js remote control (with its typing)
    spectoda = result.value
  }

  addEventListeners()
}

initializeSpectodaCommunication()
  .then(() => {
    if (typeof window !== 'undefined') {
      // @ts-ignore-next-line TODO add Spectoda to window
      window.Spectoda = Spectoda
      // @ts-ignore-next-line TODO add spectoda to window
      window.spectoda = spectoda
    }
  })
  .catch((error) =>
    console.error('Failed to initialize spectoda communication', error),
  )

export { spectoda }
