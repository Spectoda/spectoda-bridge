// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO REFACTOR - deprecate this file with useSpectodaStore

import { simplifyNetworkData } from './DEPRECATED_networksStore'
import { parseMapEntries } from './DEPRECATED_utils'

/** @deprecated */
export const persistConfig = {
  name: 'app-store-v2',
  storage: {
    getItem: (name: string) => {
      const str = localStorage.getItem(name) as string
      const { state } = JSON.parse(str)

      return {
        state: {
          ...state,
          controllers: parseMapEntries(state.controllers),
          devices: parseMapEntries(state.devices),
          groups: parseMapEntries(state.groups),
          uuidToController: parseMapEntries(state.uuidToController),
          controls: parseMapEntries(state.controls),
        },
      }
    },
    setItem: (name, newValue) => {
      const str = JSON.stringify({
        state: simplifyNetworkData(newValue.state),
      })

      localStorage.setItem(name, str)
    },
    removeItem: (name) => localStorage.removeItem(name),
  },
}
