/* eslint-disable */
// @ts-nocheck
// TODO: Remove file, replace functionality with spectoda-core

export const CONNECTION = {
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
  DISCONNECTING: 'disconnecting',
} as const

export type ConnectionStatus = (typeof CONNECTION)[keyof typeof CONNECTION]

export const CONNECTORS = [
  { key: 'default', name: 'Automatic', hidden: false },
  { key: 'bluetooth', name: 'Bluetooth', hidden: false },
  { key: 'serial', name: 'Serial', hidden: false },
  { key: 'simulated', name: 'Simulated', hidden: false },
  { key: 'dummy', name: 'Dummy', hidden: false },
  { key: 'websockets', name: 'Web Sockets', hidden: true },
] as const

export type ConnectorType = (typeof CONNECTORS)[number]['key']
