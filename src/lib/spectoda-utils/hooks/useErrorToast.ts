/* eslint-disable no-console */

import { ErrorFormat, general, getError } from '../errors'

import { ToastProps, useToast } from './useToast'

export const errorToastContent = (errorCode: string): ToastProps => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore Because we don`t know what type of error we will get
  const { message, title, url } = getError(errorCode, 'studio')

  return { title, description: message, status: 'error', url, code: errorCode }
}

/**
 * @deprecated use `toast.error` from `sonner` package instead
 */
export const useErrorToast = () => {
  const toast = useToast()

  return (error: unknown) => {
    if (error === 'UserCanceledSelection') {
      const { title, message } = general.UserCanceledSelection as ErrorFormat

      toast({ title, description: message })
      return
    }

    if (hasTitle(error)) {
      console.error(error.error)
      toast({ title: error.title, status: 'error' })
      return
    }

    if (error instanceof Error) {
      console.error(error)
      if (error.name) {
        toast(errorToastContent(error.name))
        return
      }
      toast(errorToastContent(error.message))
      return
    }

    if (typeof error === 'string') {
      console.error(error)
      toast(errorToastContent(error))
      return
    }
  }
}

const hasTitle = (
  error: unknown,
): error is { title: string; error: unknown } => {
  if (!error) {
    return false
  }
  if (typeof error !== 'object') {
    return false
  }
  if (!('title' in error)) {
    return false
  }
  if (typeof error?.title !== 'string') {
    return false
  }
  return true
}
