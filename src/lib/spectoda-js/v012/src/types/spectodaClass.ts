/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimeTrack } from '../../TimeTrack'
import { SpectodaRuntime } from '../SpectodaRuntime'

import { SpectodaAppEventMap } from './app-events'
import { ConnectorType } from './connect'
import { ControllerInfo, Criteria, NetworkKey, NetworkSignature } from './primitives'
import { ValueTypeColor, ValueTypeIDs, ValueTypeLabel, ValueTypePercentage, ValueTypeTimestamp } from './values'
import { ValueTypeDate } from './values'

export type SpectodaClass = {
  timeline: TimeTrack
  runtime: SpectodaRuntime
  socket: any

  // Connection methods
  setConnector(connector_type: ConnectorType, connector_param?: any): void
  assignConnector(connector_type: ConnectorType, connector_param?: any): void
  connect(
    criteria: Criteria,
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
  assignOwnerSignature(ownerSignature: NetworkSignature): boolean
  assignOwnerKey(ownerKey: NetworkKey): boolean
  getOwnerSignature(): NetworkSignature
  getOwnerKey(): NetworkKey

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
  emitEvent(event_label: ValueTypeLabel, device_ids?: ValueTypeIDs, force_delivery?: boolean): Promise<any>
  emitTimestamp(event_label: ValueTypeLabel, event_value: ValueTypeTimestamp, device_ids?: ValueTypeIDs): Promise<any>
  emitColor(event_label: ValueTypeLabel, event_value: ValueTypeColor, device_ids?: ValueTypeIDs): Promise<any>
  emitPercentage(event_label: ValueTypeLabel, event_value: ValueTypePercentage, device_ids?: ValueTypeIDs): Promise<any>
  emitLabel(event_label: ValueTypeLabel, event_value: ValueTypeLabel, device_ids?: ValueTypeIDs): Promise<any>

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
  writeOwner(ownerSignature?: NetworkSignature, ownerKey?: NetworkKey): Promise<any>
  writeNetworkOwner(ownerSignature?: NetworkSignature, ownerKey?: NetworkKey): Promise<any>
  writeControllerName(label: ValueTypeLabel): Promise<any>
  readControllerName(): Promise<any>

  // Timeline methods
  syncTimelineToDayTime(): Promise<any>
  syncTimeline(
    timestamp?: ValueTypeTimestamp | null,
    paused?: boolean | null,
    date?: ValueTypeDate | null,
  ): Promise<any>

  // Utility methods
  setDebugLevel(level: number): void
  requestWakeLock(prioritized?: boolean): Promise<void>
  releaseWakeLock(prioritized?: boolean): Promise<void>

  readControllerInfo: () => Promise<ControllerInfo>
}
