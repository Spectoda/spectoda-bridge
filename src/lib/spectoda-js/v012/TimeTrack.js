/**
 * TimeTrack class - manages timeline state (millis, paused, date)
 * Note: This class does not emit events. Use TIMELINE_UPDATE event from Spectoda instead.
 */
export class TimeTrack {
  constructor(timestamp, paused) {
    this.memory_ = 0
    this.paused_ = false
    this.date_ = '01-01-1970'

    if (paused) {
      this.pause()
    }

    if (timestamp) {
      this.setMillis(timestamp)
    } else {
      this.setMillis(0)
    }
  }

  millis() {
    if (this.paused_) {
      return this.memory_
    } else {
      return Date.now() - this.memory_
    }
  }

  getMillis() {
    return this.millis()
  }

  setMillis(currentTimestamp) {
    this.memory_ = this.paused_
      ? currentTimestamp
      : Date.now() - currentTimestamp
  }

  date() {
    return this.date_
  }

  getDate() {
    return this.date_
  }

  setDate(date) {
    this.date_ = date
  }

  paused() {
    return this.paused_
  }

  getPaused() {
    return this.paused_
  }

  setPaused(paused) {
    if (paused) {
      this.pause()
    } else {
      this.unpause()
    }
  }

  pause() {
    if (!this.paused_) {
      this.paused_ = true
      this.memory_ = Date.now() - this.memory_
    }
  }

  unpause() {
    if (this.paused_) {
      this.paused_ = false
      this.memory_ = Date.now() - this.memory_
    }
  }

  setState(currentTimestamp, paused) {
    if ((paused && !this.paused_) || (!paused && this.paused_)) {
      this.paused_ = paused
      this.memory_ = Date.now() - this.memory_
    }

    this.memory_ = this.paused_
      ? currentTimestamp
      : Date.now() - currentTimestamp
  }
}
