/* eslint-disable */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO: Remove this file, all functionality was replaced with spectoda-core

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'

import initialState, { SpectodaState } from './DEPRECATED_initialState'
import spectodaStoreActions, { SpectodaActions } from './DEPRECATED_SpectodaStoreActions'
import { persistConfig } from './DEPRECATED_persistConfig'

enableMapSet()

/** @deprecated use useSpectodaFirebaseStore instead */
const useSpectodaStore = create<SpectodaState & SpectodaActions>()(
  devtools(
    persist(
      immer<SpectodaState & SpectodaActions>((set, getState) => ({
        ...initialState,
        ...spectodaStoreActions(set, getState),
      })),
      persistConfig,
    ),
  ),
)

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.useSpectodaStore = useSpectodaStore
}

export { useSpectodaStore }
