/* eslint-disable @typescript-eslint/no-unused-vars */
// TODO Remove file

import {
  ControlsArray,
  FirebaseAppSettings,
  FirebaseAutomation,
  FirebaseConfig,
  FirebaseController,
  FirebaseDevice,
  FirebaseGroup,
  FirebaseScene,
} from '@spectoda/spectoda-firebase'

export type SpectodaState = {
  controllers: Map<string, FirebaseController>
  devices: Map<string, FirebaseDevice>
  newDevices: Record<string, FirebaseDevice>
  groups: Map<string, FirebaseGroup>
  uuidToController: Map<string, string>
  controls: Map<string, ControlsArray>
  settings: FirebaseAppSettings
  automations: FirebaseAutomation[]
  scenes: FirebaseScene[]
  rgbSwatches: string[]
  configs: FirebaseConfig[]
  tnglHeader: string
}

export const DEFAULT_SWATCHES = [
  '#FFFFFF',
  '#FF0000',
  '#FFFF00',
  '#00FF00',
  '#000FFF',
]

// TODO @mchlkucera remove hardcoded My Sunflow when refactoring from Firebase to database
const mockDevices = [
  // {
  //   uuid: "1",
  //   id: 1, // Spectoda Segment ID
  //   name: "My Sunflow",
  //   controls: "sunflow",
  // },
  // {
  //   uuid: "2",
  //   id: 2,
  //   name: "Brightness device",
  //   controls: "brightness",
  // },
  // {
  //   uuid: "3",
  //   id: 3,
  //   controls: "cct",
  //   name: "Temperature device",
  // },
  // {
  //   uuid: "4",
  //   id: 4,
  //   controls: "animations",
  //   name: "Animations device",
  // },
  // {
  //   uuid: "5",
  //   id: 5,
  //   controls: "rgb",
  //   name: "RGB device",
  // },
  // {
  //   uuid: "6",
  //   id: 6,
  //   controls: "amber",
  //   name: "Amber device",
  // },
  // {
  //   uuid: "7",
  //   id: 7,
  //   name: "ON/OFF device",
  //   controls: "onoff",
  // },
]
// TODO @mchlkucera remove hardcoded My Sunflow when refactoring from Firebase to database
const mockGroups = [
  // {
  //   uuid: "1",
  //   name: "Group 1",
  //   deviceIds: [1],
  //   // deviceIds: [1, 2, 3],
  // },
  // {
  //   uuid: "2",
  //   name: "Group 2",
  //   deviceIds: [4, 5, 6, 7],
  // },
]

const initialState = {
  devices: new Map(),
  groups: new Map(),
  controllers: new Map<string, FirebaseController>(),
  newDevices: {},
  uuidToController: new Map<string, string>(),
  controls: new Map<string, ControlsArray>(),
  settings: {} as FirebaseAppSettings,
  scenes: [],
  automations: [],
  rgbSwatches: DEFAULT_SWATCHES,
  configs: [],
  tnglHeader: '',
} satisfies SpectodaState

export default initialState
