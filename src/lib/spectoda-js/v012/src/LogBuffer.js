export class LogEntry {
  constructor(level, filename, message, timestamp) {
    this.level = level
    this.filename = filename
    this.message = message
    this.timestamp = timestamp || new Date()
  }
}

export class RingLogBuffer {
  constructor(size) {
    this.size = size
    this.buffer = new Array(size)
    this.start = 0
    this.end = 0
  }

  isFull() {
    return (this.end + 1) % this.size === this.start
  }

  isEmpty() {
    return this.end === this.start
  }

  push(item) {
    this.buffer[this.end] = item
    this.end = (this.end + 1) % this.size

    if (this.isFull()) {
      this.start = (this.start + 1) % this.size
    }
  }

  pop() {
    if (this.isEmpty()) {
      return null
    }

    const item = this.buffer[this.start]

    this.start = (this.start + 1) % this.size
    return item
  }

  // Method to retrieve all logs in the buffer
  getAllLogs() {
    const logs = []
    let start = this.start
    const end = this.end

    while (start !== end) {
      logs.push(this.buffer[start])
      start = (start + 1) % this.size
    }
    return logs
  }

  getAllLogsWithPop() {
    const logs = []

    while (!this.isEmpty()) {
      logs.push(this.pop())
    }
    return logs
  }

  clear() {
    this.start = 0
    this.end = 0
  }
}
