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


def normalize_result(result):
    text = ""
    language = None

    if isinstance(result, str):
        text = result
    elif isinstance(result, list):
        parts = []
        for item in result:
            maybe_text = getattr(item, "text", None)
            if isinstance(maybe_text, str) and maybe_text:
                parts.append(maybe_text)
        text = " ".join(parts)
    else:
        maybe_text = getattr(result, "text", None)
        if isinstance(maybe_text, str):
            text = maybe_text
        else:
            text = str(result)

        maybe_language = getattr(result, "language", None)
        if isinstance(maybe_language, str):
            language = maybe_language

    return {"text": text.strip(), "language": language}


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
