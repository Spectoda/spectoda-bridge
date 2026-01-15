import type { PrivateError } from '../../../error/src/private'
import type { ControllerInfo } from './types/primitives'
import type { SpectodaClass } from './types/spectodaClass'
import type { ConnectionInfo } from './types/wasm'
import { parseConnectionHop } from './controllerRef.utils'

type RequestOptions = { timeout?: number }
type WriteConfigOptions = RequestOptions & { rebootAfterWrite?: boolean }
type SleepOptions = RequestOptions & { duration?: number }

// Error types that can be returned from ControllerRef operations
export type ControllerRefError = PrivateError<
  | 'TIMEOUT'
  | 'DISCONNECTED'
  | 'REQUEST_FAILED'
  | 'INVALID_PATH'
  | 'HOP_UNREACHABLE'
  | 'CONNECTOR_NOT_FOUND'
  | 'SEND_FAILED'
  | 'LEGACY_MODE_ONLY'
  | 'NEW_MODE_REQUIRED'
>

/**
 * Legacy mode for ControllerRef.
 * - 'legacy': FW < 0.12.11, uses direct methods (readDeviceConfig, etc.)
 * - null: FW >= 0.12.11, uses Controller Actions (request* methods with connection paths)
 */
export type ControllerRefLegacyMode = 'legacy' | null

/**
 * Options for creating a ControllerRef.
 */
export type ControllerRefOptions = {
  /** 
   * Legacy mode - determines which API methods to use.
   * - 'legacy': Uses direct methods (readDeviceConfig, etc.) for FW < 0.12.11
   * - null: Uses Controller Actions (request* methods) for FW >= 0.12.11
   */
  legacyMode: ControllerRefLegacyMode
  /** MAC address of the controller */
  mac: string
  /** Human-readable name of the controller */
  name?: string | null
  /** Signal strength in dBm (from discovery) */
  rssi?: number | null
}

/**
 * Represents a controller accessible via a specific connection path.
 * Central abstraction for all controller interactions.
 *
 * ## API Versioning
 *
 * ControllerRef handles API versioning internally:
 * - **Legacy Mode** (FW < 0.12.11): Uses existing methods like `readDeviceConfig()`, `rebootDevice()`
 * - **New Mode** (FW >= 0.12.11): Uses request* methods like `requestReadConfig(path)`
 *
 * ## Read vs Get Pattern
 *
 * - `readXXX()` methods **always fetch fresh data** from the physical controller
 * - Getters return **cached values** (may be `null` if never fetched)
 * - The physical Controller is the **source of truth**
 *
 * @example
 * // Get cached value (fast, may be null)
 * const cachedConfig = ref.config
 *
 * // Fetch fresh from controller (network request)
 * const freshConfig = await ref.readConfig()
 *
 * // Now getter returns the fresh value
 * ref.config === freshConfig // true
 *
 * @example
 * // One-liner for quick operations
 * await spectoda.use(["bluetooth/aa:bb:cc:dd:ee:ff"]).readControllerInfo()
 *
 * // Store reference for multiple operations
 * const controllerRef = spectoda.use(["bluetooth/aa:bb:cc:dd:ee:ff"])
 * const config = await controllerRef.readConfig()
 * const info = await controllerRef.readControllerInfo()
 * await controllerRef.restart()
 */
export class ControllerRef {
  private readonly _spectoda: SpectodaClass
  private _connectionPath: string[]
  private readonly _legacyMode: ControllerRefLegacyMode

  /** Whether this controller is in legacy mode (FW < 0.12.11) */
  get legacyMode(): ControllerRefLegacyMode {
    return this._legacyMode
  }

  /** Whether this controller is in legacy mode (FW < 0.12.11) */
  get isLegacyMode(): boolean {
    return this._legacyMode === 'legacy'
  }

  // ============ Identity ============
  private _mac: string
  private _name: string | null = null
  private _controllerLabel: string | null = null

  // ============ Device Info (cached from readControllerInfo) ============
  private _fwVersion: string | null = null // e.g., "0.12.4"
  private _fullVersion: string | null = null // e.g., "FW_0.12.4_20241117"
  private _fwVersionCode: number | null = null // e.g., 1204
  private _fwPlatformCode: number | null = null
  private _fwCompilationUnixTimestamp: bigint | null = null
  private _networkSignature: string | null = null
  private _pcbCode: number | null = null
  private _productCode: number | null = null
  private _commissionable: boolean | null = null

  // ============ Fingerprints (cached) ============
  private _tnglFingerprint: string | null = null
  private _eventStoreFingerprint: string | null = null
  private _configFingerprint: string | null = null
  private _networkStorageFingerprint: string | null = null
  private _controllerStoreFingerprint: string | null = null
  private _notificationStoreFingerprint: string | null = null

  // ============ Config (cached) ============
  private _config: string | null = null
  private _configLastRead: Date | null = null

  // ============ Signal Strength ============
  private _rssi: number | null = null
  private _rssiUpdatedAt: Date | null = null

  // ============ Connections (from this controller's POV) ============
  private _connections: ConnectionInfo[] | null = null
  private _connectionsUpdatedAt: Date | null = null

  // ============ Loading State ============
  private _isLoading = false
  private _error: string | null = null

  constructor(spectoda: SpectodaClass, connectionPath: string[], options: ControllerRefOptions) {
    this._spectoda = spectoda
    this._connectionPath = [...connectionPath] // defensive copy
    this._legacyMode = options.legacyMode
    this._mac = options.mac
    this._name = options.name ?? null
    this._rssi = options.rssi ?? null
    if (options.rssi != null) {
      this._rssiUpdatedAt = new Date()
    }
  }

  // ============ Identity Getters ============

  /** MAC address of this controller */
  get mac(): string {
    return this._mac
  }

  /** Human-readable name of this controller */
  get name(): string | null {
    return this._name
  }

  /** Connection path to reach this controller */
  get path(): readonly string[] {
    return this._connectionPath
  }

  /** Whether this is directly connected (single legacy hop) */
  get isDirectlyConnected(): boolean {
    return (
      this._connectionPath.length === 1 &&
      (this._connectionPath[0].startsWith('legacy/') ||
        this._connectionPath[0].startsWith('bluetooth/'))
    )
  }

  /** Whether this is the app/root controller (empty path) */
  get isAppController(): boolean {
    return this._connectionPath.length === 0
  }

  // ============ Cached State Getters (from readControllerInfo) ============

  get controllerLabel(): string | null {
    return this._controllerLabel
  }
  get fwVersion(): string | null {
    return this._fwVersion
  }
  get fullVersion(): string | null {
    return this._fullVersion
  }
  get fwVersionCode(): number | null {
    return this._fwVersionCode
  }
  get fwPlatformCode(): number | null {
    return this._fwPlatformCode
  }
  get fwCompilationUnixTimestamp(): bigint | null {
    return this._fwCompilationUnixTimestamp
  }
  get networkSignature(): string | null {
    return this._networkSignature
  }
  get pcbCode(): number | null {
    return this._pcbCode
  }
  get productCode(): number | null {
    return this._productCode
  }
  get commissionable(): boolean | null {
    return this._commissionable
  }

  // Fingerprints
  get tnglFingerprint(): string | null {
    return this._tnglFingerprint
  }
  get eventStoreFingerprint(): string | null {
    return this._eventStoreFingerprint
  }
  get configFingerprint(): string | null {
    return this._configFingerprint
  }
  get networkStorageFingerprint(): string | null {
    return this._networkStorageFingerprint
  }
  get controllerStoreFingerprint(): string | null {
    return this._controllerStoreFingerprint
  }
  get notificationStoreFingerprint(): string | null {
    return this._notificationStoreFingerprint
  }

  // ============ Config Getters ============

  /** Cached configuration JSON string */
  get config(): string | null {
    return this._config
  }
  get configLastRead(): Date | null {
    return this._configLastRead
  }

  // ============ Signal Strength ============

  /** RSSI signal strength in dBm (e.g., -65). Relative to current reference point. */
  get rssi(): number | null {
    return this._rssi
  }
  get rssiUpdatedAt(): Date | null {
    return this._rssiUpdatedAt
  }

  /**
   * Signal quality as 0-4 bars based on RSSI.
   * Matches Studio's current implementation thresholds.
   * Returns null if RSSI is unknown.
   */
  get signalBars(): number | null {
    if (this._rssi === null) return null
    if (this._rssi > -50) return 4 // Excellent (green)
    if (this._rssi > -70) return 3 // Good (green)
    if (this._rssi > -85) return 2 // Fair (yellow/warning)
    if (this._rssi > -127) return 1 // Weak (red/critical)
    return 0 // No Signal (red/critical)
  }

  // ============ Connections Getters ============

  /** Cached connections visible from this controller's perspective */
  get connections(): readonly ConnectionInfo[] | null {
    return this._connections
  }
  get connectionsUpdatedAt(): Date | null {
    return this._connectionsUpdatedAt
  }

  // ============ Loading State ============

  get isLoading(): boolean {
    return this._isLoading
  }
  get error(): string | null {
    return this._error
  }

  // ============ Operations ============

  /**
   * Fetches config from the physical controller.
   * Always makes a network request - use `config` getter for cached value.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving to config JSON string
   */
  async readConfig(options?: RequestOptions): Promise<string> {
    this._isLoading = true
    this._error = null

    try {
      let config: string

      if (this._legacyMode === 'legacy') {
        config = await this._spectoda.readDeviceConfig()
      } else {
        config = await this._spectoda.requestReadConfig(this._connectionPath, options)
      }

      this._config = config
      this._configLastRead = new Date()
      return config
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to read config'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Writes config to the physical controller.
   * After write, the cached configFingerprint will be outdated.
   * Call readControllerInfo() to refresh fingerprints if needed.
   *
   * @param config - Configuration JSON string
   * @param options - Write options (rebootAfterWrite, timeout)
   * @returns Promise resolving when config is written
   */
  async writeConfig(config: string, options?: WriteConfigOptions): Promise<void> {
    this._isLoading = true
    this._error = null

    try {
      if (this._legacyMode === 'legacy') {
        await this._spectoda.updateDeviceConfig(config, {
          skipReboot: !options?.rebootAfterWrite,
        })
        if (options?.rebootAfterWrite) {
          await this._spectoda.rebootDevice()
        }
      } else {
        await this._spectoda.requestWriteConfig(this._connectionPath, config, options)
      }

      // Update cached config content (we know what we wrote)
      this._config = config
      this._configLastRead = new Date()
      // Note: cached configFingerprint is now outdated
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to write config'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Fetches controller info from the physical controller.
   * Always makes a network request - use getters for cached values.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving to ControllerInfo object
   */
  async readControllerInfo(options?: RequestOptions): Promise<ControllerInfo> {
    this._isLoading = true
    this._error = null

    try {
      let info: ControllerInfo

      if (this._legacyMode === 'legacy') {
        info = await this._spectoda.readControllerInfo()
      } else {
        info = await this._spectoda.requestReadControllerInfo(this._connectionPath, options)
      }

      // Cache all info fields
      this._name = info.fullName ?? this._name
      this._controllerLabel = info.controllerLabel ?? null
      this._commissionable = info.commissionable ?? null
      this._pcbCode = info.pcbCode ?? null
      this._productCode = info.productCode ?? null
      this._fwVersion = info.fwVersion
      this._fullVersion = info.fwVersionFull ?? null
      this._fwVersionCode = info.fwVersionCode ?? null
      this._fwPlatformCode = info.fwPlatformCode ?? null
      this._fwCompilationUnixTimestamp =
        info.fwCompilationUnixTimestamp != null ? BigInt(info.fwCompilationUnixTimestamp) : null
      this._networkSignature = info.networkSignature ?? null
      this._tnglFingerprint = info.tnglFingerprint ?? null
      this._eventStoreFingerprint = info.eventStoreFingerprint ?? null
      this._configFingerprint = info.configFingerprint ?? null
      this._networkStorageFingerprint = info.networkStorageFingerprint ?? null
      this._controllerStoreFingerprint = info.controllerStoreFingerprint ?? null
      this._notificationStoreFingerprint = info.notificationStoreFingerprint ?? null

      return info
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to read controller info'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Fetches connections visible from THIS controller's perspective.
   * Always makes a network request - use `connections` getter for cached value.
   * Returns list of controllers this one can communicate with, including RSSI.
   *
   * Only available in new mode.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving to array of ConnectionInfo objects
   */
  async readConnections(options?: RequestOptions): Promise<ConnectionInfo[]> {
    if (this._legacyMode === 'legacy') {
      throw new Error('readConnections requires firmware 0.12.11+')
    }

    this._isLoading = true
    this._error = null

    try {
      const connections = await this._spectoda.requestReadConnections(this._connectionPath, options)

      this._connections = connections
      this._connectionsUpdatedAt = new Date()

      return connections
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to read connections'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Restart this controller.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving when restart command is sent
   */
  async restart(options?: RequestOptions): Promise<void> {
    this._isLoading = true
    this._error = null

    try {
      if (this._legacyMode === 'legacy') {
        await this._spectoda.rebootDevice()
      } else {
        await this._spectoda.requestRestart(this._connectionPath, options)
      }
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to restart'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Put this controller to sleep.
   *
   * @param options - Sleep options (timeout, duration)
   *   - duration: sleep duration in ms, 0 for indefinite (requires power cycle)
   * @returns Promise resolving when sleep command is sent
   */
  async sleep(options?: SleepOptions): Promise<void> {
    this._isLoading = true
    this._error = null

    try {
      if (this._legacyMode === 'legacy') {
        // Legacy mode: use legacy function that calls the request on a directly connected controller
        await this._spectoda.deviceSleep()
      } else {
        // New mode: use request API with connection path
        await this._spectoda.requestSleep(this._connectionPath, options)
      }
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to sleep'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Reads the controller label (short name) from the physical controller.
   * Always makes a network request - use `controllerLabel` getter for cached value.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving to the controller label string
   */
  async readControllerLabel(options?: RequestOptions): Promise<string> {
    this._isLoading = true
    this._error = null

    try {
      let label: string

      if (this._legacyMode === 'legacy') {
        // Legacy mode: use legacy function that calls the request on a directly connected controller
        label = await this._spectoda.readControllerName()
      } else {
        // New mode: use request API with connection path
        label = await this._spectoda.requestReadControllerLabel(this._connectionPath, options)
      }

      this._controllerLabel = label
      return label
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to read controller label'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Writes the controller label (short name) to the physical controller.
   *
   * @param label - The new controller label to write
   * @param options - Request options (timeout)
   * @returns Promise resolving when label is written
   */
  async writeControllerLabel(label: string, options?: RequestOptions): Promise<void> {
    this._isLoading = true
    this._error = null

    try {
      if (this._legacyMode === 'legacy') {
        // Legacy mode: use legacy function that calls the request on a directly connected controller
        await this._spectoda.writeControllerName(label)
      } else {
        // New mode: use request API with connection path
        await this._spectoda.requestWriteControllerLabel(this._connectionPath, label, options)
      }

      // Update cached label
      this._controllerLabel = label
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to write controller label'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Reads the firmware version from the physical controller.
   * Always makes a network request - use `fwVersion` getter for cached value.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving to the firmware version string
   */
  async readFwVersion(options?: RequestOptions): Promise<string> {
    this._isLoading = true
    this._error = null

    try {
      let version: string

      if (this._legacyMode === 'legacy') {
        // Legacy mode: use legacy function that calls the request on a directly connected controller
        version = await this._spectoda.getFwVersion()
      } else {
        // New mode: use request API with connection path
        version = await this._spectoda.requestReadFwVersion(this._connectionPath, options)
      }

      this._fwVersion = version
      return version
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to read firmware version'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Erases the network ownership from this controller.
   * The controller will need to be commissioned again after this operation.
   *
   * @param options - Request options (timeout)
   * @returns Promise resolving when network is erased
   */
  async eraseNetwork(options?: RequestOptions): Promise<void> {
    this._isLoading = true
    this._error = null

    try {
      if (this._legacyMode === 'legacy') {
        // Legacy mode: use legacy function that calls the request on a directly connected controller
        await this._spectoda.removeOwner()
      } else {
        // New mode: use request API with connection path
        await this._spectoda.requestEraseNetwork(this._connectionPath, options)
      }

      // Clear network-related cached data
      this._networkSignature = null
      this._commissionable = null
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to erase network'
      throw error
    } finally {
      this._isLoading = false
    }
  }

  // ============ Navigation (New Mode Only) ============

  /**
   * Create a new ControllerRef by extending the path.
   * Accepts a single hop (string) or multiple hops (string[]).
   *
   * @param path - Single hop or array of hops to append to current path
   * @returns New ControllerRef with extended path
   *
   * @example
   * const directRef = spectoda.use("bluetooth/aa:bb:cc:dd:ee:ff")
   * const deeperRef = directRef.use("espnow/11:22:33:44:55:66")
   */
  use(path: string | string[]): ControllerRef {
    if (this._legacyMode === 'legacy') {
      throw new Error('Cannot navigate from legacy mode controller. Upgrade firmware to 0.12.11+')
    }

    const hops = typeof path === 'string' ? [path] : path

    // Parse the last hop to extract MAC
    const lastHop = hops.at(-1)
    let mac = this._mac
    if (lastHop) {
      const parsed = parseConnectionHop(lastHop)
      if (parsed) {
        mac = parsed.mac
      }
    }

    return new ControllerRef(this._spectoda, [...this._connectionPath, ...hops], {
      legacyMode: null,
      mac,
    })
  }

  // ============ State Updates (for store/external use) ============

  /**
   * Update the controller's name.
   * Used by store when name is discovered or changed.
   */
  updateName(name: string): void {
    this._name = name
  }

  /**
   * Update the RSSI signal strength.
   * Used by store when connections are refreshed.
   */
  updateRssi(rssi: number): void {
    this._rssi = rssi
    this._rssiUpdatedAt = new Date()
  }

  /**
   * Update the connection path to this controller.
   * Used by store when optimal paths are computed after network scan.
   */
  updatePath(path: string[]): void {
    this._connectionPath = [...path] // defensive copy
  }

  /**
   * Clear all cached data.
   * Useful when the controller state may have changed externally.
   */
  clearCache(): void {
    this._config = null
    this._configLastRead = null
    this._fwVersion = null
    this._fullVersion = null
    this._fwVersionCode = null
    this._fwPlatformCode = null
    this._fwCompilationUnixTimestamp = null
    this._networkSignature = null
    this._pcbCode = null
    this._productCode = null
    this._commissionable = null
    this._controllerLabel = null
    this._tnglFingerprint = null
    this._eventStoreFingerprint = null
    this._configFingerprint = null
    this._networkStorageFingerprint = null
    this._controllerStoreFingerprint = null
    this._notificationStoreFingerprint = null
    this._connections = null
    this._connectionsUpdatedAt = null
  }
}