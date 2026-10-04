"""Run only the task-scope patch tests against staged real MediaCrawler sources."""
import argparse
import asyncio
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--staged", type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.root))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manager_module = load("api.services.kol_scope_candidate", args.staged / "api/services/crawler_manager.py")
server = load("kol_mcp_scope_candidate", args.staged / "mcp_server.py")


class TaskScopeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.manager = manager_module.CrawlerManager()
        self.manager._task_id = "owned-task"
        server.crawler_manager = self.manager

    def test_matching_status_and_logs(self):
        self.assertEqual(server.get_crawl_status("owned-task")["task_id"], "owned-task")
        self.assertEqual(server.get_crawl_logs(task_id="owned-task")["task_id"], "owned-task")

    def test_mismatched_reads_return_no_data(self):
        with self.assertRaisesRegex(ValueError, "crawl_task_mismatch"):
            server.get_crawl_status("other-task")
        with self.assertRaisesRegex(ValueError, "crawl_task_mismatch"):
            server.get_crawl_logs(task_id="other-task")

    async def test_stop_matches_task_inside_manager_lock(self):
        await self.manager._lock.acquire()
        pending = asyncio.create_task(server.stop_crawl("owned-task"))
        await asyncio.sleep(0)
        self.manager._task_id = "new-task"
        self.manager._lock.release()
        with self.assertRaisesRegex(ValueError, "crawl_task_mismatch"):
            await pending

    async def test_matching_stop_uses_existing_shutdown(self):
        self.manager.has_running = lambda: True
        self.manager.processes = {"youtube": object()}
        self.manager._stop_process = AsyncMock()
        result = await server.stop_crawl("owned-task")
        self.assertTrue(result["ok"])
        self.manager._stop_process.assert_awaited_once()

    def test_legacy_status_call_remains_compatible(self):
        self.assertEqual(server.get_crawl_status()["task_id"], "owned-task")


unittest.main(argv=[sys.argv[0]])
