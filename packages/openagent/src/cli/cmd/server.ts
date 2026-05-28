import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { SharedServer } from "@/server/shared-manager"

function print(value: unknown, json?: boolean) {
  if (json) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  console.log(value)
}

export const ServerCommand = effectCmd({
  command: "server <action>",
  describe: "manage the shared local openagent server",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["start", "stop", "status", "doctor"] as const,
        demandOption: true,
      })
      .option("json", {
        type: "boolean",
        describe: "print machine-readable JSON",
        default: false,
      }),
  handler: Effect.fn("Cli.server")(function* (args) {
    if (args.action === "start") {
      const metadata = yield* Effect.promise(() => SharedServer.start())
      print(args.json ? metadata : metadata.url, args.json)
      return
    }

    if (args.action === "stop") {
      const stopped = yield* Effect.promise(() => SharedServer.stop())
      print(args.json ? { stopped } : stopped ? "stopped" : "not running", args.json)
      return
    }

    if (args.action === "status") {
      const status = yield* Effect.promise(() => SharedServer.status())
      print(args.json ? status : status.status, args.json)
      return
    }

    const result = yield* Effect.promise(() => SharedServer.doctor())
    print(result, true)
  }),
})
