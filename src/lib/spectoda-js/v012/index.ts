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

  /** TODO @deprecated deprecate this beauty */
  czechHackyToEnglish,

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

export type {
  EventState,
  EventStateInput,
  LabelEvent,
  PercentageEvent,
  TimestampEvent,
  ColorEvent,
  PixelsEvent,
  BooleanEvent,
  NullEvent,
  UndefinedEvent,
} from './src/types/event'

export { CONNECTION_STATUS, REMOTECONTROL_STATUS, WEBSOCKET_CONNECTION_STATE } from './src/types/connect'

export type {
  ConnectionStatus,
  ConnectorType,
  ConnectorCriteria,
  RemoteControlConnectionStatus,
} from './src/types/connect'
export type { ControllerError, ControllerWarning } from './src/types/messages'

export {
  EventSchema,
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
} from './src/schemas/event'
export type { AnyEvent } from './src/schemas/event'

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

/** @deprecated Use individual types instead */
export type { SpectodaTypes } from './src/types/primitives'
export type {
  /** @deprecated Use ControllerMessage instead */
  ControllerMessage as SpectodaMessage,
  /** @deprecated Use ControllerError instead */
  ControllerError as SpectodaError,
  /** @deprecated Use ControllerWarning instead */
  ControllerWarning as SpectodaWarning,
} from './src/types/messages'
export type {
  /** @deprecated Use EventState instead */
  Event,

  /** @deprecated Use EventState instead */
  Event as SpectodaEvent,

  /** @deprecated Use EventState instead */
  EventState as SpectodaEventState,

  /** @deprecated Use EventStateInput instead */
  EventStateInput as SpectodaEventInput,
  NumberEvent,

  /** @deprecated Use NumberEvent instead */
  NumberEvent as SpectodaNumberEvent,

  /** @deprecated Use LabelEvent instead */
  LabelEvent as SpectodaLabelEvent,

  /** @deprecated Use PercentageEvent instead */
  PercentageEvent as SpectodaPercentageEvent,

  /** @deprecated Use TimestampEvent instead */
  TimestampEvent as SpectodaTimestampEvent,

  /** @deprecated Use ColorEvent instead */
  ColorEvent as SpectodaColorEvent,

  /** @deprecated Use PixelsEvent instead */
  PixelsEvent as SpectodaPixelsEvent,

  /** @deprecated Use BooleanEvent instead */
  BooleanEvent as SpectodaBooleanEvent,

  /** @deprecated Use NullEvent instead */
  NullEvent as SpectodaNullEvent,

  /** @deprecated Use UndefinedEvent instead */
  UndefinedEvent as SpectodaUndefinedEvent,
} from './src/types/event'

export { WASM_VERSION } from './src/SpectodaWasm'
