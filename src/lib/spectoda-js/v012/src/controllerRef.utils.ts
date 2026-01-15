/**
 * Utilities for ControllerRef - hop parsing, version checking, etc.
 * Internal to spectoda-js.
 */

/**
 * Connector types supported in connection path hops.
 * Different from ConnectorType in connect.ts which represents physical connectors.
 */
export type HopConnectorType = 'legacy' | 'espnow' | 'serial' | 'twai' | 'ethernet' | 'bluetooth'

/**
 * Minimum firmware version code required for Controller Actions feature.
 * Controller Actions (0.12.11+) enables remote operations on controllers
 * via connection paths (e.g., spectoda.use(path).readControllerInfo()).
 */
const CONTROLLER_ACTIONS_MIN_VERSION_CODE = 1211 // 0.12.11

/**
 * Minimum build date required for Controller Actions feature.
 * Used in combination with version code to ensure firmware has the feature.
 */
const CONTROLLER_ACTIONS_MIN_DATE = '20260101'

/**
 * Parse firmware version string into components.
 * Format: PREFIX_SEMVER_DATE (e.g., "FW_DEV_0.12.11_20260105")
 *
 * @param fullVersion - Full firmware version string
 * @returns Parsed version object or null if invalid
 */
export const parseFirmwareVersion = (
  fullVersion: string,
): {
  prefix: string
  semver: string
  date: string
  major: number
  minor: number
  patch: number
  versionCode: number
} | null => {
  const parts = fullVersion.split('_')
  if (parts.length < 3) return null

  const datePart = parts.at(-1)
  const semverPart = parts.at(-2)

  if (!datePart || !semverPart) return null
  if (datePart.length !== 8) return null

  const semverParts = semverPart.split('.')
  if (semverParts.length !== 3) return null

  const major = parseInt(semverParts[0], 10)
  const minor = parseInt(semverParts[1], 10)
  const patch = parseInt(semverParts[2], 10)

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return null
  }

  // Version code: major * 10000 + minor * 100 + patch
  // e.g., 0.12.11 -> 1211
  const versionCode = major * 10000 + minor * 100 + patch

  const prefixParts = parts.slice(0, -2)
  const prefix = prefixParts.join('_')

  return {
    prefix,
    semver: semverPart,
    date: datePart,
    major,
    minor,
    patch,
    versionCode,
  }
}

/**
 * Checks if the given firmware version supports Controller Actions feature.
 *
 * @param fullVersion - Full firmware version string (e.g., "FW_DEV_0.12.11_20260105")
 * @returns true if the firmware supports Controller Actions
 *
 * @example
 * supportsControllerActions("FW_DEV_0.12.11_20260105") // true
 * supportsControllerActions("FW_DEV_0.12.10_20251220") // false
 */
export const supportsControllerActions = (fullVersion: string): boolean => {
  const parsed = parseFirmwareVersion(fullVersion)
  if (!parsed) return false
  if (parsed.versionCode < CONTROLLER_ACTIONS_MIN_VERSION_CODE) return false
  if (parsed.date < CONTROLLER_ACTIONS_MIN_DATE) return false
  return true
}

/**
 * Format a connection hop from connector type and MAC address.
 *
 * @param connector - Connector type: 'legacy', 'espnow', 'serial', etc.
 * @param mac - MAC address of the target controller
 * @returns Formatted hop string (e.g., "espnow/08:3a:8d:16:9c:f0")
 */
export const formatConnectionHop = (connector: HopConnectorType, mac: string): string => {
  return `${connector}/${mac}`
}

/**
 * Parse a connection hop string into connector and MAC components.
 *
 * @param hop - Connection hop string (e.g., "espnow/08:3a:8d:16:9c:f0")
 * @returns Parsed components or null if invalid format
 */
export const parseConnectionHop = (
  hop: string,
): { connector: HopConnectorType; mac: string } | null => {
  const idx = hop.indexOf('/')
  if (idx === -1) return null
  const connector = hop.slice(0, idx)
  const mac = hop.slice(idx + 1)
  if (!connector || !mac) return null
  // Validate connector is a known type
  const validConnectors: HopConnectorType[] = ['legacy', 'espnow', 'serial', 'twai', 'ethernet', 'bluetooth']
  if (!validConnectors.includes(connector as HopConnectorType)) {
    return null
  }
  return { connector: connector as HopConnectorType, mac }
}

/**
 * Extract MAC address from the last hop in a connection path.
 *
 * @param connectionPath - Array of hop strings
 * @returns MAC address or null if path is empty or invalid
 */
export const getMacFromPath = (connectionPath: string[]): string | null => {
  if (connectionPath.length === 0) return null
  const lastHop = connectionPath.at(-1)
  if (!lastHop) return null
  const parsed = parseConnectionHop(lastHop)
  return parsed?.mac ?? null
}
