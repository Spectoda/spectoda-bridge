export interface interface_error_tValue<T extends number> {
  value: T;
}
export type interface_error_t = interface_error_tValue<0>|interface_error_tValue<255>;

export interface connector_type_tValue<T extends number> {
  value: T;
}
export type connector_type_t = connector_type_tValue<0>|connector_type_tValue<1>|connector_type_tValue<2>|connector_type_tValue<3>|connector_type_tValue<4>|connector_type_tValue<5>|connector_type_tValue<6>;

export interface connection_rssi_tValue<T extends number> {
  value: T;
}
export type connection_rssi_t = connection_rssi_tValue<127>|connection_rssi_tValue<-128>;

export interface Connection {
  connector_type: connector_type_t;
  connection_rssi: connection_rssi_t;
  address_string: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
  delete(): void;
}

export interface Value {
  isPercentage(): boolean;
  setPercentage(_0: number): void;
  asPercentage(): number;
  delete(): void;
}

export interface Synchronization {
  history_fingerprint: number;
  tngl_fingerprint: number;
  clock_timestamp: number;
  timeline_clock_timestamp: number;
  tngl_clock_timestamp: number;
  fw_compilation_timestamp: number;
  origin_address: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
  toUint8Array(): any;
  delete(): void;
}

export interface Uint8Vector {
  push_back(_0: number): void;
  resize(_0: number, _1: number): void;
  size(): number;
  set(_0: number, _1: number): boolean;
  get(_0: number): any;
  delete(): void;
}

export interface IConnector_WASM {
  _process(): void;
  init(_0: connector_type_t): void;
  _scan(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: number, _2: any): boolean;
  _userConnect(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: number, _2: any): boolean;
  _autoConnect(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: number, _2: number, _3: any): boolean;
  _disconnect(_0: any): boolean;
  _sendExecute(_0: Uint8Vector, _1: any): void;
  _sendRequest(_0: number, _1: Uint8Vector, _2: any): boolean;
  _sendResponse(_0: number, _1: number, _2: Uint8Vector, _3: any): boolean;
  _sendSynchronize(_0: any, _1: any): void;
  delete(): void;
}

export interface ImplementedIConnector_WASM extends IConnector_WASM {
  notifyOnDestruction(): void;
  delete(): void;
}

export interface Spectoda_WASM {
  _handleReboot(): interface_error_t;
  begin(): void;
  end(): void;
  synchronize(_0: Synchronization, _1: Connection): void;
  process(): void;
  render(): void;
  eraseHistory(): void;
  eraseTimeline(): void;
  eraseTngl(): void;
  registerConnector(_0: IConnector_WASM): void;
  _onTnglUpdate(_0: Uint8Vector): boolean;
  _onExecute(_0: Uint8Vector): boolean;
  execute(_0: number, _1: Connection): boolean;
  request(_0: number, _1: Uint8Vector, _2: Connection): boolean;
  getIdentifier(): number;
  _handleTimelineManipulation(_0: number, _1: boolean, _2: number): interface_error_t;
  setClockTimestamp(_0: number): void;
  getClockTimestamp(): number;
  _handlePeerConnected(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string): interface_error_t;
  _handlePeerDisconnected(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string): interface_error_t;
  _onLog(_0: number, _1: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _2: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string): void;
  init(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string): void;
  getLabel(): string;
  writeIO(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: number, _2: Value): boolean;
  readIO(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: number, _2: Value): boolean;
  emitEvent(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: Value, _2: number, _3: boolean): void;
  _onEvents(_0: any): boolean;
  _onEventStateUpdates(_0: any): boolean;
  _onRequest(_0: number, _1: Uint8Vector, _2: any): boolean;
  _onSynchronize(_0: any): boolean;
  makePort(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string): any;
  readVariableAddress(_0: number, _1: number): any;
  delete(): void;
}

export interface ImplementedSpectoda_WASM extends Spectoda_WASM {
  notifyOnDestruction(): void;
  delete(): void;
}

export interface MainModule {
  interface_error_t: {SUCCESS: interface_error_tValue<0>, FAIL: interface_error_tValue<255>};
  connector_type_t: {CONNECTOR_UNDEFINED: connector_type_tValue<0>, CONNECTOR_ESPNOW: connector_type_tValue<1>, CONNECTOR_BLE: connector_type_tValue<2>, CONNECTOR_SERIAL: connector_type_tValue<3>, CONNECTOR_WEBSOCKETS: connector_type_tValue<4>, CONNECTOR_TWAI: connector_type_tValue<5>, CONNECTOR_MAX: connector_type_tValue<6>};
  connection_rssi_t: {RSSI_MAX: connection_rssi_tValue<127>, RSSI_MIN: connection_rssi_tValue<-128>};
  Connection: {new(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: connector_type_t, _2: connection_rssi_t): Connection};
  Value: {new(): Value};
  Synchronization: {new(_0: number, _1: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _2: number, _3: number, _4: number, _5: number, _6: number): Synchronization; make(_0: number, _1: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _2: number, _3: number, _4: number, _5: number, _6: number): any; fromUint8Array(_0: any): any};
  Uint8Vector: {new(): Uint8Vector};
  IConnector_WASM: {implement(_0: any): ImplementedIConnector_WASM; extend(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: any): any};
  ImplementedIConnector_WASM: {};
  Spectoda_WASM: {implement(_0: any): ImplementedSpectoda_WASM; extend(_0: ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string, _1: any): any};
  ImplementedSpectoda_WASM: {};
}
