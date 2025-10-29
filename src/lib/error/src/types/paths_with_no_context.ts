import { InferContext } from './infer_context'
import { InferPaths } from './infer_paths'

export type PathsWithNoContext<$ErrorMap> = {
  [$Paths in InferPaths<$ErrorMap>]: InferContext<
    $ErrorMap,
    $Paths
  > extends never
    ? $Paths
    : never
}[InferPaths<$ErrorMap>]
