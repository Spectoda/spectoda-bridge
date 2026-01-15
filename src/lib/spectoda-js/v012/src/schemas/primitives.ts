import { z } from 'zod'

import {
  MAX_ID,
  MAX_PCB_CODE,
  MAX_PRODUCT_CODE,
  MAX_TNGL_BANK,
} from '../constants'

import { LabelSchema } from './values'

/**
 * Controller name. Same type as LabelSchema.
 *
 * @example "SC_1"
 * @example "SCI01"
 */
export const ControllerNameSchema = LabelSchema

/**
 * ID of an event or segment.
 * Range: 0 - 255
 *
 * @example 0
 * @example 42
 */
export const IDSchema = z
  .number()
  .min(0, `ID must be between 0 and ${MAX_ID}`)
  .max(MAX_ID, `ID must be between 0 and ${MAX_ID}`)
// TODO add .brand('SpectodaId')

/**
 * Network signature as 32-character lowercase hexadecimal string.
 *
 * @example "34567890123456789012345678901234"
 */
export const NetworkSignatureSchema = z
  .string()
  .regex(
    /^[a-f0-9]{32}$/,
    "Network signature must be a 32-character hex string (e.g. '34567890123456789012345678901234')",
  )

/**
 * Network key as 32-character hexadecimal string.
 *
 * @example "34567890123456789012345678901234"
 */
export const NetworkKeySchema = z
  .string()
  .regex(
    /^[a-f0-9]{32}$/,
    "Network key must be a 32-character hex string (e.g. '34567890123456789012345678901234')",
  )

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/

/**
 * MAC address in format "XX:XX:XX:XX:XX:XX".
 *
 * @example "12:43:ab:8d:ff:04"
 */
export const MacAddressSchema = z.string().transform((v, ctx) => {
  const transformed = v.replace(/[\n\r\s\t]+/g, '')

  if (MAC_REGEX.test(transformed) === true) {
    return transformed
  }

  ctx.addIssue({
    code: 'custom',
    message:
      "MAC address must be in format 'XX:XX:XX:XX:XX:XX' (e.g. '12:43:ab:8d:ff:04'",
  })

  return z.NEVER
})

/**
 * PCB (Printed Circuit Board) code.
 * Range: 0 - 16535
 *
 * @example 32
 */
export const PcbCodeSchema = z
  .int('PCB code must be an integer')
  .min(0, `PCB code must be between 0 and ${MAX_PCB_CODE}`)
  .max(MAX_PCB_CODE, `PCB code must be between 0 and ${MAX_PCB_CODE}`)

/**
 * Product code for specific models.
 * Range: 0 - 16535
 *
 * @example 24
 */
export const ProductCodeSchema = z.coerce
  .number()
  .positive()
  .int('Product' + ' code' + ' must be' + ' an integer')
  .min(0, `Product code must be between 0 and ${MAX_PRODUCT_CODE}`)
  .max(
    MAX_PRODUCT_CODE,
    `Product code must be between 0 and ${MAX_PRODUCT_CODE}`,
  )

/**
 * Firmware version in format "X.Y.Z"
 *
 * @example "0.12.2"
 */
export const FirmwareVersionSchema = z
  .string()
  .regex(
    /^!?\d+\.\d+\.\d+$/,
    "Firmware version must be in format 'X.Y.Z' (e.g. '0.12.2')",
  )

const DATE_REGEX_SOURCE = {
  // TODO: Hello, maintainers of the year 9999! Please change this regex to allow for years 10000 and beyond.
  YEAR: '(?:[2-9][0-9]{3})',
  MONTH: '(?:0[1-9]|1[0-2])',
  DAY: '(?:0[1-9]|[12][0-9]|3[01])',
}

export const FIRMWARE_VERSION_REGEX_SOURCES_PARTS = {
  PREFIX: '[A-Z0-9_]+',
  SEMVER: '\\d+\\.\\d+\\.\\d+',
  DATE: `${DATE_REGEX_SOURCE.YEAR}(${DATE_REGEX_SOURCE.MONTH})(${DATE_REGEX_SOURCE.DAY})`,
}

const FIRMWARE_VERSION_FULL_REGEXP = new RegExp(
  `^${FIRMWARE_VERSION_REGEX_SOURCES_PARTS.PREFIX}_${FIRMWARE_VERSION_REGEX_SOURCES_PARTS.SEMVER}_${FIRMWARE_VERSION_REGEX_SOURCES_PARTS.DATE}$`,
)

/**
 * Full firmware version string.
 * Format: PREFIX_X.Y.Z_YYYYMMDD
 *
 * @example "UNIVERSAL_0.12.2_20250208"
 */
export const FirmwareVersionFullSchema = z.string().transform((value, ctx) => {
  const transformed = value.replace('.enc', '')

  if (FIRMWARE_VERSION_FULL_REGEXP.test(transformed)) {
    return transformed
  }

  ctx.addIssue({
    code: 'custom',
    message:
      "Firmware version must be in format 'PREFIX_X.Y.Z_YYYYMMDD' (e.g. 'UNIVERSAL_0.12.2_20250208') where PREFIX contains uppercase letters, numbers and underscores, X.Y.Z is a valid semantic version, and YYYYMMDD is a valid date",
  })

  return z.NEVER
})

/**
 * Firmware version code.
 *
 * @example 1201
 */
export const FirmwareVersionCodeSchema = z
  .int('Firmware version code must be a positive integer')
  .min(0, 'Firmware version code must be a positive integer')

/**
 * Fingerprint as 32-character hexadecimal string.
 *
 * @example "839dfa03839dfa03839dfa03839dfa03"
 */
export const FingerprintSchema = z
  .string()
  .regex(
    /^[a-f0-9]{32}$/,
    "Fingerprint must be a 32-character hex string (e.g. '839dfa03839dfa03839dfa03839dfa03')",
  )

/**
 * TNGL bank identifier.
 * Range: 0 - 255
 *
 * @example 42
 */
export const TnglBankSchema = z
  .int('TNGL bank must be an integer')
  .min(0, `TNGL bank must be between 0 and ${MAX_TNGL_BANK}`)
  .max(MAX_TNGL_BANK, `TNGL bank must be between 0 and ${MAX_TNGL_BANK}`)

/**
 * Baudrate for serial communication.
 * Common values: 9600, 19200, 38400, 57600, 115200
 *
 * @example 115200
 */
export const BaudrateSchema = z
  .int('Baudrate must be a positive integer')
  .positive('Baudrate must be a positive integer (e.g. 9600, 115200)')

/**
 * Serial port path string used for device communication.
 * Format varies by operating system:
 *
 * On macOS:
 * - `/dev/cu.usbserial-00000000`
 * - `/dev/cu.usbserial-A800H7OY`
 * - `/dev/cu.usbserial-A50285BI`
 *
 * On Windows:
 * - `COM1`
 * - `COM23`
 *
 * On Linux:
 * - `/dev/ttyS3`
 * - `/dev/ttyUSB0`
 */
export const SerialPathSchema = z.string()
