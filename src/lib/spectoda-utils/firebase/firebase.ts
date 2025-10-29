import { atomWithLocalStorage } from '../utils/DEPRECATED_atom'

/** @deprecated */
export const isAutoConnectEnabledAtom = atomWithLocalStorage(
  'auto-connect',
  true,
)

/** @deprecated */
export const useFirebaseAuthentication = () => {
  return () => console.log('useFirebaseAuthentication is deprecated')
}
