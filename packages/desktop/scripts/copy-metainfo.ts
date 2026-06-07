import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "com.rcsn01.openagent" : `com.rcsn01.openagent.${channel}`
const productName = channel === "prod" ? "OpenAgent" : `OpenAgent ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `GUI for external opencode servers${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="com.rcsn01">
    <name>OpenAgent</name>
  </developer>

  <description>
    <p>
      OpenAgent is a desktop GUI for connecting to stock external opencode servers.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/rcsn01/OpenAgent/issues</url>
  <url type="homepage">https://github.com/rcsn01/OpenAgent</url>
  <url type="vcs-browser">https://github.com/rcsn01/OpenAgent</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
