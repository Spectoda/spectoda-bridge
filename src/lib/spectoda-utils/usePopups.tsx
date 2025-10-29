/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
// TODO REFACTOR FILE

import { ReactElement, ReactNode, useCallback, useRef } from 'react'
import { create } from 'zustand'

type PromptInterface = {
  cancel: () => void
  action: (value: string | { name: string; switchValue?: boolean }) => void
}

type SimpleModal = string

type ComplexModal = {
  title?: string
  useOverlay?: boolean
  description?: string
  destructive?: boolean
  actionName?: string
  buttons?: ReactElement[] | []
  content?: ReactNode
  disableClose?: boolean
}

// Modal hook
export type ClientModalProps = SimpleModal | ComplexModal

export type ModalProps = ComplexModal & {
  setOpen: (open: boolean) => void
  open?: boolean
}

// Prompt hook
export type ClientPromptProps = {
  title?: string
  placeholder?: string
  actionName?: string
  defaultValue?: string
  description?: string
  useOverlay?: boolean
  footerSwitch?: string
}

export type PromptProps = {
  open?: boolean
  setOpen: (open: boolean) => void
  type: 'confirm' | 'prompt'
  footerSwitch?: string
  showCancel?: boolean
} & ClientPromptProps &
  ComplexModal &
  PromptInterface

type ModalInterface = {
  type?: 'modal'
}

type ModalAtom = ComplexModal & ModalInterface
type PromptAtom = ClientPromptProps & PromptInterface & { type: 'prompt' }
type ConfirmAtom = ComplexModal & PromptInterface & { type: 'confirm' }
type GenericModalAtom = ModalAtom | PromptAtom | ConfirmAtom
export type ClientConfirmProps = ComplexModal

export const useModalAtom = create<{
  modal: GenericModalAtom | null
  setModal: (modal: GenericModalAtom | null) => void
}>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
}))

export const useModal = () => {
  const setModal = useModalAtom((atom) => atom.setModal)

  const modal = useCallback(
    (props: ClientPromptProps) => {
      setModal({ type: 'modal', ...props })
    },
    [setModal],
  )

  return modal
}

export const usePrompt = () => {
  const setModal = useModalAtom((atom) => atom.setModal)

  const resolve = useRef<(value: string | false) => void>()

  const handleAction = useCallback((content: any) => {
    resolve.current?.(content)
  }, [])

  const handleCancel = useCallback(() => {
    resolve.current?.(false)
  }, [])

  const prompt = useCallback(
    async (props: ClientPromptProps) => {
      setModal({
        ...props,
        type: 'prompt',
        cancel: handleCancel,
        action: handleAction,
      })

      const promise = new Promise<string | false>((local_resolve) => {
        resolve.current = local_resolve
      })

      return promise
    },
    [setModal, handleCancel, handleAction],
  )

  return prompt
}

export const useConfirm = () => {
  const setModal = useModalAtom((atom) => atom.setModal)

  const confirm = useCallback(
    async (props: ClientConfirmProps) => {
      return new Promise<boolean>((resolve) => {
        const handleAction = (result: boolean) => {
          resolve(result)
          setModal(null)
        }

        setModal({
          ...props,
          type: 'confirm',
          cancel: () => handleAction(false),
          action: () => handleAction(true),
        })
      })
    },
    [setModal],
  )

  return confirm
}
