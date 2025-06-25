// TODO @immakermatty convert to typescript
// TODO @immakermatty move compilation to WASM

import { TnglWriter } from './TnglWriter'
import { CPP_EVENT_VALUE_LIMITS as VALUE_LIMITS } from './src/constants/limits'
import { PERCENTAGE_JS_VS_CPP_SCALE_FACTOR } from './src/constants'
import { mapValue, uint8ArrayToHexString } from './functions'
import { logging } from './logging'

const CONSTANTS = Object.freeze({
  MODIFIER_SWITCH_NONE: 0,
  MODIFIER_SWITCH_RG: 1,
  MODIFIER_SWITCH_GB: 2,
  MODIFIER_SWITCH_BR: 3,
})

const TNGL_FLAGS = Object.freeze({
  /* no code or command used by decoder as a validation */
  NONE: 0,

  // ======================

  /* drawings */
  DRAWING_SET: 1,
  DRAWING_ADD: 2,
  DRAWING_SUB: 3,
  DRAWING_SCALE: 4,
  DRAWING_FILTER: 5,

  /* layer operations */
  LAYER_SET: 6,
  LAYER_ADD: 7,
  LAYER_SUB: 8,
  LAYER_SCALE: 9,
  LAYER_FILTER: 10,

  /* frame */
  SCOPE: 11,

  /* interface implementation */
  SCOPE_ID: 12,

  /* sifters */
  SIFTER_CONTROLLER: 13,
  SIFTER_SEGMENT: 14,
  SIFTER_CANVAS: 15,

  /* event handlers */
  INTERACTIVE: 16,
  EVENT_CATCHER: 17,

  /* definitions scoped */
  DECLARE_VARIABLE: 18,

  /* event state */
  EVENTSTATE_OVERLOAD: 19,

  // ======================

  /* definitions global */
  DEFINE_CONTROLLER: 24,
  DEFINE_SEGMENT: 25,
  DEFINE_CANVAS: 26,
  DEFINE_INTERFACE: 27,
  DEFINE_ANIMATION: 28,

  // ======================

  /* animations */
  ANIMATION_NONE: 32,
  ANIMATION_FILL: 33,
  ANIMATION_RAINBOW: 34,
  ANIMATION_FADE: 35,
  ANIMATION_PROJECTILE: 36,
  ANIMATION_LOADING: 37,
  ANIMATION_COLOR_ROLL: 38,
  ANIMATION_COLOR_GRADIENT3: 39,
  ANIMATION_COLOR_GRADIENT5: 40,
  ANIMATION_COLOR_GRADIENT2: 41,
  ANIMATION_COLOR_GRADIENT4: 42,
  ANIMATION_STREAM: 43,

  MUTATOR_REORDER: 100,
  MUTATOR_CORRECTION: 101,
  MUTATOR_BRIGHTNESS: 102,
  MUTATOR_TRANSLATION: 103,
  MUTATOR_MASK: 104,
  MUTATOR_REMAP: 105,

  ANIMATION_INL_ANI: 126,
  ANIMATION_DEFINED: 127,

  /* modifiers */
  MODIFIER_BRIGHTNESS: 128,
  MODIFIER_TIMELINE: 129,
  MODIFIER_FADE_IN: 130,
  MODIFIER_FADE_OUT: 131,
  MODIFIER_SWITCH_COLORS: 132,
  MODIFIER_TIME_LOOP: 133,
  MODIFIER_TIME_SCALE: 134,
  MODIFIER_TIME_SCALE_SMOOTHED: 135,
  MODIFIER_TIME_CHANGE: 136,
  MODIFIER_TIME_SET: 137,

  /* state operations */
  GENERATOR_LAST_EVENT_VALUE: 144,
  GENERATOR_SMOOTHOUT: 145,
  GENERATOR_LAG_VALUE: 146,

  /* generators */
  GENERATOR_SINE: 150,
  GENERATOR_SAW: 151,
  GENERATOR_TRIANGLE: 152,
  GENERATOR_SQUARE: 153,
  GENERATOR_PERLIN_NOISE: 154,

  /* variable operations gates */
  VALUE_READ_ADDRESS: 160,
  OPERATION_ADD: 161,
  OPERATION_SUB: 162,
  OPERATION_MUL: 163,
  OPERATION_DIV: 164,
  OPERATION_MOD: 165,
  OPERATION_SCA: 166,
  OPERATION_MAP: 167,
  OPERATION_NVL: 168,

  /* objects */
  CONTROLLER: 176,
  IO: 177,
  SEGMENT: 178,
  CANVAS: 180,
  EVENTSTATE: 181,
  ID: 182,
  OBJECT_MAC_ADDRESS: 183,
  INTERFACE: 187,

  /* events */
  EVENT_SET_VALUE: 184,
  EVENT_EMIT_LOCAL: 185,
  EVENT_RANDOM_CHOICE: 186,

  // ======================

  /* values */
  VALUE_ADDRESS: 191,
  VALUE_PIXELS: 192,
  VALUE_COLOR: 193,
  VALUE_DATE: 194,
  VALUE_PERCENTAGE: 195,
  VALUE_TIMESTAMP: 196,
  VALUE_LABEL: 197,
  VALUE_NUMBER: 198,

  // ======================

  /* most used constants */
  CONST_TIMESTAMP_0: 210,
  CONST_TIMESTAMP_INFINITY: 211,
  CONST_TIMESTAMP_MINUS_INFINITY: 212,
  CONST_COLOR_WHITE: 213,
  CONST_COLOR_BLACK: 214,
  // CONST_COLOR_RED : 215,
  // CONST_COLOR_GREEN : 216,
  // CONST_COLOR_BLUE : 217,
  CONST_PERCENTAGE_0: 218,
  CONST_PERCENTAGE_100: 219,
  CONST_PERCENTAGE_MINUS_100: 220,
  // CONST_PIXELS_0 : 221,
  // CONST_PIXELS_1 : 222,
  // CONST_ID_255 : 223,
  CONST_BOOLEAN_TRUE: 224,
  CONST_BOOLEAN_FALSE: 225,
  CONST_NULL: 226,
  CONST_UNDEFINED: 227,
  // ======================

  PARAMETERS_MAP: 250,

  // ======================

  BERRY_SCRIPT: 253,

  /* command ends */
  END_OF_SCOPE: 254,
  END_OF_TNGL_BYTES: 255,
})

export class TnglCompiler {
  #tnglWriter
  #const_declarations_stack
  #const_scope_depth_stack
  #let_declarations_stack // TODO @immakermatty convert let to var?
  #let_scope_depth_stack
  #var_declarations //  TODO @immakermatty remove var functionality and use let renamed to var instead

  #memory_stack

  constructor() {
    this.#tnglWriter = new TnglWriter(65535)

    // @type array of {name: "variable", address: 0x0001};
    this.#const_declarations_stack = [] // stack of variable name-address pairs
    // @type array of numers
    this.#const_scope_depth_stack = [] // stack of variable depths in scopes
    // @type array of {name: "variable", address: 0x0001};
    this.#let_declarations_stack = [] // stack of variable name-address pairs
    // @type array of numers
    this.#let_scope_depth_stack = [] // stack of variable depths in scopes
    // @type array of {name: "variable", address: 0x0001};
    this.#var_declarations = [] // addresses starts from 0x0001 to 0xfffe. 0x0000 is a "reserved", 0xffff is unknown address

    this.#memory_stack = []
    this.#reserveAddress('reserved')
  }

  // Add new method to handle parsing
  parseAndCompileCode(tngl_code) {
    logging.verbose(tngl_code)

    // 1st stage: tokenize the code
    const tokens = this.#tokenize(tngl_code, TnglCompiler.#parses)

    logging.verbose(tokens)

    // 2nd stage: compile the code
    for (let index = 0; index < tokens.length; index++) {
      this.compileToken(tokens[index])
    }
  }

  compileToken(element) {
    switch (element.type) {
      case TnglCompiler.PARSES.BERRY_A:
        this.compileBerryScript(element.token)
        break

      case TnglCompiler.PARSES.VAR_B:
        this.compileVarDeclaration(element.token)
        break

      case TnglCompiler.PARSES.CONST_C:
        this.compileConstDeclaration(element.token)
        break

      case TnglCompiler.PARSES.COMMENT_D:
        // skip
        break

      case TnglCompiler.PARSES.COLOR_E:
        this.compileColor(element.token)
        break

      case TnglCompiler.PARSES.LINERALS_F:
        this.compileLinerals(element.token)
        break

      // case TnglCompiler.PARSES.STRING_G:
      //   this.compileString(element.token);
      //   break;

      case TnglCompiler.PARSES.ADDRESS_H:
        this.compileValueAddress(element.token)
        break

      case TnglCompiler.PARSES.TIME_I:
        this.compileTimestamp(element.token)
        break

      case TnglCompiler.PARSES.LABEL_J:
        this.compileLabel(element.token)
        break

      case TnglCompiler.PARSES.BYTE_K:
        this.compileByte(element.token)
        break

      case TnglCompiler.PARSES.PIXELS_L:
        this.compilePixels(element.token)
        break

      case TnglCompiler.PARSES.ID_M:
        this.compileId(element.token)
        break

      case TnglCompiler.PARSES.PERCENTAGE_N:
        this.compilePercentage(element.token)
        break

      case TnglCompiler.PARSES.FLOAT_O:
        logging.error('"Naked" float numbers are not permitted.')
        break

      case TnglCompiler.PARSES.NUMBER_P:
        this.compileNumber(element.token)
        break

      case TnglCompiler.PARSES.WORD_Q:
        this.compileWord(element.token)
        break

      case TnglCompiler.PARSES.BYTE_R:
        this.compileByte(element.token)
        break

      case TnglCompiler.PARSES.WHITESPACE_S:
        // skip
        break

      case TnglCompiler.PARSES.PUNCTUATION_T:
        this.compilePunctuation(element.token)
        break

      case TnglCompiler.PARSES.MACADDRESS_U:
        this.compileMacAddress(element.token)
        break

      case TnglCompiler.PARSES.LET_V:
        this.compileLetDeclaration(element.token)
        break

      case TnglCompiler.PARSES.PARAMETER_V:
        this.compileParametersMap(element.token)
        break

      default:
        throw new Error(`Unknown token type >${element.type}<`)
    }
  }

  getVariableDeclarations() {
    return this.#var_declarations
  }

  getMemoryStack() {
    return this.#memory_stack
  }

  reset() {
    this.#tnglWriter.reset()

    this.#const_declarations_stack.length = 0
    this.#const_scope_depth_stack.length = 0
    this.#let_declarations_stack.length = 0
    this.#let_scope_depth_stack.length = 0
    this.#var_declarations.length = 0

    this.#memory_stack.length = 0
    this.#reserveAddress('reserved')
  }

  compileUndefined() {
    this.#tnglWriter.writeUint8(TNGL_FLAGS.NONE)
  }

  compileFlag(flag) {
    this.#tnglWriter.writeUint8(flag)
  }

  compileByte(byte) {
    let reg = byte.match(/0x([0-9a-f][0-9a-f])(?![0-9a-f])/i)

    if (!reg) {
      logging.error('Failed to compile a byte')
      return
    }
    this.#tnglWriter.writeUint8(parseInt(reg[1], 16))
  }

  compileChar(char) {
    let reg = char.match(/(-?)'([\W\w])'/)

    if (!reg) {
      logging.error('Failed to compile char')
      return
    }
    // TODO deprecate negative char
    if (reg[1] === '-') {
      console.warn('Negative char is deprecated')
      this.#tnglWriter.writeUint8(-reg[2].charCodeAt(0))
    } else {
      this.#tnglWriter.writeUint8(reg[2].charCodeAt(0))
    }
  }

  // takes string string as '"this is a string"'
  compileString(string) {
    let reg = string.match(/"([\w ]*)"/)

    if (!reg) {
      logging.error('Failed to compile a string')
      return
    }

    for (let i = 0; i < string.length; i++) {
      this.#tnglWriter.writeUint8(string.charCodeAt(i))
    }

    this.#tnglWriter.writeFlag(TNGL_FLAGS.NONE)
  }

  /**
   * Compiles linerals (literals) like Infinity, booleans, null and undefined into TNGL flags
   * @param {string} linerals - The literal value to compile
   * @returns {void}
   */
  compileLinerals(linerals) {
    // Handle Infinity values
    let infinityMatch = linerals.match(/([+-]?Infinity)/)

    if (infinityMatch) {
      if (infinityMatch[1] === 'Infinity' || infinityMatch[1] === '+Infinity') {
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_INFINITY)
        return
      } else if (infinityMatch[1] === '-Infinity') {
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_MINUS_INFINITY)
        return
      }
    }

    // Handle boolean and null values
    switch (linerals) {
      case 'true':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_BOOLEAN_TRUE)
        break
      case 'false':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_BOOLEAN_FALSE)
        break
      case 'null':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_NULL)
        break
      case 'undefined':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_UNDEFINED)
        break
      default:
        logging.error('Failed to compile literal:', linerals)
    }
  }

  compileValueAddress(variable_reference) {
    logging.verbose(`compileValueAddress(${variable_reference})`)

    let reg = variable_reference.match(/&([a-z_][\w]*)/i)

    if (!reg) {
      logging.error('Failed to compile variable address')
      return
    }

    const variable_name = reg[1]
    let valueadr = undefined

    // TODO @immakermatty figure out how to handle const, let and var variables
    // // check if the variable is already declared
    // // look for the latest variable address on the stack
    // for (let i = this.#const_declarations_stack.length - 1; i >= 0; i--) {
    //   const declaration = this.#const_declarations_stack[i];
    //   if (declaration.name === variable_name) {
    //     valueadr = declaration.address;
    //     break;
    //   }
    // }

    // TODO @immakermatty figure out how to handle const, let and var variables
    // // check if the variable is already declared
    // // look for the latest variable address on the stack
    // for (let i = this.#let_declarations_stack.length - 1; i >= 0; i--) {
    //   const declaration = this.#let_declarations_stack[i];
    //   if (declaration.name === variable_name) {
    //     valueadr = declaration.address;
    //     break;
    //   }
    // }

    // // ! there is an issue where variables that have the same name as a const or let variable will be treated as a const or let variable

    // check if the variable is already declared
    // look for the latest variable address on the stack
    for (let i = this.#var_declarations.length - 1; i >= 0; i--) {
      const declaration = this.#var_declarations[i]

      if (declaration.name === variable_name) {
        valueadr = declaration.address
        break
      }
    }

    if (valueadr === undefined) {
      logging.error(`Variable ${variable_name} is not declated`)
      throw 'CompilationError'
    }

    logging.verbose(`VALUE_ADDRESS name=${variable_name}, address=${valueadr}`)
    this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_ADDRESS)
    this.#tnglWriter.writeUint16(valueadr)
  }

  // takes in time string token like "1.2d+9h2m7.2s-123t" and appeds to payload the total time in ms (tics) as a int32_t: [FLAG.VALUE_TIMESTAMP, BYTE4, BYTE2, BYTE1, BYTE0]
  compileTimestamp(value) {
    if (!value) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_0)
      return
    }

    value = value.trim()

    const timestampRegex = /([+-]?(\d+\.\d+|\d+|\.\d+))\s*(d|h|m(?!s)|s|ms|t)/gi
    let match
    let total = 0

    while ((match = timestampRegex.exec(value)) !== null) {
      const number = parseFloat(match[1])
      const unit = match[3].toLowerCase()

      switch (unit) {
        case 'd':
          total += number * 86400000
          break
        case 'h':
          total += number * 3600000
          break
        case 'm':
          total += number * 60000
          break
        case 's':
          total += number * 1000
          break
        case 'ms':
        case 't':
          total += number
          break
        default:
          logging.error('Error while parsing timestamp: Unknown unit', unit)
          break
      }
    }

    if (total >= VALUE_LIMITS.TIMESTAMP_MAX) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_INFINITY)
      return
    } else if (total <= VALUE_LIMITS.TIMESTAMP_MIN) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_MINUS_INFINITY)
      return
    } else if (total === 0) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_TIMESTAMP_0)
      return
    } else {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_TIMESTAMP)
      this.#tnglWriter.writeInt32(total)
      return
    }
  }

  // takes in html color string "#abcdef" and encodes it into 24 bits [FLAG.VALUE_COLOR, R, G, B]
  compileColor(color) {
    let reg = color.match(/#([0-9a-f][0-9a-f])([0-9a-f][0-9a-f])([0-9a-f][0-9a-f])/i)

    if (!reg) {
      logging.error('Failed to compile color')
      return
    }

    let r = parseInt(reg[1], 16)
    let g = parseInt(reg[2], 16)
    let b = parseInt(reg[3], 16)

    if (r === 255 && g === 255 && b === 255) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_COLOR_WHITE)
    } else if (r === 0 && g === 0 && b === 0) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_COLOR_BLACK)
    } else {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_COLOR)
      this.#tnglWriter.writeUint8(r)
      this.#tnglWriter.writeUint8(g)
      this.#tnglWriter.writeUint8(b)
    }
  }

  // takes in percentage string "83.234%" and encodes it into 24 bits
  compilePercentage(percentage) {
    let reg = percentage.match(/([+-]?[\d.]+)%/)

    if (!reg) {
      logging.error('Failed to compile percentage')
      return
    }

    let val = parseFloat(reg[1])

    if (val > 100.0) {
      val = 100.0
    }
    if (val < -100.0) {
      val = -100.0
    }

    const UNIT_ERROR = 0.000001

    if (val > -UNIT_ERROR && val < UNIT_ERROR) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_PERCENTAGE_0)
    } else if (val > 100.0 - UNIT_ERROR) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_PERCENTAGE_100)
    } else if (val < -100.0 + UNIT_ERROR) {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_PERCENTAGE_MINUS_100)
    } else {
      this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_PERCENTAGE)
      this.#tnglWriter.writeInt32(Math.round(val * PERCENTAGE_JS_VS_CPP_SCALE_FACTOR))
    }
  }

  // takes label string as "$label" and encodes it into 32 bits
  compileLabel(label) {
    let reg = label.match(/\$([\w]*)/)

    if (!reg) {
      logging.error('Failed to compile a label')
      return
    }

    this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_LABEL)
    for (let index = 0; index < 5; index++) {
      this.#tnglWriter.writeUint8(reg[1].charCodeAt(index))
    }
  }

  // takes pixels string "12px" and encodes it into 16 bits
  compilePixels(pixels) {
    let reg = pixels.match(/(-?[\d]+)px/)

    if (!reg) {
      logging.error('Failed to compile pixels')
      return
    }

    let count = parseInt(reg[1])

    this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_PIXELS)
    this.#tnglWriter.writeInt16(count)
  }

  ///////////////////////////////////////////////////////////

  #reserveAddress(description) {
    logging.verbose(`#reserveAddress(${description})`)
    const address = this.#memory_stack.length

    logging.debug(`Reserving address ${address} for '${description}'`)
    this.#memory_stack.push(description)
    return address
  }

  #declareConst(name) {
    logging.verbose(`#declareConst(${name})`)
    // TODO @immakermatty #const_declarations_stack is not used anymore? So rename #var_declarations to something else?
    const address = this.#reserveAddress(`const ${name}`)

    logging.debug(`Declared const ${name} at address ${address}`)
    this.#const_declarations_stack.push({ name: name, address: address })
    return address
  }

  // TODO @immakermatty deprecate let keyword and use var keyword for let functionality instead
  #declareLet(name) {
    logging.verbose(`#declareLet(${name})`)
    const address = this.#reserveAddress(`let ${name}`)

    logging.debug(`Declared let ${name} at address ${address}`)
    this.#let_declarations_stack.push({ name: name, address: address })
    return address
  }

  #declareVar(name) {
    logging.verbose(`#declareVar(${name})`)
    const address = this.#reserveAddress(`var ${name}`)

    logging.debug(`Declared var ${name} at address ${address}`)
    this.#var_declarations.push({ name: name, address: address })
    return address
  }

  compileConstDeclaration(variable_declaration) {
    logging.verbose(`compileConstDeclaration("${variable_declaration}")`)

    // TODO @immakermatty implement const declaration
    logging.error('const declaration is not supported in TNGL in this version of the compiler')
    throw 'ConstDeclarationNotSupported'

  }

  compileLetDeclaration(variable_declaration) {
    logging.verbose(`compileLetDeclaration(${variable_declaration})`)

    // TODO @immakermatty implement let declaration
    logging.error('let declaration is not supported in TNGL in this version of the compiler')
    throw 'LetDeclarationNotSupported'

  }

  compileVarDeclaration(variable_declaration) {
    logging.verbose(`compileVarDeclaration(${variable_declaration})`)

    let reg = variable_declaration.match(/var +([A-Za-z_][\w]*) *=/)

    if (!reg) {
      logging.error('Failed to compile var declaration')
      return
    }

    const var_name = reg[1]
    const var_address = this.#declareVar(var_name)

    // retrieve the var_address and write the TNGL_FLAGS with uint16_t variable address value.
    this.#tnglWriter.writeFlag(TNGL_FLAGS.DECLARE_VARIABLE)
    this.#tnglWriter.writeUint16(var_address)
  }

  compileWord(word) {
    switch (word) {
      // === canvas operations ===
      case 'setDrawing':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DRAWING_SET)
        break
      case 'addDrawing':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DRAWING_ADD)
        break
      case 'subDrawing':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DRAWING_SUB)
        break
      case 'scaDrawing':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DRAWING_SCALE)
        break
      case 'filDrawing':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DRAWING_FILTER)
        break
      case 'setLayer':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.LAYER_SET)
        break
      case 'addLayer':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.LAYER_ADD)
        break
      case 'subLayer':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.LAYER_SUB)
        break
      case 'scaLayer':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.LAYER_SCALE)
        break
      case 'filLayer':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.LAYER_FILTER)
        break

      // === scopes ===
      case 'scope':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SCOPE)
        break

      // === animations ===
      case 'animation':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_DEFINED)
        break
      case 'animNone':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_NONE)
        break
      case 'animFill':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_FILL)
        break
      case 'animRainbow':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_RAINBOW)
        break
      case 'animPlasmaShot':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_PROJECTILE)
        break
      case 'animLoadingBar':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_LOADING)
        break
      case 'animFade':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_FADE)
        break
      case 'animColorRoll':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_COLOR_ROLL)
        break
      // case "animPaletteRoll":
      //   this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_PALLETTE_ROLL);
      //   break;
      case 'animColorGradient2':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_COLOR_GRADIENT2)
        break
      case 'animColorGradient3':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_COLOR_GRADIENT3)
        break
      case 'animColorGradient4':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_COLOR_GRADIENT4)
        break
      case 'animColorGradient5':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_COLOR_GRADIENT5)
        break
      case 'animStream':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.ANIMATION_STREAM)
        break

      case 'applyReorder':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_REORDER)
        break
      case 'applyCorrection':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_CORRECTION)
        break
      case 'applyBrightness':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_BRIGHTNESS)
        break
      case 'applyTranslation':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_TRANSLATION)
        break
      case 'applyMask':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_MASK)
        break
      case 'applyRemap':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MUTATOR_REMAP)
        break

      // === handlers ===
      case 'interactive':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.INTERACTIVE)
        break

      // === definitions ===

      case 'defController':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DEFINE_CONTROLLER)
        break
      case 'defSegment':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DEFINE_SEGMENT)
        break
      case 'defCanvas':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DEFINE_CANVAS)
        break
      case 'defAnimation':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DEFINE_ANIMATION)
        break
      case 'defInterface':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.DEFINE_INTERFACE)
        break

      // === sifters ===
      case 'siftControllers':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SIFTER_CONTROLLER)
        break
      case 'siftSegments':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SIFTER_SEGMENT)
        break
      case 'siftCanvases':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SIFTER_CANVAS)
        break

      // === interface implementation ===
      case 'idScope':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SCOPE_ID)
        break

      // === objects ===
      case 'controller':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CONTROLLER)
        break
      case 'segment':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.SEGMENT)
        break
      case 'io':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.IO)
        break
      case 'canvas':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.CANVAS)
        break
      case 'interface':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.INTERFACE)
        break
      case 'eventstate':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENTSTATE)
        break

      // === modifiers ===
      case 'modifyBrightness':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_BRIGHTNESS)
        break
      case 'modifyTimeline':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIMELINE)
        break
      case 'modifyFadeIn':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_FADE_IN)
        break
      case 'modifyFadeOut':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_FADE_OUT)
        break
      case 'modifyColorSwitch':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_SWITCH_COLORS)
        break
      case 'modifyTimeLoop':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIME_LOOP)
        break
      case 'modifyTimeScale':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIME_SCALE)
        break
      case 'modifyTimeScaleSmoothed':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIME_SCALE_SMOOTHED)
        break
      case 'modifyTimeChange':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIME_CHANGE)
        break
      case 'modifyTimeSet':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.MODIFIER_TIME_SET)
        break

      // === events ===
      case 'catchEvent': // ! deprecate in 0.13
      case 'onEventStateSet':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENT_CATCHER)
        break
      case 'setValue':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENT_SET_VALUE)
        break
      case 'emitAs': // ! deprecate in 0.13
      case 'setEventState':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENT_EMIT_LOCAL)
        break
      case 'randomChoice':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENT_RANDOM_CHOICE)
        break
      case 'overloadEventState':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.EVENTSTATE_OVERLOAD)
        break

      // === event state operations ===
      case 'genLastEventParam':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_LAST_EVENT_VALUE)
        break
      case 'genSmoothOut':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_SMOOTHOUT)
        break
      case 'genLagValue':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_LAG_VALUE)
        break

      // === generators ===
      case 'genSine':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_SINE)
        break
      case 'genSaw':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_SAW)
        break
      case 'genTriangle':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_TRIANGLE)
        break
      case 'genSquare':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_SQUARE)
        break
      case 'genPerlinNoise':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.GENERATOR_PERLIN_NOISE)
        break

      /* === variable operations === */

      case 'addValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_ADD)
        break
      case 'subValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_SUB)
        break
      case 'mulValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_MUL)
        break
      case 'divValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_DIV)
        break
      case 'nvlValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_NVL)
        break
      case 'modValues':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_MOD)
        break
      case 'scaValue':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_SCA)
        break
      case 'mapValue':
        this.#tnglWriter.writeFlag(TNGL_FLAGS.OPERATION_MAP)
        break

      // === constants ===
      // TODO! implement in FW
      // case "true":
      //   this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_VALUE_BOOLEAN_TRUE);
      //   this.#tnglWriter.writeUint8(0x01);
      //   break;
      // case "false":
      //   this.#tnglWriter.writeFlag(TNGL_FLAGS.CONST_VALUE_BOOLEAN_FALSE);
      //   this.#tnglWriter.writeUint8(0x00);
      //   break;

      // TODO @immakermatty remove these deprecated constants
      case 'MODIFIER_SWITCH_NONE':
        this.#tnglWriter.writeUint8(CONSTANTS.MODIFIER_SWITCH_NONE)
        break
      case 'MODIFIER_SWITCH_RG':
      case 'MODIFIER_SWITCH_GR':
        this.#tnglWriter.writeUint8(CONSTANTS.MODIFIER_SWITCH_RG)
        break
      case 'MODIFIER_SWITCH_GB':
      case 'MODIFIER_SWITCH_BG':
        this.#tnglWriter.writeUint8(CONSTANTS.MODIFIER_SWITCH_GB)
        break
      case 'MODIFIER_SWITCH_BR':
      case 'MODIFIER_SWITCH_RB':
        this.#tnglWriter.writeUint8(CONSTANTS.MODIFIER_SWITCH_BR)
        break

      default:
        let var_address = undefined

        // check if the variable is already declared
        // look for the latest variable address on the stack
        for (let i = this.#var_declarations.length - 1; i >= 0; i--) {
          const declaration = this.#var_declarations[i]

          if (declaration.name === word) {
            var_address = declaration.address
            break
          }
        }

        if (var_address !== undefined) {
          logging.verbose(`VALUE_READ_ADDRESS name=${word}, address=${var_address}`)
          this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_READ_ADDRESS)
          this.#tnglWriter.writeUint16(var_address)
          break
        }

        // === unknown ===
        throw new Error(`Unknown word >${word}<`)
    }
  }

  compilePunctuation(puctuation) {
    switch (puctuation) {
      case '{':
        // push the current depth of the variable stack to the depth stack
        this.#const_scope_depth_stack.push(this.#const_declarations_stack.length)
        this.#let_scope_depth_stack.push(this.#let_declarations_stack.length)
        break

      case '}':
        // pop the scope depth of the depth stack variable stack and set the variable stack to the previous depth
        const const_depth = this.#const_scope_depth_stack.pop()

        this.#const_declarations_stack.length = const_depth
        const let_depth = this.#let_scope_depth_stack.pop()

        this.#let_declarations_stack.length = let_depth

        this.#tnglWriter.writeFlag(TNGL_FLAGS.END_OF_SCOPE)
        break

      default:
        break
    }
  }

  compileMacAddress(mac_address) {
    let reg = mac_address.match(/([0-9a-f][0-9a-f]:){5}[0-9a-f][0-9a-f]/i)

    if (!reg) {
      logging.error('Failed to compile mac address')
      return
    }

    this.#tnglWriter.writeFlag(TNGL_FLAGS.OBJECT_MAC_ADDRESS)

    let mac = reg[0].split(':')

    for (let i = 0; i < 6; i++) {
      this.#tnglWriter.writeUint8(parseInt(mac[i], 16))
    }
  }

  // number_t, 4 bytes, min: -1000000000, max: 1000000000
  compileNumber(number) {
    this.#tnglWriter.writeFlag(TNGL_FLAGS.VALUE_NUMBER)
    this.#tnglWriter.writeInt32(number)
  }

  /**
   * Compiles an ID string (e.g., "ID0" to "ID255") and writes it to the payload.
   * @param {string} id - The ID string to compile.
   */
  compileId(id) {
    // Check if the string starts with "ID" or "id" (case-insensitive)
    if (typeof id !== 'string' || !id.startsWith('ID')) {
      logging.error("Invalid ID format! Expected 'ID0' to 'ID255'. Received:", id)
      this.#tnglWriter.writeFlag(TNGL_FLAGS.ID)
      this.#tnglWriter.writeUint16(0)
      return
    }

    // Extract the numerical part
    const idNumberStr = id.slice(2) // Remove 'ID'

    // Parse the number
    const idNumber = parseInt(idNumberStr, 10)

    // Write the ID
    this.#tnglWriter.writeFlag(TNGL_FLAGS.ID)
    this.#tnglWriter.writeUint8(idNumber)
  }

  compileBerryScript(berry) {
    // TODO: Get bytes in WASM and then only send Berry bytecode

    // BERRY(`...`)
    const berryMatch = berry.match(/^BERRY\s*\(\s*`([\s\S]*)`\s*\)$/)

    if (!berryMatch) {
      logging.error('Invalid Berry script format! Expected BERRY(`...`). Received:', berry)
      return
    }
    const code = berryMatch[1]

    logging.debug('matched script:', code)

    const bytes = new TextEncoder().encode(code)

    logging.verbose('matched script bytes:', bytes)

    this.#tnglWriter.writeFlag(TNGL_FLAGS.BERRY_SCRIPT)
    this.#tnglWriter.writeUint16(bytes.length)
    this.#tnglWriter.writeBytes(bytes, bytes.length)
  }

  compileParametersMap(parameter) {
    // Check if parameter is a string and matches parameter map format
    if (typeof parameter !== 'string') {
      logging.error('Invalid parameter format! Expected parameter map string. Received:', parameter)
      return
    }

    // Write flag for parameters map
    this.#tnglWriter.writeFlag(TNGL_FLAGS.PARAMETERS_MAP)

    // Find all ID:value pairs using regex
    const regex = /ID\d+\s*:\s*[^,{}]+/g
    let matches = [...parameter.matchAll(regex)]

    const parameter_description = `parameter ${parameter}`

    let address = 0

    for (const description of this.#memory_stack) {
      if (description === parameter_description) {
        address = this.#memory_stack.indexOf(description)
        break
      }
    }

    if (address === 0) {
      address = this.#reserveAddress(parameter_description)
    }

    // Write the variable address that the parameters map is stored in
    this.#tnglWriter.writeUint16(address)

    // Process each ID:value pair
    for (const match of matches) {
      if (!match[0]) {
        logging.error('Invalid parameter map format! Expected ID:value pairs. Received:', parameter)
        continue
      }

      // Use the new parsing method instead of calling back to TnglCodeParser
      this.parseAndCompileCode(match[0])
    }

    this.#tnglWriter.writeFlag(TNGL_FLAGS.END_OF_SCOPE)
  }

  get tnglBytes() {
    return new Uint8Array(this.#tnglWriter.bytes.buffer, 0, this.#tnglWriter.written)
  }

  static PARSES = Object.freeze({
    BERRY_A: 'A',
    VAR_B: 'B',
    CONST_C: 'C',
    COMMENT_D: 'D',
    COLOR_E: 'E',
    LINERALS_F: 'F',
    // STRING_G: "G",
    ADDRESS_H: 'H',
    TIME_I: 'I',
    LABEL_J: 'J',
    BYTE_K: 'K',
    PIXELS_L: 'L',
    ID_M: 'M',
    PERCENTAGE_N: 'N',
    FLOAT_O: 'O',
    NUMBER_P: 'P',
    WORD_Q: 'Q',
    BYTE_R: 'R',
    WHITESPACE_S: 'S',
    PUNCTUATION_T: 'T',
    MACADDRESS_U: 'U',
    PARAMETER_V: 'V',
  })

  static #parses = {
    D: /\/\/[^\n]*/, // comment: //...
    A: /BERRY\(`([\s\S]*?)`\)/, // berry code: /BERRY\(`([\s\S]*?)`\)/,
    B: /var +[A-Za-z_][\w]* *=/, // var declaration
    C: /const +[A-Za-z_][\w]* *=/, // const declaration
    V: /\{(?:\s*ID\d+\s*:\s*[^,{}]+(?:,\s*ID\d+\s*:\s*[^,{}]+)*\s*)\}/, // parameter in format "{ IDxxx: yyyy, IDxxx: yyyy }",
    U: /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i, // mac address
    E: /#[0-9a-f]{6}/i, // color: /#[0-9a-f]{6}/i,
    F: /(?:[+-]?Infinity|true|false|null|undefined)/, // +-Infinity, true, false, null, undefined
    // G: /"[\w ]*"/,
    H: /&[a-z_][\w]*/i, // value address: /&[a-z_][\w]*/i,
    I: /_?[+-]?(?:\d+\.\d+|\d+)(?:d|h|m(?!s)|s|t|ms)/, //timestamp: /(_?[+-]?[0-9]*[.]?[0-9]+(d|h|m(?!s)|s|t|ms))+/,
    J: /\$[\w]+/, // label: /\$[\w]+/,
    K: /0x[0-9a-f][0-9a-f](?![0-9a-f])/i, // byte TODO deprecate in interaction green block
    L: /-?[\d]+px/, // pixels: /-?[\d]+px/,
    M: /\bID\d+\b/, // id: /\bID\d+\b/,
    N: /[+-]?\d+(\.\d+)?%/, // percentage: /[+-]?[\d.]+%/,
    O: /([+-]?[0-9]*[.][0-9]+)/, // float: /([+-]?[0-9]*[.][0-9]+)/,
    P: /([+-]?[0-9]+)/, // number: /([+-]?[0-9]+)/,
    Q: /[a-z_][\w]*/i, // word: /[a-z_][\w]*/i,
    R: /0x[0-9a-f][0-9a-f](?![0-9a-f])/i,
    S: /\s+/,
    T: /[^\w\s]/,
  }

  /*
   * Tiny tokenizer https://gist.github.com/borgar/451393
   *
   * - Accepts a subject string and an object of regular expressions for parsing
   * - Returns an array of token objects
   *
   * tokenize('this is text.', { word:/\w+/, whitespace:/\s+/, punctuation:/[^\w\s]/ }, 'invalid');
   * result => [{ token="this", type="word" },{ token=" ", type="whitespace" }, Object { token="is", type="word" }, ... ]
   *
   */

  #tokenize(s, parsers, deftok) {
    var m,
      r,
      l,
      cnt,
      t,
      tokens = []

    while (s) {
      t = null
      m = s.length
      for (var key in parsers) {
        r = parsers[key].exec(s)
        // try to choose the best match if there are several
        // where "best" is the closest to the current starting point
        if (r && r.index < m) {
          t = {
            token: r[0],
            type: key,
            matches: r.slice(1),
          }
          m = r.index
        }
      }
      if (m) {
        // there is text between last token and currently
        // matched token - push that out as default or "unknown"
        tokens.push({
          token: s.substr(0, m),
          type: deftok || 'unknown',
        })
      }
      if (t) {
        // push current token onto sequence
        tokens.push(t)
      }
      s = s.substr(m + (t ? t.token.length : 0))
    }
    return tokens
  }
}

export class TnglCodeParser {
  #compiler
  constructor() {
    this.#compiler = new TnglCompiler()
  }

  parseTnglCode(tngl_code) {
    logging.verbose(tngl_code)

    this.#compiler.reset()
    this.#compiler.parseAndCompileCode(tngl_code)
    this.#compiler.compileFlag(TNGL_FLAGS.END_OF_TNGL_BYTES)

    let tnglBytes = this.#compiler.tnglBytes

    logging.verbose(tnglBytes)
    logging.debug('TNGL_BYTECODE:')
    logging.debug(uint8ArrayToHexString(tnglBytes))
    logging.info('Compiled tnglbytes length:', tnglBytes.length)

    return tnglBytes
  }

  getVariableDeclarations() {
    return this.#compiler.getVariableDeclarations()
  }

  getMemoryStack() {
    return this.#compiler.getMemoryStack()
  }
}
