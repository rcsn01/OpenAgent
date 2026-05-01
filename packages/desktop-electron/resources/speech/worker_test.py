import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import worker


class WorkerTests(unittest.TestCase):
    def test_normalize_prompt_terms_dedupes_and_trims(self):
        self.assertEqual(
            worker.normalize_prompt_terms([" OpenAI ", "openai", None, "WhisperKit"]),
            ["OpenAI", "WhisperKit"],
        )

    def test_average_confidence_converts_logprobs(self):
        self.assertAlmostEqual(worker.average_confidence([0.0, -0.6931471805599453]), 0.75, places=2)

    def test_normalize_result_preserves_timestamp_metadata(self):
        payload = worker.normalize_result(
            SimpleNamespace(
                text="hello world",
                tokens=["hello", " world"],
                timestamps=[0.1, 0.4],
                logprobs=[-0.10536051565782628, -0.2231435513142097],
            ),
            600,
        )

        self.assertAlmostEqual(payload["confidence"], 0.85, places=2)
        self.assertEqual(payload["segments"][0]["startMs"], 100)
        self.assertEqual(payload["segments"][0]["endMs"], 400)
        self.assertEqual(payload["tokens"][0]["text"], "hello")
        self.assertEqual(payload["tokens"][1]["text"], " world")

    def test_apply_short_clip_gate_suppresses_low_confidence_noise(self):
        payload = worker.apply_short_clip_gate(
            {
                "text": "uh",
                "confidence": 0.31,
                "segments": [{"text": "uh"}],
                "tokens": [{"text": "uh"}],
            },
            500,
        )

        self.assertEqual(payload["text"], "")
        self.assertNotIn("segments", payload)
        self.assertNotIn("tokens", payload)

    def test_apply_short_clip_gate_keeps_confident_short_transcript(self):
        payload = worker.apply_short_clip_gate(
            {
                "text": "OpenAI",
                "confidence": 0.91,
                "segments": [{"text": "OpenAI"}],
            },
            500,
        )

        self.assertEqual(payload["text"], "OpenAI")
        self.assertIn("segments", payload)


if __name__ == "__main__":
    unittest.main()
