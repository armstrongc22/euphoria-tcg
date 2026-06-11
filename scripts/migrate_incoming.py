#!/usr/bin/env python3
"""One-time, re-runnable migration from _incoming/raw-cards to the project layout.

Copy-based: never modifies anything under _incoming/.

- Copies card art to assets/cards/<group>/<slug>.png (group = lowercased source folder)
- Writes data/cards/cards.json cleaned from cards_file_stabilized.json:
    * drops snake_case effect_code/effect_params (identical to camelCase duplicates)
    * rewrites imageFile to the new relative path under assets/cards/
- Copies images that match no card to assets/cards/_unmatched/ and reports them.

Replace with a TypeScript import pipeline once the Node toolchain exists.
"""

from __future__ import annotations

import json
import shutil
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "_incoming" / "raw-cards"
SRC_JSON = RAW / "card_jsonexcel" / "cards_file_stabilized.json"
ASSETS = ROOT / "assets" / "cards"
DATA = ROOT / "data" / "cards"

IMAGE_FOLDERS = ["Dwarf", "Monk", "Sonic", "Surfer", "Shaman", "Items", "Weapons"]

# Quote glyphs vary between the JSON and the PNG filenames (curly vs straight,
# sometimes doubled), so matching keys drop quote characters entirely.
QUOTE_CHARS = "'\"‘’‚“”„′″`´"


def match_key(filename: str) -> str:
    stem = Path(filename).stem
    stem = unicodedata.normalize("NFC", stem)
    stem = "".join(ch for ch in stem if ch not in QUOTE_CHARS)
    return stem.casefold().strip()


def main() -> int:
    cards = json.loads(SRC_JSON.read_text(encoding="utf-8"))

    disk: dict[str, tuple[Path, str]] = {}
    for folder in IMAGE_FOLDERS:
        for png in sorted((RAW / folder).glob("*.png")):
            key = match_key(png.name)
            if key in disk:
                print(f"WARNING: duplicate image key {key!r}: {png} vs {disk[key][0]}")
            disk[key] = (png, folder.lower())

    DATA.mkdir(parents=True, exist_ok=True)

    cleaned = []
    missing = []
    used_keys = set()
    for card in cards:
        key = match_key(card["imageFile"])
        if key not in disk:
            missing.append(card["name"])
            continue
        src, group = disk[key]
        used_keys.add(key)
        dest_rel = f"{group}/{card['slug']}.png"
        dest = ASSETS / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)

        card = dict(card)
        card.pop("effect_code", None)
        card.pop("effect_params", None)
        card["imageFile"] = dest_rel
        cleaned.append(card)

    orphans = [src for key, (src, _) in disk.items() if key not in used_keys]
    for src in orphans:
        dest = ASSETS / "_unmatched" / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)

    out = DATA / "cards.json"
    out.write_text(
        json.dumps(cleaned, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"cards written: {len(cleaned)}/{len(cards)} -> {out.relative_to(ROOT)}")
    if missing:
        print(f"cards with no image found: {missing}")
    if orphans:
        print(f"unmatched images -> assets/cards/_unmatched/: {[p.name for p in orphans]}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
