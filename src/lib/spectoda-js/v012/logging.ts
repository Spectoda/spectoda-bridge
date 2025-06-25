/* eslint-disable */
// @ts-nocheck
// TODO: Make Spectoda typesafe

/**
 * @deprecated use logging.LOGGING_LEVEL_NONE */
export const DEBUG_LEVEL_NONE = 0
/**
 * @deprecated use logging.LOGGING_LEVEL_ERROR */
export const DEBUG_LEVEL_ERROR = 1
/**
 * @deprecated use logging.LOGGING_LEVEL_WARN */
export const DEBUG_LEVEL_WARN = 2
/**
 * @deprecated use logging.LOGGING_LEVEL_INFO */
export const DEBUG_LEVEL_INFO = 3
/**
 * @deprecated use logging.LOGGING_LEVEL_DEBUG */
export const DEBUG_LEVEL_DEBUG = 4
/**
 * @deprecated use logging.LOGGING_LEVEL_VERBOSE */
export const DEBUG_LEVEL_VERBOSE = 5

// Logging configuration object
export const logging = {
  LOGGING_LEVEL_NONE: 0,
  LOGGING_LEVEL_ERROR: 1,
  LOGGING_LEVEL_WARN: 2,
  LOGGING_LEVEL_INFO: 3,
  LOGGING_LEVEL_DEBUG: 4,
  LOGGING_LEVEL_VERBOSE: 5,

  level: 5,

  logCallback: console.log,
  warnCallback: console.warn,
  errorCallback: console.error,

  setLoggingLevel: (level: number) => {
    if (level >= 0 && level <= 5) {
      logging.level = level
    }
    logging.log = logging.level >= 0 ? logging.logCallback : () => {}
    logging.error = logging.level >= 1 ? logging.errorCallback : () => {}
    logging.warn = logging.level >= 2 ? logging.warnCallback : () => {}
    logging.info = logging.level >= 3 ? logging.logCallback : () => {}
    logging.debug = logging.level >= 4 ? logging.logCallback : () => {}
    logging.verbose = logging.level >= 5 ? logging.logCallback : () => {}
  },

  /**
   * @deprecated use setLoggingLevel
   */
  setDebugLevel: (level: number) => {
    logging.setLoggingLevel(level)
  },

  setLogCallback(callback: (...msg: any) => void) {
    logging.logCallback = callback
    //? reassing log function to the new callback
    logging.log = logging.level >= 0 ? logging.logCallback : () => {}
    logging.info = logging.level >= 3 ? logging.logCallback : () => {}
    logging.debug = logging.level >= 4 ? logging.logCallback : () => {}
    logging.verbose = logging.level >= 5 ? logging.logCallback : () => {}
  },

  setWarnCallback(callback: (...msg: any) => void) {
    logging.warnCallback = callback
    //? reassing warn function to the new callback
    logging.warn = logging.level >= 2 ? logging.warnCallback : () => {}
  },

  setErrorCallback(callback: (...msg: any) => void) {
    logging.errorCallback = callback
    //? reassing error function to the new callback
    logging.error = logging.level >= 1 ? logging.errorCallback : () => {}
  },

  log: (...msg: any) => logging.logCallback(...msg),
  error: (...msg: any) => logging.errorCallback(...msg),
  warn: (...msg: any) => logging.warnCallback(...msg),
  info: (...msg: any) => logging.logCallback(...msg),
  debug: (...msg: any) => logging.logCallback(...msg),
  verbose: (...msg: any) => logging.logCallback(...msg),
}

logging.setLoggingLevel(3)

if (typeof window !== 'undefined') {
  window.logging = logging
}
