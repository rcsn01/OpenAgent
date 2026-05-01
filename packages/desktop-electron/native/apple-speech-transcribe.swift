import Foundation
import Speech

struct Segment: Codable {
    let text: String
    let startMs: Int
    let endMs: Int
    let confidence: Double?
}

struct Payload: Codable {
    let text: String
    let language: String?
    let confidence: Double?
    let segments: [Segment]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func requestSpeechAccess() {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .authorized {
        return
    }
    if status == .denied || status == .restricted {
        fail("Speech recognition access was denied")
    }

    let semaphore = DispatchSemaphore(value: 0)
    var authorized = false
    SFSpeechRecognizer.requestAuthorization { value in
        authorized = value == .authorized
        semaphore.signal()
    }
    semaphore.wait()
    if !authorized {
        fail("Speech recognition access was denied")
    }
}

guard CommandLine.arguments.count >= 2 else {
    fail("Expected an audio file path")
}

requestSpeechAccess()

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard FileManager.default.fileExists(atPath: url.path) else {
    fail("Audio file does not exist")
}

guard let recognizer = SFSpeechRecognizer() else {
    fail("Apple Speech is unavailable on this Mac")
}

let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false
if recognizer.supportsOnDeviceRecognition {
    request.requiresOnDeviceRecognition = true
}

let semaphore = DispatchSemaphore(value: 0)
var payload: Payload?
var failure: String?

let task = recognizer.recognitionTask(with: request) { result, error in
    if let error {
        failure = error.localizedDescription
        semaphore.signal()
        return
    }

    guard let result, result.isFinal else {
        return
    }

    let segments = result.bestTranscription.segments.map {
        Segment(
            text: $0.substring,
            startMs: Int(($0.timestamp * 1000).rounded()),
            endMs: Int((($0.timestamp + $0.duration) * 1000).rounded()),
            confidence: Double($0.confidence)
        )
    }
    let confidence = segments.isEmpty
        ? nil
        : segments.compactMap(\.confidence).reduce(0, +) / Double(segments.count)
    payload = Payload(
        text: result.bestTranscription.formattedString,
        language: recognizer.locale.identifier,
        confidence: confidence,
        segments: segments
    )
    semaphore.signal()
}

let timeout = DispatchTime.now() + .seconds(120)
if semaphore.wait(timeout: timeout) == .timedOut {
    task.cancel()
    fail("Apple Speech transcription timed out")
}

task.cancel()

if let failure {
    fail(failure)
}

guard let payload, let data = try? JSONEncoder().encode(payload) else {
    fail("Apple Speech failed to produce a result")
}

FileHandle.standardOutput.write(data)
