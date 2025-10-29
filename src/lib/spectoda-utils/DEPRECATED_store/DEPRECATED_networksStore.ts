/* eslint-disable @typescript-eslint/ban-types */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO REFACTOR

/** @deprecated file **/

/** @deprecated */
export const simplifyNetworkData = (dataToStore: Object): string => {
  const dataToSerialize = {
    controllers: [...dataToStore.controllers.entries()],
    devices: [...dataToStore.devices.entries()],
    groups: [...dataToStore.groups.entries()],
    uuidToController: [...dataToStore.uuidToController.entries()],
    controls: [...dataToStore.controls.entries()],
    settings: dataToStore.settings,
    automations: dataToStore.automations,
    rgbSwatches: dataToStore.rgbSwatches,
    tnglHeader: dataToStore.tnglHeader,
  }

  return dataToSerialize
}
