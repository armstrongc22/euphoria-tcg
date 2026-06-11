import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


FIELD_ALIASES = {
    "id": ["id", "card_id", "cardId"],
    "name": ["name", "card_name", "cardName", "Name"],
    "slug": ["slug", "Slug"],
    "faction": ["faction", "Faction"],
    "type": ["type", "card_type", "cardType", "Type"],
    "subtype": ["subtype", "sub_type", "category", "Subtype"],
    "spirit": ["spirit", "spirit_cost", "cost", "Spirit", "Spirit Cost"],
    "attack": ["attack", "atk", "ATK", "Attack"],
    "health": ["health", "hp", "HEALTH", "Health"],
    "effect": [
        "effect",
        "effect_text",
        "card_text",
        "rules_text",
        "description",
        "ability",
        "Effect",
        "Card Text",
        "Rules Text",
        "Description",
    ],
    "image": [
        "image",
        "image_file",
        "image_filename",
        "filename",
        "file_name",
        "image_path",
        "Image",
        "Image Filename",
    ],
}


def clean_text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value != value:
        return ""
    return str(value).strip()


def get_field(card, field_name):
    aliases = FIELD_ALIASES[field_name]

    for key in aliases:
        value = card.get(key)
        value = clean_text(value)
        if value:
            return value

    # Flexible fallback: normalize keys like "Effect Text" -> "effecttext"
    normalized_lookup = {
        re.sub(r"[^a-z0-9]", "", str(k).lower()): v
        for k, v in card.items()
    }

    for key in aliases:
        norm = re.sub(r"[^a-z0-9]", "", key.lower())
        value = clean_text(normalized_lookup.get(norm))
        if value:
            return value

    return ""


def normalize_for_match(text):
    text = clean_text(text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()

    replacements = {
        "’": "",
        "'": "",
        "`": "",
        "´": "",
        "“": "",
        "”": "",
        "&": "and",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def to_int(value):
    value = clean_text(value)
    if not value:
        return None

    value = value.replace(",", "")
    match = re.search(r"-?\d+", value)
    if not match:
        return None

    return int(match.group())


def load_cards(json_path):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        for key in ["cards", "Cards", "data", "items"]:
            if isinstance(data.get(key), list):
                return data[key]

    raise ValueError("JSON must be either a list of cards or an object containing a cards list.")


def build_image_index(images_root):
    images_root = Path(images_root)

    if not images_root.exists():
        raise FileNotFoundError(f"Images folder does not exist: {images_root}")

    image_index = {}

    for path in images_root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            stem_key = normalize_for_match(path.stem)
            file_key = normalize_for_match(path.name)

            image_index.setdefault(stem_key, []).append(path)
            image_index.setdefault(file_key, []).append(path)

    return image_index


def find_image(card, image_index):
    name = get_field(card, "name")
    slug = get_field(card, "slug")
    image = get_field(card, "image")

    candidates = []

    if image:
        image_path = Path(image)
        candidates.append(image_path.stem)
        candidates.append(image_path.name)

    if slug:
        candidates.append(slug)

    if name:
        candidates.append(name)

    for candidate in candidates:
        key = normalize_for_match(candidate)
        if key in image_index:
            return image_index[key][0]

    return None


def validate_card(card, row_number, image_index):
    errors = []
    warnings = []

    name = get_field(card, "name") or f"Unnamed row {row_number}"
    faction = get_field(card, "faction")
    card_type = get_field(card, "type")
    effect = get_field(card, "effect")

    spirit = to_int(get_field(card, "spirit"))
    attack = to_int(get_field(card, "attack"))
    health = to_int(get_field(card, "health"))

    type_lower = card_type.lower()
    faction_lower = faction.lower()

    prefix = f"Row {row_number} | {name}:"

    if not get_field(card, "id"):
        errors.append(f"{prefix} Missing id.")

    if not name:
        errors.append(f"{prefix} Missing name.")

    if not get_field(card, "slug"):
        errors.append(f"{prefix} Missing slug.")

    if not faction:
        errors.append(f"{prefix} Missing faction.")

    if not card_type:
        errors.append(f"{prefix} Missing type.")

    if spirit is None:
        errors.append(f"{prefix} Missing or invalid Spirit cost.")

    # Cost rules
    if type_lower == "item" and spirit != 1:
        errors.append(f"{prefix} Item card should cost 1 Spirit, found {spirit}.")

    if type_lower == "weapon" and spirit != 2:
        errors.append(f"{prefix} Weapon card should cost 2 Spirit, found {spirit}.")

    if faction_lower == "shaman" and spirit != 3:
        errors.append(f"{prefix} Shaman card should cost 3 Spirit, found {spirit}.")

    # Stat rules
    if type_lower == "warrior":
        if attack is None:
            errors.append(f"{prefix} Warrior card missing ATK.")
        if health is None:
            errors.append(f"{prefix} Warrior card missing HEALTH.")

    if type_lower in {"attack", "item", "weapon"}:
        if not effect:
            errors.append(f"{prefix} {card_type} card has no effect text.")

    # Image rules
    image_path = find_image(card, image_index)
    if not image_path:
        warnings.append(f"{prefix} Could not find matching image file.")

    return errors, warnings


def write_report(report_path, errors, warnings):
    with open(report_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["level", "message"])

        for error in errors:
            writer.writerow(["ERROR", error])

        for warning in warnings:
            writer.writerow(["WARNING", warning])


def main():
    parser = argparse.ArgumentParser(description="Validate Euphoria TCG cards JSON.")
    parser.add_argument("--json", required=True, help="Path to cards JSON file.")
    parser.add_argument("--images", required=True, help="Root folder containing card images.")
    parser.add_argument(
        "--report",
        default="validation_report.csv",
        help="Output CSV report path.",
    )

    args = parser.parse_args()

    json_path = Path(args.json)
    images_root = Path(args.images)
    report_path = Path(args.report)

    cards = load_cards(json_path)
    image_index = build_image_index(images_root)

    all_errors = []
    all_warnings = []

    for index, card in enumerate(cards, start=2):
        errors, warnings = validate_card(card, index, image_index)
        all_errors.extend(errors)
        all_warnings.extend(warnings)

    print("EUPHORIA CARD VALIDATION")
    print("-" * 60)
    print(f"Cards checked: {len(cards)}")
    print(f"Errors:        {len(all_errors)}")
    print(f"Warnings:      {len(all_warnings)}")
    print()

    for message in all_errors:
        print(message)

    for message in all_warnings:
        print(message)

    write_report(report_path, all_errors, all_warnings)

    print()
    print(f"Report saved: {report_path.resolve()}")

    if all_errors:
        print("VALIDATION FAILED")
        return 1

    print("VALIDATION PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())