import { useAtom, atom } from 'jotai'
import * as R from '@radix-ui/react-toast'
import { ReactNode } from 'react'
import { nanoid } from 'nanoid'

const REMOVE_DELAY = 6000

export type ToastStatus = 'success' | 'error'

type InternalToastFunctions = {
  toastId: string
  removeToast: (id: string) => void
}

export type ToastProps = {
  id?: string
  title: string
  status?: ToastStatus
  description?: string
  url?: string
  code?: string
  icon?: ReactNode
  delay?: number
  action?: string
  onActionClick?: () => void
} & R.ToastProps

export type ToastImplProps = ToastProps & InternalToastFunctions

export const toastListAtom = atom<ToastImplProps[] | []>([])

export const useToast = () => {
  const [toastList, setToastList] = useAtom(toastListAtom)

  const removeToast = (toastId: string) =>
    setToastList((current: ToastImplProps[]) =>
      current.filter((toast) => toast.toastId !== toastId),
    )

  const removeToastAfterTime = (toastId: string, delay = REMOVE_DELAY) =>
    setTimeout(() => removeToast(toastId), delay)

  return (props: string | ToastProps) => {
    const toastId = nanoid()
    const stringPropHandled =
      typeof props === 'object' ? props : { title: props }

    const existingToast = toastList.find(
      (toast) => toast.toastId === stringPropHandled.id,
    )

    if (existingToast) {
      removeToast(existingToast.toastId)
    }

    setToastList((current) => [
      ...current,
      { ...stringPropHandled, removeToast, toastId },
    ])

    removeToastAfterTime(toastId, stringPropHandled?.delay)
  }
}
