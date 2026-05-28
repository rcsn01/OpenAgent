import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENAGENT_CHANNEL ?? "dev"}`

await $`cd ../openagent && bun script/build-node.ts`
