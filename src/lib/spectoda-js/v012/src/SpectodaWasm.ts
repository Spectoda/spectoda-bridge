// eslint-disable-next-line @typescript-eslint/ban-ts-comment

import { logging } from '../logging'

import { MainModule, Uint8Vector } from './types/wasm'

export const WASM_VERSION = 'DEBUG_UNIVERSAL_0.12.11_20251102'
export const WEBASSEMBLY_BASE_URL = 'https://webassembly.spectoda.com'

const IS_NODEJS =
  typeof process == 'object' && typeof process.versions == 'object' && typeof process.versions.node == 'string'

let moduleInitilizing = false
let moduleInitilized = false

declare global {
  var __non_webpack_require__: NodeJS.Require
}

const r = globalThis?.__non_webpack_require__ ?? require

export const downloadWasmFromS3 = async (version: string) => {
  const js_url = `${WEBASSEMBLY_BASE_URL}/${version}.js`
  const wasm_url = `${WEBASSEMBLY_BASE_URL}/${version}.wasm`

  let js_content: string | null = null
  let wasm_content: ArrayBuffer | null = null
  let js_module_url: string | null = null

  try {
    const [js_response, wasm_response] = await Promise.all([
      fetch(js_url, {
        method: 'GET',
        cache: 'force-cache',
        credentials: 'omit',
        headers: {
          Accept: 'text/javascript',
        },
      }),
      fetch(wasm_url, {
        method: 'GET',
        cache: 'force-cache',
        credentials: 'omit',
        headers: {
          Accept: 'application/wasm',
        },
      }),
    ])

    js_content = await js_response.text()
    wasm_content = await wasm_response.arrayBuffer()
  } catch {
    if (IS_NODEJS) {
      const { readFile, readdir } = r(/* webpackIgnore: true */ /* @vite-ignore */ 'node:fs/promises')
      const { cwd } = r(/* webpackIgnore: true */ /* @vite-ignore */ 'node:process')

      const files = await readdir(`${cwd()}/.webassembly`)

      if (files.includes(`${version}.js`) && files.includes(`${version}.wasm`)) {
        const wasm_buffer = await readFile(`${cwd()}/.webassembly/${version}.wasm`)

        js_content = await readFile(`${cwd()}/.webassembly/${version}.js`, { encoding: 'utf-8' })
        wasm_content = wasm_buffer.buffer.slice(
          wasm_buffer.byteOffset,
          wasm_buffer.byteOffset + wasm_buffer.byteLength,
        ) as ArrayBuffer
      } else {
        throw Error(`${version}.{js|wasm} is missing`)
      }

      js_module_url = `${cwd()}/.webassembly/${version}.js`
    }
  }

  if (js_content === null || wasm_content === null) {
    throw Error(`Could not load ${version}.{js/wasm}`)
  }

  if (js_module_url === null) {
    if (IS_NODEJS) {
      const { writeFile, readdir, mkdir } = r(/* webpackIgnore: true */ /* @vite-ignore */ 'node:fs/promises')
      const { cwd } = r(/* webpackIgnore: true */ /* @vite-ignore */ 'node:process')

      try {
        await readdir(`${cwd()}/.webassembly`)
      } catch {
        await mkdir(`${cwd()}/.webassembly`)
      }

      await Promise.all([
        writeFile(`${cwd()}/.webassembly/${version}.js`, js_content),
        writeFile(`${cwd()}/.webassembly/${version}.wasm`, new DataView(wasm_content)),
      ])

      js_module_url = `${cwd()}/.webassembly/${version}.js`
    } else {
      js_module_url = URL.createObjectURL(new Blob([js_content], { type: 'text/javascript' }))
    }
  }

  if (js_module_url === null) {
    throw Error('Could not load JS module')
  }

  return {
    wasm_content,
    js_module_url,
  }
}

export const loadWasmFromS3 = async (version: string): Promise<MainModule> => {
  const { wasm_content, js_module_url } = await downloadWasmFromS3(version)

  try {
    // Both Webpack and Vite try to resolve this dynamic import during build time
    // Since this is a runtime-only dynamic import we want them to ignore it
    const imported_module = await import(/* webpackIgnore: true */ /* @vite-ignore */ js_module_url)

    if (!imported_module.default || typeof imported_module.default !== 'function') {
      throw new Error(`JS file (${version}.js) did not export a default function as expected.`)
    }

    const wasm_instance: MainModule = await imported_module.default({
      wasmBinary: wasm_content,
      locateFile: (path: string, prefix: string): string => {
        if (path.endsWith('.wasm')) {
          return path
        }

        return prefix + path
      },
    })

    return wasm_instance
  } catch (maybe_error) {
    if (maybe_error instanceof Error) {
      throw maybe_error
    } else {
      throw new Error(`Could not download ${version}`)
    }
  } finally {
    if (IS_NODEJS === false) {
      URL.revokeObjectURL(js_module_url)
    }
  }
}

class Wait {
  promise: Promise<void>
  resolve: (value: void | PromiseLike<void>) => void
  reject: (reason?: any) => void

  constructor() {
    this.resolve = () => {}
    this.reject = () => {}

    this.promise = new Promise((resolve, reject) => {
      this.reject = reject
      this.resolve = resolve
    })
  }
}

let waitingQueue: Wait[] = []

// ? SpectodaWasm binds the JS world with the webassembly's C
// ? This is a singleton object in a way, not a class... But I didnt figure out how to implement it in TS
export class SpectodaWasm {
  //
  // TODO! disallow creating instances of this class
  constructor() {
    console.error('SpectodaWasm is a singleton class, please do not create instances of it')
  }

  // ? from MainModule:
  // interface_error_t: { SUCCESS: interface_error_tValue<0>; FAIL: interface_error_tValue<255> };
  // connector_type_t: {
  //   CONNECTOR_UNDEFINED: connector_type_tValue<0>;
  //   CONNECTOR_ESPNOW: connector_type_tValue<1>;
  //   CONNECTOR_BLE: connector_type_tValue<2>;
  //   CONNECTOR_SERIAL: connector_type_tValue<3>;
  //   CONNECTOR_WEBSOCKETS: connector_type_tValue<4>;
  //   CONNECTOR_TWAI: connector_type_tValue<5>;
  //   CONNECTOR_MAX: connector_type_tValue<6>;
  // };
  // connection_rssi_t: { RSSI_MAX: connection_rssi_tValue<127>; RSSI_MIN: connection_rssi_tValue<-128> };
  // Connection: { new (): Connection };
  // Uint8Vector: { new (): Uint8Vector };
  // Spectoda_WASM: { implement(_0: any): ImplementedSpectoda_WASM; extend(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: any): any };
  // // ImplementedSpectoda_WASM: {};
  // IConnector_WASM: { implement(_0: any): ImplementedIConnector_WASM; extend(_0: ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string, _1: any): any };
  // // ImplementedIConnector_WASM: {};

  static interface_error_t: MainModule['interface_error_t']
  static connector_type_t: MainModule['connector_type_t']
  static connection_rssi_t: MainModule['connection_rssi_t']
  static Value: MainModule['Value']
  static Connection: MainModule['Connection']
  static Synchronization: MainModule['Synchronization']
  static Uint8Vector: MainModule['Uint8Vector']
  static Spectoda_WASM: MainModule['Spectoda_WASM']
  static IConnector_WASM: MainModule['IConnector_WASM']

  // oposite of convertJSArrayToNumberVector() in https://emscripten.org/docs/api_reference/val.h.html
  static convertUint8VectorUint8Array(vector: Uint8Vector) {
    const array = new Uint8Array(vector.size())

    for (let i = 0; i < array.length; i++) {
      array[i] = vector.get(i)
    }
    return array
  }

  // wasmVersion might be DEBUG_0.9.2_20230814
  static initialize(wasmVersion = WASM_VERSION) {
    if (moduleInitilizing || moduleInitilized) {
      return
    }
    moduleInitilizing = true
    loadWasm(wasmVersion)
  }

  static initilized() {
    return moduleInitilized
  }

  static waitForInitilize() {
    if (moduleInitilized) {
      return Promise.resolve()
    }

    const wait = new Wait()

    waitingQueue.push(wait)
    return wait.promise
  }

  static toHandle(value: any): number {
    // @ts-ignore - Emval is a global object of Emscripten
    return Module.Emval.toHandle(value)
  }

  static toValue(value: number): any {
    // @ts-ignore - Emval is a global object of Emscripten
    return Module.Emval.toValue(value)
  }

  static loadFS() {
    return new Promise((resolve, reject) => {
      // @ts-ignore - FS is a global object of Emscripten
      Module.FS.syncfs(true, (err: any) => {
        if (err) {
          logging.error('SpectodaWasm::loadFS() ERROR:', err)
          reject(err)
        } else {
          logging.info('SpectodaWasm::loadFS() Filesystem loaded')
          resolve(null)
        }
      })
    })
  }

  static saveFS() {
    return new Promise((resolve, reject) => {
      // @ts-ignore - FS is a global object of Emscripten
      Module.FS.syncfs(false, (err: any) => {
        if (err) {
          logging.error('SpectodaWasm::saveFS() ERROR:', err)
          reject(err)
        } else {
          logging.info('SpectodaWasm::saveFS() Filesystem saved')
          resolve(null)
        }
      })
    })
  }
}

// eslint-disable-next-line func-style
function onWasmLoad() {
  logging.info('WASM loaded')

  const resolveWaitingQueue = () => {
    for (const wait of waitingQueue) {
      wait.resolve()
    }
    waitingQueue = []
  }

  moduleInitilized = true

  logging.info('WASM runtime initilized')

  // static interface_error_t: MainModule["interface_error_t"];
  // static connector_type_t: MainModule["connector_type_t"];
  // static connection_rssi_t: MainModule["connection_rssi_t"];
  // static Connection: MainModule["Connection"];
  // static Synchronization: MainModule["Synchronization"];
  // static Uint8Vector: MainModule["Uint8Vector"];
  // static Spectoda_WASM: MainModule["Spectoda_WASM"];
  // static IConnector_WASM: MainModule["IConnector_WASM"];

  // ? SpectodaWasm holds the class definitions of the webassembly

  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.interface_error_t = Module.interface_error_t
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.connector_type_t = Module.connector_type_t
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.connection_rssi_t = Module.connection_rssi_t
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.Value = Module.Value
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.Connection = Module.Connection
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.Synchronization = Module.Synchronization
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.Uint8Vector = Module.Uint8Vector
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.Spectoda_WASM = Module.Spectoda_WASM
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.IConnector_WASM = Module.IConnector_WASM
  // @ts-ignore - Module is a global object of Emscripten
  SpectodaWasm.computeFingerprint32 = Module.computeFingerprint32

  // ? BROWSER: mounting FS
  if (typeof window !== 'undefined') {
    // @ts-ignore - FS is a global object of Emscripten
    Module.FS.mkdir('/littlefs')
    // @ts-ignore - FS and IDBFS are global objects of Emscripten
    Module.FS.mount(Module.FS.filesystems.IDBFS, {}, '/littlefs')
  }
  // ? NODE.JS: mounting FS
  else if (!process.env.NEXT_PUBLIC_VERSION) {
    // TODO make "filesystem" folder in root, if it does not exist
    // const fs = require("fs");
    // if (!fs.existsSync("filesystem")) {
    //   fs.mkdirSync("filesystem");
    // }

    // @ts-ignore - FS is a global object of Emscripten
    Module.FS.mkdir('/littlefs')
    // @ts-ignore - FS is a global object of Emscripten
    Module.FS.mount(Module.FS.filesystems.NODEFS, { root: './filesystem' }, '/littlefs')
  }

  // ? Load WASM filesystem from mounted system filesystem
  SpectodaWasm.loadFS().finally(() => {
    resolveWaitingQueue()
  })

  // ? BROWSER: Save WASM filesystem before window unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      SpectodaWasm.saveFS()
    })
  }
  // ? NODE.JS: enviroment save WASM filesystem before app exit
  else if (!process.env.NEXT_PUBLIC_VERSION) {
    process.on('exit', () => {
      SpectodaWasm.saveFS()
    })
  }
}

// eslint-disable-next-line func-style
function loadWasm(wasmVersion: string) {
  logging.info('Loading spectoda-js WASM version ' + wasmVersion)

  loadWasmFromS3(wasmVersion).then((module_instance) => {
    // @ts-ignore
    globalThis.Module = module_instance
    onWasmLoad()
  })
}
