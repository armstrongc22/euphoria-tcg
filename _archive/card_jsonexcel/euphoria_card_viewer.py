#!/usr/bin/env python3
"""
Euphoria Card Viewer

A small local desktop viewer for your beta card JSON + image folders.

Run example:
    python euphoria_card_viewer.py --json "C:\\Users\\Armstrong\\Documents\\Euphoria\\cards_clean_image_names.json" --images "C:\\Users\\Armstrong\\Documents\\Euphoria\\Cards"

Install image support:
    pip install pillow

What it does:
- Loads your master cards JSON.
- Recursively searches your Cards folder for images.
- Lets you filter by search, faction, and card type.
- Shows the card image, rules text, effects, and raw JSON.
- Handles filenames like "Ajax.png", "ajax.webp", and accidental "Ajax (1).png".
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from PIL import Image, ImageTk
except ImportError:
    Image = None
    ImageTk = None

import tkinter as tk
from tkinter import filedialog, messagebox, ttk


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def clean_name_suffix(stem: str) -> str:
    return re.sub(r"\s*\(\d+\)$", "", stem).strip()


def normalize_key(text: str) -> str:
    text = clean_name_suffix(Path(str(text)).stem)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("’", "'").replace("“", "").replace("”", "").replace('"', "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def load_cards(json_path: Path) -> List[Dict[str, Any]]:
    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        data = data.get("cards", data.get("data", []))

    if not isinstance(data, list):
        raise ValueError("JSON must be a list of card objects, or an object containing a 'cards' list.")

    return [card for card in data if isinstance(card, dict)]


def build_image_index(images_root: Path) -> Dict[str, Path]:
    index: Dict[str, Path] = {}

    if not images_root.exists():
        return index

    for path in images_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue

        keys = {
            path.name.lower(),
            normalize_key(path.stem),
            normalize_key(clean_name_suffix(path.stem)),
        }

        for key in keys:
            index.setdefault(key, path)

    return index


def find_card_image(card: Dict[str, Any], image_index: Dict[str, Path], images_root: Path) -> Optional[Path]:
    candidates: List[str] = []

    for field in ("imageFile", "image", "image_file", "filename"):
        value = card.get(field)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())

    for field in ("name", "slug", "id"):
        value = card.get(field)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())

    for raw in candidates:
        p = Path(raw)
        possible_paths = [p] if p.is_absolute() else [images_root / p]

        if p.suffix == "":
            for ext in IMAGE_EXTS:
                possible_paths.append(images_root / f"{raw}{ext}")

        for path in possible_paths:
            if path.exists() and path.is_file():
                return path

    for raw in candidates:
        raw_path = Path(raw)
        keys = [
            raw.lower(),
            raw_path.name.lower(),
            normalize_key(raw),
            normalize_key(raw_path.stem),
            normalize_key(clean_name_suffix(raw_path.stem)),
        ]
        for key in keys:
            if key in image_index:
                return image_index[key]

    return None


def card_sort_key(card: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        str(card.get("faction", "")),
        str(card.get("type", "")),
        str(card.get("name", "")),
    )


class CardViewer(tk.Tk):
    def __init__(self, json_path: Optional[Path] = None, images_root: Optional[Path] = None):
        super().__init__()
        self.title("Euphoria Card Viewer")
        self.geometry("1200x760")
        self.minsize(960, 620)

        self.cards: List[Dict[str, Any]] = []
        self.filtered_cards: List[Dict[str, Any]] = []
        self.image_index: Dict[str, Path] = {}
        self.images_root: Path = images_root or Path.cwd()
        self.json_path: Optional[Path] = json_path
        self.current_photo = None

        self.search_var = tk.StringVar()
        self.faction_var = tk.StringVar(value="All")
        self.type_var = tk.StringVar(value="All")
        self.sort_var = tk.StringVar(value="Faction > Type > Name")

        self._build_ui()

        if json_path:
            self.load_json(json_path, images_root)

    def _build_ui(self) -> None:
        top = ttk.Frame(self, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)

        ttk.Button(top, text="Open JSON", command=self.open_json).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(top, text="Set Images Folder", command=self.open_images_folder).pack(side=tk.LEFT, padx=(0, 12))

        ttk.Label(top, text="Search").pack(side=tk.LEFT)
        search_entry = ttk.Entry(top, textvariable=self.search_var, width=28)
        search_entry.pack(side=tk.LEFT, padx=(4, 12))
        search_entry.bind("<KeyRelease>", lambda _event: self.apply_filters())

        ttk.Label(top, text="Faction").pack(side=tk.LEFT)
        self.faction_combo = ttk.Combobox(top, textvariable=self.faction_var, width=14, state="readonly")
        self.faction_combo.pack(side=tk.LEFT, padx=(4, 12))
        self.faction_combo.bind("<<ComboboxSelected>>", lambda _event: self.apply_filters())

        ttk.Label(top, text="Type").pack(side=tk.LEFT)
        self.type_combo = ttk.Combobox(top, textvariable=self.type_var, width=14, state="readonly")
        self.type_combo.pack(side=tk.LEFT, padx=(4, 12))
        self.type_combo.bind("<<ComboboxSelected>>", lambda _event: self.apply_filters())

        ttk.Label(top, text="Sort").pack(side=tk.LEFT)
        sort_combo = ttk.Combobox(
            top,
            textvariable=self.sort_var,
            width=20,
            state="readonly",
            values=["Faction > Type > Name", "Name", "Spirit Cost", "Attack", "Health"],
        )
        sort_combo.pack(side=tk.LEFT, padx=(4, 0))
        sort_combo.bind("<<ComboboxSelected>>", lambda _event: self.apply_filters())

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        left = ttk.Frame(main, padding=4)
        main.add(left, weight=1)

        columns = ("name", "faction", "type", "cost", "attack", "health")
        self.tree = ttk.Treeview(left, columns=columns, show="headings", selectmode="browse")

        headings = {
            "name": "Name",
            "faction": "Faction",
            "type": "Type",
            "cost": "Spirit",
            "attack": "ATK",
            "health": "HEALTH",
        }
        widths = {
            "name": 240,
            "faction": 90,
            "type": 90,
            "cost": 60,
            "attack": 80,
            "health": 90,
        }

        for col in columns:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], anchor=tk.W if col in {"name", "faction", "type"} else tk.CENTER)

        yscroll = ttk.Scrollbar(left, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=yscroll.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        yscroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        right = ttk.Frame(main, padding=8)
        main.add(right, weight=2)

        self.image_label = ttk.Label(right, anchor=tk.CENTER)
        self.image_label.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 10))

        details_frame = ttk.Frame(right)
        details_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=False)

        self.details = tk.Text(details_frame, width=44, wrap=tk.WORD, font=("Segoe UI", 10))
        self.details.pack(fill=tk.BOTH, expand=True)
        self.details.configure(state=tk.DISABLED)

        bottom = ttk.Frame(self, padding=(8, 0, 8, 8))
        bottom.pack(side=tk.BOTTOM, fill=tk.X)
        self.status_var = tk.StringVar(value="Open your master card JSON to begin.")
        ttk.Label(bottom, textvariable=self.status_var).pack(side=tk.LEFT)

    def open_json(self) -> None:
        path = filedialog.askopenfilename(
            title="Open Euphoria card JSON",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if path:
            self.load_json(Path(path), self.images_root)

    def open_images_folder(self) -> None:
        folder = filedialog.askdirectory(title="Select root folder containing card images")
        if folder:
            self.images_root = Path(folder)
            self.image_index = build_image_index(self.images_root)
            self.status_var.set(f"Indexed {len(self.image_index)} image keys from: {self.images_root}")
            self.show_selected_card()

    def load_json(self, json_path: Path, images_root: Optional[Path] = None) -> None:
        try:
            self.cards = load_cards(json_path)
            self.json_path = json_path

            if images_root:
                self.images_root = images_root
            elif self.images_root == Path.cwd():
                guessed = json_path.parent / "Cards"
                if guessed.exists():
                    self.images_root = guessed

            self.image_index = build_image_index(self.images_root)
            self.refresh_filter_options()
            self.apply_filters()
            self.status_var.set(f"Loaded {len(self.cards)} cards. Images folder: {self.images_root}")
        except Exception as exc:
            messagebox.showerror("Could not load JSON", str(exc))

    def refresh_filter_options(self) -> None:
        factions = sorted({str(c.get("faction", "")).strip() for c in self.cards if c.get("faction")})
        types = sorted({str(c.get("type", "")).strip() for c in self.cards if c.get("type")})
        self.faction_combo["values"] = ["All"] + factions
        self.type_combo["values"] = ["All"] + types
        self.faction_var.set("All")
        self.type_var.set("All")

    def apply_filters(self) -> None:
        query = self.search_var.get().strip().lower()
        faction = self.faction_var.get()
        card_type = self.type_var.get()

        def matches(card: Dict[str, Any]) -> bool:
            haystack = " ".join(
                str(card.get(k, "")) for k in ("name", "faction", "type", "subtype", "rulesText", "id", "slug")
            ).lower()
            if query and query not in haystack:
                return False
            if faction != "All" and str(card.get("faction", "")) != faction:
                return False
            if card_type != "All" and str(card.get("type", "")) != card_type:
                return False
            return True

        self.filtered_cards = [card for card in self.cards if matches(card)]

        sort_mode = self.sort_var.get()
        if sort_mode == "Name":
            self.filtered_cards.sort(key=lambda card: str(card.get("name", "")))
        elif sort_mode == "Spirit Cost":
            self.filtered_cards.sort(key=lambda card: (int(card.get("spiritCost") or 0), str(card.get("name", ""))))
        elif sort_mode == "Attack":
            self.filtered_cards.sort(key=lambda card: (int(card.get("attack") or 0), str(card.get("name", ""))), reverse=True)
        elif sort_mode == "Health":
            self.filtered_cards.sort(key=lambda card: (int(card.get("health") or 0), str(card.get("name", ""))), reverse=True)
        else:
            self.filtered_cards.sort(key=card_sort_key)

        self.populate_tree()
        self.status_var.set(f"Showing {len(self.filtered_cards)} of {len(self.cards)} cards.")

    def populate_tree(self) -> None:
        for row in self.tree.get_children():
            self.tree.delete(row)

        for idx, card in enumerate(self.filtered_cards):
            self.tree.insert(
                "",
                tk.END,
                iid=str(idx),
                values=(
                    card.get("name", ""),
                    card.get("faction", ""),
                    card.get("type", ""),
                    card.get("spiritCost", ""),
                    card.get("attack", ""),
                    card.get("health", ""),
                ),
            )

        if self.filtered_cards:
            self.tree.selection_set("0")
            self.tree.focus("0")
            self.show_card(self.filtered_cards[0])
        else:
            self.clear_preview()

    def on_select(self, _event: Any = None) -> None:
        self.show_selected_card()

    def show_selected_card(self) -> None:
        selected = self.tree.selection()
        if not selected:
            self.clear_preview()
            return

        idx = int(selected[0])
        if 0 <= idx < len(self.filtered_cards):
            self.show_card(self.filtered_cards[idx])

    def clear_preview(self) -> None:
        self.image_label.configure(image="", text="No card selected")
        self.current_photo = None
        self.set_details("")

    def show_card(self, card: Dict[str, Any]) -> None:
        image_path = find_card_image(card, self.image_index, self.images_root)
        self.display_image(image_path)
        self.set_details(self.format_card_details(card, image_path))

    def display_image(self, image_path: Optional[Path]) -> None:
        if not image_path:
            self.image_label.configure(image="", text="Image not found")
            self.current_photo = None
            return

        if Image is None or ImageTk is None:
            self.image_label.configure(
                image="",
                text=f"Image found:\n{image_path}\n\nInstall Pillow to preview images:\npip install pillow"
            )
            self.current_photo = None
            return

        try:
            img = Image.open(image_path)
            img.thumbnail((520, 700))
            self.current_photo = ImageTk.PhotoImage(img)
            self.image_label.configure(image=self.current_photo, text="")
        except Exception as exc:
            self.image_label.configure(image="", text=f"Could not open image:\n{image_path}\n\n{exc}")
            self.current_photo = None

    def set_details(self, text: str) -> None:
        self.details.configure(state=tk.NORMAL)
        self.details.delete("1.0", tk.END)
        self.details.insert(tk.END, text)
        self.details.configure(state=tk.DISABLED)

    def format_card_details(self, card: Dict[str, Any], image_path: Optional[Path]) -> str:
        lines = []
        title = str(card.get("name", "Untitled"))
        lines.append(title)
        lines.append("=" * max(8, len(title)))
        lines.append("")

        for key in ("id", "slug", "faction", "type", "subtype", "spiritCost", "costResource", "attack", "health", "rarity"):
            if key in card and card.get(key) not in (None, ""):
                lines.append(f"{key}: {card.get(key)}")

        if card.get("rulesText"):
            lines.append("")
            lines.append("Rules Text")
            lines.append("----------")
            lines.append(str(card.get("rulesText")))

        effects = card.get("effects")
        if effects:
            lines.append("")
            lines.append("Effects")
            lines.append("-------")
            for i, effect in enumerate(effects, 1):
                lines.append(f"{i}. {json.dumps(effect, ensure_ascii=False, indent=2)}")

        lines.append("")
        lines.append("Image")
        lines.append("-----")
        lines.append(str(image_path) if image_path else "Not found")

        lines.append("")
        lines.append("Raw Card Data")
        lines.append("-------------")
        lines.append(json.dumps(card, ensure_ascii=False, indent=2))

        return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Euphoria card viewer.")
    parser.add_argument("--json", type=str, default="", help="Path to cards JSON.")
    parser.add_argument("--images", type=str, default="", help="Root folder containing card images.")
    args = parser.parse_args()

    json_path = Path(args.json) if args.json else None
    images_root = Path(args.images) if args.images else None

    app = CardViewer(json_path=json_path, images_root=images_root)
    app.mainloop()


if __name__ == "__main__":
    main()
