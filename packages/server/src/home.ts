import { homedir } from "node:os"
import { join } from "node:path"

export function openAgentHome() {
  return process.env.OPENAGENT_HOME || join(homedir(), ".openagent")
}

export function serverMetadataPath(home = openAgentHome()) {
  return join(home, "server.json")
}

export function authPath(home = openAgentHome()) {
  return join(home, "auth.json")
}

export function configPath(home = openAgentHome()) {
  return join(home, "config.json")
}
