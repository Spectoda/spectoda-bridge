import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// TODO @mchlkucera:
// 1 - centralize tailwind.config for studio and app
// 2 - include extended tailwind class merging based on custom color and z-index values (code: https://gist.github.com/mchlkucera/4c5dfb835ccd87ddac566620d61bd5a3)

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}

export const separateLayoutClasses = (
  classes: string | undefined,
): [layout: string, rest: string] => {
  // go through classes and filter out any that don't start with "col-", split it to two arrays, one for container and one for children

  const children = []
  const container = []

  if (!classes) {
    return ['', '']
  }

  for (const className of classes.split(' ')) {
    if (className.startsWith('col-')) {
      container.push(className)
    } else {
      children.push(className)
    }
  }

  return [cn(container), cn(children)]
}
