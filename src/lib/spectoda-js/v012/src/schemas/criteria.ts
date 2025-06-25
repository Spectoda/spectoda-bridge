import { z } from 'zod'

import type { SpectodaTypes } from '../types/primitives'

import {
  MacAddressSchema,
  NetworkSignatureSchema,
  FirmwareVersionSchema,
  ProductCodeSchema,
  SerialPathSchema,
  BaudrateSchema,
  ControllerNameSchema,
} from './primitives'

/**
 * Base criteria for connecting to a Spectoda device
 */
export const BaseCriteriaSchema = z
  .object({
    /** Exact controller name match */
    name: ControllerNameSchema.optional(),

    /** Matches controllers with names starting with this prefix
     * @example "SCI_" will match "SCI_1", "SCI_2", "SCI_3", etc.
     */
    nameprefix: ControllerNameSchema.optional(),

    /** Exact MAC address match */
    mac: MacAddressSchema.optional(),

    /** Exact network signature match */
    network: NetworkSignatureSchema.optional(),

    /** Exact firmware version match */
    fw: FirmwareVersionSchema.optional(),

    /** Exact product code match */
    product: ProductCodeSchema.optional(),

    /** Whether device is commissionable */
    commisionable: z.boolean().optional(),
  })
  .strict()

/**
 * Serial-specific connection criteria
 */
export const SerialCriteriaSchema = BaseCriteriaSchema.extend({
  path: SerialPathSchema.optional(),
  baudrate: BaudrateSchema.optional(),
})

/**
 * BLE-specific connection criteria
 */
export const BleCriteriaSchema = BaseCriteriaSchema

/**
 * Dummy/simulated connection criteria
 */
export const DummyCriteriaSchema = BaseCriteriaSchema

/**
 * Union of all possible criteria types
 */
export const CriteriaSchema = z.union([SerialCriteriaSchema, BleCriteriaSchema, DummyCriteriaSchema])

/**
 * Single criterion or array of criteria
 */
export const CriteriaArraySchema = z.union([CriteriaSchema, z.array(CriteriaSchema)])

export const isSerialCriteria = (criteria: unknown): criteria is SpectodaTypes['SerialCriteria'] => {
  return SerialCriteriaSchema.safeParse(criteria).success
}

export const isBleCriteria = (criteria: unknown): criteria is SpectodaTypes['BleCriteria'] => {
  return BleCriteriaSchema.safeParse(criteria).success
}

export const isDummyCriteria = (criteria: unknown): criteria is SpectodaTypes['DummyCriteria'] => {
  return DummyCriteriaSchema.safeParse(criteria).success
}

export const isCriteriaArray = (value: unknown): value is Array<SpectodaTypes['Criteria']> => {
  return Array.isArray(value) && value.every((item) => CriteriaSchema.safeParse(item).success)
}
