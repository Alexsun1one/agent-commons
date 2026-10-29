#!/usr/bin/env python3
"""Small standard-library load probe for the Commons list and search endpoints."""

from __future__ import annotations

import argparse
import concurrent.futures
import math
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        help="Target origin. Defaults to http://127.0.0.1:8000; any non-loopback target must be passed explicitly.",
    )
    parser.add_argument("--list-path", default="/api/objects")
    parser.add_argument("--search-path", default="/api/search")
    parser.add_argument("--query", default="模型")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--cookie-env", help="Name of an env var holding a session cookie (name=value) for member-only paths; the value is never printed.")
    return parser.parse_args()


def percentile(samples: list[float], fraction: float) -> float:
    ordered = sorted(samples)
    index = max(0, math.ceil(len(ordered) * fraction) - 1)
    return ordered[index]


def fetch(url: str, timeout: float, cookie: str = "") -> tuple[float, int]:
    started = time.perf_counter()
    headers = {"Accept": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        exc.read()
        status = exc.code
    except (urllib.error.URLError, TimeoutError):
        status = 0
    return (time.perf_counter() - started) * 1000, status


def main() -> int:
    args = parse_args()
    if args.requests < 1 or args.concurrency < 1:
        raise SystemExit("--requests and --concurrency must be positive")

    explicit_target = args.base_url is not None
    base_url = (args.base_url or "http://127.0.0.1:8000").rstrip("/")
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise SystemExit("base URL must be an HTTP(S) origin without embedded credentials")
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"} and not explicit_target:
        raise SystemExit("non-loopback targets must be passed explicitly with --base-url")
    if not args.list_path.startswith("/") or not args.search_path.startswith("/"):
        raise SystemExit("endpoint paths must start with /")

    cookie = os.environ.get(args.cookie_env, "") if args.cookie_env else ""
    if args.cookie_env and not cookie:
        raise SystemExit(f"{args.cookie_env} is empty")
    list_url = base_url + args.list_path
    search_query = urllib.parse.urlencode({"q": args.query})
    separator = "&" if "?" in args.search_path else "?"
    search_url = base_url + args.search_path + separator + search_query
    urls = [list_url if index % 2 == 0 else search_url for index in range(args.requests)]

    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        samples = list(pool.map(lambda url: fetch(url, args.timeout, cookie), urls))
    elapsed = time.perf_counter() - started

    latencies = [latency for latency, _ in samples]
    statuses = [status for _, status in samples]
    successes = sum(200 <= status < 300 for status in statuses)
    failures = len(statuses) - successes
    print(f"target={base_url} requests={len(samples)} concurrency={args.concurrency}")
    print(f"success={successes} failure={failures} elapsed_seconds={elapsed:.3f}")
    print(
        "latency_ms "
        f"P50={percentile(latencies, 0.50):.2f} "
        f"P95={percentile(latencies, 0.95):.2f} "
        f"P99={percentile(latencies, 0.99):.2f} "
        f"mean={statistics.fmean(latencies):.2f} max={max(latencies):.2f}"
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
