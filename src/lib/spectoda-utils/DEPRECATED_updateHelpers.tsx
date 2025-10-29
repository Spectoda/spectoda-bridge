/* eslint-disable */
// @ts-nocheck
// TODO: Remove file, replace functionality with spectoda-core

import { z } from 'zod'
const FETCH_CONFIG = { next: { revalidate: 60 } }
const BASE_URL = 'https://updates.spectoda.com/subdom/updates/firmware'

type FirmwareType = 'daily' | 'stable'
const FirmwareFirmwareListSchema = z.array(
  z.object({
    file: z.string(),
  }),
)

type FirmwareOptions = {
  type?: FirmwareType
  version?: string
  filename?: string
  filter?: string
}

async function fetchValidatedJson(url: string) {
  try {
    const response = await fetch(url, FETCH_CONFIG)
    const { files } = await response.json()
    const validatedData = FirmwareFirmwareListSchema.parse(files)

    return validatedData.map(({ file }) => file)
  } catch {
    console.log("Couldn't fetch, check your connection")
    return []
  }
}

async function fetchArrayBuffer(url: string) {
  const response = await fetch(url, FETCH_CONFIG)

  return new Uint8Array(await response.arrayBuffer())
}

export async function fetchFirmware(filename: string): Promise<Uint8Array> {
  const url = `${BASE_URL}/daily/` + filename

  return fetchArrayBuffer(url)
}

export async function fetchFirmwareVersionList(options: FirmwareOptions = {}) {
  const url =
    options.type === 'daily'
      ? `${BASE_URL}/daily/list.php`
      : `${BASE_URL}/list.php`

  let data = await fetchValidatedJson(url)

  data = data.sort(versionComparator).reverse()

  data &&
    data.sort((a, b) => {
      if (a.includes('UNIVERSAL')) {
        return -1
      }
      if (b.includes('UNIVERSAL')) {
        return 1
      }
      return 0
    })

  return options.filter
    ? data.filter((item) => item.includes(options.filter ?? ''))
    : data
}

function versionComparator(a: string, b: string) {
  const aParts = a.split('_')
  const bParts = b.split('_')

  // Compare prefixes (e.g., UNIVERSAL, EXPERIMENTAL)
  const prefixComparison = aParts[0].localeCompare(bParts[0])

  if (prefixComparison !== 0) {
    return prefixComparison
  }

  // If prefixes are the same, compare version numbers
  const aVersionParts = aParts[1].split('.')
  const bVersionParts = bParts[1].split('.')

  if (aVersionParts.length !== 3 || bVersionParts.length !== 3) {
    // Handle invalid version strings
    return 0
  }

  const aMajor = parseInt(aVersionParts[0], 10)
  const aMinor = parseInt(aVersionParts[1], 10)
  const aPatch = parseInt(aVersionParts[2], 10)

  const bMajor = parseInt(bVersionParts[0], 10)
  const bMinor = parseInt(bVersionParts[1], 10)
  const bPatch = parseInt(bVersionParts[2], 10)

  if (aMajor === bMajor) {
    if (aMinor === bMinor) {
      return aPatch - bPatch
    }
    return aMinor - bMinor
  }
  return aMajor - bMajor
}
