import { InferContext } from './infer_context'
import { InferPaths } from './infer_paths'

export type PathsWithContext<$ErrorMap> = {
  [$Paths in InferPaths<$ErrorMap>]: InferContext<
    $ErrorMap,
    $Paths
  > extends never
    ? never
    : $Paths
}[InferPaths<$ErrorMap>]
