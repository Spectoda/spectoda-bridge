export { Spectoda } from './Spectoda'
export { logging } from './logging'
export {
  // TODO Move to monorepo/packages/utils/bytes
  toUint8Array,
  convertToByteArray,
  hexStringToArray,
  hexStringToNumberArray,
  hexStringToUint8Array,
  uint8ArrayToHexString,
  numberToBytes,
  stringToBytes,
  toBytes,
  labelToBytes,
  strMacToBytes,

  // TODO Move to monorepo/packages/utils/color
  colorToBytes,
  cssColorToHex,
  rgbToHex,
  getColorString,

  // TODO Move to monorepo/packages/utils/environment
  detectAndroid,
  detectBrowser,
  detectChrome,
  detectGW,
  detectIPhone,
  detectLinux,
  detectMacintosh,
  detectNext,
  detectNode,
  detectProductionBuild,
  detectSafari,
  detectServerEnvironment,
  detectSpectodaConnect,
  detectWindows,
  // TODO Move to spectoda-js/utils/time
  getClockTimestamp,
  getSeconds,
  validateTimestamp,
  sleep,

  // TODO Move to spectoda-js/utils/crypto
  crc32,
  crc8,

  // TODO Move to spectoda-js/utils/nano
  createNanoEvents,
  createNanoEventsWithWrappedEmit,

  // TODO Move to spectoda-js/tngl.helpers.ts
  computeTnglCodeFingerprint,
  computeTnglFingerprint,

  // TODO Move to spectoda-js/utils
  mapValue,
  fetchFirmware,

  // TODO Move this out of functions
  enableDebugMode,
  deactivateDebugMode,
} from './functions'

export {
  SPECTODA_APP_EVENTS,
  SpectodaAppEvents,
  type SpectodaAppEventName,
  type SpectodaAppEventMap,
} from './src/types/app-events'

export type {
  ValueTypeNumber,
  ValueTypeLabel,
  ValueTypeTimestamp,
  ValueTypePercentage,
  ValueTypeDate,
  ValueTypeColor,
  ValueTypePixels,
  ValueTypeBoolean,
  ValueTypeNull,
  ValueTypeUndefined,
  ValueTypeID,
  ValueTypeIDs,
  SpectodaIdType,
} from './src/types/values'

export type {
  BaseCriteria,
  BleCriteria,
  Criteria,
  Criterium,
  ControllerConnectionCriteria,
  ControllerMoreData,
  ControllerInfo,
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
  ControllerName,
  DummyCriteria,
  SerialCriteria,
} from './src/types/primitives'

export { FIRMWARE_VERSION_REGEX_SOURCES_PARTS } from './src/schemas/primitives'

export { CONNECTION_STATUS, REMOTECONTROL_STATUS, WEBSOCKET_CONNECTION_STATE } from './src/types/connect'

export type {
  ConnectionStatus,
  ConnectorType,
  ConnectorCriteria,
  RemoteControlConnectionStatus,
} from './src/types/connect'
export type { ControllerError, ControllerWarning, ControllerMessage } from './src/types/messages'

export {
  EventStateSchema as EventSchema,
  EventInputSchema,
  NumberEventSchema,
  LabelEventSchema,
  PercentageEventSchema,
  TimestampEventSchema,
  ColorEventSchema,
  PixelsEventSchema,
  BooleanEventSchema,
  NullEventSchema,
  UndefinedEventSchema,
  AnyEventSchema,
  AnyEventValueSchema,
  type EventState,
  type EventInput,
  type NumberEvent,
  type LabelEvent,
  type PercentageEvent,
  type TimestampEvent,
  type ColorEvent,
  type PixelsEvent,
  type BooleanEvent,
  type NullEvent,
  type UndefinedEvent,
  type AnyEvent,
} from './src/schemas/event'

export {
  FirmwareVersionSchema,
  FirmwareVersionFullSchema,
  ProductCodeSchema,
  NetworkSignatureSchema,
  MacAddressSchema,
  BaudrateSchema,
  ControllerNameSchema,
  SerialPathSchema,
  IDSchema,
  FingerprintSchema,
  FirmwareVersionCodeSchema,
  NetworkKeySchema,
  PcbCodeSchema,
  TnglBankSchema,
} from './src/schemas/primitives'

export {
  TimestampSchema,
  PercentageSchema,
  LabelSchema,
  NumberSchema,
  ColorSchema,
  PixelsSchema,
  BooleanSchema,
  NullSchema,
  DateSchema,
  UndefinedSchema,
} from './src/schemas/values'

export { PercentageSchemaWithSuffix, TimeStampSchemaWithSuffix } from './src/schemas/valuesWithSuffixes'

export { CONNECTORS, NO_NETWORK_SIGNATURE, BROADCAST_ID, JS_VALUE_LIMITS } from './src/constants'

export { VALUE_TYPES, type ValueType } from './src/constants/values'

export { mockScanResult } from './__mocks__/scan'

export { isCurrentSpectodaInstanceLocal, createSpectodaWebsocket } from './SpectodaWebSocketsConnector'

export { WASM_VERSION } from './src/SpectodaWasm'
