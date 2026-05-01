import type { SpeechCaptureSessionInfo } from "@/context/platform"

export const adoptSpeechCaptureSession = (session?: SpeechCaptureSessionInfo) =>
  session?.source === "native" ? session : undefined
