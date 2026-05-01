import AVFoundation
import Foundation

struct ReadyPayload: Codable {
    let sampleRate: Double
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func requestMicrophoneAccess() {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    if status == .authorized {
        return
    }
    if status == .denied || status == .restricted {
        fail("Microphone access was denied")
    }

    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { value in
        granted = value
        semaphore.signal()
    }
    semaphore.wait()
    if !granted {
        fail("Microphone access was denied")
    }
}

func writeReady(sampleRate: Double) {
    let payload = ReadyPayload(sampleRate: sampleRate)
    guard let data = try? JSONEncoder().encode(payload) else {
        fail("Failed to encode native speech capture header")
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func writeSamples(_ samples: [Float]) {
    samples.withUnsafeBytes { bytes in
        FileHandle.standardOutput.write(Data(bytes))
    }
}

requestMicrophoneAccess()

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.inputFormat(forBus: 0)
let channelCount = Int(format.channelCount)

writeReady(sampleRate: format.sampleRate)

input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    guard let channelData = buffer.floatChannelData else {
        return
    }

    let frameCount = Int(buffer.frameLength)
    if frameCount == 0 {
        return
    }

    if channelCount == 1 {
        let samples = Array(UnsafeBufferPointer(start: channelData[0], count: frameCount))
        writeSamples(samples)
        return
    }

    var mono = [Float](repeating: 0, count: frameCount)
    for channel in 0..<channelCount {
        let values = UnsafeBufferPointer(start: channelData[channel], count: frameCount)
        for index in 0..<frameCount {
            mono[index] += values[index]
        }
    }
    let divisor = Float(channelCount)
    for index in 0..<frameCount {
        mono[index] /= divisor
    }
    writeSamples(mono)
}

do {
    try engine.start()
} catch {
    fail("Failed to start native speech capture: \(error.localizedDescription)")
}

RunLoop.main.run()
