import { FFT } from './dsp.js'
import { createNanoEvents, mapValue, sleep } from './functions'
import { logging } from './logging'

function calculateSensitivityValue(value, sensitivity) {
  return (value * sensitivity) / 100
}

// function lerpUp(a, b, t) {
//   if (b > a) {
//     t *= 5;
//   }
//   return (1 - t) * a + t * b;
// }

export class SpectodaSound {
  #stream
  #gain_node
  #source
  #audioContext
  #bufferedValues
  /**
   * @type {ScriptProcessorNode}
   */
  #script_processor_get_audio_samples
  #events
  #fft
  #sensitivity
  #movingAverageGapValues
  evRate

  #rmsMax
  #rmsMin
  #smoothedOutput
  #peakHold
  #lastLoudnessEmitTime

  // Accumulation for averaging loudness between emissions
  #pendingLoudnessSum
  #pendingLoudnessCount

  // Peak hold for peakTrigger between emissions (keep max, don't miss beats)
  #pendingPeakTriggerMax

  // Smoothed peak trigger output (envelope follower for smoother decay)
  #smoothedPeakTrigger

  // Old algorithm state for peak trigger (used for auto-switching colors/effects)
  #oldRmsMax
  #oldRmsMin

  // Emit loudness at 20 times per second (50ms) to match WASM UPS of 20
  static LOUDNESS_EMIT_INTERVAL_MS = 50

  constructor() {
    this.running = false
    this.#source = null
    this.#gain_node = null
    this.#script_processor_get_audio_samples = null
    this.BUFF_SIZE = 4096
    this.#audioContext = null
    this.#stream = null
    this.#fft = null
    this.#bufferedValues = []
    this.#movingAverageGapValues = []
    this.#sensitivity = 100
    this.evRate = 100
    this.lastValue = 0
    this.silentCountdown
    /**
     * @type {"static"|"dynamic"}
     */
    this.evRateType = 'dynamic'

    this.#events = createNanoEvents()

    this.#rmsMax = 0.01
    this.#rmsMin = 0
    this.#smoothedOutput = 0
    this.#peakHold = 0
    this.#lastLoudnessEmitTime = 0

    // Accumulation for averaging loudness between emissions
    this.#pendingLoudnessSum = 0
    this.#pendingLoudnessCount = 0

    // Peak hold for peakTrigger between emissions
    this.#pendingPeakTriggerMax = 0

    // Smoothed peak trigger (envelope follower)
    this.#smoothedPeakTrigger = 0

    // Old algorithm state (slow adaptation = easier to reach 100)
    this.#oldRmsMax = 0.01
    this.#oldRmsMin = 0
  }

  /**
   *
   * @param {MediaStream|"microphone"|"system"} mediaStream
   */
  async connect(mediaStream = null) {
    // Uává velikost bloků ze kterých bude vypočítávána průměrná hlasitos.
    // Maximální velikost je 2048 vzorků.
    // Hodnota musí být vždy násobkem dvou.
    // Pokud bude buffer menší bude se také rychleji posílat výpočet efektivní hodnoty.
    if (!this.#audioContext) {
      this.#audioContext = new AudioContext()
    }
    if (!mediaStream || mediaStream === 'microphone') {
      // Dotaz na povolení přístupu k mikrofonu
      if (navigator.mediaDevices) {
        const constraints = (window.constraints = {
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            deviceId: undefined,
            channelCount: 1,
            sampleRate: 44100,
            sampleSize: 64,
            volume: 1,
          },
          video: false,
        })

        await new Promise((resolve, reject) => {
          navigator.mediaDevices
            .getUserMedia(constraints)
            .then((stream) => {
              this.#stream = stream
              this.#source = this.#audioContext.createMediaStreamSource(
                this.#stream,
              )
              resolve()
              logging.debug('SpectodaSound.connect', 'Connected microphone')
            })
            .catch((e) => {
              reject(e)
              // Do not throw here - it creates an unhandled rejection even if the
              // outer promise is properly awaited/caught by the caller.
            })
        })
        logging.info('Connected Mic')
        // await new Promise((resolve, reject) => { navigator.mediaDevices.getUserMedia(constraints).then(resolve).catch(reject)) };
      } else {
        // TODO - check, tato chyba možná vzniká jinak. Navíc ta chyba nemusí být bluefy only
        throw 'MicAccessDenied'
      }
    } else if (!mediaStream || mediaStream === 'system') {
      const gdmOptions = {
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        },
      }
      let videoEl

      if (document.querySelector('#spectoda_video_system')) {
        videoEl = document.querySelector('#spectoda_video_system')
      } else {
        videoEl = document.createElement('video')
        videoEl.id = 'spectoda_video_system'
        document.body.appendChild(videoEl)
      }

      await new Promise(async (resolve, reject) => {
        const _srcObject = await navigator.mediaDevices
          .getDisplayMedia(gdmOptions)
          .then((stream) => {
            this.#stream = stream
            this.#source = this.#audioContext.createMediaStreamSource(
              this.#stream,
            )
            resolve()
            logging.debug('SpectodaSound.connect', 'Connected SystemSound')
          })
          .catch((e) => {
            reject(e)
            // Do not throw here - it creates an unhandled rejection even if the
            // outer promise is properly awaited/caught by the caller.
          })
      })
    } else {
      this.#stream = mediaStream
      this.#source = this.#audioContext.createMediaStreamSource(mediaStream)
      logging.debug('SpectodaSound.connect', 'Connected mediaStream')
      logging.info('Connected mediaStream')
    }
  }

  async start() {
    if (!this.#stream) {
      this.startCountDown()
      await this.connect()
    }
    if (!this.running) {
      this.#gain_node = this.#audioContext.createGain()
      this.#gain_node.connect(this.#audioContext.destination)

      // TODO use audio worklet https://developer.chrome.com/blog/audio-worklet/
      this.#script_processor_get_audio_samples =
        this.#audioContext.createScriptProcessor(this.BUFF_SIZE, 1, 1)
      this.#script_processor_get_audio_samples.connect(this.#gain_node)

      logging.info(`Sample rate of soundcard: ${this.#audioContext.sampleRate}`)
      this.#fft = new FFT(this.BUFF_SIZE, this.#audioContext.sampleRate)

      this.#source.connect(this.#script_processor_get_audio_samples)

      // TODO - this should be handled better
      this.running = true
      // var bufferCount = 0;

      logging.debug('running samples', this.BUFF_SIZE)

      // Tato funkce se provede pokaždé když dojde k naplnění bufferu o velikosti 2048 vzorků.
      // Při vzorkovacím kmitočku 48 kHz se tedy zavolá jednou za cca 42 ms.

      this.#script_processor_get_audio_samples.addEventListener(
        'audioprocess',
        this.processHandler.bind(this),
      )
    }
  }

  stop() {
    this.running = false
  }

  on(...args) {
    return this.#events.on(...args)
  }

  getBufferedDataAverage() {
    if (this.#bufferedValues.length > 0) {
      const value =
        this.#bufferedValues.reduce((p, v) => p + v) /
        this.#bufferedValues.length

      this.#bufferedValues = []

      // value = lerpUp(this.lastValue, value, 0.2);
      this.lastValue = value

      return { value }
    }
  }

  calcEventGap() {
    let gapValues = [...this.#movingAverageGapValues]
    let evRate

    if (gapValues.length > 0) {
      gapValues = gapValues.map((v) => v - gapValues[0])
      for (let i = 0; i < gapValues.length; i++) {
        gapValues[i + 1] -= gapValues[i]
      }
      evRate = gapValues.reduce((p, v) => p + v) / gapValues.length
      this.evRate = evRate
      return evRate
    }
    evRate = evRate > 20 ? evRate : 20
  }

  /**
   *
   * @param {Function} func
   */
  async autoEmitFunctionValue(func) {
    const data = this.getBufferedDataAverage()

    if (data) {
      func(calculateSensitivityValue(data.value, this.#sensitivity)).finally(
        () => this.autoEmitFunctionValue(func),
      )
    } else {
      if (this.running) {
        sleep(10).finally(() => this.autoEmitFunctionValue(func))
      }
    }
  }

  setBuffSize(size) {
    return (this.BUFF_SIZE = size)
  }

  setSensitivity(value) {
    this.#sensitivity = value
  }

  startCountDown() {
    clearTimeout(this.silentCountdown)
    this.silentCountdown = setTimeout(() => {
      // this.#events.emit("silent", true);
      this.#rmsMax = 0.001
      this.#rmsMin = 0
      this.#smoothedOutput = 0
      this.#peakHold = 0
      this.#smoothedPeakTrigger = 0
      // Reset old algorithm state too
      this.#oldRmsMax = 0.01
      this.#oldRmsMin = 0
      // Reset accumulators
      this.#pendingLoudnessSum = 0
      this.#pendingLoudnessCount = 0
      this.#pendingPeakTriggerMax = 0
    }, 600)
  }

  resetSilentCountdown() {
    clearTimeout(this.silentCountdown)
    this.silentCountdown = setTimeout(() => {
      // this.#events.emit("silent", true);
      this.#rmsMax = 0.001
      this.#rmsMin = 0
      this.#smoothedOutput = 0
      this.#peakHold = 0
      this.#smoothedPeakTrigger = 0
      // Reset old algorithm state too
      this.#oldRmsMax = 0.01
      this.#oldRmsMin = 0
      // Reset accumulators
      this.#pendingLoudnessSum = 0
      this.#pendingLoudnessCount = 0
      this.#pendingPeakTriggerMax = 0
    }, 600)

    // this.#events.emit("silent", false);
  }

  processHandler(e) {
    const samples = e.inputBuffer.getChannelData(0)
    const sampleRate = this.#audioContext.sampleRate

    this.#fft.forward(samples)
    const spectrum = this.#fft.spectrum
    const spectrumLength = spectrum.length

    // Calculate frequency per bin: (sampleRate / 2) / spectrumLength
    const freqPerBin = sampleRate / 2 / spectrumLength

    // Weighted RMS focusing on different frequency bands
    // Bass (20-150Hz) - for the "thump"
    // Mid (150-2000Hz) - for the "body" and rhythm
    // High (2000-8000Hz) - for the "snap" and transients
    let bassEnergy = 0
    let midEnergy = 0
    let highEnergy = 0
    let bassCount = 0
    let midCount = 0
    let highCount = 0

    for (let i = 0; i < spectrumLength; i++) {
      const freq = i * freqPerBin
      const energy = spectrum[i] ** 2

      if (freq >= 20 && freq < 150) {
        bassEnergy += energy
        bassCount++
      } else if (freq >= 150 && freq < 2000) {
        midEnergy += energy
        midCount++
      } else if (freq >= 2000 && freq < 8000) {
        highEnergy += energy
        highCount++
      }
    }

    // Normalize by bin count to get average energy per band
    bassEnergy = bassCount > 0 ? Math.sqrt(bassEnergy / bassCount) : 0
    midEnergy = midCount > 0 ? Math.sqrt(midEnergy / midCount) : 0
    highEnergy = highCount > 0 ? Math.sqrt(highEnergy / highCount) : 0

    // Weighted combination: emphasize bass and highs for more dynamic beat response
    // Bass gives the "thump", mids give body, highs give transient "snap"
    const weightedRms = bassEnergy * 0.4 + midEnergy * 0.35 + highEnergy * 0.25

    // === Dynamic range adaptation (fast adaptation for more dynamics) ===

    // Fast attack for max (instant response to peaks)
    if (weightedRms > this.#rmsMax) {
      this.#rmsMax = weightedRms
    }

    // Fast decay for max (adapts to quieter sections quickly for more dynamics)
    // ~85ms per callback at 48kHz with 4096 buffer
    this.#rmsMax *= 0.985 // Faster decay = more dynamic response

    // Keep minimum reasonable range
    if (this.#rmsMax < 0.001) {
      this.#rmsMax = 0.001
    }

    // Faster adaptation for min (tracks volume changes quickly)
    if (weightedRms < this.#rmsMin || this.#rmsMin === 0) {
      this.#rmsMin = weightedRms
    }
    // Raise min faster to track noise floor changes
    this.#rmsMin = this.#rmsMin * 0.995 + weightedRms * 0.005

    // Ensure min doesn't exceed max (with tighter range for more dynamics)
    if (this.#rmsMin > this.#rmsMax * 0.3) {
      this.#rmsMin = this.#rmsMax * 0.3
    }

    // === Mapping with less compression for more dynamics ===

    // Linear map to 0-1 range first
    const range = this.#rmsMax - this.#rmsMin
    let normalized = range > 0 ? (weightedRms - this.#rmsMin) / range : 0
    normalized = Math.max(0, Math.min(1, normalized))

    // Apply less aggressive curve - closer to linear for more dynamic range
    // 0.75 keeps more of the original dynamics while still boosting quiet parts slightly
    const curved = normalized ** 0.75

    // === Envelope follower (fast attack, faster release for more dynamics) ===
    const attackCoeff = 0.85 // Very fast attack - instant transient response
    const releaseCoeff = 0.25 // Faster release - more dynamic decay

    if (curved > this.#smoothedOutput) {
      // Attack: quickly follow rising signal
      this.#smoothedOutput =
        this.#smoothedOutput * (1 - attackCoeff) + curved * attackCoeff
    } else {
      // Release: follow falling signal (faster = more dynamic)
      this.#smoothedOutput =
        this.#smoothedOutput * (1 - releaseCoeff) + curved * releaseCoeff
    }

    // === Peak detection for extra "punch" ===
    // Track recent peak and add a boost when we hit a new peak
    if (curved > this.#peakHold) {
      this.#peakHold = curved
    } else {
      this.#peakHold *= 0.88 // Faster decay = more frequent peak boosts
    }

    // Blend smoothed output with peak detection for extra punch
    const peakBoost = Math.max(0, curved - this.#smoothedOutput) * 0.7 // More peak boost
    const finalOutput = Math.min(1, this.#smoothedOutput + peakBoost)

    // Convert to 0-100 range
    const out = finalOutput * 100

    // === OLD ALGORITHM for peakTrigger (used for auto-switching colors/effects) ===
    // This uses slow dynamic range adaptation, making it easier to reach 100 on peaks

    // Calculate simple RMS of entire spectrum (old method)
    let rmsLoudnessSpectrum = 0
    for (let i = 0; i < spectrumLength; i++) {
      rmsLoudnessSpectrum += spectrum[i] ** 2
    }
    rmsLoudnessSpectrum = Math.sqrt(rmsLoudnessSpectrum)

    // Very slow boundary adaptation
    if (this.#oldRmsMin < this.#oldRmsMax - 0.01) {
      this.#oldRmsMin += 0.0001
    }

    if (this.#oldRmsMax >= 0.01) {
      this.#oldRmsMax -= this.#oldRmsMax / 1000
    }

    if (this.#oldRmsMax - this.#oldRmsMin < 0.01) {
      this.#oldRmsMin = this.#oldRmsMax - 0.01
    }

    if (this.#oldRmsMax < 0.01) {
      this.#oldRmsMax = 0.01
    }

    if (this.#oldRmsMin < 0.0) {
      this.#oldRmsMin = 0.0
    }

    if (rmsLoudnessSpectrum < this.#oldRmsMin) {
      this.#oldRmsMin = rmsLoudnessSpectrum
    }

    if (rmsLoudnessSpectrum > this.#oldRmsMax) {
      this.#oldRmsMax = rmsLoudnessSpectrum
    }

    // Linear mapping (old method) - easier to reach 100
    const rawPeakTrigger = mapValue(
      rmsLoudnessSpectrum,
      this.#oldRmsMin,
      this.#oldRmsMax,
      0.0,
      100.0,
    )

    // === Envelope follower for peakTrigger (fast attack, SLOW release) ===
    // This makes the visualization much smoother and less chaotic
    const peakAttackCoeff = 0.99 // Fast attack - respond to peaks
    const peakReleaseCoeff = 0.05 // Very slow release - smooth decay over ~1-2 seconds

    if (rawPeakTrigger > this.#smoothedPeakTrigger) {
      // Attack: quickly follow rising signal
      this.#smoothedPeakTrigger =
        this.#smoothedPeakTrigger * (1 - peakAttackCoeff) +
        rawPeakTrigger * peakAttackCoeff
    } else {
      // Release: slowly follow falling signal
      this.#smoothedPeakTrigger =
        this.#smoothedPeakTrigger * (1 - peakReleaseCoeff) +
        rawPeakTrigger * peakReleaseCoeff
    }

    const peakTriggerValue = this.#smoothedPeakTrigger

    // Accumulate values for averaging/peak-holding between emissions
    this.#pendingLoudnessSum += out
    this.#pendingLoudnessCount++

    // Track max peakTrigger value (don't miss peaks for auto-switching)
    if (peakTriggerValue > this.#pendingPeakTriggerMax) {
      this.#pendingPeakTriggerMax = peakTriggerValue
    }

    // Emit at fixed intervals to match WASM processing rate
    const now = Date.now()
    if (
      now - this.#lastLoudnessEmitTime >=
      SpectodaSound.LOUDNESS_EMIT_INTERVAL_MS
    ) {
      this.#lastLoudnessEmitTime = now

      // Emit average loudness (smoother visualization)
      const avgLoudness =
        this.#pendingLoudnessCount > 0
          ? this.#pendingLoudnessSum / this.#pendingLoudnessCount
          : out
      this.#events.emit('loudness', avgLoudness)

      // Emit max peakTrigger (don't miss beats for auto-switching)
      this.#events.emit('peakTrigger', this.#pendingPeakTriggerMax)

      // Reset accumulators
      this.#pendingLoudnessSum = 0
      this.#pendingLoudnessCount = 0
      this.#pendingPeakTriggerMax = 0
    }

    if (out > 1.0) {
      this.resetSilentCountdown()
    }

    this.#bufferedValues.push(out)
    this.#movingAverageGapValues.push(now)

    if (this.#bufferedValues.length > 5) {
      this.#bufferedValues.splice(0, 1)
    }
    if (this.#movingAverageGapValues.length > 100) {
      this.#movingAverageGapValues.splice(0, 1)
    }

    if (!this.running) {
      this.#source.disconnect()
      this.#gain_node.disconnect()
    }
  }

  /**
   *
   * @returns {ScriptProcessorNode}
   */

  getScriptProcessorNode() {
    return this.#script_processor_get_audio_samples
  }

  /**
   *
   * @returns {MediaStreamAudioSourceNode}
   */
  getSource() {
    return this.#source
  }

  /**
   *
   * @returns {MediaStream}
   */
  getStream() {
    return this.#stream
  }
  // this.#events.emit('control', {
  //   type: 'loudness',
  //   value: value
  // });

  getAudioContext() {
    return this.#audioContext
  }
}
