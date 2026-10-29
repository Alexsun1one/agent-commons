import time
from datetime import datetime, timezone

FORMAT = '%Y-%m-%dT%H:%M:%S.%fZ'


def now_ts():
    return time.time()


def iso(ts=None):
    return datetime.fromtimestamp(now_ts() if ts is None else ts, timezone.utc).strftime(FORMAT)


def now():
    return iso()


def parse(value):
    return datetime.strptime(value, FORMAT).replace(tzinfo=timezone.utc).timestamp()
