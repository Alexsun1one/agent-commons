"""Normalize machine-specific error fragments into stable signatures."""

from __future__ import annotations

import hashlib
import re
import unicodedata


ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
UUID = re.compile(r"(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])", re.I)
TIMESTAMP = re.compile(
    r"\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b"
    r"|\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b",
    re.I,
)
HEX_ADDRESS = re.compile(r"(?<![\w])0x[0-9a-f]{6,}(?![\w])", re.I)
WINDOWS_PATH = re.compile(r"(?<![\w])(?:[a-zA-Z]:\\|\\\\)[^\s\"'<>|]+")
UNIX_PATH = re.compile(r"(?<![\w])/(?:Users|home|var|tmp|private|opt|srv|workspace|app|mnt|Volumes)/[^\s\"'<>]+", re.I)
FILE_LOCATION = re.compile(r"(?P<file>\b[\w.-]+\.(?:py|pyi|js|jsx|mjs|cjs|ts|tsx|rs|go|java|kt|rb|php|c|cc|cpp|h|hpp))(?::\d+){1,2}\b", re.I)
LINE_COLUMN = re.compile(r"\b(?:line|row|column|col)\s+\d+(?:\s*,?\s*(?:column|col)\s+\d+)?\b", re.I)
USER_FRAGMENT = re.compile(r"\b(?:user(?:name)?|login|account|owner)\s*[=:]\s*[A-Za-z][\w.-]{1,63}\b", re.I)
AT_USER = re.compile(r"(?<![\w@])@[A-Za-z][\w.-]{1,63}\b")
NUMBER = re.compile(r"(?<![\w])\d+(?![\w])")
SPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Return a deterministic, privacy-reduced signature string."""
    if not isinstance(text, str):
        raise TypeError("error signature must be text")
    value = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    value = ANSI.sub(" ", value)
    value = UUID.sub(" <uuid> ", value)
    value = TIMESTAMP.sub(" <time> ", value)
    value = HEX_ADDRESS.sub(" <addr> ", value)
    value = WINDOWS_PATH.sub(" <path> ", value)
    value = UNIX_PATH.sub(" <path> ", value)
    value = FILE_LOCATION.sub(lambda m: f"{m.group('file')}:<line>", value)
    value = LINE_COLUMN.sub("line <line>", value)
    value = USER_FRAGMENT.sub(lambda m: m.group(0).split("=", 1)[0].split(":", 1)[0] + "=<user>", value)
    value = AT_USER.sub("@<user>", value)
    value = NUMBER.sub("<num>", value)
    value = SPACE.sub(" ", value).strip().casefold()
    return value


def digest(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def signature(text: str) -> tuple[str, str]:
    normalized = normalize(text)
    return normalized, hashlib.sha256(normalized.encode("utf-8")).hexdigest()

