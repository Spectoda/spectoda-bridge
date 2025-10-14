import { logging } from '../logging'

import type { MainModule, Uint8Vector } from './types/wasm'

export const WASM_VERSION = 'DEBUG_UNIVERSAL_0.12.11_20251005'
export const WEBASSEMBLY_BASE_URL = 'https://webassembly.spectoda.com'

const IS_NODEJS =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

let moduleInitilizing = false
let moduleInitilized = false

const looksLikeHtml = (content: string) =>
  /^\s*<!doctype html>/i.test(content) || /^\s*<html/i.test(content)

declare global {
  var __non_webpack_require__: NodeJS.Require
}

export const downloadWasmFromS3 = async (version: string) => {
  const jsUrl = `${WEBASSEMBLY_BASE_URL}/${version}.js`
  const wasmUrl = `${WEBASSEMBLY_BASE_URL}/${version}.wasm`

  let jsContent: string | null = null
  let wasmContent: ArrayBuffer | null = null
  let jsModuleUrl: string | null = null

  try {
    const [jsResponse, wasmResponse] = await Promise.all([
      fetch(jsUrl, {
        method: 'GET',
        cache: 'force-cache',
        credentials: 'omit',
        headers: {
          Accept: 'text/javascript',
        },
      }),
      fetch(wasmUrl, {
        method: 'GET',
        cache: 'force-cache',
        credentials: 'omit',
        headers: {
          Accept: 'application/wasm',
        },
      }),
    ])

    if (!jsResponse.ok || !wasmResponse.ok) {
      throw new Error(
        `Failed to download ${version}.{js|wasm} (${jsResponse.status}/${wasmResponse.status})`,
      )
    }

    jsContent = await jsResponse.text()
    wasmContent = await wasmResponse.arrayBuffer()

    if (looksLikeHtml(jsContent)) {
      throw new Error(
        `Downloaded ${version}.js is HTML (likely an error page).`,
      )
    }

    if (wasmContent.byteLength === 0) {
      throw new Error(`Downloaded ${version}.wasm is empty.`)
    }
  } catch {
    if (IS_NODEJS) {
      const r = globalThis?.__non_webpack_require__ ?? require
      const { readFile, readdir, unlink } = r(
        /* webpackIgnore: true */ /* @vite-ignore */ 'node:fs/promises',
      )
      const { cwd } = r(
        /* webpackIgnore: true */ /* @vite-ignore */ 'node:process',
      )

      const files = await readdir(`${cwd()}/.webassembly`)

      if (
        files.includes(`${version}.js`) &&
        files.includes(`${version}.wasm`)
      ) {
        const wasmBuffer = await readFile(
          `${cwd()}/.webassembly/${version}.wasm`,
        )

        jsContent = await readFile(`${cwd()}/.webassembly/${version}.js`, {
          encoding: 'utf-8',
        })
        if (looksLikeHtml(jsContent)) {
          try {
            await Promise.all([
              unlink(`${cwd()}/.webassembly/${version}.js`),
              unlink(`${cwd()}/.webassembly/${version}.wasm`),
            ])
          } catch {
            // ignore cleanup errors
          }
          throw new Error(
            `Cached ${version}.js is HTML. Removed cached files; rerun to re-download.`,
          )
        }
        wasmContent = wasmBuffer.buffer.slice(
          wasmBuffer.byteOffset,
          wasmBuffer.byteOffset + wasmBuffer.byteLength,
        ) as ArrayBuffer
      } else {
        throw Error(`${version}.{js|wasm} is missing`)
      }

      jsModuleUrl = `${cwd()}/.webassembly/${version}.js`
    }
  }

  if (jsContent === null || wasmContent === null) {
    throw Error(`Could not load ${version}.{js/wasm}`)
  }

  if (jsModuleUrl === null) {
    if (IS_NODEJS) {
      const r = globalThis?.__non_webpack_require__ ?? require
      const { writeFile, readdir, mkdir } = r(
        /* webpackIgnore: true */ /* @vite-ignore */ 'node:fs/promises',
      )
      const { cwd } = r(
        /* webpackIgnore: true */ /* @vite-ignore */ 'node:process',
      )

      try {
        await readdir(`${cwd()}/.webassembly`)
      } catch {
        await mkdir(`${cwd()}/.webassembly`)
      }

      await Promise.all([
        writeFile(`${cwd()}/.webassembly/${version}.js`, jsContent),
        writeFile(
          `${cwd()}/.webassembly/${version}.wasm`,
          new DataView(wasmContent),
        ),
      ])

      jsModuleUrl = `${cwd()}/.webassembly/${version}.js`
    } else {
      jsModuleUrl = URL.createObjectURL(
        new Blob([jsContent], { type: 'text/javascript' }),
      )
    }
  }

  if (jsModuleUrl === null) {
    throw Error('Could not load JS module')
  }

  return {
    wasm_content: wasmContent,
    js_module_url: jsModuleUrl,
  }
}

export const loadWasmFromS3 = async (version: string): Promise<MainModule> => {
  const { wasm_content, js_module_url } = await downloadWasmFromS3(version)

  try {
    // Both Webpack and Vite try to resolve this dynamic import during build time
    // Since this is a runtime-only dynamic import we want them to ignore it
    const importedModule = await import(
      /* webpackIgnore: true */ /* @vite-ignore */ js_module_url
    )

    if (
      !importedModule.default ||
      typeof importedModule.default !== 'function'
    ) {
      throw new Error(
        `JS file (${version}.js) did not export a default function as expected.`,
      )
    }

    const wasmInstance: MainModule = await importedModule.default({
      wasmBinary: wasm_content,
      locateFile: (path: string, prefix: string): string => {
        if (path.endsWith('.wasm')) {
          return path
        }

        return prefix + path
      },
    })

    return wasmInstance
  } catch (maybeError) {
    if (maybeError instanceof Error) {
      throw maybeError
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
    console.error(
      'SpectodaWasm is a singleton class, please do not create instances of it',
    )
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
    // @ts-expect-error - Emval is a global object of Emscripten
    return Module.Emval.toHandle(value)
  }

  static toValue(value: number): any {
    // @ts-expect-error - Emval is a global object of Emscripten
    return Module.Emval.toValue(value)
  }

  static loadFS() {
    return new Promise((resolve, reject) => {
      // @ts-expect-error - FS is a global object of Emscripten
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
      // @ts-expect-error - FS is a global object of Emscripten
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

  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.interface_error_t = (Module as MainModule).interface_error_t
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.connector_type_t = (Module as MainModule).connector_type_t
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.connection_rssi_t = Module.connection_rssi_t
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.Value = Module.Value
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.Connection = Module.Connection
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.Synchronization = Module.Synchronization
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.Uint8Vector = Module.Uint8Vector
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.Spectoda_WASM = Module.Spectoda_WASM
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.IConnector_WASM = Module.IConnector_WASM
  // @ts-expect-error - Module is a global object of Emscripten
  SpectodaWasm.computeFingerprint32 = Module.computeFingerprint32

  // ? BROWSER: mounting FS
  if (typeof window !== 'undefined') {
    // @ts-expect-error - FS is a global object of Emscripten
    Module.FS.mkdir('/littlefs')
    // @ts-expect-error - FS and IDBFS are global objects of Emscripten
    Module.FS.mount(Module.FS.filesystems.IDBFS, {}, '/littlefs')
  }
  // ? NODE.JS: mounting FS
  else if (!process.env.NEXT_PUBLIC_VERSION) {
    // TODO make "filesystem" folder in root, if it does not exist
    // const fs = require("fs");
    // if (!fs.existsSync("filesystem")) {
    //   fs.mkdirSync("filesystem");
    // }

    // @ts-expect-error - FS is a global object of Emscripten
    const module = Module as MainModule & {
      FS: {
        mkdir: (path: string) => void
        mount: (
          filesystem: unknown,
          options: unknown,
          mountpoint: string,
        ) => void
        filesystems: { NODEFS: unknown }
      }
    }
    module.FS.mkdir('/littlefs')
    module.FS.mount(
      module.FS.filesystems.NODEFS,
      { root: './filesystem' },
      '/littlefs',
    )
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
  logging.info(`Loading spectoda-js WASM version ${wasmVersion}`)

  loadWasmFromS3(wasmVersion).then((moduleInstance) => {
    globalThis.Module = moduleInstance
    onWasmLoad()
  })
}
