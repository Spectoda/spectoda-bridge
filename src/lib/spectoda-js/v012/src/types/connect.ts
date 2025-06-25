import { CONNECTORS } from '../constants'

import { SpectodaTypes } from './primitives'

export type ConnectorType = (typeof CONNECTORS)[keyof typeof CONNECTORS]

export type ConnectorCriteria = SpectodaTypes['Criteria']

export const CONNECTION_STATUS = Object.freeze({
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  DISCONNECTING: 'disconnecting',
})

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS]

export const REMOTECONTROL_STATUS = Object.freeze({
  REMOTECONTROL_CONNECTED: 'connected-websockets',
  REMOTECONTROL_CONNECTING: 'connecting-websockets',
  REMOTECONTROL_DISCONNECTED: 'disconnected-websockets',
  REMOTECONTROL_DISCONNECTING: 'disconnecting-websockets',
})

export type RemoteControlConnectionStatus = (typeof REMOTECONTROL_STATUS)[keyof typeof REMOTECONTROL_STATUS]

/** @deprecated Use REMOTECONTROL_STATUS instead */
export const WEBSOCKET_CONNECTION_STATE = REMOTECONTROL_STATUS

/** @deprecated Use RemoteControlConnectionStatus instead */
export type WebsocketConnectionState = RemoteControlConnectionStatus
