import { createNanoEvents } from './functions'

export class TimeTrack {
  constructor(timestamp, paused) {
    this.memory_ = 0
    this.paused_ = false
    this.date_ = '01-01-1970'

    this.eventEmitter_ = createNanoEvents()

    if (paused) {
      this.pauseWithoutEvent()
    }

    if (timestamp) {
      this.setMillisWithoutEvent(timestamp)
    } else {
      this.setMillisWithoutEvent(0)
    }
  }

  millis() {
    if (this.paused_) {
      return this.memory_
    } else {
      return Date.now() - this.memory_
    }
  }

  setDate(date) {
    this.date_ = date
  }

  date() {
    return this.date_
  }

  getDate() {
    return this.date()
  }

  setState(current_timestamp, paused) {
    if ((paused && !this.paused_) || (!paused && this.paused_)) {
      this.paused_ = paused
      this.memory_ = Date.now() - this.memory_
    }

    this.memory_ = this.paused_ ? current_timestamp : Date.now() - current_timestamp
    this.eventEmitter_.emit('change', { target: this })
    // TODO implement event handlers
  }

  setStateWithoutEvent(current_timestamp, paused) {
    if ((paused && !this.paused_) || (!paused && this.paused_)) {
      this.paused_ = paused
      this.memory_ = Date.now() - this.memory_
    }

    this.memory_ = this.paused_ ? current_timestamp : Date.now() - current_timestamp
  }

  setMillis(current_timestamp) {
    this.memory_ = this.paused_ ? current_timestamp : Date.now() - current_timestamp
    this.eventEmitter_.emit('change', { target: this })

    this.eventEmitter_.emit('millis', current_timestamp)
  }

  getMillis() {
    return this.millis()
  }

  setMillisWithoutEvent(current_timestamp) {
    this.memory_ = this.paused_ ? current_timestamp : Date.now() - current_timestamp
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
      this.eventEmitter_.emit('change', { target: this })
    }
    this.eventEmitter_.emit('pause')
  }

  pauseWithoutEvent() {
    if (!this.paused_) {
      this.paused_ = true
      this.memory_ = Date.now() - this.memory_
    }
  }

  unpause() {
    if (this.paused_) {
      this.paused_ = false
      this.memory_ = Date.now() - this.memory_
      this.eventEmitter_.emit('change', { target: this })
    }
    this.eventEmitter_.emit('play')
  }

  unpauseWithoutEvent() {
    if (this.paused_) {
      this.paused_ = false
      this.memory_ = Date.now() - this.memory_
    }
  }

  paused() {
    return this.paused_
  }

  getPaused() {
    return this.paused()
  }

  on() {
    return this.eventEmitter_.on.apply(this.eventEmitter_, arguments)
  }
}
