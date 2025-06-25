import { z } from 'zod'

import { MAX_ID, MAX_PCB_CODE, MAX_PRODUCT_CODE, MAX_TNGL_BANK } from '../constants'

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
  .regex(/^[a-f0-9]{32}$/, "Network key must be a 32-character hex string (e.g. '34567890123456789012345678901234')")

/**
 * MAC address in format "XX:XX:XX:XX:XX:XX".
 *
 * @example "12:43:ab:8d:ff:04"
 */
export const MacAddressSchema = z
  .string()
  .regex(
    /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/,
    "MAC address must be in format 'XX:XX:XX:XX:XX:XX' (e.g. '12:43:ab:8d:ff:04')",
  )

/**
 * PCB (Printed Circuit Board) code.
 * Range: 0 - 16535
 *
 * @example 32
 */
export const PcbCodeSchema = z
  .number()
  .int('PCB code must be an integer')
  .min(0, `PCB code must be between 0 and ${MAX_PCB_CODE}`)
  .max(MAX_PCB_CODE, `PCB code must be between 0 and ${MAX_PCB_CODE}`)

/**
 * Product code for specific models.
 * Range: 0 - 16535
 *
 * @example 24
 */
export const ProductCodeSchema = z
  .number()
  .int('Product code must be an integer')
  .min(0, `Product code must be between 0 and ${MAX_PRODUCT_CODE}`)
  .max(MAX_PRODUCT_CODE, `Product code must be between 0 and ${MAX_PRODUCT_CODE}`)

/**
 * Firmware version in format "X.Y.Z"
 *
 * @example "0.12.2"
 */
export const FirmwareVersionSchema = z
  .string()
  .regex(/^!?\d+\.\d+\.\d+$/, "Firmware version must be in format 'X.Y.Z' (e.g. '0.12.2')")

/**
 * Full firmware version string.
 * Format: PREFIX_X.Y.Z_YYYYMMDD
 *
 * @example "UNIVERSAL_0.12.2_20250208"
 */
export const FirmwareVersionFullSchema = z
  .string()
  .regex(
    /^[A-Z_]+\d+\.\d+\.\d+_\d{8}$/,
    "Firmware version must be in format 'PREFIX_X.Y.Z_YYYYMMDD' (e.g. 'UNIVERSAL_0.12.2_20250208') where PREFIX is uppercase",
  )

/**
 * Firmware version code.
 *
 * @example 1201
 */
export const FirmwareVersionCodeSchema = z
  .number()
  .int('Firmware version code must be a positive integer')
  .min(0, 'Firmware version code must be a positive integer')

/**
 * Fingerprint as 32-character hexadecimal string.
 *
 * @example "839dfa03839dfa03839dfa03839dfa03"
 */
export const FingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/, "Fingerprint must be a 32-character hex string (e.g. '839dfa03839dfa03839dfa03839dfa03')")

/**
 * TNGL bank identifier.
 * Range: 0 - 255
 *
 * @example 42
 */
export const TnglBankSchema = z
  .number()
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
  .number()
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
