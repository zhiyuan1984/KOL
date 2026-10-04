"""Apply the reviewed task-scoping compatibility patch; never reads credentials.

Run with --root PATH. Exact source anchors make an unknown upstream revision fail
before any writes. Existing files are backed up alongside the originals.
"""
import argparse
from pathlib import Path


def patched(server: str, manager: str) -> tuple[str, str]:
    if "KOL_TASK_SCOPE_V1" in server and "expected_task_id: str" in manager:
        return server, manager
    changes = [
        ('def get_crawl_status() -> Dict[str, Any]:', 'def get_crawl_status(task_id: str = "") -> Dict[str, Any]:'),
        ('    return crawler_manager.get_status()\n\n\n@mcp.tool()\ndef get_crawl_logs',
         '    _assert_task_scope(task_id)\n    return crawler_manager.get_status()\n\n\n@mcp.tool()\ndef get_crawl_logs'),
        ('def get_crawl_logs(limit: int = 100)', 'def get_crawl_logs(limit: int = 100, task_id: str = "")'),
        ('    """Return the most recent crawler logs."""\n    safe_limit', '    """Return the most recent crawler logs."""\n    _assert_task_scope(task_id)\n    safe_limit'),
        ('async def stop_crawl() -> Dict[str, Any]:', 'async def stop_crawl(task_id: str = "") -> Dict[str, Any]:'),
        ('    stopped = await crawler_manager.stop()', '    stopped = await crawler_manager.stop(expected_task_id=task_id)'),
    ]
    for index, (old, new) in enumerate(changes):
        if server.count(old) != 1:
            raise ValueError(f"Unexpected MediaCrawler MCP source at anchor {index}; patch not applied")
        server = server.replace(old, new, 1)
    anchor = '\n\nclass BearerTokenMiddleware:'
    if server.count(anchor) != 1:
        raise ValueError("Unexpected middleware source; patch not applied")
    server = server.replace(anchor, '''

# KOL_TASK_SCOPE_V1: optional for older clients; governed callers always pin a task.
def _assert_task_scope(task_id: str) -> None:
    if task_id and task_id != crawler_manager.task_id:
        raise ValueError("crawl_task_mismatch")
''' + anchor, 1)
    old = '    async def stop(self) -> bool:'
    if manager.count(old) != 1:
        raise ValueError("Unexpected crawler manager stop signature")
    manager = manager.replace(old, '    async def stop(self, expected_task_id: str = "") -> bool:', 1)
    old = '        async with self._lock:\n            if not self.has_running():'
    if manager.count(old) != 1:
        raise ValueError("Unexpected crawler manager stop lock")
    manager = manager.replace(old, '''        async with self._lock:
            if expected_task_id and expected_task_id != self._task_id:
                raise ValueError("crawl_task_mismatch")
            if not self.has_running():''', 1)
    compile(server, "mcp_server.py", "exec")
    compile(manager, "crawler_manager.py", "exec")
    return server, manager


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    paths = [args.root / "mcp_server.py", args.root / "api/services/crawler_manager.py"]
    original = [p.read_text(encoding="utf-8") for p in paths]
    updated = patched(*original)
    for path, before, after in zip(paths, original, updated):
        if before != after and path.with_suffix(path.suffix + ".before-kol-task-scope").exists():
            raise ValueError("Backup already exists; inspect it before applying")
    for path, before, after in zip(paths, original, updated):
        if before == after:
            continue
        backup = path.with_suffix(path.suffix + ".before-kol-task-scope")
        if backup.exists():
            raise ValueError("Backup already exists; inspect it before applying")
        backup.write_text(before, encoding="utf-8")
        path.write_text(after, encoding="utf-8")
    print("MediaCrawler task scope patch applied")
