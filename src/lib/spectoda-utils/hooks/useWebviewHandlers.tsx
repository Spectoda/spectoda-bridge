import { detectSpectodaConnect, logging } from '@spectoda/spectoda-js/v012'
import { useEffect } from 'react'

/**
 * Sets up form submission handling for Spectoda Connect compatibility
 * @returns {() => void} Cleanup function to remove event listeners
 */
const setupFormSubmissionHandling = () => {
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
  for (const button of submitButtons) {
    button.addEventListener('click', handleClick)
  }

  // Return cleanup function
  return () => {
    for (const button of submitButtons) {
      button.removeEventListener('click', handleClick)
    }
  }
}

/**
 * Sets up handling of external links for Flutter Spectoda Connect
 * @returns {() => void} Cleanup function to remove event listener
 */
const setupFlutterExternalLinksHandling = () => {
  const handleClick = (e: Event) => {
    e.preventDefault()

    // Polyfill for composedPath
    if (!e.composedPath) {
      e.composedPath = function () {
        if ((this as any).path) {
          return (this as any).path
        }
        let target = this.target as Node
        const path = []

        while (target.parentNode !== null) {
          path.push(target)
          target = target.parentNode
        }
        path.push(document, window)
        return path
      }
    }

    const path = (e as any).path || (e.composedPath && e.composedPath())

    for (const el of path) {
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        e.preventDefault()
        const url = el.getAttribute('href')

        logging.verbose(url)
        logging.debug('Opening external url', url)
        ;(window as any).flutter_inappwebview.callHandler(
          'openExternalUrl',
          url,
        )
        break
      }
    }
  }

  document.querySelector('body')?.addEventListener('click', handleClick)

  return () => {
    document.querySelector('body')?.removeEventListener('click', handleClick)
  }
}

/**
 * Hook that handles form submission and external links in Spectoda Connect Webview
 */
export const useWebviewHandlers = () => {
  useEffect(() => {
    if (detectSpectodaConnect()) {
      const cleanupForm = setupFormSubmissionHandling()
      const cleanupLinks = setupFlutterExternalLinksHandling()

      return () => {
        cleanupForm()
        cleanupLinks()
      }
    }
  }, [])
}
