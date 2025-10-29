import { useContext } from 'react'

import { SpectodaConnection } from '../utils/DEPRECATED_SpectodaConnectionContext'

/** @deprecated use spectoda-core instead */
export const useSpectodaConnection = () => {
  const context = useContext(SpectodaConnection)

  if (context === undefined) {
    throw new Error(
      'useSpectodaConnection must be used within a SpectodaConnectionProvider',
    )
  }
  return context
}
