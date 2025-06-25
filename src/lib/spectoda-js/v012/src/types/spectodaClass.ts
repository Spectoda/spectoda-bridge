/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimeTrack } from '../../TimeTrack'
import { SpectodaRuntime } from '../SpectodaRuntime'

import { SpectodaAppEventMap } from './app-events'
import { ConnectorType } from './connect'
import { SpectodaTypes } from './primitives'

export type SpectodaClass = {
  timeline: TimeTrack
  runtime: SpectodaRuntime
  socket: any

  // Connection methods
  setConnector(connector_type: ConnectorType, connector_param?: any): void
  assignConnector(connector_type: ConnectorType, connector_param?: any): void
  connect(
    criteria: SpectodaTypes['Criteria'],
    autoConnect?: boolean,
    ownerSignature?: string | null,
    ownerKey?: string | null,
    connectAny?: boolean,
    fwVersion?: string,
    autonomousReconnection?: boolean,
    overrideConnection?: boolean,
  ): Promise<any>
  disconnect(): Promise<void> | ReturnType<SpectodaRuntime['disconnect']>
  connected(): Promise<null> | ReturnType<SpectodaRuntime['connected']>

  // Network methods
  assignOwnerSignature(ownerSignature: SpectodaTypes['NetworkSignature']): boolean
  assignOwnerKey(ownerKey: SpectodaTypes['NetworkKey']): boolean
  getOwnerSignature(): SpectodaTypes['NetworkSignature']
  getOwnerKey(): SpectodaTypes['NetworkKey']

  // Event handling
  addEventListener<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ): () => void
  on<K extends keyof SpectodaAppEventMap>(event: K, callback: (props: SpectodaAppEventMap[K]) => void): () => void

  // TNGL methods
  preprocessTngl(tngl_code: string): Promise<string>
  writeTngl(tngl_code: string | null, tngl_bytes: Uint8Array | null): Promise<any>
  getTnglFingerprint(): Promise<Uint8Array>

  // Event emission methods
  emitEvent(
    event_label: SpectodaTypes['Label'],
    device_ids?: SpectodaTypes['IDs'],
    force_delivery?: boolean,
  ): Promise<any>
  emitTimestamp(
    event_label: SpectodaTypes['Label'],
    event_value: SpectodaTypes['Timestamp'],
    device_ids?: SpectodaTypes['IDs'],
  ): Promise<any>
  emitColor(
    event_label: SpectodaTypes['Label'],
    event_value: SpectodaTypes['Color'],
    device_ids?: SpectodaTypes['IDs'],
  ): Promise<any>
  emitPercentage(
    event_label: SpectodaTypes['Label'],
    event_value: SpectodaTypes['Percentage'],
    device_ids?: SpectodaTypes['IDs'],
  ): Promise<any>
  emitLabel(
    event_label: SpectodaTypes['Label'],
    event_value: SpectodaTypes['Label'],
    device_ids?: SpectodaTypes['IDs'],
  ): Promise<any>

  // Device/Network management
  updateDeviceFirmware(firmware: Uint8Array): Promise<any>
  updateNetworkFirmware(firmware: Uint8Array): Promise<any>
  rebootNetwork(): Promise<any>
  rebootDevice(): Promise<any>
  removeOwner(): Promise<any>
  removeNetworkOwner(): Promise<any>
  getFwVersion(): Promise<string>
  getConnectedPeersInfo(): Promise<Array<{ mac: string; rssi: number }>>
  deviceSleep(): Promise<any>
  networkSleep(): Promise<any>

  // Controller configuration
  writeOwner(ownerSignature?: SpectodaTypes['NetworkSignature'], ownerKey?: SpectodaTypes['NetworkKey']): Promise<any>
  writeNetworkOwner(
    ownerSignature?: SpectodaTypes['NetworkSignature'],
    ownerKey?: SpectodaTypes['NetworkKey'],
  ): Promise<any>
  writeControllerName(label: SpectodaTypes['Label']): Promise<any>
  readControllerName(): Promise<any>

  // Timeline methods
  syncTimelineToDayTime(): Promise<any>
  syncTimeline(
    timestamp?: SpectodaTypes['Timestamp'] | null,
    paused?: boolean | null,
    date?: SpectodaTypes['Date'] | null,
  ): Promise<any>

  // Utility methods
  setDebugLevel(level: number): void
  requestWakeLock(prioritized?: boolean): Promise<void>
  releaseWakeLock(prioritized?: boolean): Promise<void>

  readControllerInfo: () => Promise<SpectodaTypes['ControllerInfo']>
}
