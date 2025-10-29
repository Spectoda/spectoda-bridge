import { ZodError } from 'zod'
import { formatZodErrorToString } from '../../spectoda-utils/zod'

import { defineMap } from './define'

export const { languages: LANGUAGES, error_map: ERROR_MAP } = defineMap(
  ['en'],
  {
    test: {
      WITH_CONTEXT: (ctx: { name: string }) => ({
        en: `Hello, ${ctx.name}!`,
      }),
      NO_CONTEXT: () => ({
        en: 'Hello, World!',
      }),
    },
    network: {
      getNetworkForSignedUser: {
        NO_KINDE_ORG_ID: (ctx: { id: number }) => ({
          en: `Network (${ctx.id}) has no kindeOrgId`,
        }),
        NO_SNAPSHOT: (ctx: { id: number }) => ({
          en: `Network (${ctx.id}) has no snapshot`,
        }),
        OPERATION_APPLY: () => ({
          en: 'Could not apply operations',
        }),
        INVALID_SNAPSHOT: (ctx: { id: number; zod_error: ZodError }) => ({
          en: `Internal error: Invalid snapshot data structure for network ${
            ctx.id
          }. Please contact support. (${formatZodErrorToString(
            ctx.zod_error,
          )})`,
        }),
      },
    },
  },
)

export const ERROR_PROPERTY = '__ERROR__'
