/** @deprecated  */
export const deprecatedGlobalControls = {
  DIMMA: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
  ],
  brightness: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
  ],
  brightnessAndTemperature: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
    {
      type: 'percentage',
      label: 'tempe',
    },
  ],
  brig1: [
    {
      type: 'toggle',
      label: 'togg1',
    },
    {
      type: 'percentage',
      label: 'brig1',
    },
  ],
  brig2: [
    {
      type: 'toggle',
      label: 'togg2',
    },
    {
      type: 'percentage',
      label: 'brig2',
    },
  ],
  bottom: [
    {
      type: 'toggle',
      label: 'togg2',
    },
    {
      type: 'percentage',
      label: 'brig2',
    },
  ],
  top: [
    {
      type: 'toggle',
      label: 'togg1',
    },
    {
      type: 'percentage',
      label: 'brig1',
    },
  ],
}

/** @deprecated  */
export const globalControls = {
  ...deprecatedGlobalControls,
  onoff: [
    {
      type: 'toggle',
      label: 'toggl',
    },
  ],
  dimma: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
  ],
  cct: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
    {
      type: 'percentage',
      label: 'tempe',
    },
  ],
  amber: [
    {
      type: 'toggle',
      label: 'toggl',
    },
    {
      type: 'percentage',
      label: 'brigh',
    },
    {
      type: 'percentage',
      label: 'tempe',
      meta: {
        minTemp: 1600,
        maxTemp: 4000,
      },
    },
    {
      type: 'buttons',
      title: 'Presets',
      buttons: [
        {
          title: 'Morning',
          brigh: 100,
          tempe: 4000,
        },
        {
          title: 'Evening',
          brigh: 75,
          tempe: 2700,
        },
        {
          title: 'Night',
          brigh: 40,
          tempe: 1600,
        },
      ],
    },
  ],

  onlyDimmable: [
    {
      type: 'percentage',
      label: 'brigh',
    },
  ],
  rgb: [],
  animations: [],
}
