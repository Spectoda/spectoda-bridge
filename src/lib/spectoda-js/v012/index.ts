export { mockScanResult } from './__mocks__/scan'
export {
  // TODO Move to monorepo/packages/utils/color
  colorToBytes,
  // TODO Move to spectoda-js/tngl.helpers.ts
  computeTnglCodeFingerprint,
  computeTnglFingerprint,
  convertToByteArray,
  crc8,
  // TODO Move to spectoda-js/utils/crypto
  crc32,
  // TODO Move to spectoda-js/utils/nano
  createNanoEvents,
  createNanoEventsWithWrappedEmit,
  cssColorToHex,
  deactivateDebugMode,
  // TODO Move to monorepo/packages/utils/environment
  detectAndroid,
  detectBrave,
  detectBrowser,
  detectBun,
  detectChrome,
  detectDeno,
  detectEdge,
  detectFirefox,
  detectGW,
  detectIPhone,
  detectLinux,
  detectMacintosh,
  detectNext,
  detectNode,
  detectOpera,
  detectProductionBuild,
  detectSafari,
  detectSamsungBrowser,
  detectServerEnvironment,
  detectSpectodaConnect,
  detectWindows,
  // TODO Move this out of functions
  enableDebugMode,
  fetchFirmware,
  // TODO Move to spectoda-js/utils/time
  getClockTimestamp,
  getColorString,
  getSeconds,
  hexStringToArray,
  hexStringToNumberArray,
  hexStringToUint8Array,
  labelToBytes,
  // TODO Move to spectoda-js/utils
  mapValue,
  numberToBytes,
  rgbToHex,
  sleep,
  stringToBytes,
  strMacToBytes,
  toBytes,
  // TODO Move to monorepo/packages/utils/bytes
  toUint8Array,
  uint8ArrayToHexString,
  validateTimestamp,
} from './functions'
export { logging } from './logging'
export { Spectoda } from './Spectoda'
export {
  APP_MAC_ADDRESS,
  BROADCAST_ID,
  CONNECTORS,
  JS_VALUE_LIMITS,
  UNCOMMISSIONED_NETWORK_SIGNATURE,
} from './src/constants'
export { VALUE_TYPES, type ValueType } from './src/constants/values'
export {
  getRemoteControlClientMeta,
  type RemoteControlClientMeta,
} from './src/rc/meta'
export { makeSpectodaVirtualProxy } from './src/rc/v1/RemoteControlSender'
export { WASM_VERSION } from './src/SpectodaWasm'
export {
  type AnyEvent,
  AnyEventSchema,
  AnyEventValueSchema,
  type BooleanEvent,
  BooleanEventSchema,
  type ColorEvent,
  ColorEventSchema,
  type EventInput,
  EventInputSchema,
  type EventState,
  EventStateSchema as EventSchema,
  type LabelEvent,
  LabelEventSchema,
  type NullEvent,
  NullEventSchema,
  type NumberEvent,
  NumberEventSchema,
  type PercentageEvent,
  PercentageEventSchema,
  type PixelsEvent,
  PixelsEventSchema,
  type TimestampEvent,
  TimestampEventSchema,
  type UndefinedEvent,
  UndefinedEventSchema,
} from './src/schemas/event'
export {
  BaudrateSchema,
  ControllerNameSchema,
  FIRMWARE_VERSION_REGEX_SOURCES_PARTS,
  FingerprintSchema,
  FirmwareVersionCodeSchema,
  FirmwareVersionFullSchema,
  FirmwareVersionSchema,
  IDSchema,
  MacAddressSchema,
  NetworkKeySchema,
  NetworkSignatureSchema,
  PcbCodeSchema,
  ProductCodeSchema,
  SerialPathSchema,
  TnglBankSchema,
} from './src/schemas/primitives'
export {
  BooleanSchema,
  ColorSchema,
  DateSchema,
  LabelSchema,
  NullSchema,
  NumberSchema,
  PercentageSchema,
  PixelsSchema,
  TimestampSchema,
  UndefinedSchema,
} from './src/schemas/values'
export {
  PercentageSchemaWithSuffix,
  TimeStampSchemaWithSuffix,
} from './src/schemas/valuesWithSuffixes'
export { preprocessTngl } from './src/TnglPreprocessor'
export {
  SPECTODA_APP_EVENTS,
  type SpectodaAppEventMap,
  type SpectodaAppEventName,
  SpectodaAppEvents,
} from './src/types/app-events'
export type {
  ConnectionStatus,
  ConnectOptions,
  ConnectorCriteria,
  ConnectorType,
  ScanOptions,
} from './src/types/connect'
export { CONNECTION_STATUS } from './src/types/connect'
export type {
  ControllerError,
  ControllerMessage,
  ControllerWarning,
} from './src/types/messages'
export type {
  BaseCriteria,
  BleCriteria,
  ControllerConnectionCriteria,
  ControllerInfo,
  ControllerMoreData,
  ControllerName,
  Criteria,
  Criterium,
  DummyCriteria,
  Fingerprint,
  FirmwareVersion,
  FirmwareVersionCode,
  FirmwareVersionFull,
  MacAddress,
  NetworkKey,
  NetworkSignature,
  PcbCode,
  ProductCode,
  SerialCriteria,
  TnglBank,
} from './src/types/primitives'
export type { SpectodaClass } from './src/types/spectodaClass'
export type {
  SpectodaIdsType,
  SpectodaIdType,
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
} from './src/types/values'
export {
  getSpectodaVersion,
  JS_REVISION,
  JS_REVISION_NEW_CONNECT_SCAN_API,
  type SpectodaVersion,
} from './src/version'
export type { ConnectionInfo } from './src/types/wasm'

export {
  ControllerRef,
  type ControllerRefLegacyMode,
  type ControllerRefOptions,
  type ControllerRefError,
} from './src/ControllerRef'
export {
  supportsControllerActions,
  formatConnectionHop,
  parseConnectionHop,
  parseFirmwareVersion,
  getMacFromPath,
  type HopConnectorType,
} from './src/controllerRef.utils'
