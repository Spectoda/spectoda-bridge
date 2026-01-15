import type { Criterium } from '../src/types/primitives'

export const mockScanResult = [
  {
    commissionable: true,
    fw: '0.12.11',
    mac: '12:e3:6d:0a:06:0c',
    name: 'LU_PA',
    network: '00000000000000000000000000000000',
    product: 37,
  },
  {
    commissionable: true,
    fw: '0.12.11',
    mac: '78:e3:6d:0a:06:0c',
    name: 'LU_PA',
    network: '00000000000000000000000000000000',
    product: 37,
  },
  {
    commissionable: true,
    fw: '0.12.11',
    mac: '13:e4:3d:2a:07:2c',
    name: 'LU_PA',
    network: '00000000000000000000000000000000',
    product: 37,
  },
] satisfies Criterium[]
