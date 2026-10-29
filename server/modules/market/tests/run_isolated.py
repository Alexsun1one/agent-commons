"""Run MARKET-1 tests without loading every parallel-lane module.

Standard command (once the whole module package loads):
    cd server && python3 -m unittest modules.market.tests.test_market -q

During R13 another lane's module currently fails the core route-prefix check at
import time, so create_app() cannot discover the full package. This runner keeps
the market tests reproducible by loading only market + media, which is all this
module needs (media provides the image pipeline and its migrations).
"""

import unittest

from app import discovery

_REAL_DISCOVER = discovery.discover


def _market_only(package):
    return [module for module in _REAL_DISCOVER(package) if module.name in ('market', 'media')]


def main():
    discovery.discover = _market_only
    suite = unittest.TestLoader().loadTestsFromName('modules.market.tests.test_market')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
