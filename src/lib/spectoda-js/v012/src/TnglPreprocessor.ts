import { logging } from '../logging'
import { fetchTnglFromApiById, sendTnglToApi } from '../tnglapi'
import { JS_EVENT_VALUE_LIMITS as VALUE_LIMITS } from './constants/limits'
import { VALUE_TYPES, type ValueType } from './constants/values'
import { tnglDefinitionsFromJsonToTngl } from './Preprocessor'
import type { EventState } from './schemas/event'

export const preprocessTngl = async (tnglCode: string) => {
  logging.debug(`Spectoda::preprocessTngl(tngl_code.length=${tnglCode.length})`)
  logging.verbose('tngl_code', tnglCode)

  logging.info('> Preprocessing TNGL code...')

  /**
   * Formats a value according to its type for TNGL usage.
   * TODO move this function to some kind of utils?
   *
   * @param type The numeric type code
   * @param rawValue The raw value as given in the event
   * @returns The correctly formatted TNGL-compatible string
   */
  function formatValue(type: ValueType, rawValue: any) {
    switch (type) {
      case VALUE_TYPES.COLOR: {
        // Ensure a leading "#" and normalize to lowercase
        // e.g. "bf1d1d" -> "#bf1d1d"
        //      "#00FF0a" -> "#00ff0a"
        const colorStr = String(rawValue).replace(/^#/, '').toLowerCase()

        return `#${colorStr}`
      }
      case VALUE_TYPES.LABEL:
        // e.g. "evt" -> "$evt"
        return `$${rawValue}`
      case VALUE_TYPES.PERCENTAGE:
        // Keep floating points, e.g. -20.34 => "-20.34%"
        // parseFloat to ensure a valid numeric string (but keep decimals if present)
        return `${parseFloat(rawValue)}%`
      case VALUE_TYPES.TIMESTAMP:
        // No floating points; parse as integer, then add "ms"
        // e.g. 1000.123 => "1000ms"
        return `${parseInt(rawValue, 10)}ms`
      case VALUE_TYPES.NULL:
        return 'null'
      case VALUE_TYPES.UNDEFINED:
        return 'undefined'
      case VALUE_TYPES.BOOLEAN:
        // e.g. true => "true", false => "false"
        return String(rawValue)
      case VALUE_TYPES.PIXELS:
        // No floating points; parse as integer, then add "px"
        return `${parseInt(rawValue, 10)}px`
      case VALUE_TYPES.NUMBER:
        // No floating points; parse as integer
        return String(parseInt(rawValue, 10))
      case VALUE_TYPES.DATE:
        // Leave the date string as-is, e.g. "2023-09-21"
        return String(rawValue)
      default:
        // Fallback for any unrecognized type
        return String(rawValue)
    }
  }

  /**
   * Helper function to parse timestamp strings and convert them to total milliseconds/tics.
   * TODO move this function to some kind of utils?
   *
   * @param value The timestamp string (e.g., "1.2d+9h2m7.2s-123t").
   * @returns The total time in milliseconds/tics.
   */
  function computeTimestamp(value: string): number {
    if (!value) {
      return 0 // Equivalent to CONST_TIMESTAMP_0
    }

    value = value.trim()

    const timestampRegex = /([+-]?(\d+\.\d+|\d+|\.\d+))\s*(d|h|m(?!s)|s|ms|t)/gi
    let match
    let total = 0

    while ((match = timestampRegex.exec(value)) !== null) {
      const number = parseFloat(match[1])
      const unit = match[3].toLowerCase()

      switch (unit) {
        case 'd': {
          total += number * 86400000 // 24*60*60*1000
          break
        }
        case 'h': {
          total += number * 3600000 // 60*60*1000
          break
        }
        case 'm': {
          total += number * 60000 // 60*1000
          break
        }
        case 's': {
          total += number * 1000 // 1000
          break
        }
        case 'ms':
        case 't': {
          total += number
          break
        }
        default: {
          logging.error('Error while parsing timestamp: Unknown unit', unit)
          break
        }
      }
    }

    if (total >= VALUE_LIMITS.TIMESTAMP_MAX) {
      return VALUE_LIMITS.TIMESTAMP_MAX // Equivalent to CONST_TIMESTAMP_INFINITY
    } else if (total <= VALUE_LIMITS.TIMESTAMP_MIN) {
      return VALUE_LIMITS.TIMESTAMP_MIN // Equivalent to CONST_TIMESTAMP_MINUS_INFINITY
    } else if (total === 0) {
      return 0 // Equivalent to CONST_TIMESTAMP_0
    } else {
      return Math.round(total) // Ensure it's an integer (int32_t)
    }
  }

  /**
   * Helper function to minify BERRY code by removing # comments, specific patterns, and unnecessary whitespace.
   * TODO move this function to some kind of utils?
   *
   * @param berryCode The BERRY code to minify.
   * @returns The minified BERRY code.
   */
  function preprocessBerry(berryCode: string): string {
    let minified = berryCode

    // Step 0: Determine flags
    let flagNoMinify = false
    let flagMinify = false

    if (minified.includes('@no-minify')) {
      minified = minified.replace('@no-minify', '')
      flagNoMinify = true
    }

    if (minified.includes('@minify')) {
      minified = minified.replace('@minify', '')
      flagMinify = true
    }

    /**
     * Step 1: Define the enum constants to replace in Berry code
     *
     * This creates a mapping of constant names to their numeric values
     * that will be used to replace occurrences in the Berry code during minification.
     *
     * Two types of constants are defined:
     *
     * a. Value type constants from VALUE_TYPES:
     *    - 'NUMBER' will be replaced with '29'
     *    - 'PERCENTAGE' will be replaced with '30'
     *    - 'LABEL' will be replaced with '31'
     *    - 'TIMESTAMP' will be replaced with '32'
     *    - 'BOOLEAN' will be replaced with '2'
     *    - etc.
     *
     * b. Device ID constants (ID0-ID255):
     *    - 'ID0' will be replaced with '0'
     *    - 'ID1' will be replaced with '1'
     *    - 'ID2' will be replaced with '2'
     *    - And so on up to ID255
     *
     * This allows Berry scripts to use readable constant names while
     * the minified version uses the actual numeric values for better performance.
     */
    const berryDefines: { [key: string]: string } = {}

    // a. Keys of VALUE_TYPES as string keys in berryDefines are being replaced with their numeric values
    Object.keys(VALUE_TYPES).forEach((key) => {
      berryDefines[key] =
        VALUE_TYPES[key as keyof typeof VALUE_TYPES].toString()
    })

    // b. ID0-ID255 constants are being replaced with their numeric values
    for (let i = 0; i <= 255; i++) {
      berryDefines[`ID${i}`] = i.toString()
    }

    // Step 2: First pass - Remove comments while preserving string literals
    let result = ''
    let i = 0
    let inSingleQuoteString = false
    let inDoubleQuoteString = false
    let inLineComment = false
    let inMultilineComment = false
    let escaped = false

    while (i < minified.length) {
      const char = minified[i]
      const nextChar = i + 1 < minified.length ? minified[i + 1] : ''

      // Handle escape sequences in strings
      if (escaped) {
        if (inSingleQuoteString || inDoubleQuoteString) {
          result += char
        }
        escaped = false
        i++
        continue
      }

      if (char === '\\' && (inSingleQuoteString || inDoubleQuoteString)) {
        result += char
        escaped = true
        i++
        continue
      }

      // Handle string boundaries
      if (
        char === '"' &&
        !inSingleQuoteString &&
        !inMultilineComment &&
        !inLineComment
      ) {
        inDoubleQuoteString = !inDoubleQuoteString
        result += char
        i++
        continue
      }

      if (
        char === "'" &&
        !inDoubleQuoteString &&
        !inMultilineComment &&
        !inLineComment
      ) {
        inSingleQuoteString = !inSingleQuoteString
        result += char
        i++
        continue
      }

      // Inside strings, just copy characters
      if (inSingleQuoteString || inDoubleQuoteString) {
        result += char
        i++
        continue
      }

      // Handle comments
      if (
        char === '#' &&
        nextChar === '-' &&
        !inLineComment &&
        !inMultilineComment
      ) {
        inMultilineComment = true
        i += 2 // Skip '#-'
        continue
      }

      if (char === '-' && nextChar === '#' && inMultilineComment) {
        inMultilineComment = false
        i += 2 // Skip '-#'
        continue
      }

      if (char === '#' && !inMultilineComment && !inLineComment) {
        inLineComment = true
        i++
        continue
      }

      if ((char === '\n' || char === '\r') && inLineComment) {
        inLineComment = false
        result += char // Keep the newline
        i++
        continue
      }

      // Skip characters in comments
      if (inLineComment || inMultilineComment) {
        i++
        continue
      }

      // Add non-comment characters
      result += char
      i++
    }

    minified = result

    // Step 3: Now apply the pattern replacements (after comments are removed)
    // // // Pattern A: Hex Color Codes - /#[0-9a-f]{6}/i
    // // const colorRegex = /#([\da-f]{6})/gi

    // // minified = minified.replace(colorRegex, (match, p1) => {
    // //   return `Value.Color("${p1.toLowerCase()}")`
    // // })

    // Pattern B: Timestamps - /([+-]?(\d+\.\d+|\d+|\.\d+))(d|h|m(?!s)|s|ms|t)\b/gi
    const timestampRegex =
      /([+-]?(?:\d+\.\d+|\d+|\.\d+))(d|h|m(?!s)|s|ms|t)\b/gi

    minified = minified.replace(timestampRegex, (match) => {
      const milliseconds = computeTimestamp(match)

      return `Value.Timestamp(${milliseconds})`
    })

    // // // Pattern C: Labels - /\$[\w]+/
    // // const labelRegex = /\$(\w+)/g

    // // minified = minified.replace(labelRegex, (match, p1) => {
    // //   return `Value.Label("${p1}")`
    // // })

    // Pattern D: Percentages - /[+-]?\d+(\.\d+)?%/
    const percentageRegex = /([+-]?\d+(\.\d+)?)%/g

    minified = minified.replace(percentageRegex, (_match, p1) => {
      return `Value.Percentage(${parseFloat(p1)})`
    })

    // // // Pattern F: null value
    // // const nullRegex = /\bnull\b/g

    // // minified = minified.replace(nullRegex, () => {
    // //   return 'Value.Null()'
    // // })

    // Step 4: Third pass - Replace enum constants with their values (only outside strings)
    result = ''
    i = 0
    inSingleQuoteString = false
    inDoubleQuoteString = false
    escaped = false
    let token = ''

    while (i < minified.length) {
      const char = minified[i]

      // Handle escape sequences in strings
      if (escaped) {
        result += char
        escaped = false
        i++
        continue
      }

      if (char === '\\' && (inSingleQuoteString || inDoubleQuoteString)) {
        result += char
        escaped = true
        i++
        continue
      }

      // Handle string boundaries
      if (char === '"' && !inSingleQuoteString) {
        inDoubleQuoteString = !inDoubleQuoteString
        result += char
        i++
        continue
      }

      if (char === "'" && !inDoubleQuoteString) {
        inSingleQuoteString = !inSingleQuoteString
        result += char
        i++
        continue
      }

      // Inside strings, just copy characters
      if (inSingleQuoteString || inDoubleQuoteString) {
        result += char
        i++
        continue
      }

      // If the character is alphanumeric or underscore, it could be part of an identifier
      if (/[A-Za-z0-9_]/.test(char)) {
        token += char
        i++
      } else {
        // Check if the token is a defined constant
        if (token && token in berryDefines) {
          result += berryDefines[token]
        } else if (token) {
          result += token
        }

        // Add the current character
        result += char
        token = ''
        i++
      }
    }

    // Handle any remaining token
    if (token && token in berryDefines) {
      result += berryDefines[token]
    } else if (token) {
      result += token
    }

    minified = result

    // Step 5: Fix any remaining ID references in strings
    // This ensures that "ID1" in string literals like "<EventState $test[ID1]: <Value 42>>" is preserved
    minified = minified.replace(/(\[)ID(\d+)(\])/g, '$1ID$2$3')

    // Step 6: Remove unnecessary semicolons
    minified = minified.replace(/;+/g, ' ')

    // Step 7: Minify variable names if @minify flag is present
    if (flagMinify && !flagNoMinify) {
      // Set to store all local variable names found
      const localVars = new Set<string>()

      // Extract variable declarations with "var"
      const varRegex = /var\s+([A-Za-z_][A-Za-z0-9_]*)/g
      let match

      while ((match = varRegex.exec(minified)) !== null) {
        localVars.add(match[1])
      }

      // Extract loop variables from "for" loops
      const forRegex = /for\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g

      while ((match = forRegex.exec(minified)) !== null) {
        localVars.add(match[1])
      }

      // Create short name generator
      function* shortNameGenerator() {
        const letters = 'abcdefghijklmnopqrstuvwxyz'
        let length = 1

        while (true) {
          const max = letters.length ** length

          for (let i = 0; i < max; i++) {
            let name = ''
            let num = i

            for (let j = 0; j < length; j++) {
              name = letters[num % letters.length] + name
              num = Math.floor(num / letters.length)
            }
            yield name
          }
          length++
        }
      }

      // Build mapping of original names to minified names
      const gen = shortNameGenerator()
      const mapping: { [key: string]: string } = {}

      for (const origVar of localVars) {
        mapping[origVar] = gen.next().value as string
      }

      // Replace all occurrences of the variables, but not within strings
      for (const [orig, min] of Object.entries(mapping)) {
        // This regex matches the variable name only when it's not inside quotes
        const idRegex = new RegExp(
          `\\b${orig}\\b(?=(?:[^"']*["'][^"']*["'])*[^"']*$)`,
          'g',
        )

        minified = minified.replace(idRegex, min)
      }
    }

    // Step 8: Remove spaces around specific characters (if not @no-minify)
    if (!flagNoMinify) {
      // Remove spaces before and after specific characters
      const charsToRemoveSpaceAround = [
        ';',
        ',',
        '{',
        '}',
        '(',
        ')',
        '=',
        '<',
        '>',
        '+',
        '-',
        '*',
        '/',
        '%',
        '&',
        '|',
        '!',
        ':',
        '?',
      ]

      for (const char of charsToRemoveSpaceAround) {
        // Remove space before the character
        const beforeRegex = new RegExp(`\\s+\\${char}`, 'g')

        minified = minified.replace(beforeRegex, char)

        // Remove space after the character
        const afterRegex = new RegExp(`\\${char}\\s+`, 'g')

        minified = minified.replace(afterRegex, char)
      }
    }

    return minified
  }

  /**
   * Converts an array of event objects to TNGL chains, grouped by `id`.
   * TODO move this function to some kind of utils?
   *
   * Output:
   *   - One chain per ID, each beginning with `onEventStateSet<IDxxx>($sceneName)`.
   *   - For each event:
   *       * If type/value differs from the previous event, emit `.setValue(formattedValue)`.
   *       * Then emit `.setEventState($label)`.
   *   - The events for each ID appear in the exact order encountered in the array.
   *   - Final output orders IDs from largest to smallest.
   *
   * @param sceneName The name of the scene (for onEventStateSet<IDxxx>($sceneName))
   * @param events The JSON array of events
   *   Each event is an object: { type, value, id, label, timestamp }
   * @returns The joined TNGL output (one chain per line)
   */
  function convertEventsToTnglChains(sceneName: string, events: EventState[]) {
    // Group events by ID while preserving their relative order
    const eventsById: Record<number, EventState[]> = {}

    for (const evt of events) {
      if (!eventsById[evt.id]) {
        eventsById[evt.id] = []
      }
      eventsById[evt.id].push(evt)
    }

    // Sort IDs descending
    const sortedIds = Object.keys(eventsById)
      .map((id) => parseInt(id, 10))
      .sort((a, b) => b - a)

    // Build one chain per ID (descending ID order)
    const chains = sortedIds.map((id) => {
      const eventList = eventsById[id]
      let chain = `onEventStateSet<ID${id}>($${sceneName})`

      let lastType = null
      let lastValue = null

      for (const e of eventList) {
        const currentFormattedValue = formatValue(e.type, e.value)

        // If (type, value) changed from last time, setValue
        if (e.type !== lastType || e.value !== lastValue) {
          chain += `.setValue(${currentFormattedValue})`
          lastType = e.type
          lastValue = e.value
        }

        // Always setEventState($label) after setValue
        chain += `.setEventState($${e.label})`
      }

      chain += ';'
      return chain
    })

    // Return all chains, separated by newlines
    return chains.join('\n')
  }

  /**
   * Helper function to remove comments from TNGL code while preserving string literals
   * @param code The TNGL code with comments
   * @returns The TNGL code with comments removed
   */
  function removeNonBerryComments(code: string): string {
    let result = ''
    let i = 0
    let inSingleQuoteString = false
    let inDoubleQuoteString = false
    let inSingleLineComment = false
    let inMultiLineComment = false

    while (i < code.length) {
      const char = code[i]
      const nextChar = i + 1 < code.length ? code[i + 1] : ''

      // Handle string boundaries
      if (
        char === '"' &&
        !inSingleQuoteString &&
        !inSingleLineComment &&
        !inMultiLineComment
      ) {
        inDoubleQuoteString = !inDoubleQuoteString
        result += char
        i++
        continue
      }

      if (
        char === "'" &&
        !inDoubleQuoteString &&
        !inSingleLineComment &&
        !inMultiLineComment
      ) {
        inSingleQuoteString = !inSingleQuoteString
        result += char
        i++
        continue
      }

      // Inside strings, just copy characters
      if (inSingleQuoteString || inDoubleQuoteString) {
        result += char
        i++
        continue
      }

      // Handle comments
      if (
        char === '/' &&
        nextChar === '*' &&
        !inSingleLineComment &&
        !inMultiLineComment
      ) {
        inMultiLineComment = true
        i += 2
        continue
      }

      if (char === '*' && nextChar === '/' && inMultiLineComment) {
        inMultiLineComment = false
        i += 2
        continue
      }

      if (
        char === '/' &&
        nextChar === '/' &&
        !inSingleLineComment &&
        !inMultiLineComment
      ) {
        inSingleLineComment = true
        i += 2
        continue
      }

      if ((char === '\n' || char === '\r') && inSingleLineComment) {
        inSingleLineComment = false
        result += char // Keep the newline
        i++
        continue
      }

      // Skip characters in comments
      if (inSingleLineComment || inMultiLineComment) {
        i++
        continue
      }

      // Add non-comment characters
      result += char
      i++
    }

    return result
  }

  // Regular expressions for API handling
  const regexPublishTnglToApi =
    /PUBLISH_TNGL_TO_API\s*\(\s*"([^"]*)"\s*,\s*`([^`]*)`\s*\);?/ms
  const regexInjectTnglFromApi =
    /INJECT_TNGL_FROM_API\s*\(\s*"([^"]*)"\s*\);?/ms

  // Handle PUBLISH_TNGL_TO_API
  for (let requests = 0; requests < 64; requests++) {
    const match = regexPublishTnglToApi.exec(tnglCode)

    if (!match) {
      break
    }

    logging.verbose(match)

    const name = match[1]
    const id = encodeURIComponent(name)
    const tngl = match[2]

    try {
      logging.verbose(`sendTnglToApi({ id=${id}, name=${name}, tngl=${tngl} })`)
      await sendTnglToApi({ id, name, tngl })
      tnglCode = tnglCode.replace(match[0], '')
    } catch {
      logging.error(`Failed to send "${name}" to TNGL API`)
      throw 'SendTnglToApiFailed'
    }
  }

  // Handle INJECT_TNGL_FROM_API
  for (let requests = 0; requests < 64; requests++) {
    const match = regexInjectTnglFromApi.exec(tnglCode)

    if (!match) {
      break
    }

    logging.verbose(match)

    const name = match[1]
    const id = encodeURIComponent(name)

    try {
      logging.verbose(`fetchTnglFromApiById({ id=${id} })`)
      const response = await fetchTnglFromApiById(id)

      tnglCode = tnglCode.replace(match[0], response.tngl)
    } catch (e) {
      logging.error(`Failed to fetch "${name}" from TNGL API`, e)
      throw 'FetchTnglFromApiFailed'
    }
  }

  // Handle #define, #ifdef, #ifndef, #endif, #warning, #error directives
  {
    // First remove comments from the TNGL code
    tnglCode = removeNonBerryComments(tnglCode)

    // Now gather all defines and process conditionals
    const defines = new Map<string, string>()
    const lines = tnglCode.split('\n')
    const resultLines: string[] = []

    // Stack to track conditional compilation state
    // Each entry is {symbol: string, include: boolean, wasTrue: boolean}
    const conditionalStack: Array<{
      symbol: string
      include: boolean
      wasTrue: boolean
    }> = []

    // Should we include the current section?
    let includeSection = true

    for (const line of lines) {
      // Extract directive if present
      const defineMatch = line.match(/^\s*#define\s+(\w+)(?:\s+(.*))?/)
      const undefMatch = line.match(/^\s*#undef\s+(\w+)/)
      const ifdefMatch = line.match(/^\s*#ifdef\s+(\w+)/)
      const ifndefMatch = line.match(/^\s*#ifndef\s+(\w+)/)
      const endifMatch = line.match(/^\s*#endif/)
      const warningMatch = line.match(/^\s*#warning\s+(.*)/)
      const errorMatch = line.match(/^\s*#error\s+(.*)/)

      if (defineMatch) {
        // Process #define, but only if we're in an included section
        if (includeSection) {
          const name = defineMatch[1]
          const value = defineMatch[2] || '' // Default to empty string if no value

          defines.set(name, value)
        }
        // Don't include the #define line in output
        continue
      } else if (undefMatch) {
        // Process #undef, but only if we're in an included section
        if (includeSection) {
          const name = undefMatch[1]

          defines.delete(name)
        }
        // Don't include the #undef line in output
        continue
      } else if (ifdefMatch) {
        // Process #ifdef
        const symbol = ifdefMatch[1]
        const symbolDefined = defines.has(symbol)

        // This section is included if the parent section is included AND the condition is true
        const newInclude: boolean = includeSection && symbolDefined

        // Push state onto stack
        conditionalStack.push({
          symbol,
          include: newInclude,
          wasTrue: symbolDefined,
        })

        // Update current include state
        includeSection = newInclude

        // Don't include the #ifdef line in output
        continue
      } else if (ifndefMatch) {
        // Process #ifndef (same as #ifdef but condition is inverted)
        const symbol = ifndefMatch[1]
        const symbolDefined = defines.has(symbol)

        // This section is included if the parent section is included AND the condition is true
        const newInclude: boolean = includeSection && !symbolDefined

        // Push state onto stack
        conditionalStack.push({
          symbol,
          include: newInclude,
          wasTrue: !symbolDefined,
        })

        // Update current include state
        includeSection = newInclude

        // Don't include the #ifndef line in output
        continue
      } else if (endifMatch) {
        // Process #endif - pop the last conditional state
        if (conditionalStack.length === 0) {
          logging.error('Error: #endif without matching #ifdef or #ifndef')
          throw 'InvalidPreprocessorDirective'
        }

        const _lastState = conditionalStack.pop()

        // Restore include state from parent conditional (or true if we're at root level)
        includeSection =
          conditionalStack.length > 0
            ? conditionalStack[conditionalStack.length - 1].include
            : true

        // Don't include the #endif line in output
        continue
      } else if (warningMatch && includeSection) {
        // Process #warning - only if in an included section
        const warningMessage = `TNGL Warning: ${warningMatch[1]}`

        logging.warn(warningMessage)

        // TODO: Process the warning in studio

        // Don't include the #warning line in output
        continue
      } else if (errorMatch && includeSection) {
        // Process #error - only if in an included section
        const errorMessage = `TNGL Error: ${errorMatch[1]}`

        logging.error(errorMessage)

        // TODO: Process the error in studio

        // Abort processing when an error directive is encountered
        throw `TnglPreprocessorError: ${errorMessage}`
      }

      // Include the line only if we're in an included section
      if (includeSection) {
        // Apply symbol replacements to each included line immediately
        let processedLine = line

        for (const [name, value] of defines.entries()) {
          if (value === null || value === undefined) {
            continue
          }

          // Create a regex that matches the symbol name with word boundaries
          // The symbol name must not be preceded or followed by a word character
          const defineRegex = new RegExp(`\\b${name}\\b`, 'g')

          processedLine = processedLine.replace(defineRegex, value)
        }
        resultLines.push(processedLine)
      }
    }

    // Check if all #ifdef/#ifndef have matching #endif
    if (conditionalStack.length > 0) {
      logging.error('Error: Unclosed #ifdef or #ifndef directives')
      throw 'UnclosedPreprocessorDirective'
    }

    // Reassemble the code
    tnglCode = resultLines.join('\n')
  }

  // Handle TNGL_DEFINITIONS_FROM_JSON
  {
    const tnglDefinitionsRegex =
      /TNGL_DEFINITIONS_FROM_JSON\s*\(\s*`([^`]*)`\s*\)\s*;?/g
    let definitionsMatch

    while ((definitionsMatch = tnglDefinitionsRegex.exec(tnglCode)) !== null) {
      const fullMatch = definitionsMatch[0]
      const jsonString = definitionsMatch[1]

      try {
        // Convert JSON to TNGL definitions
        const tnglDefinitions = tnglDefinitionsFromJsonToTngl(jsonString)

        // Replace the TNGL_DEFINITIONS_FROM_JSON call with the generated TNGL
        tnglCode =
          tnglCode.substring(0, definitionsMatch.index) +
          tnglDefinitions +
          tnglCode.substring(definitionsMatch.index + fullMatch.length)

        // Reset lastIndex to account for potential length changes
        tnglDefinitionsRegex.lastIndex =
          definitionsMatch.index + tnglDefinitions.length
      } catch (error) {
        logging.error(`Failed to process TNGL_DEFINITIONS_FROM_JSON: ${error}`)
        throw new Error(
          `TNGL_DEFINITIONS_FROM_JSON processing failed: ${error}`,
        )
      }
    }
  }

  // Process BERRY code blocks after handling preprocessor directives
  {
    // Extract and process BERRY code segments
    const berryRegex = /BERRY\(`([\S\s]*?)`\)/g
    let berryMatch

    while ((berryMatch = berryRegex.exec(tnglCode)) !== null) {
      const fullMatch = berryMatch[0]
      const berryCode = berryMatch[1]

      // Process the BERRY code using the preprocessBerry function
      const processedBerryCode = preprocessBerry(berryCode)

      // Replace the original BERRY segment with the processed one
      const newBerrySegment = `BERRY(\`${processedBerryCode}\`)`

      tnglCode =
        tnglCode.substring(0, berryMatch.index) +
        newBerrySegment +
        tnglCode.substring(berryMatch.index + fullMatch.length)

      // Reset lastIndex to account for potential length changes
      berryRegex.lastIndex = berryMatch.index + newBerrySegment.length
    }
  }
  tnglCode = tnglCode
    // Remove empty lines with only whitespace
    .replace(/^\s*[\n\r]/gm, '')

    // Remove multiple consecutive empty lines
    .replace(/[\n\r]{3,}/g, '\n\n')

    // Remove trailing whitespace at end of lines
    .replace(/[\t ]+$/gm, '')

    // Remove multiple spaces between words/tokens (preserving indentation)
    .replace(/([^\t\n\r ])[\t ]{2,}([^\t\n\r ])/g, '$1 $2')

    // Standardize line endings to \n
    .replace(/\r\n|\r/g, '\n')

    // Remove spaces before commas and semicolons
    .replace(/\s+([,;])/g, '$1')

    // Remove multiple spaces after commas (but preserve line indentation)
    .replace(/([,;])[\t ]{2,}/g, '$1 ')

    // Remove spaces around parentheses while preserving indentation
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')

    // Remove extra spaces around operators while preserving indentation
    .replace(/(\S)[\t ]{2,}([%*+/<=>-])/g, '$1 $2')
    .replace(/([%*+/<=>-])[\t ]{2,}(\S)/g, '$1 $2')

    // Remove duplicate spaces after line indentation
    .replace(/^([\t ]*?)[\t ]{2,}/gm, '$1')

    // Remove extra whitespace at the start and end of the file
    .trim()

  logging.debug(tnglCode)

  // Handle SCENE declarations
  {
    // Regular expression to find all SCENE("name"|$name, [IDxxx,] `[...]`) segments
    const regexSCENE =
      /SCENE\s*\(\s*(?:"([^"]*)"|(\$\w+))\s*(?:,\s*ID(\d+))?\s*,\s*`\[([^]*?)\]`\s*\)\s*;?/g
    let match

    while ((match = regexSCENE.exec(tnglCode)) !== null) {
      const sceneName = match[1] || match[2] // match[1] for quoted string, match[2] for $variable
      const _sceneId = match[3] // Will be undefined if no ID was provided
      // Clean up the JSON string by removing trailing commas before the closing bracket
      const eventsJson = `[${match[4].replace(/,(\s*\])/g, '$1')}]`

      try {
        // Parse the JSON array of events
        const events = JSON.parse(eventsJson)

        // Convert events to TNGL chains using existing function
        const tnglChains = convertEventsToTnglChains(
          sceneName.replace(/^\$/, ''),
          events,
        )

        // Replace the SCENE declaration with the generated TNGL chains
        tnglCode = tnglCode.replace(match[0], tnglChains)
      } catch (e) {
        logging.error(`Failed to parse SCENE "${sceneName}"`, e)
        throw 'InvalidSceneFormat'
      }
    }
  }

  return tnglCode
}
