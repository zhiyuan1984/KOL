"""Prepare a strict subscriber parser for MediaCrawler; dry-run unless --apply.

The original general count parser can read the 4 in '@Go4x4 ... subscribers'.
Keep it for video counters; only channel subscriber extraction uses this parser.
Unknown/localized labels stay unknown rather than becoming an account-name digit.
"""
import argparse
import hashlib
import json
import pathlib

FUNCTION = '''
def parse_subscriber_count(value: Any, *, dedicated: bool = False) -> Optional[int]:
    text = text_value(value).replace("\\u00a0", " ")
    count = r"(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?:\\s*(?:[KMB]|千|万|億|亿))?"
    label = r"(?:subscribers?\\b|位?订阅(?:者)?|位?訂閱(?:者)?)"
    matches = list(re.finditer(r"(?<![\\w.,+\\-])(" + count + r")\\s*" + label, text, re.I))
    if len(matches) == 1:
        return parse_count(matches[0].group(1))
    # A dedicated subscriberCountText may contain only the number.
    if dedicated and re.fullmatch(count, text.strip(), re.I):
        return parse_count(text)
    return None

'''


def patched_sources(helper: str, client: str) -> tuple[str, str]:
    marker = "def parse_video_id(value: str)"
    old = '"followers": parse_count(subscriber_text),'
    new = '"followers": parse_subscriber_count(subscriber_text),'
    if "def parse_subscriber_count(" in helper and new in client:
        return helper, client
    if helper.count(marker) != 1 or client.count(old) != 1 or client.count("    parse_count,\n") != 1:
        raise ValueError("Source changed; review before applying this patch")
    return (helper.replace(marker, FUNCTION + marker),
            client.replace("    parse_count,\n", "    parse_count,\n    parse_subscriber_count,\n").replace(old, new))


MARKER = "KOL_SUBSCRIBER_EVIDENCE_V1"
FILES = ["media_platform/youtube/help.py", "media_platform/youtube/client.py",
         "media_platform/youtube/core.py", "tools/standard_creator_writer.py"]


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError("Source changed; review before applying this patch")
    return source.replace(old, new, 1)


def patched_evidence_sources(originals: dict[str, str]) -> dict[str, str]:
    if all(MARKER in originals[name] for name in FILES):
        return dict(originals)
    if any(MARKER in originals[name] for name in FILES):
        raise ValueError("Partial evidence patch detected; restore/review before applying")
    updated = dict(originals)
    helper, client = patched_sources(originals[FILES[0]], originals[FILES[1]])
    if "dedicated: bool = False" not in helper:
        raise ValueError("Older subscriber patch detected; review upgrade explicitly")
    client = replace_once(client, "from datetime import date, datetime\n", "from datetime import date, datetime, timezone\n")
    client = replace_once(client, '''        subscriber_text = (
            first_nested(payload, "subscriberCountText")
            or dom_metadata.get("subscriberText")
        )''', '''        # KOL_SUBSCRIBER_EVIDENCE_V1: keep the exact text and its field source.
        dedicated_subscribers = first_nested(payload, "subscriberCountText")
        has_dedicated_subscribers = bool(text_value(dedicated_subscribers))
        subscriber_text = dedicated_subscribers if has_dedicated_subscribers else dom_metadata.get("subscriberText")
        subscriber_raw = text_value(subscriber_text)[:256]
        follower_count = parse_subscriber_count(subscriber_raw, dedicated=has_dedicated_subscribers)
        follower_evidence = {
            "raw_text": subscriber_raw,
            "source_field": "subscriberCountText" if has_dedicated_subscribers else "dom.subscriberText",
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "parser_version": "youtube-subscribers/v1",
            "state": "source_recorded" if follower_count is not None else "unavailable",
        }''')
    client = replace_once(client, '"followers": parse_subscriber_count(subscriber_text),',
                          '"followers": follower_count,\n            "followers_evidence": follower_evidence,')
    core = replace_once(originals[FILES[2]], '            followers=channel.get("followers"),\n            avatar=channel.get("avatar"),',
                        '            followers=channel.get("followers"),\n            # KOL_SUBSCRIBER_EVIDENCE_V1\n            followers_evidence=channel.get("followers_evidence"),\n            avatar=channel.get("avatar"),')
    writer = replace_once(originals[FILES[3]], '    followers: Any = None,\n',
                          '    followers: Any = None,\n    followers_evidence: Any = None,\n')
    writer = replace_once(writer, '''        if follower_count is not None:
            record["followers"] = follower_count
''', '''        if follower_count is not None:
            record["followers"] = follower_count
        # KOL_SUBSCRIBER_EVIDENCE_V1: an explicitly unknown refresh clears stale counts.
        if isinstance(followers_evidence, dict):
            record["followers"] = follower_count
            record["followers_evidence"] = {
                key: followers_evidence[key]
                for key in ("raw_text", "source_field", "captured_at", "parser_version", "state")
                if key in followers_evidence
            }
''')
    updated.update(dict(zip(FILES, ["# " + MARKER + "\n" + helper, client, core, writer])))
    for name, source in updated.items():
        compile(source, name, "exec")
    return updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=pathlib.Path, help="MediaCrawler source directory")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    paths = {name: args.root.resolve() / name for name in FILES}
    originals = {name: p.read_text(encoding="utf-8") for name, p in paths.items()}
    updated = patched_evidence_sources(originals)
    changed = [name for name in FILES if originals[name] != updated[name]]
    if args.apply and changed:
        if any(paths[name].with_suffix(paths[name].suffix + ".tcw-backup").exists() for name in changed):
            raise ValueError("Backup exists; review it before applying")
        for name in changed:
            p, original = paths[name], originals[name]
            with p.with_suffix(p.suffix + ".tcw-backup").open("x", encoding="utf-8") as backup:
                backup.write(original)
        for name in changed:
            paths[name].write_text(updated[name], encoding="utf-8")
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", "changed_files": changed,
          "before_sha256": {name: hashlib.sha256(originals[name].encode()).hexdigest() for name in FILES},
          "after_sha256": {name: hashlib.sha256(updated[name].encode()).hexdigest() for name in FILES}}))
