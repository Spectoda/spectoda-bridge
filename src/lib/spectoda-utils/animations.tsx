import { MotionNodeAnimationOptions } from 'framer-motion'

// TODO EASY: Replace all heightAndOpacityAnimation(number) with heightAndOpacityAnimation()
export const heightAndOpacityAnimation = (_height?: number) =>
  ({
    initial: { height: 0, opacity: 0, overflow: 'hidden' },
    animate: { height: 'auto', opacity: 1, overflow: 'visible' },
    exit: { height: 0, opacity: 0, overflow: 'hidden' },
  } satisfies MotionNodeAnimationOptions)

export const widthAndOpacityAnimation = (
  width: number,
  initialShow?: boolean,
) =>
  ({
    initial: {
      maxWidth: initialShow ? width : 0,
      opacity: initialShow ? 1 : 0,
    },
    animate: { maxWidth: width, opacity: 1 },
    exit: { maxWidth: 0, opacity: 0 },
  } satisfies MotionNodeAnimationOptions)

export const fadeUpAnimation = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 12 },
} satisfies MotionNodeAnimationOptions

export const fadeDownAnimation = {
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
} satisfies MotionNodeAnimationOptions

export const fadeLeftAnimation = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
} satisfies MotionNodeAnimationOptions

export const fadeRightAnimation = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
} satisfies MotionNodeAnimationOptions

export const fadeScaleAnimation = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
} satisfies MotionNodeAnimationOptions

export const fadeAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} satisfies MotionNodeAnimationOptions

export const opacityBlurAnimation = {
  initial: { opacity: 0, filter: 'blur(1px)' },
  animate: { opacity: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, filter: 'blur(1px)' },
  transition: { duration: 0.1 },
} satisfies MotionNodeAnimationOptions
