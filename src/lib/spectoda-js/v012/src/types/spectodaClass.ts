import type { TimeTrack } from '../../TimeTrack'
import type { SpectodaRuntime } from '../SpectodaRuntime'
import type { SpectodaVersion } from '../version'

import type { SpectodaAppEventMap, SpectodaAppEventName } from './app-events'
import type {
  ConnectionStatus,
  ConnectOptions,
  ConnectorType,
  ScanOptions,
} from './connect'
import type {
  ControllerInfo,
  Criteria,
  Criterium,
  NetworkKey,
  NetworkSignature,
  TnglBank,
} from './primitives'
import type {
  SpectodaIdsType,
  ValueTypeBoolean,
  ValueTypeColor,
  ValueTypeDate,
  ValueTypeLabel,
  ValueTypeNumber,
  ValueTypePercentage,
  ValueTypeTimestamp,
} from './values'
import type { ConnectionInfo } from './wasm'

// Forward declaration for ControllerRef (actual implementation in ControllerRef.ts)
import type { ControllerRef } from '../ControllerRef'

export type SpectodaClass = {
  /**
   * True if this is a SpectodaVirtualProxy (remote control sender mode).
   * Undefined on a real Spectoda instance.
   */
  isVirtualProxy?: boolean

  timeline: TimeTrack
  runtime: SpectodaRuntime

  // Version information

  /**
   * Returns the current spectoda-js version information.
   * Used by spectoda-core to determine which API signatures are supported
   * when communicating with remote control receivers.
   *
   * @returns SpectodaVersion object containing wasm version and jsRevision
   */
  version(): SpectodaVersion

  // Connection methods

  /**
   * Scans for controllers that match the given criteria.
   *
   * @param connector - The connector type to use for scanning (e.g., 'bluetooth', 'serial')
   * @param criteria - Filter criteria for device discovery (network, fw, mac, name, etc.)
   * @param options - Scan options (scanPeriod)
   * @returns Array of discovered devices matching the criteria
   */
  scan(
    connector: ConnectorType,
    criteria: Criteria,
    options?: ScanOptions,
  ): Promise<Criterium[]>

  /**
   * Connects to a controller that matches the given criteria.
   *
   * @param connector - The connector type to use (e.g., 'bluetooth', 'serial', 'websockets', 'simulated')
   * @param criteria - Filter criteria for device selection (network, key, fw, mac, name, etc.)
   * @param options - Connection options (autoSelect, overrideConnection, autonomousReconnection, timeout)
   * @returns The criteria of the connected controller, or null if connection failed
   */
  connect(
    connector: ConnectorType,
    criteria: Criteria,
    options?: ConnectOptions,
  ): Promise<Criterium | null>

  /**
   * Cancels the current connect or scan operation.
   */
  cancel(): ReturnType<SpectodaRuntime['cancel']>

  disconnect(): Promise<void> | ReturnType<SpectodaRuntime['disconnect']>
  connected(): Promise<null> | ReturnType<SpectodaRuntime['connected']>

  /**
   * Returns the current connection state (CONNECTING, CONNECTED, DISCONNECTING, DISCONNECTED).
   */
  getConnectionState(): ConnectionStatus

  // Event handling
  addEventListener<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ): () => void
  on<K extends keyof SpectodaAppEventMap>(
    event: K,
    callback: (props: SpectodaAppEventMap[K]) => void,
  ): () => void
  emit(event: SpectodaAppEventName, value: unknown): void

  // TNGL methods
  preprocessTngl(tnglCode: string): Promise<string>
  writeTngl(
    tnglCode: string | null,
    tnglBytes: Uint8Array | null,
    tnglBank?: TnglBank,
  ): Promise<any>
  getTnglFingerprint(): Promise<Uint8Array>
  eraseTngl(): Promise<any>
  eraseTnglBank(tnglBank: TnglBank): Promise<any>
  reloadTngl(): void

  // Event emission methods
  emitEvent(
    eventLabel: ValueTypeLabel,
    deviceIds?: SpectodaIdsType,
    forceDelivery?: boolean,
  ): Promise<any>
  emitTimestamp(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeTimestamp,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitColor(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeColor,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitPercentage(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypePercentage,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitLabel(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeLabel,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitNumber(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeNumber,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitDate(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeDate,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitBoolean(
    eventLabel: ValueTypeLabel,
    eventValue: ValueTypeBoolean,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>
  emitNull(
    eventLabel: ValueTypeLabel,
    deviceIds?: SpectodaIdsType,
  ): Promise<any>

  // Device/Network management
  fetchAndUpdateDeviceFirmware(
    url: string,
    options?: { skipReboot?: boolean },
  ): Promise<any>
  fetchAndUpdateNetworkFirmware(
    url: string,
    options?: { skipReboot?: boolean },
  ): Promise<any>
  updateDeviceFirmware(
    firmware: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<any>
  updateNetworkFirmware(
    firmware: Uint8Array,
    options?: { skipReboot?: boolean },
  ): Promise<any>
  rebootNetwork(): Promise<any>
  rebootDevice(): Promise<any>
  removeOwner(): Promise<any>
  removeNetworkOwner(): Promise<any>
  getFwVersion(): Promise<string>
  getConnectedPeersInfo(): Promise<Array<{ mac: string; rssi: number }>>
  deviceSleep(): Promise<any>
  networkSleep(): Promise<any>
  saveState(): Promise<any>
  eraseEventHistory(): Promise<any>
  eraseTimeline(): Promise<any>
  eraseNetworkStorage(): Promise<any>

  // Controller configuration
  writeOwner(
    ownerSignature?: NetworkSignature,
    ownerKey?: NetworkKey,
  ): Promise<any>
  writeNetworkOwner(
    ownerSignature?: NetworkSignature,
    ownerKey?: NetworkKey,
  ): Promise<any>
  writeControllerName(label: ValueTypeLabel): Promise<any>
  readControllerName(): Promise<any>

  // Timeline methods
  syncTimelineToDayTime(): Promise<any>
  syncTimeline(
    timestamp?: ValueTypeTimestamp | null,
    paused?: boolean | null,
    date?: ValueTypeDate | null,
  ): Promise<any>
  getTimelineState(): Promise<{ millis: number; paused: boolean; date: string }>
  getTimelineMillis(): Promise<number>
  getTimelinePaused(): Promise<boolean>
  getTimelineDate(): Promise<string>
  setTimelineMillis(millis: number): Promise<any>
  setTimelineDate(date: string): Promise<any>
  pauseTimeline(): Promise<any>
  unpauseTimeline(): Promise<any>
  rewindTimeline(pause?: boolean): Promise<any>
  manipulateTimeline(
    timestamp: number,
    pause: boolean,
    date: string,
  ): Promise<any>

  // Utility methods
  setDebugLevel(level: number): void
  requestWakeLock(prioritized?: boolean): Promise<void>
  releaseWakeLock(prioritized?: boolean): Promise<void>

  readControllerInfo: () => Promise<ControllerInfo>

  // Legacy device methods (for direct connection operations)
  /**
   * Reads configuration from the directly connected controller.
   * @returns Promise resolving to config JSON string
   */
  readDeviceConfig(): Promise<string>

  /**
   * Writes configuration to the directly connected controller.
   * @param configString - Configuration JSON string to write
   * @param options - Options for the update (skipReboot)
   * @returns Promise resolving to response bytes or null/undefined
   */
  updateDeviceConfig(
    configString: string,
    options?: { skipReboot?: boolean },
  ): Promise<Uint8Array | null | undefined>

  // Controller Actions via Connection Path (0.12.11+)

  /**
   * Creates a ControllerRef bound to a specific connection path.
   *
   * @param path - Single hop (string) or array of hops to reach the controller
   *   - [] or no args for app controller (local/root)
   *   - "bluetooth/aa:bb:cc:dd:ee:ff" or ["bluetooth/aa:bb:cc:dd:ee:ff"] for direct
   *   - ["bluetooth/...", "espnow/..."] for multi-hop
   * @returns ControllerRef instance
   */
  use(path?: string | string[]): ControllerRef

  /**
   * Reads configuration from a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to config JSON string
   */
  requestReadConfig(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string>

  /**
   * Writes configuration to a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param config - Configuration JSON string to write
   * @param options - rebootAfterWrite (bool), timeout (ms)
   * @returns Promise resolving to response bytes
   */
  requestWriteConfig(
    connectionPath: string[],
    config: string,
    options?: { rebootAfterWrite?: boolean; timeout?: number },
  ): Promise<Uint8Array>

  /**
   * Reads available connections from a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to array of ConnectionInfo objects
   */
  requestReadConnections(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ConnectionInfo[]>

  /**
   * Reads controller info from a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to ControllerInfo object
   */
  requestReadControllerInfo(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<ControllerInfo>

  /**
   * Reboots a controller via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when reboot command is sent
   */
  requestRestart(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void>

  /**
   * Puts a controller to sleep via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms), duration (ms) - sleep duration, 0 for indefinite
   * @returns Promise resolving when sleep command is sent
   */
  requestSleep(
    connectionPath: string[],
    options?: { timeout?: number; duration?: number },
  ): Promise<void>

  /**
   * Reads the controller label (short name) via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the controller label string
   */
  requestReadControllerLabel(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string>

  /**
   * Writes the controller label (short name) via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param label - The new controller label to write
   * @param options - timeout (ms)
   * @returns Promise resolving when label is written
   */
  requestWriteControllerLabel(
    connectionPath: string[],
    label: string,
    options?: { timeout?: number },
  ): Promise<void>

  /**
   * Reads the firmware version via connection path.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving to the firmware version string
   */
  requestReadFwVersion(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<string>

  /**
   * Erases the network ownership from a controller via connection path.
   * Controller will need to be commissioned again.
   *
   * @param connectionPath - Array of hops, e.g., [] for local, ["bluetooth/aa:bb:cc:dd:ee:ff"] for remote
   * @param options - timeout (ms)
   * @returns Promise resolving when network is erased
   */
  requestEraseNetwork(
    connectionPath: string[],
    options?: { timeout?: number },
  ): Promise<void>

  // Remote control methods
  // Named "install/uninstall" to differentiate from spectoda-core's
  // enableRemoteControlReceiver/disableRemoteControl which manage state
  installRemoteControlReceiver(options: {
    signature: string
    key: string
    sessionOnly: boolean
    meta: object
  }): Promise<unknown>
  uninstallRemoteControlReceiver(): void
  makeRemoteControlSender(options: {
    signature: string
    key: string
    sessionOnly?: boolean
    sessionRoomNumber?: number
  }): SpectodaClass
}
