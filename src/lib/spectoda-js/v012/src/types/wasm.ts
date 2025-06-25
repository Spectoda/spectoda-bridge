import { Event } from './event'

/// === auto-generated from Emscripten build process === ///
/// ========== DEBUG_DEV_0.12.5_20250209.d.ts ========== ///

export type interface_error_tValue<T extends number> = {
  value: T
}
export type interface_error_t = interface_error_tValue<0> | interface_error_tValue<255>

export type connector_type_tValue<T extends number> = {
  value: T
}
export type connector_type_t =
  | connector_type_tValue<0>
  | connector_type_tValue<1>
  | connector_type_tValue<2>
  | connector_type_tValue<3>
  | connector_type_tValue<4>
  | connector_type_tValue<5>
  | connector_type_tValue<6>
  | connector_type_tValue<7>

export type connection_rssi_tValue<T extends number> = {
  value: T
}
export type connection_rssi_t = connection_rssi_tValue<127> | connection_rssi_tValue<-128>

export type Connection = {
  connector_type: connector_type_t
  connection_rssi: connection_rssi_t
  address_string: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string
  delete(): void
}

export type Value = {
  setNull(): void
  setUndefined(): void
  isNumber(): boolean
  isLabel(): boolean
  isTimestamp(): boolean
  isPercentage(): boolean
  isDate(): boolean
  isColor(): boolean
  isPixels(): boolean
  isBoolean(): boolean
  isNull(): boolean
  isUndefined(): boolean
  setBoolean(_0: boolean): void
  getBoolean(): boolean
  setNumber(_0: number): void
  setTimestamp(_0: number): void
  setPixels(_0: number): void
  getNumber(): number
  getTimestamp(): number
  getPixels(): number
  setPercentage(_0: number): void
  getPercentage(): number
  setLabel(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): void
  setDate(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): void
  setColor(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): void
  getLabel(): string
  getDate(): string
  getColor(): string
  delete(): void
}

export type Synchronization = {
  history_fingerprint: number
  tngl_fingerprint: number
  clock_timestamp: number
  timeline_clock_timestamp: number
  tngl_clock_timestamp: number
  fw_compilation_timestamp: number
  origin_address: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string
  toUint8Array(): any
  delete(): void
}

export type Uint8Vector = {
  push_back(_0: number): void
  resize(_0: number, _1: number): void
  size(): number
  set(_0: number, _1: number): boolean
  get(_0: number): any
  delete(): void
}

export type IConnector_WASM = {
  _process(): void
  _sendExecute(_0: Uint8Vector, _1: Connection): void
  _sendSynchronize(_0: Synchronization, _1: Connection): void
  _disconnect(_0: Connection): boolean
  init(_0: connector_type_t): boolean
  _sendRequest(_0: number, _1: Uint8Vector, _2: Connection): boolean
  _sendResponse(_0: number, _1: number, _2: Uint8Vector, _3: Connection): boolean
  _scan(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number, _2: any): boolean
  _userConnect(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number, _2: any): boolean
  _autoConnect(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: number,
    _2: number,
    _3: any,
  ): boolean
  delete(): void
}

export type ImplementedIConnector_WASM = {
  notifyOnDestruction(): void
  delete(): void
} & IConnector_WASM

export type Spectoda_WASM = {
  _handleReboot(): interface_error_t
  end(): void
  synchronize(_0: Synchronization, _1: Connection): void
  eraseHistory(): void
  eraseTimeline(): void
  eraseTngl(): void
  registerConnector(_0: IConnector_WASM): void
  _onTnglLoad(_0: Uint8Vector, _1: Uint8Vector): boolean
  _onExecute(_0: Uint8Vector): boolean
  _onSynchronize(_0: Synchronization): boolean
  process(_0: boolean, _1: boolean, _2: boolean, _3: boolean): void
  render(_0: number): void
  registerDeviceContext(_0: number): boolean
  _onRequest(_0: number, _1: Uint8Vector, _2: Connection): boolean
  execute(_0: number, _1: Connection): boolean
  request(_0: number, _1: Uint8Vector, _2: Connection): boolean
  getIdentifier(): number
  setClockTimestamp(_0: number): void
  getClockTimestamp(): number
  _handlePeerConnected(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): interface_error_t
  _handlePeerDisconnected(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): interface_error_t
  _handleTimelineManipulation(
    _0: number,
    _1: boolean,
    _2: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
  ): interface_error_t
  _onLog(
    _0: number,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _2: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
  ): void
  init(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
  ): boolean
  begin(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
  ): void
  getLabel(): string
  writeIO(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number, _2: Value): boolean
  readIO(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number, _2: Value): boolean
  emitValue(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: Value,
    _2: number,
    _3: boolean,
  ): boolean
  getTnglFingerprint(): string
  getEventStoreFingerprint(): string
  requestReloadTngl(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): boolean
  requestEmitTnglBytecode(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number): boolean
  requestWriteIoVariant(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _2: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _3: boolean,
  ): boolean
  requestWriteIoMapping(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _2: number,
    _3: boolean,
  ): boolean
  _onEvents(_0: any): boolean
  _onEventStateUpdates(_0: any): boolean
  _onProcess(_0: any): boolean
  makePort(
    _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
    _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
  ): any
  readVariableAddress(_0: number, _1: number): any
  getEventState(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: number): any
  getDateTime(): any
  delete(): void
}

export type ImplementedSpectoda_WASM = {
  notifyOnDestruction(): void
  delete(): void
} & Spectoda_WASM

export type MainModule = {
  interface_error_t: { SUCCESS: interface_error_tValue<0>; FAIL: interface_error_tValue<255> }
  connector_type_t: {
    CONNECTOR_UNDEFINED: connector_type_tValue<0>
    CONNECTOR_ESPNOW: connector_type_tValue<1>
    CONNECTOR_BLE: connector_type_tValue<2>
    CONNECTOR_SERIAL: connector_type_tValue<3>
    CONNECTOR_WEBSOCKETS: connector_type_tValue<4>
    CONNECTOR_TWAI: connector_type_tValue<5>
    CONNECTOR_SIMULATED: connector_type_tValue<6>
    CONNECTOR_MAX: connector_type_tValue<7>
  }
  connection_rssi_t: { RSSI_MAX: connection_rssi_tValue<127>; RSSI_MIN: connection_rssi_tValue<-128> }
  Connection: {
    make(
      _0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
      _1: connector_type_t,
      _2: connection_rssi_t,
    ): any
  }
  Value: {
    makeNumber(_0: number): any
    makeLabel(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): any
    makeTimestamp(_0: number): any
    makePercentage(_0: number): any
    makeDate(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): any
    makeColor(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string): any
    makePixels(_0: number): any
    makeBoolean(_0: boolean): any
    makeNull(): any
    makeUndefined(): any
  }
  Synchronization: {
    make(
      _0: number,
      _1: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string,
      _2: number,
      _3: number,
      _4: number,
      _5: number,
      _6: number,
    ): any
    makeFromUint8Array(_0: any): any
  }
  Uint8Vector: { new (): Uint8Vector }
  IConnector_WASM: {
    implement(_0: any): ImplementedIConnector_WASM
    extend(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: any): any
  }
  ImplementedIConnector_WASM: {}
  Spectoda_WASM: {
    implement(_0: any): ImplementedSpectoda_WASM
    extend(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: any): any
  }
  ImplementedSpectoda_WASM: {}
}

/// ========== DEBUG_DEV_0.12.5_20250209.d.ts ========== ///

/// =================== MANUALLY DEFINED INTERFACES ================= ///

// ! from C++ types.h in Spectoda_Firmware
// struct process_options_t {
//   bool skip_berry_plugin_update = false;
//   bool skip_eventstate_updates = false;
//   bool force_event_emittion = false;
//   bool skip_event_emittion = false;
//   // internal
//   timestamp_t __timeline_time = TIMESTAMP(0);
//   date_t __timeline_date = DATE::DATE_UNDEFINED;
//   clock_ms __clock_timestamp = clock_ms(0);
// };

export type ProcessOptions = {
  skip_berry_plugin_update: boolean
  skip_eventstate_updates: boolean
  force_event_emittion: boolean
  skip_event_emittion: boolean
}

// ! from C++ types.h in Spectoda_Firmware
// struct render_options_t {
//   bool force_clear_ports_flag = false;
//   bool force_bake_flag = false;
//   uint8_t power = 255;
// };

export type RenderOptions = {
  force_clear_ports_flag: boolean
  force_bake_flag: boolean
  power: number
}

export type Spectoda_WASMImplementation = {
  // ! C++ Code the Spectoda_WASMImplementation is mapped to and MUST be in sync for WASM binding to work properly
  // ! please keep it here as it is used for determining if there are some changes in C++ vs this file. For more info contact @immakermatty
  // ? class ImplementedSpectoda_WASM : public wrapper<Spectoda_WASM>

  // bool _onTnglLoad(const std::vector<uint8_t>& tngl_bytes, const std::vector<uint8_t>& used_ids) override
  // {
  //     return call<bool>("_onTnglLoad", tngl_bytes, used_ids);
  // }

  // bool _onEvents(val&& event_array) override
  // {
  //     return call<bool>("_onEvents", std::move(event_array));
  // }

  // bool _onEventStateUpdates(val&& event_state_updates_array) override
  // {
  //     return call<bool>("_onEventStateUpdates", std::move(event_state_updates_array));
  // }

  // bool _onExecute(const std::vector<uint8_t>& execute_bytecode) override
  // {
  //     return call<bool>("_onExecute", execute_bytecode);
  // }

  // bool _onRequest(const int32_t request_ticket_number, const std::vector<uint8_t>& request_bytecode_vector, Connection&& destination_connection) override
  // {
  //     return call<bool>("_onRequest", request_ticket_number, request_bytecode_vector, val(std::move(destination_connection)));
  // }

  // bool _onSynchronize(Synchronization&& synchronization) override
  // {
  //     return call<bool>("_onSynchronize", val(std::move(synchronization)));
  // }

  // bool _onProcess(val&& options) override
  // {
  //     return call<bool>("_onProcess", std::move(options));
  // }

  // interface_error_t _handlePeerConnected(const std::string& peer_mac) override
  // {
  //     return call<interface_error_t>("_handlePeerConnected", peer_mac);
  // }

  // interface_error_t _handlePeerDisconnected(const std::string& peer_mac) override
  // {
  //     return call<interface_error_t>("_handlePeerDisconnected", peer_mac);
  // }

  // interface_error_t _handleTimelineManipulation(const timeline_ms timeline_timestamp, const bool timeline_paused, const std::string& timeline_date) override
  // {
  //     return call<interface_error_t>("_handleTimelineManipulation", timeline_timestamp, timeline_paused, timeline_date);
  // }

  // interface_error_t _handleReboot() override
  // {
  //     return call<interface_error_t>("_handleReboot");
  // }

  // void _onLog(const int32_t level, const std::string& where, const std::string& message) const override
  // {
  //     call<void>("_onLog", level, where, message);
  // }

  // // __construct: function () {}
  // // __destruct: function () {}
  _onTnglLoad(tngl_bytes: Uint8Vector, used_ids: Uint8Vector): boolean
  _onEvents(event_array: Event[]): boolean
  _onEventStateUpdates(event_array: Event[]): boolean
  _onExecute(execute_bytecode: Uint8Vector): boolean
  _onRequest(
    request_ticket_number: number,
    request_bytecode_vector: Uint8Vector,
    destination_connection: Connection,
  ): boolean
  _onSynchronize(synchronization: Synchronization): boolean
  _onProcess(options: ProcessOptions): boolean
  _handlePeerConnected(peer_mac: string): interface_error_t
  _handlePeerDisconnected(peer_mac: string): interface_error_t
  _handleTimelineManipulation(
    timeline_timestamp: number,
    timeline_paused: boolean,
    timeline_date: string,
  ): interface_error_t
  _handleReboot(): interface_error_t
  _onLog(level: number, where: string, message: string): void
}

export type IConnector_WASMImplementation = {
  // ! C++ Code the IConnector_WASMImplementation is mapped to and MUST be in sync for WASM binding to work properly
  // ! please keep it here as it is used for determining if there are some changes in C++ vs this file. For more info contact @immakermatty
  // ? class ImplementedIConnector_WASM : public wrapper<IConnector_WASM>

  // bool _scan(const std::string& criteria_json, const int32_t scan_period, const val& result_out) override
  // {
  //     return call<bool>("_scan", criteria_json, scan_period, result_out);
  // }

  // bool _autoConnect(const std::string& criteria_json, const int32_t scan_period, const int32_t timeout, const val& result_out) override
  // {
  //     return call<bool>("_autoConnect", criteria_json, scan_period, timeout, result_out);
  // }

  // bool _userConnect(const std::string& criteria_json, const int32_t timeout, const val& result_out) override
  // {
  //     return call<bool>("_userConnect", criteria_json, timeout, result_out);
  // }

  // bool _disconnect(Connection&& connection) override
  // {
  //     return call<bool>("_disconnect", val(std::move(connection)));
  // }

  // void _sendExecute(const std::vector<uint8_t>& command_bytes, Connection&& source_connection) override
  // {
  //     return call<void>("_sendExecute", command_bytes, val(std::move(source_connection)));
  // }

  // bool _sendRequest(const int32_t request_ticket_number, std::vector<uint8_t>& request_bytecode, Connection&& destination_connection) override
  // {
  //     return call<bool>("_sendRequest", request_ticket_number, request_bytecode, val(std::move(destination_connection)));
  // }

  // bool _sendResponse(const int32_t request_ticket_number, const int32_t request_result, std::vector<uint8_t>& response_bytecode, Connection&& destination_connection) override
  // {
  //     return call<bool>("_sendResponse", request_ticket_number, request_result, response_bytecode, val(std::move(destination_connection)));
  // }

  // void _sendSynchronize(Synchronization&& synchronization, Connection&& source_connection) override
  // {
  //     return call<void>("_sendSynchronize", val(std::move(synchronization)), val(std::move(source_connection)));
  // }

  // void _process() override
  // {
  //     return call<void>("_process");
  // }

  // // __construct: function () {}
  // // __destruct: function () {}
  _scan: (criteria_json: string, scan_period: number, result_out: any) => boolean
  _autoConnect: (criteria_json: string, scan_period: number, timeout: number, result_out: any) => boolean
  _userConnect: (criteria_json: string, timeout: number, result_out: any) => boolean
  _disconnect: (connection: Connection) => boolean
  _sendExecute: (command_bytes: Uint8Vector, source_connection: Connection) => void
  _sendRequest: (
    request_ticket_number: number,
    request_bytecode: Uint8Vector,
    destination_connection: Connection,
  ) => boolean
  _sendResponse: (
    request_ticket_number: number,
    request_result: number,
    response_bytecode: Uint8Vector,
    destination_connection: Connection,
  ) => boolean
  _sendSynchronize: (synchronization: Synchronization, source_connection: Connection) => void
  _process: () => void
}

/// ======================================================= ///
