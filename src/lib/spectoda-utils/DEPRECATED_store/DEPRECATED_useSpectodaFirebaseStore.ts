import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import spectodaStoreActions, { SpectodaActions } from './DEPRECATED_SpectodaStoreActions'
import initialState, { SpectodaState } from './DEPRECATED_initialState'
// TODO Remove this file
// eslint-disable-next-line import/no-cycle
import { persistConfig } from './DEPRECATED_persistConfig'

enableMapSet()

/**
 * @deprecated TODO Replace all usage with useNetworkDataAdapter
 */
const useSpectodaFirebaseStore = create<SpectodaState & SpectodaActions>()(
  devtools(
    persist(
      immer<SpectodaState & SpectodaActions>((set, getState) =>
        // @ts-expect-error TODO: remove useSpectodaFirebaseStore [DEV-4734]
        ({
          ...initialState,
          ...spectodaStoreActions(set, getState),
        }),
      ),
      persistConfig,
    ),
  ),
)

export { useSpectodaFirebaseStore }
