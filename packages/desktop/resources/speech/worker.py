from __future__ import annotations

import json
import math
import os
import sys
import traceback
from pathlib import Path
from typing import Any

import onnx_asr


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def clean_error(error: BaseException) -> str:
    message = str(error).strip()
    return message or error.__class__.__name__


def confidence_from_logprobs(logprobs: list[float] | None) -> float | None:
    if not logprobs:
        return None
    probabilities = [math.exp(value) for value in logprobs if math.isfinite(value)]
    if not probabilities:
        return None
    return max(0.0, min(1.0, sum(probabilities) / len(probabilities)))


def build_tokens(result: Any, duration_ms: int | None) -> list[dict[str, Any]] | None:
    raw_tokens = getattr(result, "tokens", None)
    if not raw_tokens:
        return None

    timestamps = getattr(result, "timestamps", None) or []
    logprobs = getattr(result, "logprobs", None) or []
    tokens: list[dict[str, Any]] = []

    for index, token in enumerate(raw_tokens):
        item: dict[str, Any] = {"text": token}
        if index < len(timestamps):
            start_ms = max(0, round(float(timestamps[index]) * 1000))
            item["startMs"] = start_ms
            if index + 1 < len(timestamps):
                item["endMs"] = max(start_ms, round(float(timestamps[index + 1]) * 1000))
            elif duration_ms is not None:
                item["endMs"] = max(start_ms, duration_ms)
        if index < len(logprobs):
            logprob = float(logprobs[index])
            item["logprob"] = logprob
            if math.isfinite(logprob):
                item["confidence"] = max(0.0, min(1.0, math.exp(logprob)))
        tokens.append(item)

    return tokens


def build_segments(text: str, confidence: float | None, duration_ms: int | None) -> list[dict[str, Any]]:
    segment: dict[str, Any] = {"text": text}
    if duration_ms is not None:
        segment["startMs"] = 0
        segment["endMs"] = duration_ms
    if confidence is not None:
        segment["confidence"] = confidence
    return [segment]


def normalize_duration_ms(value: Any) -> int | None:
    if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
        return round(value)
    return None


def load_model_with_providers(model_name: str, model_path: Path, quantization: str | None, providers: list[str] | None) -> Any:
    provider_label = ", ".join(providers) if providers else "onnxruntime default providers"
    log(f"[speech-worker] loading {model_name} from {model_path} with {provider_label}")
    return onnx_asr.load_model(
        model_name,
        model_path,
        quantization=quantization,
        providers=providers,
    ).with_timestamps()


def load_worker_model() -> Any:
    model_name = os.environ.get("PARAKEET_MODEL_NAME", "nemo-parakeet-tdt-0.6b-v3")
    model_dir = os.environ.get("PARAKEET_MODEL_DIR")
    quantization = os.environ.get("PARAKEET_QUANTIZATION") or None

    if not model_dir:
        raise RuntimeError("PARAKEET_MODEL_DIR is not set")

    model_path = Path(model_dir)
    if not model_path.exists():
        raise RuntimeError(f"Parakeet model directory does not exist: {model_path}")

    preferred_providers = None if quantization else ["CPUExecutionProvider"]
    try:
        model = load_model_with_providers(model_name, model_path, quantization, preferred_providers)
        provider = "default" if preferred_providers is None else "cpu"
    except Exception:
        if preferred_providers == ["CPUExecutionProvider"]:
            raise
        log("[speech-worker] preferred ONNX Runtime providers failed; retrying with CPUExecutionProvider")
        traceback.print_exc(file=sys.stderr)
        model = load_model_with_providers(model_name, model_path, quantization, ["CPUExecutionProvider"])
        provider = "cpu"

    emit({"type": "ready", "model": model_name, "quantization": quantization, "provider": provider})
    return model


def transcribe(model: Any, request: dict[str, Any]) -> None:
    request_id = request.get("id")
    if not isinstance(request_id, str) or not request_id:
        emit({"type": "error", "message": "Transcription request is missing an id"})
        return

    audio_path = request.get("audio_path")
    if not isinstance(audio_path, str) or not audio_path:
        emit({"type": "error", "id": request_id, "message": "Transcription request is missing audio_path"})
        return

    duration_ms = normalize_duration_ms(request.get("original_duration_ms"))
    result = model.recognize(Path(audio_path))
    text = getattr(result, "text", str(result)).strip()
    logprobs = getattr(result, "logprobs", None)
    confidence = confidence_from_logprobs(logprobs)
    tokens = build_tokens(result, duration_ms)

    response: dict[str, Any] = {
        "type": "response",
        "id": request_id,
        "text": text,
        "segments": build_segments(text, confidence, duration_ms),
    }
    if duration_ms is not None:
        response["originalDurationMs"] = duration_ms
    if confidence is not None:
        response["confidence"] = confidence
    if tokens is not None:
        response["tokens"] = tokens
    emit(response)


def run() -> int:
    try:
        model = load_worker_model()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "message": clean_error(error)})
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            emit({"type": "error", "message": "Worker received invalid JSON"})
            continue

        if request.get("type") == "shutdown":
            return 0

        if request.get("type") != "transcribe":
            emit({"type": "error", "id": request.get("id"), "message": "Unsupported worker request"})
            continue

        try:
            transcribe(model, request)
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "id": request.get("id"), "message": clean_error(error)})

    return 0


if __name__ == "__main__":
    raise SystemExit(run())
