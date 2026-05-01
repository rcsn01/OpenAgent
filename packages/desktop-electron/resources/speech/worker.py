import json
import os
import sys

import onnx_asr

MODEL_NAME = os.environ.get("PARAKEET_MODEL_NAME", "nemo-parakeet-tdt-0.6b-v3")
MODEL_DIR = os.environ.get("PARAKEET_MODEL_DIR", "").strip() or None
PREFERRED_QUANTIZATION = os.environ.get("PARAKEET_QUANTIZATION", "int8").strip() or None
PROVIDERS = ["CPUExecutionProvider"]


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


def normalize_ms(value, explicit_ms):
    if not isinstance(value, (int, float)):
        return None
    if explicit_ms:
        return round(value)
    if isinstance(value, float):
        return round(value * 1000)
    return round(value)


def normalize_segment(item):
    text = read_value(item, "text")
    if not isinstance(text, str) or not text.strip():
        return None

    start_ms = normalize_ms(read_value(item, "start_ms", "startMs"), True)
    end_ms = normalize_ms(read_value(item, "end_ms", "endMs"), True)
    if start_ms is None and end_ms is None:
        start_ms = normalize_ms(read_value(item, "start"), False)
        end_ms = normalize_ms(read_value(item, "end"), False)

    return {"text": text.strip(), "startMs": start_ms, "endMs": end_ms}


def normalize_result(result):
    text = ""
    language = None
    segments = None

    if isinstance(result, str):
        text = result
    elif isinstance(result, list):
        segments = [segment for segment in (normalize_segment(item) for item in result) if segment]
        text = " ".join(segment["text"] for segment in segments)
    else:
        maybe_text = getattr(result, "text", None)
        if isinstance(maybe_text, str):
            text = maybe_text
        else:
            text = str(result)

        maybe_language = getattr(result, "language", None)
        if isinstance(maybe_language, str):
            language = maybe_language

        maybe_segments = read_value(result, "segments")
        if isinstance(maybe_segments, list):
            segments = [segment for segment in (normalize_segment(item) for item in maybe_segments) if segment]

    payload = {"text": text.strip(), "language": language}
    if segments:
        payload["segments"] = segments
    return payload


def load_model():
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


def main():
    model, quantization = load_model()
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
            result = model.recognize(request["audio_path"])
            emit({"type": "response", "id": request_id, **normalize_result(result)})
        except Exception as exc:  # pragma: no cover
            emit({"type": "error", "id": request_id, "message": str(exc)})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        emit({"type": "error", "message": str(exc)})
        raise
