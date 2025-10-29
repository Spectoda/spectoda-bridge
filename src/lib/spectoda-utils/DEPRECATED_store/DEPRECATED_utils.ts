export const parseMapEntries = (entries: [string, unknown][]) => {
  return new Map(entries.map(([key, value]) => [key, value]))
}
