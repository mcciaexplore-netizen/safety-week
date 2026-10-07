"""Shop-facing catalogue helpers: URL slugs and the default category of a material (editable per product later)."""

import re

CATEGORY_RULES = [  # first match wins; mirrored in migration 0011 for rows that already exist
    (r"^t[ -]?shirt", "T-Shirts"),
    (r"^banner", "Banners"),
    (r"^flag", "Flags"),
    (r"^(poster|slogan)", "Posters & Slogans"),
    (r"^(scroll|ppe scroll|oath)", "Scrolls & Oath"),
    (r"^pocket", "Books & Calendars"),
    (r"^(badge|ball pen|cap|coffee|water|dangler|sticker)", "Gifts & Accessories"),
]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:110] or "item"


def category_of(name: str) -> str:
    n = " ".join(name.split()).lower()
    for pattern, cat in CATEGORY_RULES:
        if re.search(pattern, n):
            return cat
    return "Safety Materials"
