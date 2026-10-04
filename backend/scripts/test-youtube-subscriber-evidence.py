"""Offline upstream integration: pytest with PYTHONPATH pointing to a patched source copy.

No browser, crawler task, network request or business import is started.
"""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
import config
from media_platform.youtube.client import YoutubeClient
from media_platform.youtube.core import YoutubeCrawler
from media_platform.youtube.help import parse_count, parse_subscriber_count
from tools.creator_uploader import load_creators
from tools.standard_creator_writer import upsert_standard_creator

CHANNEL = "UCOtCKIoHcQvBl1GzRo7Z2SA"


def test_real_counter_does_not_parse_handle_digits_as_subscribers():
    assert parse_count("@Go4x4 1.8M subscribers") == 4
    assert parse_subscriber_count("@Go4x4 1.8M subscribers") == 1800000
    assert parse_count("1,234 views") == 1234
    assert parse_subscriber_count("1,8M subscribers") is None
    assert parse_subscriber_count("4") is None
    assert parse_subscriber_count("4", dedicated=True) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize("raw,dedicated,count,field", [
    ("@Go4x4 1.8M subscribers 99 videos", False, 1800000, "dom.subscriberText"),
    ("281K", True, 281000, "subscriberCountText"),
    ("hidden subscribers", False, None, "dom.subscriberText"),
    ("@Go4x4 " + "x" * 260 + " 1.8M subscribers", False, None, "dom.subscriberText"),
])
async def test_channel_source_survives_core_writer_and_task_loader(tmp_path, monkeypatch, raw, dedicated, count, field):
    monkeypatch.setattr(config, "ENABLE_GET_CREATOR_EMAIL", False)
    monkeypatch.setattr(config, "SAVE_DATA_PATH", str(tmp_path))
    monkeypatch.setattr(config, "SAVE_DATA_OPTION", "json")
    monkeypatch.setattr(config, "KEYWORDS", "offline-fixture")
    monkeypatch.setenv("MEDIACRAWLER_TASK_ID", "offline-subscriber-task")
    payload = {"channelMetadataRenderer": {"externalId": CHANNEL, "title": "Go4x4", "country": "Australia"}}
    if dedicated:
        payload["subscriberCountText"] = {"simpleText": raw}
    page = MagicMock()
    page.evaluate = AsyncMock(return_value={"channelId": CHANNEL, "subscriberText": raw})
    client = YoutubeClient(page)
    client._goto = AsyncMock(return_value=payload)
    channel = await client.get_channel(CHANNEL, include_videos=False)
    assert channel["followers"] == count
    evidence = channel["followers_evidence"]
    assert evidence["raw_text"] == raw[:256]
    assert evidence["source_field"] == field
    assert evidence["captured_at"].endswith("+00:00")
    assert evidence["parser_version"] == "youtube-subscribers/v1"
    assert evidence["state"] == ("source_recorded" if count is not None else "unavailable")
    await YoutubeCrawler()._write_channel(channel)
    files = list((tmp_path / "youtube" / "json").glob("*_kol_creators_offline-subscriber-task_*.json"))
    assert len(files) == 1
    stored = json.loads(files[0].read_text())[0]
    assert stored["followers"] == count
    assert stored["followers_evidence"] == evidence
    loaded = load_creators(files)[0]
    assert loaded.get("followers") == count
    assert loaded["followers_evidence"] == evidence
    assert loaded["profile_url"] == f"https://www.youtube.com/channel/{CHANNEL}"
    page.goto.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_refresh_cannot_reuse_old_count_with_new_source(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SAVE_DATA_PATH", str(tmp_path))
    monkeypatch.setattr(config, "SAVE_DATA_OPTION", "json")
    monkeypatch.setattr(config, "KEYWORDS", "offline-fixture")
    monkeypatch.setenv("MEDIACRAWLER_TASK_ID", "offline-stale-task")
    args = {"platform": "youtube", "crawler_type": "search", "platform_creator_id": CHANNEL, "nickname": "Go4x4"}
    await upsert_standard_creator(**args, followers=4)
    evidence = {"raw_text": "hidden subscribers", "source_field": "dom.subscriberText",
                "captured_at": "2026-10-04T15:00:00+00:00", "parser_version": "youtube-subscribers/v1", "state": "unavailable"}
    await upsert_standard_creator(**args, followers=None, followers_evidence=evidence)
    files = list((tmp_path / "youtube" / "json").glob("*_kol_creators_offline-stale-task_*.json"))
    result = load_creators(files)[0]
    assert result.get("followers") is None
    assert result["followers_evidence"] == evidence
