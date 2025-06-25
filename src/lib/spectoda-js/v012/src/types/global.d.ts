import { SCFBridgeMethods } from '@spectoda/scf-bridge/src/types'

import { validateTimestamp } from '../../functions'
import { logging } from '../../logging'

declare global {
  // Changing this to `type` breaks the `declare` functionality
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    logging: typeof logging
    validateTimestamp: typeof validateTimestamp
    flutter_inappwebview: SCFBridgeMethods
  }
}

export {}
