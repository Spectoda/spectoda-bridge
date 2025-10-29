/* eslint-disable @typescript-eslint/no-unused-vars */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// TODO REFACTOR and remove file

import type {
  ControlType,
  ControlsArray,
  FirebaseAutomation,
  FirebaseConfig,
  FirebaseController,
  FirebaseDevice,
  FirebaseGroup,
  FirebaseScene,
} from '@spectoda/spectoda-firebase'
import {
  DEFAULT_TOP_LEVEL_ELEMENT,
  mockData as mockNetworkData,
} from '@spectoda/spectoda-core'

// import { DeviceWithType } from "./SpectodaStoreActions";
import { globalControls } from '../globalControls'
import {
  NetworkSnapshotWithoutPermissions,
  Element,
} from '@spectoda/spectoda-server'

import { Nullable } from '../typeUtils'

import { SpectodaState } from './DEPRECATED_initialState'

export type DeviceWithType = {
  type: 'device'
} & FirebaseDevice
export type GroupWithType = {
  type: 'group'
} & FirebaseGroup
export type GroupWithVisibility = {
  isVisible: boolean | 'partial'
} & FirebaseGroup
export type DeviceWithVisibility = {
  isVisible: boolean | 'partial'
} & Element
export type GroupWithChildren = {
  children: Array<DeviceWithType>
} & GroupWithType

export type AggregatedDevicesInGroups = Array<
  DeviceWithType | GroupWithChildren
>

const networkElementsWithAllDevices = (
  networkId: NetworkSnapshotWithoutPermissions['id'],
) => {
  const network = mockNetworkData.find((network) => network.id === networkId)

  return [...(network?.elements ?? []), DEFAULT_TOP_LEVEL_ELEMENT]
}

/**
 * TODO: Refactor
 * @deprecated
 */
export type SpectodaActions = {
  addDevice: (device: FirebaseDevice) => void
  editDevice: (device: DeviceWithVisibility) => void
  getDevice: (
    id: string,
    networkId: NetworkSnapshotWithoutPermissions['id'],
  ) => DeviceWithVisibility
  getDevices: (
    networkId: NetworkSnapshotWithoutPermissions['id'],
  ) => DeviceWithVisibility[]
  getNewDevices: () => DeviceWithVisibility[]
  setDeviceConsumption: (id: number, consumption: number) => void
  getScenes: () => FirebaseScene[]

  addController: (controller: FirebaseController) => void
  adoptAndAddController: () => void
  getControllers: () => FirebaseController[]
  getController: (mac: string) => FirebaseController
  getControllerMacsForUuids: (
    uuid: string | string[],
  ) => string | string[] | undefined

  getAggregatedDevicesInGroups: () => {
    devicesWithoutGroup: Array<DeviceWithType>
    groups: Array<GroupWithChildren>
  }

  getControls: (controls: string) => ControlsArray

  getGroups: (
    network: Nullable<NetworkSnapshotWithoutPermissions>,
  ) => GroupWithVisibility[]

  getControlsForSegment: (
    deviceId: number,
    segmentIndex: number,
  ) => ControlsArray
  getControlsForDevice: (
    deviceId: number,
    networkId: NetworkSnapshotWithoutPermissions['id'],
  ) => ControlsArray
  getControlsForGroup: (
    groupUuid: string,
    getKeywords?: boolean,
  ) => ControlsArray
  getControlsForAllDevices: () => ControlsArray
  getIdsForAllDevices: () => number[]

  getAutomations: () => FirebaseAutomation[]

  setState: (state: SpectodaState) => void

  getRgbSwatches: () => string[]
  setRgbSwatches: (swatches: string[]) => void

  getConfigs: () => FirebaseConfig[]
  addConfig: (config: FirebaseConfig) => void
}

const mapToArray = <T>(map: Map<string, T>) => {
  return [...map.values()]
}

const spectodaStoreActions = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (draft: any) => void,
  getState: () => SpectodaState & SpectodaActions,
) => {
  return {
    getControls: (passedControls) => {
      return
    },

    getRgbSwatches() {
      return ['#ffffff', '#ff0000', '#ffff00', '#00ff00', '#000fff']
    },

    setRgbSwatches(swatches) {
      return
    },

    getAutomations() {
      return
    },

    getControlsForDevice(
      deviceId: number,
      networkId: NetworkSnapshotWithoutPermissions['id'],
    ) {
      const device = networkElementsWithAllDevices(networkId, deviceId).find(
        (element) => element.id === deviceId,
      )

      if (!device?.controls) {
        return []
      }

      const result =
        getState().controls?.get(device.controls.toString()) ??
        globalControls[device.controls]

      return result ? result : []
    },

    getControlsForGroup(groupUuid: string) {
      const group = getState()?.groups?.get(`${groupUuid}`)

      if (!group?.deviceIds) {
        return []
      }

      const controls = group?.deviceIds
        .map((deviceId) => {
          const device = getState()?.devices?.get(`${deviceId}`)

          return device?.controls?.toString()
        })
        .filter((v): v is ControlType => v !== undefined)

      const uniqueControls = [...new Set(controls)]

      if (uniqueControls.some((v) => v.match(/rgb|animations/))) {
        return uniqueControls
      }

      const controlsForGroup = uniqueControls
        .flatMap(
          (controls) =>
            (controls && getState().controls?.get(controls)) ??
            globalControls[controls],
        )
        .filter((control): control is ControlsArray => control !== undefined)

      return controlsForGroup || []
    },

    getIdsForAllDevices() {
      return []
    },

    addDevice: (device: FirebaseDevice) => {
      set((draft: SpectodaState) => {
        draft.devices.set(device.uuid, device)
      })
    },

    getControllerMacsForUuids(uuidOrUuids: string | string[]) {
      return undefined
    },

    getGroups(network: NetworkSnapshotWithoutPermissions) {
      if (!network) {
        return []
      }

      const groups = network.groups || []
      const devices = network.elements || []

      const deviceIdsInGroups = new Set(
        groups.flatMap((group) => group.deviceIds),
      )
      const deviceIdsNotInGroups = devices
        .map((device) => device.id)
        .filter((id) => !deviceIdsInGroups.has(id))

      if (deviceIdsNotInGroups.length > 0) {
        groups.push({
          name: 'No group',
          uuid: '9999',
          deviceIds: deviceIdsNotInGroups,
        })
      }

      return groups
    },

    getControllers() {
      const controllers = [...getState().controllers.entries()].map(
        ([key, controller]) => controller,
      )

      return controllers
    },

    getDevice(id: number, networkId: NetworkSnapshotWithoutPermissions['id']) {
      const network = mockNetworkData.find(
        (network) => network.id === networkId,
      )

      const element = networkElementsWithAllDevices(networkId).find(
        (element) => element.id === id,
      )

      return element
    },

    getDevices(networkId: NetworkSnapshotWithoutPermissions['id']) {
      if (!networkId) {
        return []
      }

      const elements = networkElementsWithAllDevices(networkId)

      return elements
    },

    editDevice(device) {
      return
    },

    editGroup(group) {
      return
    },

    setState(state) {
      return
    },
  } satisfies SpectodaActions
}

export default spectodaStoreActions
