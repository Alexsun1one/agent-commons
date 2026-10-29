"""L1 de-identification. Standard library only. The HMAC key is only ever read from a file path.
Detection runs on a normalised shadow string (NFKC per character, zero-width removed, dashes unified, whitespace
collapsed); every hit is mapped back to the original text, which is never rewritten wholesale."""
import errno
import hashlib
import hmac
import os
import re
import stat
import unicodedata
from collections import Counter
from datetime import date, datetime, timezone

PH_PHONE, PH_WECHAT, PH_EMAIL, PH_LINK = "[手机号]", "[微信号]", "[邮箱]", "[私链]"
PH_QQ, PH_ID = "[QQ号]", "[证件号]"
PLACEHOLDER_RE = re.compile(r"(\[(?:手机号|微信号|邮箱|私链|QQ号|证件号)\])")
TEXT_KINDS = frozenset({"text", "quote", "system"})  # other kinds (image/voice/...) keep no text
MIN_KEY_BYTES = 32
MIN_KEY_DISTINCT = 8
MIN_NAME_LEN = 2
MAX_AT_NAME = 40

PRIVATE_DOMAINS = (
    "feishu.cn", "feishu.net", "larksuite.com", "larkoffice.com", "notion.so", "notion.site", "docs.qq.com",
    "wj.qq.com", "meeting.tencent.com", "meeting.qq.com", "shimo.im", "yuque.com", "kdocs.cn", "wps.cn",
    "alidocs.dingtalk.com", "dingtalk.com", "wolai.com", "flowus.cn", "pan.baidu.com", "aliyundrive.com",
    "alipan.com", "123pan.com", "pan.quark.cn", "drive.google.com", "docs.google.com", "dropbox.com",
    "1drv.ms", "onedrive.live.com", "airtable.com", "figma.com", "miro.com", "teambition.com", "mubu.com",
    "ones.ai", "tower.im", "wx.qq.com", "work.weixin.qq.com",
)
SHORT_DOMAINS = (
    "t.cn", "url.cn", "w.url.cn", "dwz.cn", "dwz.n", "suo.im", "985.so", "sourl.cn", "t.co", "bit.ly", "tinyurl.com",
    "is.gd", "goo.gl", "ow.ly", "buff.ly", "reurl.cc", "cutt.ly", "rb.gy", "t.ly", "shorturl.at", "lnkd.in",
    "v.douyin.com", "b23.tv", "xhslink.com", "m.tb.cn", "e.tb.cn", "u.jd.com", "qr.alipay.com", "t.me",
)
_DOM_ALT = "|".join(re.escape(d) for d in sorted(PRIVATE_DOMAINS, key=len, reverse=True))
_SHORT_ALT = "|".join(re.escape(d) for d in sorted(SHORT_DOMAINS, key=len, reverse=True))
_URL_END = r"""[^\s<>"'）)」』】，。！？、；;\u3000-\u303f\u4e00-\u9fff]"""
URL_RE = re.compile(r"https?://" + _URL_END + "+", re.I)
BARE_PRIVATE_RE = re.compile(
    r"(?<![A-Za-z0-9@.\-])(?:[A-Za-z0-9-]+\.)*(?:(?:" + _DOM_ALT + r")(?::\d+)?(?:/" + _URL_END + r"*)?"
    r"|(?:" + _SHORT_ALT + r")(?::\d+)?/[A-Za-z0-9_\-]{3,}" + _URL_END + r"*)", re.I)
_AT = r"(?:@|[\(\[\{<]\s?at\s?[\)\]\}>]|艾特)"
_DOT_WORD = r"(?:\s{0,2}[\(\[\{<]\s?dot\s?[\)\]\}>]\s{0,2}|\s+dot\s+|\s{0,2}点\s{0,2})"
_LABEL = r"[A-Za-z0-9\-]+"
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+\s{0,2}" + _AT + r"\s{0,2}" + _LABEL + r"(?:(?:\.|。|" + _DOT_WORD + r")" + _LABEL + r")+", re.I)
EMAIL_WORD_RE = re.compile(
    r"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+\s+at\s+" + _LABEL + r"(?:" + _DOT_WORD + _LABEL + r")+", re.I)
WXID_RE = re.compile(r"(?<![A-Za-z0-9_])wxid_[A-Za-z0-9_\-]{4,}")
PHONE_RE = re.compile(
    r"(?<!\d)(?:\(?(?:\+|00)?86\)?[\s\-]{0,2})?"
    r"(?:1[\s\-_/·]{0,3}[3-9][\s\-_/·]{0,3}\d(?:[\s\-_/·]{0,3}\d){8}|1[3-9]\d\.\d{4}\.\d{4})(?!\d)"
    r"|(?<!\d)\(?0\d{2,3}\)?[\s\-]{1,3}\d{7,8}(?!\d)")
_WX_PRE = (r"(?<![A-Za-z])(?P<pre>(?:微信号|微信|威信|薇信|[Vv]信|[Vv][Xx]|[Ww][Xx]|[Ww]eixin|[Ww]e[Cc]hat)"
           r"(?:\s*[Ii][Dd](?![A-Za-z]))?\s*(?P<sep>[:：=是为]?)\s*)")
WECHAT_PREFIX_RE = re.compile(_WX_PRE + r"(?P<id>[A-Za-z][-_A-Za-z0-9]{5,19}|[1-9]\d{5,11})(?![A-Za-z0-9_\-])")
WECHAT_SPLIT_RE = re.compile(_WX_PRE + r"(?P<id>(?:[A-Za-z0-9_\-] ){5,19}[A-Za-z0-9_\-])(?![A-Za-z0-9_\-])")
WX_STOPWORDS = frozenset(
    "payment message messages official account accounts platform developer developers moments miniprogram channels "
    "business support service services notification notifications browser desktop version login group groups article "
    "articles public contact contacts security password verify verification".split())
QQ_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<pre>(?:qq|扣扣|企鹅)(?:群号|号码|群|号)?\s*(?:id)?\s*[:=是为]?\s*)"
    r"(?P<id>[1-9](?: ?\d){4,11})(?!\d)", re.I)
ID18_RE = re.compile(
    r"(?<![0-9A-Za-z])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])")
ID15_RE = re.compile(
    r"(?<![0-9A-Za-z])[1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?![0-9A-Za-z])")
ID_LABEL_RE = re.compile(
    r"(?:身份证件?(?:号码?)?|证件号码?|公民身份号码|ID\s?(?:card|no\.?|number))\s*[:=是为]?\s*", re.I)
ID_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
ID_CHECK = "10X98765432"
ID_PROVINCES = frozenset(
    "11 12 13 14 15 21 22 23 31 32 33 34 35 36 37 41 42 43 44 45 46 50 51 52 53 54 61 62 63 64 65 71 81 82 91".split())
DATE_FULL_RE = re.compile(
    r"(?<!\d)((?:19|20)\d{2})([-/.年])(\d{1,2})(?:[-/.月])(\d{1,2})[日号]?"
    r"(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)")
DATE_COMPACT_RE = re.compile(
    r"(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[T_ ]?(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?)?(?!\d)")
DATE_DMY_RE = re.compile(r"(?<![\d.])(\d{1,2})([/.\-])(\d{1,2})\2((?:19|20)\d{2})(?!\d)")
_MON = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE_EN_RE = re.compile(
    r"\b(?:" + _MON + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})"
    r"|(\d{1,2})(?:st|nd|rd|th)?\s+" + _MON + r"\.?,?\s+((?:19|20)\d{2}))\b", re.I)
DATE_MD_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})[日号]")
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
QUOTE_NAME_RES = (
    re.compile(r"<displayname>\s*(?:<!\[CDATA\[)?([^<\]]{1,64}?)(?:\]\]>)?\s*</displayname>", re.I),
    re.compile(r"\b(?:sender|sender_name|nickname|nick|display_?name|author|from_name)\s*=\s*[\"']([^\"']{1,64})[\"']", re.I),
)
TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?")
DATE_ONLY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

_CF = "\u00ad\u0600-\u0605\u061c\u06dd\u070f\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000e0001\U000e0020-\U000e007f"
_DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212\ufe58\ufe63\uff0d"
CF_RE = re.compile("[" + _CF + "]")
ODD_RE = re.compile("[" + _CF + _DASHES + "\t\x0b\x0c\x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|  |(?![0-9])\\d")
DASH_SET = frozenset(_DASHES)


class KeyFileError(Exception):
    pass


def load_key(path):
    """Read the HMAC key from a file. No default, no env var, no key in code."""
    if not path:
        raise KeyFileError("a key file path is required (--key-file)")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0))
    except OSError as e:
        if e.errno == errno.ELOOP:
            raise KeyFileError("key file must not be a symlink")
        raise KeyFileError("cannot read key file: %s" % e.strerror)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise KeyFileError("key file must be a regular file")
        if st.st_mode & 0o077:
            raise KeyFileError("key file must not be readable by group/other (chmod 600)")
        with os.fdopen(fd, "rb") as f:
            fd = None
            key = f.read(65536).strip(b" \t\r\n")
    finally:
        if fd is not None:
            os.close(fd)
    if len(key) < MIN_KEY_BYTES:
        raise KeyFileError("key file too short (need >= %d bytes)" % MIN_KEY_BYTES)
    if len(set(key)) < MIN_KEY_DISTINCT:
        raise KeyFileError("key file looks low-entropy (use random bytes)")
    return key


def parse_ts(value, allow_date=False):
    """Strict timestamp parse; naive values are taken as UTC. Returns an aware UTC datetime or raises ValueError."""
    s = value.strip() if isinstance(value, str) else ""
    if not (TS_RE.fullmatch(s) or (allow_date and DATE_ONLY_RE.fullmatch(s))):
        raise ValueError("bad timestamp")
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def hmac_hex(key, label, *parts, n=32):
    msg = "\x1f".join((label,) + tuple(str(p) for p in parts)).encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()[:n]


def record_hmac(key, group, src_id):
    return hmac_hex(key, "rec", group, src_id)


def _is_short_link(host, path):
    base = ".".join(host.split(".")[-2:])
    return len(base) <= 5 and re.fullmatch(r"/[A-Za-z0-9_\-]{4,}/?", path) is not None


def _is_private_url(url):
    m = re.match(r"https?://([^/:?#]+)(?::\d+)?([^?#]*)(\?[^#]*)?", url, re.I)
    if not m:
        return True
    host, path, query = m.group(1).lower(), m.group(2) or "", m.group(3) or ""
    if any(host == d or host.endswith("." + d) for d in PRIVATE_DOMAINS + SHORT_DOMAINS):
        return True
    if _is_short_link(host, path):
        return True
    if host == "localhost" or re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", host) or host.endswith((".local", ".internal", ".lan")):
        return True
    if re.search(r"(?:^|[?&])(?:token|key|sig|signature|pwd|password|secret|ticket|auth|access_token|code|share)=", query, re.I):
        return True
    for seg in path.split("/"):
        if len(seg) >= 20 and re.fullmatch(r"[A-Za-z0-9_\-]+", seg) and re.search(r"[0-9A-Z]", seg):
            return True
    return False


def _strip_url_tail(url):
    tail = ""
    while url and url[-1] in ".,:!?*_~":
        tail = url[-1] + tail
        url = url[:-1]
    return url, tail


def _shadow(text):
    """Returns (shadow, starts, ends); starts/ends map each shadow char to its original [start, end). None = identity."""
    if unicodedata.is_normalized("NFKC", text) and not ODD_RE.search(text):
        return text, None, None
    out, ss, se, prev_space = [], [], [], False
    for i, c in enumerate(text):
        if CF_RE.match(c):
            continue
        if c in "\n\r":
            n, prev_space = c, False
        elif c.isspace() or "\x1c" <= c <= "\x1f":
            if prev_space:
                se[-1] = i + 1
                continue
            n, prev_space = " ", True
        else:
            prev_space = False
            n = "-" if c in DASH_SET else (c if c < "\x80" else unicodedata.normalize("NFKC", c))
            if not n.isascii() and any(x.isdecimal() for x in n):
                n = "".join(str(unicodedata.decimal(x)) if x.isdecimal() else x for x in n)
        for ch in n:
            out.append(ch)
            ss.append(i)
            se.append(i + 1)
    return "".join(out), ss, se


def _norm_name(nm):
    s = _shadow(str(nm))[0]
    return re.sub(r"\s+", " ", s).strip().lower()


def _id18_ok(s):
    try:
        date(int(s[6:10]), int(s[10:12]), int(s[12:14]))
    except ValueError:
        return False
    chk = ID_CHECK[sum(int(c) * w for c, w in zip(s[:17], ID_WEIGHTS)) % 11]
    return s[17].upper() == chk


def _id15_ok(s):
    try:
        date(1900 + int(s[6:8]), int(s[8:10]), int(s[10:12]))
    except ValueError:
        return False
    return s[:2] in ID_PROVINCES


class Deidentifier:
    def __init__(self, key, members, extra_names=()):
        """members: iterable of (sender_id, sender_name). extra_names: iterable of names (non-members)."""
        if not key or len(key) < MIN_KEY_BYTES:
            raise KeyFileError("a key of >= %d bytes is required" % MIN_KEY_BYTES)
        self.key = key
        ids = {}
        names = {}
        for sid, nm in members:
            sid = str(sid)
            ids.setdefault(sid, set())
            if nm is not None and str(nm).strip():
                ids[sid].add(str(nm).strip())
        self.member_ids = {sid: hmac_hex(key, "member-id", sid, n=24) for sid in ids}
        self.member_codes = self._assign_codes(ids)
        self.extra_codes = set()
        self.short_skipped = 0
        self.short_names = {}
        self.alias_names = {}
        self._alias_re = None
        self._at_cache = None
        for sid, nms in ids.items():
            code = self.member_codes[sid]
            for nm in nms | ({sid} if len(sid) >= 4 else set()):
                self._add_name(names, nm, code)
        for nm in extra_names:
            nm = nm.strip()
            if nm and _norm_name(nm) not in names:
                self._add_name(names, nm, self._extra_code(_norm_name(nm)))
        self.name_re = None
        if names:
            alt = "|".join(re.escape(n) for n in sorted(names, key=lambda s: (-len(s), s)))
            self.name_re = re.compile(alt, re.I)
        self.names = names
        self.n_names = len(names)

    def _add_name(self, names, nm, code):
        k = _norm_name(nm)
        if len(k) < MIN_NAME_LEN:
            self.short_skipped += 1
            if k:
                self.short_names.setdefault(k, code)
            return
        names.setdefault(k, code)

    def _used_codes(self):
        return set(self.member_codes.values()) | self.extra_codes

    def _extra_code(self, key):
        used = self._used_codes()
        n = int(hmac_hex(self.key, "member-extra", key, n=12), 16) % 9999 + 1
        while "M%04d" % n in used:
            n = n % 9999 + 1
        code = "M%04d" % n
        self.extra_codes.add(code)
        return code

    def _assign_codes(self, ids):
        """Display codes M0001-M9999 are per-batch handles; the stable internal id is member_ids (96-bit HMAC)."""
        used, codes = set(), {}
        for mid, sid in sorted((self.member_ids[sid], sid) for sid in ids):
            n = int(mid, 16) % 9999 + 1
            while n in used:
                n = n % 9999 + 1
            used.add(n)
            codes[sid] = "M%04d" % n
        return codes

    def member_id(self, sender_id):
        sid = str(sender_id)
        if sid not in self.member_ids:
            self.member_ids[sid] = hmac_hex(self.key, "member-id", sid, n=24)
        return self.member_ids[sid]

    def member_code(self, sender_id):
        sid = str(sender_id)
        if sid not in self.member_codes:
            used = self._used_codes()
            n = int(self.member_id(sid), 16) % 9999 + 1  # not in dictionary
            while "M%04d" % n in used:
                n = n % 9999 + 1
            self.member_codes[sid] = "M%04d" % n
        return self.member_codes[sid]

    # ---- aliases ----------------------------------------------------------
    def add_alias(self, name):
        """Register a display name seen outside the member table (e.g. in a quote payload). Returns True if new."""
        k = _norm_name(name)
        if len(k) < MIN_NAME_LEN:
            if k:
                self.short_names.setdefault(k, None)
            return False
        if k in self.names or k in self.alias_names:
            return False
        self.alias_names[k] = self._extra_code(k)
        self._alias_re = None
        return True

    def register_quote_names(self, text):
        if text:
            self._learn_quote_names(_shadow(text)[0])

    def _learn_quote_names(self, s):
        if "=" not in s and "<displayname" not in s.lower():
            return
        for rx in QUOTE_NAME_RES:
            for m in rx.finditer(s):
                self.add_alias(m.group(1))

    def _at_index(self):
        c = self._at_cache
        if c and c[0] is self.names and c[1] == len(self.names) and c[2] == len(self.alias_names):
            return c[3], c[4]
        idx = {}
        for src in (self.alias_names, self.names):
            for k, code in src.items():
                idx.setdefault(re.sub(r"\s+", "", k), code)
        mx = min(max((len(k) for k in idx), default=0), MAX_AT_NAME)
        self._at_cache = (self.names, len(self.names), len(self.alias_names), idx, mx)
        return idx, mx

    # ---- text -------------------------------------------------------------
    def deid_text(self, text, stats=None):
        st = stats if stats is not None else Counter()
        if not text:
            return ""
        s, ss, se = _shadow(text)
        claimed = bytearray(len(s))
        spans = []

        def take(a, b, repl, key=None):
            if a >= b or any(claimed[a:b]):
                return False
            claimed[a:b] = b"\x01" * (b - a)
            spans.append((a, b, repl))
            if key:
                st[key] += 1
            return True

        for m in URL_RE.finditer(s):
            url, _ = _strip_url_tail(m.group(0))
            if _is_private_url(url):
                take(m.start(), m.start() + len(url), PH_LINK, "link")
        for m in EMAIL_RE.finditer(s):
            take(m.start(), m.end(), PH_EMAIL, "email")
        for m in EMAIL_WORD_RE.finditer(s):
            take(m.start(), m.end(), PH_EMAIL, "email")
        for m in BARE_PRIVATE_RE.finditer(s):
            take(m.start(), m.end(), PH_LINK, "link")
        for m in WXID_RE.finditer(s):
            take(m.start(), m.end(), PH_WECHAT, "wechat")
        self._ids(s, take)
        for m in PHONE_RE.finditer(s):
            take(m.start(), m.end(), PH_PHONE, "phone")
        for m in QQ_RE.finditer(s):
            take(m.start("id"), m.end("id"), PH_QQ, "qq")
        for rx in (WECHAT_PREFIX_RE, WECHAT_SPLIT_RE):
            for m in rx.finditer(s):
                idv = m.group("id")
                if rx is WECHAT_SPLIT_RE or m.group("sep") or re.search(r"[\d_\-]", idv) or idv.lower() not in WX_STOPWORDS:
                    take(m.start("id"), m.end("id"), PH_WECHAT, "wechat")
        self._dates(s, take)
        self._learn_quote_names(s)
        self._names(s, claimed, take, st)
        return self._rebuild(text, ss, se, spans)

    @staticmethod
    def _rebuild(text, ss, se, spans):
        spans.sort()
        parts, pos = [], 0
        for a, b, r in spans:
            oa, ob = (a, b) if ss is None else (ss[a], se[b - 1])
            oa = max(oa, pos)
            parts.append(CF_RE.sub("", text[pos:oa]))
            parts.append(r)
            pos = max(ob, oa)
        parts.append(CF_RE.sub("", text[pos:]))
        return "".join(parts)

    @staticmethod
    def _ids(s, take):
        for m in ID18_RE.finditer(s):
            if _id18_ok(m.group(0)):
                take(m.start(), m.end(), PH_ID, "idcard")
        for m in ID15_RE.finditer(s):
            if _id15_ok(m.group(0)):
                take(m.start(), m.end(), PH_ID, "idcard")
        for m in ID_LABEL_RE.finditer(s):  # a labelled number is redacted even when the check digit is wrong
            k, got, last = m.end(), [], None
            while k < len(s) and len(got) < 18:
                c = s[k]
                if c in "0123456789Xx":
                    got.append(k)
                elif c in " -" and got and k + 1 < len(s) and s[k + 1] in "0123456789Xx":
                    pass
                else:
                    break
                k += 1
            if len(got) >= 15:
                take(got[0], got[-1] + 1, PH_ID, "idcard")

    @staticmethod
    def _dates(s, take):
        for m in DATE_FULL_RE.finditer(s):
            mo = int(m.group(3))
            if 1 <= mo <= 12 and 1 <= int(m.group(4)) <= 31:
                take(m.start(), m.end(), "%s-%02d" % (m.group(1), mo), "date")
        for m in DATE_COMPACT_RE.finditer(s):
            take(m.start(), m.end(), "%s-%s" % (m.group(1), m.group(2)), "date")
        for m in DATE_DMY_RE.finditer(s):
            a, b = int(m.group(1)), int(m.group(3))
            if a > 31 or b > 31 or a < 1 or b < 1 or (a > 12 and b > 12):
                continue
            mo = b if (a > 12 or b <= 12) else a  # day/month/year unless only the first part can be a month
            take(m.start(), m.end(), "%s-%02d" % (m.group(4), mo), "date")
        for m in DATE_EN_RE.finditer(s):
            mon, yr = (m.group(1), m.group(3)) if m.group(1) else (m.group(5), m.group(6))
            take(m.start(), m.end(), "%s-%02d" % (yr, MONTHS[mon[:3].lower()]), "date")
        for m in DATE_MD_RE.finditer(s):
            if 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31:
                take(m.start(), m.end(), "%d月" % int(m.group(1)), "date")

    def _names(self, s, claimed, take, st):
        idx, mx = self._at_index()
        if mx or self.short_names:
            for am in re.finditer("@", s):
                a = am.start()
                if claimed[a]:
                    continue
                comp, ends, k = [], [], a + 1
                while k < len(s) and len(comp) < mx + 1 and not claimed[k]:
                    c = s[k]
                    if c in "@\n\r":
                        break
                    if c != " ":
                        comp.append(c.lower())
                        ends.append(k + 1)
                    elif comp and k + 1 < len(s) and s[k + 1] == " ":
                        break
                    k += 1
                word = "".join(comp)
                hit = next((n for n in range(min(len(word), mx), 0, -1) if word[:n] in idx), 0)
                if hit:
                    take(a, ends[hit - 1], "@" + idx[word[:hit]], "name")
                elif word[:1] in self.short_names:
                    st["review"] += 1
                elif word and word[0].isalnum() and not re.match(r"(?:所有人|all\b|everyone|here\b|m[0-9a-f]{4})", word):
                    st["review"] += 1
        regexes = []
        if self.name_re is not None:
            regexes.append((self.name_re, self.names))
        if self.alias_names:
            if self._alias_re is None:
                alt = "|".join(re.escape(n) for n in sorted(self.alias_names, key=lambda x: (-len(x), x)))
                self._alias_re = re.compile(alt, re.I)
            regexes.append((self._alias_re, self.alias_names))
        for rx, table in regexes:
            for seg in re.finditer(rb"\x00+", bytes(claimed)):
                for m in rx.finditer(s, seg.start(), seg.end()):
                    if m.end() == m.start():
                        continue
                    try:
                        code = table[m.group(0).lower()]
                    except KeyError:
                        continue
                    take(m.start(), m.end(), code, "name")

    # ---- rows -------------------------------------------------------------
    def deid_row(self, row, stats=None):
        """row: dict with id, group_alias, sender_id, sent_at, kind, text, quoted_message_id.
        Returns the public record (no names, no exact time). Keys starting with `_` are private (sort keys, internal id).
        `sent_at` is parsed strictly (ValueError if invalid) and converted to UTC; naive values are taken as UTC."""
        g = row["group_alias"]
        qid = row.get("quoted_message_id")
        kind = row.get("kind") or "text"
        dt = parse_ts(row["sent_at"])
        return {
            "record_hmac": record_hmac(self.key, g, row["id"]),
            "group": g,
            "member": self.member_code(row["sender_id"]),
            "month": "%04d-%02d" % (dt.year, dt.month),
            "kind": kind,
            "text": self.deid_text(row.get("text") or "", stats) if kind in TEXT_KINDS else "",
            "reply_to": record_hmac(self.key, g, qid) if qid is not None else None,
            "_ts": dt.isoformat(),
            "_id": row["id"],
            "_member_id": self.member_id(row["sender_id"]),
        }


def public(rec):
    return {k: v for k, v in rec.items() if not k.startswith("_")}


def read_extra_names(path):
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
