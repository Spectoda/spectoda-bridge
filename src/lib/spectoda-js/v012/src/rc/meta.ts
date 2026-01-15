import {
  detectAndroid,
  detectBrave,
  detectBun,
  detectChrome,
  detectDeno,
  detectEdge,
  detectFirefox,
  detectIPhone,
  detectLinux,
  detectMacintosh,
  detectNode,
  detectOpera,
  detectSafari,
  detectSamsungBrowser,
  detectSpectodaConnect,
  detectWindows,
} from '../../functions'
import { getSpectodaVersion } from '../version'

export type RemoteControlClientMeta = {
  platform: string
  browser: string
  userAgent: string
  timestamp: string
  spectodaVersion: {
    wasmFullVersion: string
    jsRevision: number
  }
}

/**
 * Collects metadata about the current platform for remote control.
 * This information is sent to the cloud server and can be viewed by other clients.
 * Used by both senders and receivers.
 */
export const getRemoteControlClientMeta = (): RemoteControlClientMeta => {
  let platform = 'unknown'
  if (detectBun()) {
    platform = 'bun'
  } else if (detectDeno()) {
    platform = 'deno'
  } else if (detectNode()) {
    platform = 'node'
  } else if (detectAndroid()) {
    platform = 'android'
  } else if (detectIPhone()) {
    platform = 'iphone'
  } else if (detectMacintosh()) {
    platform = 'macintosh'
  } else if (detectWindows()) {
    platform = 'windows'
  } else if (detectLinux()) {
    platform = 'linux'
  }

  let browser = 'unknown'
  if (detectSpectodaConnect()) {
    browser = 'spectoda-connect'
  } else if (detectBrave()) {
    browser = 'brave'
  } else if (detectEdge()) {
    browser = 'edge'
  } else if (detectOpera()) {
    browser = 'opera'
  } else if (detectSamsungBrowser()) {
    browser = 'samsung-browser'
  } else if (detectFirefox()) {
    browser = 'firefox'
  } else if (detectChrome()) {
    browser = 'chrome'
  } else if (detectSafari()) {
    browser = 'safari'
  }

  return {
    platform,
    browser,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    timestamp: new Date().toISOString(),
    spectodaVersion: getSpectodaVersion(),
  }
}
