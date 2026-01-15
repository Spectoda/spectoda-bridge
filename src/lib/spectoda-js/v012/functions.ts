// TODO fix TSC in spectoda-js
// @ts-nocheck

import { logging } from './logging'
import { TnglCodeParser } from './SpectodaParser'
import { PERCENTAGE_JS_VS_CPP_SCALE_FACTOR } from './src/constants'

export const createNanoEvents = () => ({
  emit<K extends keyof SpectodaJsEventMap>(
    event: K,
    ...args: SpectodaJsEventMap[K]
  ) {
    const callbacks = this.events[event] || []

    for (let i = 0, length = callbacks.length; i < length; i++) {
      callbacks[i](...args)
    }
  },
  events: {},
  on<K extends keyof SpectodaJsEventMap>(
    event: K,
    cb: (props: SpectodaJsEventMap[K]) => void,
  ) {
    this.events[event]?.push(cb) || (this.events[event] = [cb])
    return () => {
      this.events[event] = this.events[event]?.filter((i) => cb !== i)
    }
  },
})

export const createNanoEventsWithWrappedEmit = (emitHandler) => ({
  emit<K extends keyof SpectodaJsEventMap>(
    event: K,
    ...args: SpectodaJsEventMap[K]
  ) {
    emitHandler({ event, args })

    const callbacks = this.events[event] || []

    for (let i = 0, length = callbacks.length; i < length; i++) {
      callbacks[i](...args)
    }
  },
  events: {},
  on<K extends keyof SpectodaJsEventMap>(
    event: K,
    cb: (props: SpectodaJsEventMap[K]) => void,
  ) {
    this.events[event]?.push(cb) || (this.events[event] = [cb])
    return () => {
      this.events[event] = this.events[event]?.filter((i) => cb !== i)
    }
  },
})

export function toBytes(value: number, byteCount: number) {
  if (typeof value !== 'number') {
    logging.error(`Invalid value type: ${value} (${typeof value})`)
    throw 'InvalidValue'
  }

  if (Number.isNaN(value)) {
    logging.error(`Invalid NaN value: ${value}`)
    throw 'InvalidValue'
  }

  if (!Number.isFinite(Number(value))) {
    logging.error(`Invalid not finite type: ${value}`)
    throw 'InvalidValue'
  }

  let number = BigInt(Math.round(value))
  const byteArray: number[] = []

  for (let index = 0; index < byteCount; index++) {
    const byte = number & 0xffn

    byteArray.push(Number(byte))
    number = number >> 8n
  }
  return byteArray
}

export function numberToBytes(numberValue: number, byteCount: number) {
  return toBytes(numberValue, byteCount)
}

export const timeOffset = Date.now() % 0x7fffffff
// must be positive int32 (4 bytes)
export function getClockTimestamp() {
  return (Date.now() % 0x7fffffff) - timeOffset
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The MIT License (MIT)

// Copyright 2016 Andrey Sitnik <andrey@sitnik.ru>

// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
// FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/////////////////////////////////////////////// == 0.7 == ///////////////////////////////////////////////////

export const getSeconds = (str) => {
  let seconds = 0
  const months = str.match(/(\d+)\s*M/)
  const days = str.match(/(\d+)\s*D/)
  const hours = str.match(/(\d+)\s*h/)
  const minutes = str.match(/(\d+)\s*m/)
  const secs = str.match(/(\d+)\s*s/)

  if (months) {
    seconds += parseInt(months[1], 10) * 86400 * 30
  }
  if (days) {
    seconds += parseInt(days[1], 10) * 86400
  }
  if (hours) {
    seconds += parseInt(hours[1], 10) * 3600
  }
  if (minutes) {
    seconds += parseInt(minutes[1], 10) * 60
  }
  if (secs) {
    seconds += parseInt(secs[1], 10)
  }
  return seconds
}

export function mapValue(x, inMin, inMax, outMin, outMax) {
  logging.verbose(
    'mapValue(x=' +
      x +
      ', in_min=' +
      inMin +
      ', in_max=' +
      inMax +
      ', out_min=' +
      outMin +
      ', out_max=' +
      outMax +
      ')',
  )

  if (inMax === inMin) {
    return outMin / 2 + outMax / 2
  }

  let minimum = Math.min(inMin, inMax)
  let maximum = Math.max(inMin, inMax)

  if (x < minimum) {
    x = minimum
  } else if (x > maximum) {
    x = maximum
  }

  let result = ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin

  minimum = Math.min(outMin, outMax)
  maximum = Math.max(outMin, outMax)

  if (result < minimum) {
    result = minimum
  } else if (result > maximum) {
    result = maximum
  }

  return result
}

// takes "label" and outputs ascii characters in a list of bytes
export function labelToBytes(labelString: string): number[] {
  return stringToBytes(labelString, 5, false)
}

export function stringToBytes(
  string: string,
  length: number,
  nullTerminated: boolean,
): number[] {
  const byteArray: number[] = []

  for (let index = 0; index < length; index++) {
    if (index < string.length) {
      byteArray.push(string.charCodeAt(index))
    } else {
      byteArray.push(0)
    }
  }

  if (nullTerminated) {
    byteArray[byteArray.length - 1] = 0
  }

  return byteArray
}

export function colorToBytes(colorHexCode: string): number[] {
  if (!colorHexCode) {
    return [0, 0, 0]
  }

  const reg = colorHexCode.match(/#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i)

  if (!reg) {
    logging.error(`Wrong color code: "${colorHexCode}"`)
    return [0, 0, 0]
  }

  const r = parseInt(reg[1], 16)
  const g = parseInt(reg[2], 16)
  const b = parseInt(reg[3], 16)

  return [r, g, b]
}

/**
 * Converts a value to a specific type based on the provided type code.
 * @deprecated There should be no need to convert percentage values to bytes.
 */
export function percentageToBytes(_percentageFloat: number): number[] {
  return numberToBytes(Math.floor(value * PERCENTAGE_JS_VS_CPP_SCALE_FACTOR), 4)
}

export function strMacToBytes(macStr: string): number[] {
  // Split the string into an array of hexadecimal values
  const hexValues = macStr.split(':')

  // Convert each hexadecimal value to a byte
  const bytes = hexValues.map((hex) => parseInt(hex, 16))

  return bytes
}

// WIN11, Google Chrome:            Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36
// Iphone 11, iOS 15.3.1, Safari:   Mozilla/5.0 (iPhone; CPU iPhone OS 15_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1
// Iphone 11, iOS 15.3.1, Bluefy:   Mozilla/5.0 (iPhone; CPU iPhone OS 15_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Bluefy/3.3.4
// Macbook M1, Google Chrome:       Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36
// Macbook M1, Safari:              Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15
// Android Spectoda Connect         Mozilla/5.0 (Linux; Android 11; Pixel 2 XL Build/RP1A.201005.004.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/104.0.5112.97 Mobile Safari/537.36
// Android Google Chrome            Mozilla/5.0 (Linux; Android 11; Pixel 2 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36
// IPhone SE Spectoda Connect       Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148
// IPhone SE Safari                 Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1

const spectodaNodeDetected =
  typeof process !== 'undefined' && process.versions && process.versions.node

export function detectNode() {
  return spectodaNodeDetected
}

export function detectServerEnvironment() {
  return typeof window === 'undefined'
}

export function detectBrowser() {
  return typeof window !== 'undefined'
}

export function detectNext() {
  return process.env.NEXT_PUBLIC_NEXTJS
}

export function detectProductionBuild() {
  return !!process.env.NEXT_PUBLIC_VERSION
}

export function detectGW() {
  return detectNode() && !detectNext()
}

export function detectSpectodaConnect() {
  return (
    typeof window !== 'undefined' &&
    Object.keys(window).some((v) => v.includes('flutter'))
  )
}

const navigatorUserAgent =
  typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
const navigatorUserAgentData =
  typeof navigator === 'undefined' ? {} : navigator.userAgentData

const androidDetected = navigatorUserAgent.includes('android')

export function detectAndroid() {
  return androidDetected
}

const iphoneDetected = navigatorUserAgent.includes('iphone')

export function detectIPhone() {
  return iphoneDetected
}

const macintoshDetected = navigatorUserAgent.includes('macintosh')

export function detectMacintosh() {
  return macintoshDetected
}

const windowsDetected = navigatorUserAgent.includes('windows')

export function detectWindows() {
  return windowsDetected
}

const linuxDetected = navigatorUserAgentData?.platform === 'Linux'

export function detectLinux() {
  return linuxDetected
}

// Browser detection - order matters due to user agent string overlaps
const firefoxDetected = navigatorUserAgent.includes('firefox')

export function detectFirefox() {
  return firefoxDetected
}

const edgeDetected = navigatorUserAgent.includes('edg/')

export function detectEdge() {
  return edgeDetected
}

const operaDetected =
  navigatorUserAgent.includes('opr/') || navigatorUserAgent.includes('opera')

export function detectOpera() {
  return operaDetected
}

const braveDetected = typeof navigator !== 'undefined' && 'brave' in navigator

export function detectBrave() {
  return braveDetected
}

const samsungBrowserDetected = navigatorUserAgent.includes('samsungbrowser')

export function detectSamsungBrowser() {
  return samsungBrowserDetected
}

// Chrome detection: exclude Edge, Opera, Brave, Samsung Browser
const chromeDetected =
  navigatorUserAgent.includes('chrome') &&
  !edgeDetected &&
  !operaDetected &&
  !braveDetected &&
  !samsungBrowserDetected

export function detectChrome() {
  return chromeDetected && !detectSpectodaConnect()
}

const safariDetected =
  navigatorUserAgent.includes('safari') &&
  !navigatorUserAgent.includes('chrome') &&
  !navigatorUserAgent.includes('chromium')

export function detectSafari() {
  return safariDetected && !detectSpectodaConnect()
}

// Runtime detection
const bunDetected = typeof globalThis !== 'undefined' && 'Bun' in globalThis

export function detectBun() {
  return bunDetected
}

const denoDetected = typeof globalThis !== 'undefined' && 'Deno' in globalThis

export function detectDeno() {
  return denoDetected
}

//////////////////////////////////////////////////////
export function computeTnglFingerprint(
  tnglBytes: Uint8Array | ArrayBuffer,
  tnglLabel = 'fingerprint',
) {
  const enc = new TextEncoder()
  const algorithm = { name: 'HMAC', hash: 'SHA-256' }
  const body = new Uint8Array(tnglBytes)

  return crypto.subtle
    .importKey('raw', enc.encode(tnglLabel), algorithm, false, [
      'sign',
      'verify',
    ])
    .then((key) => {
      return crypto.subtle.sign(algorithm.name, key, body)
    })
    .then((signature) => {
      return new Uint8Array(signature)
    })
}

export async function computeTnglCodeFingerprint(tnglCode: string) {
  const newTnglBytecode = new TnglCodeParser().parseTnglCode(tnglCode)
  const newTnglFingerprint = await computeTnglFingerprint(
    newTnglBytecode,
    'fingerprint',
  )
  const newTnglFingerprintHex = uint8ArrayToHexString(newTnglFingerprint)

  return newTnglFingerprintHex
}

export function hexStringToUint8Array(hexString, arrayLength) {
  if (hexString.length % 2 !== 0) {
    throw 'Invalid hexString'
  }
  if (!arrayLength) {
    arrayLength = hexString.length / 2
  }
  const arrayBuffer = new Uint8Array(arrayLength)

  for (let i = 0; i < arrayLength; i++) {
    const byteValue = parseInt(hexString.slice(i * 2, i * 2 + 2), 16)

    if (Number.isNaN(byteValue)) {
      arrayBuffer[i] = 0
    } else {
      arrayBuffer[i] = byteValue
    }
  }
  return arrayBuffer
}

export function uint8ArrayToHexString(bytes) {
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

export function enableDebugMode() {
  if (typeof window !== 'undefined' && window.eruda) {
    window.eruda.init()
    logging.setLoggingLevel(4)
  }
  logging.setLoggingLevel(5)
}

export function deactivateDebugMode() {
  if (
    typeof window !== 'undefined' &&
    'eruda' in window &&
    Object.hasOwn(window.eruda, 'destroy')
  ) {
    window.eruda.destroy()
  }
}

/////////////////////////////////////////////////////////////////

const CRC32_TABLE =
  '00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D'

const CRC32_DATA = CRC32_TABLE.split(' ').map((s) => parseInt(s, 16))

export function crc32(bytes: Uint8Array): number {
  let crc = -1

  for (let i = 0, iTop = bytes.length; i < iTop; i++) {
    crc = (crc >>> 8) ^ CRC32_DATA[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/////////////////////////////////////////////////////////////////

const CRC8_TABLE =
  '005EBCE2613FDD83C29C7E20A3FD1F419DC3217FFCA2401E5F01E3BD3E6082DC237D9FC1421CFEA0E1BF5D0380DE3C62BEE0025CDF81633D7C22C09E1D43A1FF4618FAA427799BC584DA3866E5BB5907DB856739BAE406581947A5FB7826C49A653BD987045AB8E6A7F91B45C6987A24F8A6441A99C7257B3A6486D85B05E7B98CD2306EEDB3510F4E10F2AC2F7193CD114FADF3702ECC92D38D6F31B2EC0E50AFF1134DCE90722C6D33D18F0C52B0EE326C8ED0530DEFB1F0AE4C1291CF2D73CA947628ABF517490856B4EA6937D58B5709EBB536688AD495CB2977F4AA4816E9B7550B88D6346A2B7597C94A14F6A8742AC896154BA9F7B6E80A54D7896B35'

export function hexStringToArray(str: string): Uint8Array {
  if (str.length === 0) {
    return new Uint8Array()
  }
  let arr = str.match(/[\da-f]{2}/gi) // convert into array of hex pairs

  arr = arr.map((x) => parseInt(x, 16)) // convert hex pairs into ints (bytes)
  return new Uint8Array(arr)
}

const CRC8_DATA = hexStringToArray(CRC8_TABLE)

export function crc8(bArr) {
  let i = 1
  const i2 = bArr.length - 1
  let b = 0

  while (i <= i2) {
    b = CRC8_DATA[(b ^ bArr[i]) & 255]
    i++
  }
  return b
}

export function convertToByteArray(str: string) {
  const byteArray = []

  for (let i = 0; i < str.length; i++) {
    byteArray.push(str.charCodeAt(i))
  }
  return new Uint8Array(byteArray)
}

// window.crc8 = crc8;
// window.crc32 = crc32;

/////////////////////////////////////////////////////////////////

function componentToHex(c) {
  const hex = c.toString(16)

  return hex.length === 1 ? `0${hex}` : hex
}

export function rgbToHex(r, g, b) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`
}

export function validateTimestamp(value) {
  if (!value) {
    return [0, '0s']
  }

  if (typeof value === 'number') {
    value = value.toString()
  }

  value = value.trim()

  if (
    value === 'inf' ||
    value === 'Inf' ||
    value === 'infinity' ||
    value === 'Infinity'
  ) {
    return [86400000, 'Infinity']
  }

  if (
    value === '-inf' ||
    value === '-Inf' ||
    value === '-infinity' ||
    value === '-Infinity'
  ) {
    return [-86400000, '-Infinity']
  }

  // if the string value is a number
  if (!Number.isNaN(value)) {
    value += 's'
  }

  const days = value.match(/([+-]? *\d+\.?\d*|\.\d+)\s*d/gi)
  const hours = value.match(/([+-]? *\d+\.?\d*|\.\d+)\s*h/gi)
  const minutes = value.match(/([+-]? *\d+\.?\d*|\.\d+)\s*m(?!s)/gi)
  const secs = value.match(/([+-]? *\d+\.?\d*|\.\d+)\s*s/gi)
  const msecs = value.match(/([+-]? *\d+\.?\d*|\.\d+)\s*(t|ms)/gi)

  let result = ''
  let total = 0

  logging.verbose(days)
  logging.verbose(hours)
  logging.verbose(minutes)
  logging.verbose(secs)
  logging.verbose(msecs)

  while (days && days.length > 0) {
    const d = parseFloat(days[0].replace(/\s/, ''))

    result += `${d}d `
    total += d * 86400000
    days.shift()
  }

  while (hours && hours.length > 0) {
    const h = parseFloat(hours[0].replace(/\s/, ''))

    result += `${h}h `
    total += h * 3600000
    hours.shift()
  }

  while (minutes && minutes.length > 0) {
    const m = parseFloat(minutes[0].replace(/\s/, ''))

    result += `${m}m `
    total += m * 60000
    minutes.shift()
  }

  while (secs && secs.length > 0) {
    const s = parseFloat(secs[0].replace(/\s/, ''))

    result += `${s}s `
    total += s * 1000
    secs.shift()
  }

  while (msecs && msecs.length > 0) {
    const ms = parseFloat(msecs[0].replace(/\s/, ''))

    result += `${ms}ms `
    total += ms
    msecs.shift()
  }

  if (total >= 86400000) {
    return [86400000, 'Infinity']
  } else if (total <= -86400000) {
    return [-86400000, '-Infinity']
  } else if (result === '') {
    return [0, '0s']
  } else {
    return [total, result.trim()]
  }
}

export function getColorString(r: number, g: number, b: number) {
  return (
    '#' +
    `0${r.toString(16)}`.slice(-2) +
    `0${g.toString(16)}`.slice(-2) +
    `0${b.toString(16)}`.slice(-2)
  )
}

export function toUint8Array(numbers) {
  const arrayBuffer = new ArrayBuffer(numbers.length)
  const uint8Array = new Uint8Array(arrayBuffer)

  for (const [i, number] of numbers.entries()) {
    uint8Array[i] = number
  }
  return uint8Array
}

export function hexStringToNumberArray(hexString) {
  const numberArray = []

  for (let i = 0; i < hexString.length; i += 2) {
    const hexPair = hexString.substr(i, 2)
    const number = parseInt(hexPair, 16)

    numberArray.push(number)
  }
  return numberArray
}

export function fetchFirmware(url: string): Promise<Uint8Array> {
  return fetch(url)
    .then((response) => {
      return response.arrayBuffer()
    })
    .then((buffer) => {
      return new Uint8Array(buffer)
    })
    .catch((e) => {
      logging.error('Failed to fetch firmware', e)
      throw e
    })
}

//! ==== NODEJS version =====

const COLOR = detectNode()
  ? require('color')
  : (_color: string) => {
      throw 'Color is not supported in browser'
    }

const barvy: { [key: string]: string } = {
  vypnuto: '#000000',
  černá: '#000000',
  bílá: '#ffffff',
  červená: '#ff0000',
  rudá: '#ff0000',
  modrá: '#0000ff',
  zelená: '#00ff00',
  žlutá: '#ffff00',
  růžová: '#ffc0cb',
  fialová: '#ff00ff',
  oranžová: '#ff7700',
  šedá: '#808080',
  hnědá: '#a52a2a',
  azurová: '#b0ffff',
  limetková: '#00ff00',
  mandlová: '#ff6b5d',
  purpurová: '#800080',
  stříbrná: '#c0c0c0',
  tyrkysová: '#40e0d0',
  zlatá: '#ffd700',
  indigo: '#4b0082',
  khaki: '#f0e68c',
  lavendulová: '#e6e6fa',
  měď: '#b87333',
}

const barvyBezHacku: { [key: string]: string } = {
  vypnuto: '#000000',
  cerna: '#000000',
  bila: '#ffffff',
  cervena: '#ff0000',
  ruda: '#ff0000',
  modra: '#0000ff',
  zelena: '#00ff00',
  zluta: '#ffff00',
  ruzova: '#ffc0cb',
  fialova: '#ff00ff',
  oranzova: '#ff7700',
  seda: '#808080',
  hneda: '#a52a2a',
  azurova: '#b0ffff',
  limetkova: '#00ff00',
  mandlova: '#ff6b5d',
  purpurova: '#800080',
  stribrna: '#c0c0c0',
  tyrkysova: '#40e0d0',
  zlata: '#ffd700',
  indigo: '#4b0082',
  khaki: '#f0e68c',
  lavendulova: '#e6e6fa',
  med: '#b87333',
}

export function cssColorToHex(
  color: typeof barvy | typeof barvyBezHacku | string,
) {
  if (typeof color !== 'string' || color.trim() === '') {
    logging.error(`Invalid color type: ${color} (${typeof color})`)
    return null
  }

  if (/^#[\dA-Fa-f]{6}$/.test(color)) {
    return color.toLocaleLowerCase()
  }

  if (color.toLocaleLowerCase() in barvy) {
    return barvy[color]
  }

  if (color.toLocaleLowerCase() in barvyBezHacku) {
    return barvyBezHacku[color]
  }

  // Add a '#' symbol before the hexadecimal color code if it's missing
  if (/^[\dA-Fa-f]{6}$/.test(color)) {
    return `#${color}`.toLocaleLowerCase()
  }

  try {
    const parsedColor = COLOR(color)
    const hexColor = parsedColor.hex()

    return hexColor
  } catch {
    logging.error(`Could not parse color: ${color}`)
    return null
  }
}
