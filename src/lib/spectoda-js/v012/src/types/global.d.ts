import { SCFBridgeMethods } from '@spectoda/scf-bridge/src/types'

import { validateTimestamp } from '../../functions'
import { logging } from '../../logging'

declare global {
  interface Window {
    logging: typeof logging
    validateTimestamp: typeof validateTimestamp
    flutter_inappwebview: SCFBridgeMethods
  }
}
