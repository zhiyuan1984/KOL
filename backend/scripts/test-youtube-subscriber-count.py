"""Offline regression only: never calls YouTube or edits a deployed crawler."""
import importlib.util
import pathlib
import re
import unittest

spec = importlib.util.spec_from_file_location("patch", pathlib.Path(__file__).with_name("patch-youtube-subscriber-count.py"))
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class SubscriberExtraction(unittest.TestCase):
    def setUp(self):
        # Capture the exact number handed to the existing general counter parser.
        namespace = {"Any": object, "Optional": __import__("typing").Optional, "re": re,
                     "text_value": lambda value: value.get("simpleText", "") if isinstance(value, dict) else str(value),
                     "parse_count": lambda value: value.strip()}
        exec(patch.FUNCTION, namespace)
        self.parse = namespace["parse_subscriber_count"]

    def test_handle_digits_do_not_become_subscribers(self):
        self.assertEqual(self.parse("@Go4x4 1.8M subscribers 99 videos"), "1.8M")

    def test_labels_and_dedicated_numeric_field(self):
        for value, expected in [("281K subscribers", "281K"), ("0 subscribers", "0"),
                                ("1,800 subscribers", "1,800"), ("12.3万位订阅者", "12.3万")]:
            self.assertEqual(self.parse(value), expected)
        self.assertEqual(self.parse({"simpleText": "1.8M"}, dedicated=True), "1.8M")
        self.assertIsNone(self.parse("1.8M"))

    def test_unknown_and_other_counters_stay_unknown(self):
        for value in ["@Go4x4", "Go4x4 subscribers", "99 videos", "hidden subscribers", "Go4x4 1.8M",
                      "1.2.3M subscribers", "1,8M subscribers", "-4 subscribers", "1K subscribers 2K subscribers"]:
            self.assertIsNone(self.parse(value))

    def test_patch_scope_idempotency_and_source_drift(self):
        helper = 'def parse_video_id(value: str): pass\n'
        client = '    parse_count,\n    "followers": parse_count(subscriber_text),\n'
        updated = patch.patched_sources(helper, client)
        self.assertEqual(patch.patched_sources(*updated), updated)
        self.assertIn('"followers": parse_subscriber_count(subscriber_text)', updated[1])
        with self.assertRaises(ValueError):
            patch.patched_sources(helper, "source changed")


if __name__ == "__main__":
    unittest.main()
