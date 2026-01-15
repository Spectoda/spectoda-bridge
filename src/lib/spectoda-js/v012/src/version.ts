/**
 * spectoda-js Version Management
 *
 * This file defines the JS revision number which is used to track API changes
 * in spectoda-js. The JS revision is checked by spectoda-core when making
 * remote control calls to determine which API signature to use.
 *
 * @see JS_REVISION_CHANGELOG.md for detailed history of API changes
 */

import { WASM_VERSION } from './SpectodaWasm'

/**
 * JS Revision number - manually incremented when significant API changes occur.
 *
 * This revision is used by spectoda-core to determine which API signatures
 * are supported when communicating with remote control receivers.
 *
 * IMPORTANT: When incrementing this value, update JS_REVISION_CHANGELOG.md
 *
 * Revision History (see JS_REVISION_CHANGELOG.md for details):
 * - 0: Legacy API (pre-0.12.x connect/scan signatures)
 * - 1: New connect(connector, criteria, options) and scan(connector, criteria, options) signatures
 */
export const JS_REVISION = 1

/**
 * Minimum JS revision that supports the new connect/scan API signatures.
 * Used by spectoda-core to determine when to use legacy fallback.
 */
export const JS_REVISION_NEW_CONNECT_SCAN_API = 1

/**
 * Type representing the spectoda-js version information
 */
export type SpectodaVersion = {
  /**
   * Full WASM version string (e.g., "DEBUG_UNIVERSAL_0.12.11_20251123")
   * This is dictated by the loaded WASM module.
   */
  wasmFullVersion: string

  /**
   * JS revision number - manually incremented when significant API changes occur.
   * Used by spectoda-core to determine which API signatures to use.
   */
  jsRevision: number
}

/**
 * Returns the current spectoda-js version information.
 * This is a standalone function that can be used without a Spectoda instance.
 */
export const getSpectodaVersion = (): SpectodaVersion => ({
  wasmFullVersion: WASM_VERSION,
  jsRevision: JS_REVISION,
})
