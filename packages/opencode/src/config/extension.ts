export * as ConfigExtension from "./extension"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt, withStatics } from "@/util/schema"

export const Installed = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  installed_at: NonNegativeInt,
  config_path: Schema.String,
  mcp_servers: Schema.mutable(Schema.Array(Schema.String)),
  skill_roots: Schema.mutable(Schema.Array(Schema.String)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Installed = Schema.Schema.Type<typeof Installed>

export const Info = Schema.Struct({
  installed: Schema.optional(Schema.mutable(Schema.Array(Installed))),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
