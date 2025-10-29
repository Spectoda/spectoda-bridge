/* eslint-disable */
// @ts-nocheck
// TODO: Remove file, replace functionality with spectoda-core

import { useEffect, useMemo, useState } from 'react'

import {
  CONNECTION,
  ConnectionStatus,
} from '../utils/DEPRECATED_SpectodaConnectionContext/DEPRECATED_constants'
import { spectoda } from '@spectoda/spectoda-core'
import { useErrorToast } from './useErrorToast'

/** @deprecated use spectoda-core instead */
const fetchVersion = async () => {
  const version = await spectoda.getFwVersion()

  const [, fw_version] = version.split('_') as [string, string]

  return {
    fw_version,
    version,
  }
}

/** @deprecated use spectoda-core instead */
export function useVersion(connectionStatus: ConnectionStatus) {
  const [version, setVersion] = useState('unknown')
  const [fullVersion, setFullVersion] = useState('unknown')
  const isConnected = useMemo(
    () => connectionStatus === CONNECTION.CONNECTED,
    [connectionStatus],
  )

  const errorToast = useErrorToast()

  useEffect(() => {
    const versionEvent = spectoda.on('version', (version: string) => {
      setVersion(version)
    })

    return () => versionEvent()
  }, [])

  useEffect(() => {
    if (isConnected) {
      fetchVersion()
        .then(({ fw_version, version }) => {
          setVersion(fw_version)
          setFullVersion(version)
        })
        .catch((e) => {
          errorToast(e)
          setVersion('error')
        })
    } else {
      setVersion('')
      setFullVersion('')
    }
  }, [isConnected])

  spectoda.on('version', (version: string) => {
    setVersion(version)
  })

  return { version, fullVersion }
}
