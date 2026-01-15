import type { CONNECTORS } from '../constants'

import type { Criteria } from './primitives'

export type ConnectorType = (typeof CONNECTORS)[keyof typeof CONNECTORS]

export type ConnectorCriteria = Criteria

export const CONNECTION_STATUS = Object.freeze({
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  DISCONNECTING: 'disconnecting',
})

export type ConnectionStatus =
  (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS]

/**
 * Options for the connect() method
 */
export type ConnectOptions = {
  /**
   * When true, automatically selects a matching device without showing user selection dialog.
   * @default false
   */
  autoSelect?: boolean

  /**
   * When true, overrides any in-progress connection attempt.
   * @default false
   */
  overrideConnection?: boolean

  /**
   * When true, automatically attempts to reconnect if connection is lost.
   * Reconnection continues until `disconnect()` or another `connect()` is called.
   * @default false
   */
  autonomousReconnection?: boolean

  /**
   * Timeout in milliseconds for the connection attempt.
   * @default null (no timeout)
   */
  timeout?: number | null
}

/**
 * Options for the scan() method
 */
export type ScanOptions = {
  /**
   * Duration in milliseconds to scan for devices.
   * @default null (uses default scan period)
   */
  scanPeriod?: number | null
}
