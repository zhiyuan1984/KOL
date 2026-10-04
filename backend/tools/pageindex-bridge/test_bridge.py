import contextlib
import io
import json
import os
import tempfile
import types
import unittest

import bridge


class BridgeContractTest(unittest.TestCase):
    def test_local_store_is_explicit_and_isolated(self):
        with tempfile.TemporaryDirectory() as root:
            first = bridge.local_client(os.path.join(root, "first"))
            second = bridge.local_client(os.path.join(root, "second"))
            self.assertEqual(first.storage_path, os.path.join(root, "first"))
            self.assertNotEqual(first.storage_path, second.storage_path)

    def test_ocr_reflow_keeps_original_page_mapping(self):
        with tempfile.TemporaryDirectory() as root:
            source = os.path.join(root, "ocr.md")
            with open(source, "w", encoding="utf-8") as out:
                out.write("## 第 1 页\n" + "Long table row with a unit: 127.5 Ah.\n" * 120 + "## 第 2 页\nSecond source page\n")
            capture = io.StringIO()
            with contextlib.redirect_stdout(capture):
                bridge.cmd_make_pdf(types.SimpleNamespace(text=source, out=os.path.join(root, "normalized.pdf")))
            result = json.loads(capture.getvalue())
            self.assertTrue(result["ok"])
            mapping = result["page_map"]
            self.assertGreater(len(mapping), 2)
            self.assertEqual(mapping["1"], 1)
            self.assertEqual(mapping[str(len(mapping))], 2)
            self.assertTrue(all(value == 1 for key, value in mapping.items() if int(key) < len(mapping)))


if __name__ == "__main__":
    unittest.main()
