"""Prepare a strict subscriber parser for MediaCrawler; dry-run unless --apply.

The original general count parser can read the 4 in '@Go4x4 ... subscribers'.
Keep it for video counters; only channel subscriber extraction uses this parser.
Unknown/localized labels stay unknown rather than becoming an account-name digit.
"""
import argparse
import pathlib

FUNCTION = '''
def parse_subscriber_count(value: Any) -> Optional[int]:
    text = text_value(value).replace("\\u00a0", " ")
    count = r"[\\d.,]+\\s*(?:[KMB]|千|万|億|亿)?"
    label = r"(?:subscribers?\\b|位?订阅(?:者)?|位?訂閱(?:者)?)"
    match = re.search(r"(?<![\\w.,])(" + count + r")\\s*" + label, text, re.I)
    if match:
        return parse_count(match.group(1))
    # A dedicated subscriberCountText may contain only the number.
    if re.fullmatch(count, text.strip(), re.I):
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=pathlib.Path, help="MediaCrawler source directory")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    folder = args.root.resolve() / "media_platform" / "youtube"
    paths = [folder / "help.py", folder / "client.py"]
    originals = [p.read_text(encoding="utf-8") for p in paths]
    updated = patched_sources(*originals)
    changed = [p.name for p, a, b in zip(paths, originals, updated) if a != b]
    if args.apply and changed:
        for p, original in zip(paths, originals):
            with p.with_suffix(p.suffix + ".tcw-backup").open("x", encoding="utf-8") as backup:
                backup.write(original)
        for p, content in zip(paths, updated):
            p.write_text(content, encoding="utf-8")
    print({"mode": "apply" if args.apply else "dry-run", "changed_files": changed})
