import type { z } from 'zod'
import type {
  BaseCriteriaSchema,
  BleCriteriaSchema,
  DummyCriteriaSchema,
  SerialCriteriaSchema,
} from '../schemas/criteria'
import type {
  ControllerNameSchema,
  FingerprintSchema,
  FirmwareVersionCodeSchema,
  FirmwareVersionFullSchema,
  FirmwareVersionSchema,
  MacAddressSchema,
  NetworkKeySchema,
  NetworkSignatureSchema,
  PcbCodeSchema,
  ProductCodeSchema,
  TnglBankSchema,
} from '../schemas/primitives'

import type {
  SpectodaIdsType,
  SpectodaIdType,
  ValueType,
  ValueTypeBoolean,
  ValueTypeColor,
  ValueTypeDate,
  ValueTypeLabel,
  ValueTypeNull,
  ValueTypeNumber,
  ValueTypePercentage,
  ValueTypePixels,
  ValueTypeTimestamp,
  ValueTypeUndefined,
} from './values'

type BaseCriteria = z.infer<typeof BaseCriteriaSchema>
type SerialCriteria = z.infer<typeof SerialCriteriaSchema>
type BleCriteria = z.infer<typeof BleCriteriaSchema>
type DummyCriteria = z.infer<typeof DummyCriteriaSchema>

type CriteriaGeneric = BaseCriteria
type CriteriaBle = BleCriteria
type CriteriaSerial = SerialCriteria
type CriteriaDummy = CriteriaGeneric
type CriteriaSimulated = CriteriaGeneric
type criteria = CriteriaBle | CriteriaSerial | CriteriaDummy | CriteriaSimulated

type TnglBytes = Uint8Array
type UsedIds = Uint8Array
type Criterium = criteria
type Criteria = criteria | criteria[]
type Tngl = {
  code: string | undefined
  bytecode: Uint8Array | undefined
}

type NetworkSignature = z.infer<typeof NetworkSignatureSchema>
type NetworkKey = z.infer<typeof NetworkKeySchema>
type MacAddress = z.infer<typeof MacAddressSchema>
type PcbCode = z.infer<typeof PcbCodeSchema>
type ProductCode = z.infer<typeof ProductCodeSchema>
type FirmwareVersion = z.infer<typeof FirmwareVersionSchema>
type FirmwareVersionFull = z.infer<typeof FirmwareVersionFullSchema>
type FirmwareVersionCode = z.infer<typeof FirmwareVersionCodeSchema>
type Fingerprint = z.infer<typeof FingerprintSchema>
type TnglBank = z.infer<typeof TnglBankSchema>

type ControllerName = z.infer<typeof ControllerNameSchema>
type ControllerConnectionCriteria = {
  controllerLabel: ValueTypeLabel
  productCode: ProductCode
  macAddress: MacAddress
  fwVersion: FirmwareVersion
  networkSignature: NetworkSignature
  commissionable: boolean
}
type ControllerMoreData = {
  fullName: ControllerName
  pcbCode: PcbCode
  fwVersionFull: FirmwareVersionFull
  fwVersionCode: FirmwareVersionCode
  fwPlatformCode: PcbCode
  fwCompilationUnixTimestamp: ValueTypeTimestamp
  tnglFingerprint: Fingerprint
  eventStoreFingerprint: Fingerprint
  configFingerprint: Fingerprint
  networkStorageFingerprint: Fingerprint
  controllerStoreFingerprint: Fingerprint
  notificationStoreFingerprint: Fingerprint
}
type ControllerInfo = ControllerConnectionCriteria & ControllerMoreData

type NetworkStorageData = { name: string; version: number; bytes: Uint8Array }

type NetworkStorageMetadata = {
  name: string
  version: number
  fingerprint: string
}

export type {
  BaseCriteria,
  SerialCriteria,
  BleCriteria,
  DummyCriteria,
  TnglBytes,
  UsedIds,
  Criteria,
  Criterium,
  Tngl,
  ValueType,
  ValueTypeNumber,
  ValueTypeLabel,
  ValueTypePercentage,
  ValueTypeColor,
  ValueTypeDate,
  ValueTypeTimestamp,
  SpectodaIdsType,
  SpectodaIdType,
  ValueTypeNull,
  ValueTypeUndefined,
  ValueTypeBoolean,
  ValueTypePixels,
  ControllerConnectionCriteria,
  ControllerMoreData,
  ControllerInfo,
  ControllerName,
  NetworkSignature,
  NetworkKey,
  MacAddress,
  PcbCode,
  ProductCode,
  FirmwareVersion,
  FirmwareVersionFull,
  FirmwareVersionCode,
  Fingerprint,
  TnglBank,
  NetworkStorageData,
  NetworkStorageMetadata,
}
