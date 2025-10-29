import { MS_IN_DAY, MS_IN_HOUR, MS_IN_MINUTE, MS_IN_SECOND } from './timeUtils'

// TODO Add unit tests
export const parseDurationToMilliseconds = (value: string): number => {
  if (!value.trim()) {
    return 0
  }

  const timestampRegex = /([+-]?(\d+\.\d+|\d+|\.\d+))\s*(d|h|m(?!s)|s|ms|t)/gi
  let match
  let total = 0

  while ((match = timestampRegex.exec(value)) !== null) {
    const number = parseFloat(match[1])
    const unit = match[3].toLowerCase()

    switch (unit) {
      case 'd':
        total += number * MS_IN_DAY
        break
      case 'h':
        total += number * MS_IN_HOUR
        break
      case 'm':
        total += number * MS_IN_MINUTE
        break
      case 's':
        total += number * MS_IN_SECOND
        break
      case 'ms':
      case 't':
        total += number
        break
    }
  }

  return Math.round(total)
}

// TODO Add unit tests
export const formatMillisecondsToDuration = (ms: number): string => {
  if (ms === 0) {
    return '0s'
  }

  const parts = []

  const days = Math.floor(ms / MS_IN_DAY)

  if (days > 0) {
    parts.push(`${days}d`)
    ms %= MS_IN_DAY
  }

  const hours = Math.floor(ms / MS_IN_HOUR)

  if (hours > 0) {
    parts.push(`${hours}h`)
    ms %= MS_IN_HOUR
  }

  const minutes = Math.floor(ms / MS_IN_MINUTE)

  if (minutes > 0) {
    parts.push(`${minutes}m`)
    ms %= MS_IN_MINUTE
  }

  const seconds = Math.floor(ms / MS_IN_SECOND)

  if (seconds > 0) {
    parts.push(`${seconds}s`)
    ms %= MS_IN_SECOND
  }

  if (ms > 0) {
    parts.push(`${ms}ms`)
  }

  return parts.join(' ')
}

export const validateDurationRange = (
  value: string,
  maxMs = MS_IN_DAY,
): boolean => {
  const ms = parseDurationToMilliseconds(value)

  return !isNaN(ms) && ms >= 0 && ms <= maxMs
}
