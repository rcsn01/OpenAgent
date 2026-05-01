import inspect
import json
import math
import os
import sys
import wave

MODEL_NAME = os.environ.get("PARAKEET_MODEL_NAME", "nemo-parakeet-tdt-0.6b-v3")
MODEL_DIR = os.environ.get("PARAKEET_MODEL_DIR", "").strip() or None
PREFERRED_QUANTIZATION = os.environ.get("PARAKEET_QUANTIZATION", "int8").strip() or None
PROVIDERS = ["CPUExecutionProvider"]
SHORT_CLIP_GATE_DURATION_MS = 1000
SHORT_CLIP_CONFIDENCE_THRESHOLD = 0.55
PROMPT_OPTION_NAMES = (
    ("prompt_terms", lambda terms: terms),
    ("hotwords", lambda terms: terms),
    ("hints", lambda terms: terms),
    ("keywords", lambda terms: terms),
    ("vocabulary", lambda terms: terms),
    ("vocab", lambda terms: terms),
    ("prompt", lambda terms: ", ".join(terms)),
)


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def read_value(item, *names):
    if isinstance(item, dict):
        for name in names:
            value = item.get(name)
            if value is not None:
                return value
        return None

    for name in names:
        value = getattr(item, name, None)
        if value is not None:
            return value
    return None


def as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)

    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        converted = tolist()
        if isinstance(converted, list):
            return converted
    return None


def normalize_ms(value, explicit_ms):
    if not isinstance(value, (int, float)):
        return None
    if explicit_ms:
        return round(value)
    if isinstance(value, float):
        return round(value * 1000)
    return round(value)


def normalize_logprob(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def normalize_confidence(value):
    numeric = normalize_logprob(value)
    if numeric is None:
        return None
    if 0 < numeric <= 1:
        return round(numeric, 4)
    if numeric <= 0:
        return round(math.exp(max(numeric, -20)), 4)
    return None


def average_confidence(values):
    items = [item for item in (normalize_confidence(value) for value in as_list(values) or []) if item is not None]
    if not items:
        return None
    return round(sum(items) / len(items), 4)


def normalize_tokens(tokens, timestamps, logprobs):
    normalized_tokens = as_list(tokens)
    if not normalized_tokens:
        return None

    normalized_timestamps = as_list(timestamps) or []
    normalized_logprobs = as_list(logprobs) or []
    items = []

    for index, token in enumerate(normalized_tokens):
        if not isinstance(token, str) or not token:
            continue

        payload = {"text": token}
        start_ms = normalize_ms(normalized_timestamps[index], False) if index < len(normalized_timestamps) else None
        end_ms = normalize_ms(normalized_timestamps[index + 1], False) if index + 1 < len(normalized_timestamps) else None
        logprob = normalize_logprob(normalized_logprobs[index]) if index < len(normalized_logprobs) else None
        confidence = normalize_confidence(logprob)
        if start_ms is not None:
            payload["startMs"] = start_ms
        if end_ms is not None:
            payload["endMs"] = end_ms
        if logprob is not None:
            payload["logprob"] = round(logprob, 4)
        if confidence is not None:
            payload["confidence"] = confidence
        items.append(payload)

    return items or None


def normalize_segment(item):
    text = read_value(item, "text")
    if not isinstance(text, str) or not text.strip():
        return None

    start_ms = normalize_ms(read_value(item, "start_ms", "startMs"), True)
    end_ms = normalize_ms(read_value(item, "end_ms", "endMs"), True)
    if start_ms is None and end_ms is None:
        start_ms = normalize_ms(read_value(item, "start"), False)
        end_ms = normalize_ms(read_value(item, "end"), False)

    payload = {"text": text.strip(), "startMs": start_ms, "endMs": end_ms}
    confidence = average_confidence(read_value(item, "logprobs"))
    if confidence is not None:
        payload["confidence"] = confidence
    return payload


def synthesize_segments(text, tokens, audio_duration_ms, confidence):
    if not text.strip():
        return None

    if tokens:
        start_ms = next((token.get("startMs") for token in tokens if token.get("startMs") is not None), None)
        end_ms = next((token.get("endMs") for token in reversed(tokens) if token.get("endMs") is not None), None)
        if end_ms is None:
            end_ms = next((token.get("startMs") for token in reversed(tokens) if token.get("startMs") is not None), None)
    else:
        start_ms = 0 if audio_duration_ms is not None else None
        end_ms = audio_duration_ms

    payload = {"text": text.strip(), "startMs": start_ms, "endMs": end_ms}
    if confidence is not None:
        payload["confidence"] = confidence
    return [payload]


def normalize_result(result, audio_duration_ms=None):
    text = ""
    language = None
    segments = None
    tokens = None
    confidence = None

    if isinstance(result, str):
        text = result
    elif isinstance(result, list):
        segments = [segment for segment in (normalize_segment(item) for item in result) if segment]
        text = " ".join(segment["text"] for segment in segments)
        confidence = average_confidence([segment.get("confidence") for segment in segments])
    else:
        maybe_text = getattr(result, "text", None)
        if isinstance(maybe_text, str):
            text = maybe_text
        else:
            text = str(result)

        maybe_language = getattr(result, "language", None)
        if isinstance(maybe_language, str):
            language = maybe_language

        maybe_segments = as_list(read_value(result, "segments"))
        if maybe_segments:
            segments = [segment for segment in (normalize_segment(item) for item in maybe_segments) if segment]
        tokens = normalize_tokens(read_value(result, "tokens"), read_value(result, "timestamps"), read_value(result, "logprobs"))
        confidence = average_confidence(read_value(result, "logprobs"))
        if not segments:
            segments = synthesize_segments(text, tokens, audio_duration_ms, confidence)

    payload = {"text": text.strip(), "language": language}
    if confidence is not None:
        payload["confidence"] = confidence
    if segments:
        payload["segments"] = segments
    if tokens:
        payload["tokens"] = tokens
    return payload


def load_model():
    import onnx_asr

    errors = []
    attempts = [PREFERRED_QUANTIZATION, None] if PREFERRED_QUANTIZATION else [None]
    for quantization in attempts:
        try:
            if quantization:
                if MODEL_DIR:
                    return (
                        onnx_asr.load_model(MODEL_NAME, MODEL_DIR, quantization=quantization, providers=PROVIDERS),
                        quantization,
                    )
                return onnx_asr.load_model(MODEL_NAME, quantization=quantization, providers=PROVIDERS), quantization
            if MODEL_DIR:
                return onnx_asr.load_model(MODEL_NAME, MODEL_DIR, providers=PROVIDERS), None
            return onnx_asr.load_model(MODEL_NAME, providers=PROVIDERS), None
        except Exception as exc:  # pragma: no cover
            errors.append(f"{quantization or 'default'}: {exc}")

    raise RuntimeError("; ".join(errors))


def with_timestamps(model):
    try:
        return model.with_timestamps()
    except Exception:
        return None


def read_wav_duration_ms(path):
    try:
        with wave.open(path, "rb") as handle:
            frame_rate = handle.getframerate()
            if not frame_rate:
                return None
            return round(handle.getnframes() * 1000 / frame_rate)
    except Exception:
        return None


def normalize_prompt_terms(value):
    seen = set()
    items = []
    for item in as_list(value) or []:
        if not isinstance(item, str):
            continue
        term = item.strip()
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(term)
    return items


def recognize_options(recognize, prompt_terms):
    if not prompt_terms:
        return {}

    try:
        signature = inspect.signature(recognize)
    except (TypeError, ValueError):
        return {}

    parameters = {
        name
        for name, value in signature.parameters.items()
        if value.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    for name, build in PROMPT_OPTION_NAMES:
        if name in parameters:
            return {name: build(prompt_terms)}
    return {}


def recognize_audio(model, request):
    options = recognize_options(model.recognize, normalize_prompt_terms(request.get("prompt_terms")))
    if options:
        return model.recognize(request["audio_path"], **options)
    return model.recognize(request["audio_path"])


def apply_short_clip_gate(payload, duration_ms):
    confidence = payload.get("confidence")
    if not payload.get("text") or confidence is None:
        return payload
    if duration_ms is None or duration_ms > SHORT_CLIP_GATE_DURATION_MS:
        return payload
    if confidence >= SHORT_CLIP_CONFIDENCE_THRESHOLD:
        return payload

    payload["text"] = ""
    payload.pop("segments", None)
    payload.pop("tokens", None)
    return payload


def main():
    model, quantization = load_model()
    timestamped_model = with_timestamps(model)
    emit({"type": "ready", "model": MODEL_NAME, "quantization": quantization})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request = json.loads(line)
        request_type = request.get("type")
        if request_type == "shutdown":
            return
        if request_type != "transcribe":
            continue

        request_id = request.get("id")
        try:
            audio_duration_ms = read_wav_duration_ms(request["audio_path"])
            result = recognize_audio(timestamped_model or model, request)
            payload = normalize_result(result, audio_duration_ms)
            emit(
                {
                    "type": "response",
                    "id": request_id,
                    **apply_short_clip_gate(
                        payload,
                        request.get("original_duration_ms") or audio_duration_ms,
                    ),
                }
            )
        except Exception as exc:  # pragma: no cover
            emit({"type": "error", "id": request_id, "message": str(exc)})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        emit({"type": "error", "message": str(exc)})
        raise
