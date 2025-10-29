/* eslint-disable */
// @ts-nocheck
// TODO: Remove file, replace functionality with spectoda-core

import { detectSpectodaConnect } from '@spectoda/spectoda-js/v012'
import { useEffect } from 'react'

/**
 * Hook that modifies form submission behavior when Spectoda Connect is detected.
 * It prevents default submission for all submit buttons and submits their parent form programmatically.
 * Cleans up event listeners on unmount.
 *
 * @returns {void}
 */
export function useSpectodaConnectFormTweaks() {
  useEffect(() => {
    if (!detectSpectodaConnect()) {
      return
    }

    const submitButtons = document.querySelectorAll(
      'button[type="submit"], input[type="submit"]',
    )

    const handleClick = (e: Event) => {
      e.preventDefault()

      const button = e.currentTarget as HTMLButtonElement | HTMLInputElement
      const form = button.closest('form')

      if (form) {
        form.submit()
      }
    }

    // Add event listeners
    submitButtons.forEach((button) => {
      button.addEventListener('click', handleClick)
    })

    // Cleanup function to remove event listeners
    return () => {
      submitButtons.forEach((button) => {
        button.removeEventListener('click', handleClick)
      })
    }
  }, [])
}
