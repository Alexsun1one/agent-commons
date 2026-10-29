import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return f.read()


def item(source, title, published_at, url=None, lang=None):
    from engine.feed.parse import canonicalize, detect_lang
    url = url or "https://%s.example.test/%s" % (source, abs(hash((source, title))) % 10**8)
    return {
        "source": source, "url": url, "canonical_url": canonicalize(url), "title": title,
        "excerpt": "", "published_at": published_at, "lang": lang or detect_lang(title),
    }
