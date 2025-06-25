export type ControllerMessage = {
  description: string
  code: number
}

export type ControllerError = {
  controller: { mac: string; label: string }
  errors: ControllerMessage[]
}

export type ControllerWarning = {
  controller: { mac: string; label: string }
  warnings: ControllerMessage[]
}
