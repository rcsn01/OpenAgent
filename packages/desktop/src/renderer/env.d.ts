import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OPENAGENT__?: {
      deepLinks?: string[]
    }
  }
}
