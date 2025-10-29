import { logging } from '../logging'

/**
 * Converts a JSON string as used in TNGL_DEFINITIONS_FROM_JSON(`...`) into TNGL definitions.
 * The output matches the style demonstrated in the provided example: one defController per controller,
 * with defSegment entries from "segments" and BERRY blocks from "scripts".
 */
export const tnglDefinitionsFromJsonToTngl = (jsonString: string): string => {
  logging.debug(`tnglDefinitionsFromJsonToTngl(jsonString.length=${jsonString.length})`)
  logging.verbose('jsonString=', jsonString)

  try {
    // Parse the JSON array of controller definitions
    const controllers = JSON.parse(jsonString)

    if (!Array.isArray(controllers)) {
      logging.error('TNGL_DEFINITIONS_FROM_JSON: Expected an array of controller definitions')
      throw new Error('Invalid JSON format: expected array')
    }

    const tnglParts: string[] = []

    // Process each controller definition
    for (const controllerDef of controllers) {
      if (!controllerDef.controller?.name) {
        logging.warn('TNGL_DEFINITIONS_FROM_JSON: Skipping controller without name')
        continue
      }

      const controllerName = controllerDef.controller.name
      const defSegments: string[] = []
      const berryScripts: string[] = []

      // Process segments
      if (controllerDef.segments) {
        for (const [segmentName, segmentConfig] of Object.entries(controllerDef.segments)) {
          const config = segmentConfig as {
            id?: number
            io?: string
            from?: number
            to?: number
            size?: number
          }

          if (config.id !== undefined) {
            // Build defSegment content using io($<ioName>, ...)
            const segmentParts: string[] = []

            if (config.io) {
              const ioName = String(config.io)

              if (config.from !== undefined && config.to !== undefined) {
                segmentParts.push(`io($${ioName}, ${config.from}px, ${config.to}px)`)
              } else if (config.size !== undefined) {
                segmentParts.push(`io($${ioName}, ${config.size}px)`)
              } else {
                // Default to 1px when size or range is not provided
                segmentParts.push(`io($${ioName}, 1px)`)
              }
            }

            const segmentContent = segmentParts.length > 0 ? ` ${segmentParts.join('; ')};` : ''

            defSegments.push(`  defSegment($${segmentName}, ID${config.id}, {${segmentContent} });`)
          }
        }
      }

      // Process scripts (convert to BERRY blocks)
      if (controllerDef.scripts && Array.isArray(controllerDef.scripts)) {
        for (const script of controllerDef.scripts) {
          // Multiline BERRY block with indentation
          berryScripts.push(`  BERRY(\`\n  ${script}\n  \`);`)
        }
      }

      // Process plugins (they can contain both config objects and script strings)
      // If plugins contain string scripts, we intentionally ignore them here to match expected output

      // Build the complete defController block
      const controllerContent: string[] = []

      if (defSegments.length > 0) {
        controllerContent.push(...defSegments)
      }
      if (berryScripts.length > 0) {
        controllerContent.push(...berryScripts)
      }

      if (controllerContent.length > 0) {
        const controllerBlock = `defController($${controllerName}, {\n${controllerContent.join('\n')}\n});\n`

        tnglParts.push(controllerBlock)
      } else {
        // Empty controller definition
        tnglParts.push(`defController($${controllerName}, {\n});\n`)
      }
    }

    return tnglParts.join('\n\n')
  } catch (error) {
    logging.error('TNGL_DEFINITIONS_FROM_JSON: Failed to parse JSON', error)
    throw new Error(`Failed to parse TNGL_DEFINITIONS_FROM_JSON: ${error}`)
  }
}
