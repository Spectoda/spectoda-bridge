export const MS_IN_SECOND = 1_000
export const MS_IN_MINUTE = 60_000
export const MS_IN_HOUR = 3_600_000
export const MS_IN_DAY = 86_400_000

export const SEC_IN_MINUTE = 60
export const SEC_IN_HOUR = 3_600
export const SEC_IN_DAY = 86_400

export const HOURS_IN_DAY = 24

export const MINS_IN_DAY = HOURS_IN_DAY * SEC_IN_MINUTE

/** @deprecated Use SEC_IN_DAY instead */
export const SECONDS_IN_DAY = SEC_IN_DAY

const DEFAULT_PAD_SIZE = 2
const MAX_HOURS = 23
const MAX_MINUTES = 59
const MILLISECONDS_DISPLAY_DIGITS = 2

const padNumber = (number: number, size = DEFAULT_PAD_SIZE): string => {
  return number.toString().padStart(size, '0')
}

export const formatTime = (
  millis: number,
  output: {
    hours?: boolean
    minutes?: boolean
    seconds?: boolean
    milliseconds?: boolean // only if seconds are defined
    hideNullHours?: boolean
  },
): string => {
  const hours = Math.floor(millis / MS_IN_HOUR)

  millis %= MS_IN_HOUR
  const minutes = Math.floor(millis / MS_IN_MINUTE)

  millis %= MS_IN_MINUTE
  const seconds = Math.floor(millis / MS_IN_SECOND)

  const formattedTime: string[] = []

  if (output.hours && !(output.hideNullHours && hours === 0)) {
    formattedTime.push(padNumber(hours))
  }

  if (output.minutes) {
    formattedTime.push(padNumber(minutes))
  }

  if (output.seconds) {
    let secondsOutput = padNumber(seconds)

    if (output.milliseconds) {
      secondsOutput +=
        '.' +
        (millis % MS_IN_SECOND).toString().slice(0, MILLISECONDS_DISPLAY_DIGITS)
    }

    formattedTime.push(secondsOutput)
  }

  return formattedTime.join(':')
}

export const formatDateTime = formatTime

/**
 * Converts milliseconds from midnight to HH:MM format (24-hour)
 * @param millis - Milliseconds from midnight (0-86400000)
 * @returns Time in HH:MM format (e.g., "09:30", "23:45")
 */
export const formatMillisecondsAsHHMM = (millis: number): string => {
  const hours = Math.floor(millis / MS_IN_HOUR)
  const minutes = Math.floor((millis % MS_IN_HOUR) / MS_IN_MINUTE)

  return `${padNumber(hours)}:${padNumber(minutes)}`
}

/** @deprecated Use formatMillisecondsAsHHMM instead */
export const formatMillisecondsFromMidnight = formatMillisecondsAsHHMM

/** @deprecated Use formatMillisecondsAsHHMM instead */
export const millisecondsToFormattedTime = formatMillisecondsAsHHMM

export const secondsToMilliseconds = (seconds: number): number => {
  return seconds * MS_IN_SECOND
}

export const millisecondsToSeconds = (milliseconds: number): number => {
  return Math.floor(milliseconds / MS_IN_SECOND)
}

/**
 * Parses HH:MM format to milliseconds from midnight
 * @param timeString - Time in HH:MM format (e.g., "09:30", "23:45")
 * @returns Milliseconds from midnight, or NaN if invalid format
 */
export const parseHHMMToMilliseconds = (timeString: string): number => {
  const timePattern = /^(\d{1,2}):(\d{2})$/
  const match = timeString.match(timePattern)

  if (!match) {
    return NaN
  }

  const [, hours, minutes] = match
  const hoursNum = parseInt(hours, 10)
  const minutesNum = parseInt(minutes, 10)

  if (
    hoursNum < 0 ||
    hoursNum > MAX_HOURS ||
    minutesNum < 0 ||
    minutesNum > MAX_MINUTES
  ) {
    return NaN
  }

  return hoursNum * MS_IN_HOUR + minutesNum * MS_IN_MINUTE
}

/** @deprecated Use parseHHMMToMilliseconds instead */
export const formattedTimeToMilliseconds = parseHHMMToMilliseconds

/**
 * Parses a seconds string to milliseconds
 * @param secondsString - Seconds as string (e.g., "30", "3600")
 * @returns Milliseconds, or NaN if invalid or out of range (0-86400 seconds)
 */
export const parseSecondsStringToMilliseconds = (
  secondsString: string,
): number => {
  const seconds = parseInt(secondsString, 10)

  if (isNaN(seconds) || seconds < 0 || seconds > SEC_IN_DAY) {
    return NaN
  }

  return secondsToMilliseconds(seconds)
}

/** @deprecated Use parseSecondsStringToMilliseconds instead */
export const formattedSecondsToMilliseconds = parseSecondsStringToMilliseconds
