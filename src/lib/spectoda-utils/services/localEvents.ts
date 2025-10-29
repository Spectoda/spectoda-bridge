import { createNanoEvents } from 'nanoevents'

// TODO add typescript types (you can read this in docs)
type Events = {
  [key: string]: unknown
}

export const nanoevents = createNanoEvents<Events>()
