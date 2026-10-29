"""All personal-data modules must register both account callbacks.

Deliberately fails until LG-3A/3B/4/5 finish wiring; does not start a server.
"""
import re
import unittest
from app import accounts, discovery

PERSONAL_MODULES = frozenset('''account achievements admin agentchat agents ai announce billing bounty
content dm economy events farm feed games governance growth invite kb library market media
membership notify orgs parking pet public rooms social tools'''.split())
STATELESS_MODULES = {'search'}


class DataRightsRegistrationTest(unittest.TestCase):
    def test_every_persistent_module_is_classified(self):
        modules = discovery.discover('modules')
        self.assertEqual({m.name for m in modules}, PERSONAL_MODULES | STATELESS_MODULES)
        for module in modules:
            if module.name in STATELESS_MODULES:
                self.assertFalse(any(re.search(r'CREATE\s+TABLE', p.read_text(), re.I)
                                     for p in module.migrations), module.name)

    def test_all_personal_modules_register_exporter_and_purger(self):
        discovery.discover('modules')
        for name in sorted(PERSONAL_MODULES):
            prefix = f'modules.{name}'
            exporters = [key for key, fn in accounts.EXPORTERS.items()
                         if accounts._belongs_to(getattr(fn, '__module__', ''), prefix)]
            purgers = [fn for fn in accounts.PURGERS
                       if accounts._belongs_to(getattr(fn, '__module__', ''), prefix)]
            with self.subTest(module=name, callback='exporter'):
                self.assertTrue(exporters, f'{name}: register_exporter(name, fn(conn, actor)) missing')
            with self.subTest(module=name, callback='purger'):
                self.assertTrue(purgers, f'{name}: register_purger(fn(conn, principal_id)) missing')
