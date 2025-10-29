import { useEffect, useState } from 'react'

import { spectoda } from '../services/communication'

export const usePlayingStatus = () => {
  const [isPlaying, setIsPlaying] = useState(!spectoda.timeline?.paused())

  useEffect(() => {
    spectoda.timeline?.on('play', () => {
      setIsPlaying(true)
    })
    spectoda.timeline?.on('pause', () => {
      setIsPlaying(false)
    })
    spectoda.timeline?.on('millis', () => {
      if (spectoda.timeline?.paused()) {
        setIsPlaying(false)
      } else {
        setIsPlaying(true)
      }
    })
  }, [])

  return { isPlaying }
}
