"""公开层测试的公共夹具。"""
from app import clock, objects
from modules.public import screen
from tests.helpers import HDRS, AppCase

RICH_TYPES = ('howto', 'faq', 'talk', 'term', 'trend', 'hot', 'tool', 'dataset', 'skill', 'prompt',
              'component', 'product', 'event', 'discussion')

CONFIG = {
    'rate.page_per_min': '100000',
    'rate.api_per_min': '100000',
    'rate.ua_per_min': '100000',
    'rate.ai_per_min': '100000',
}


def rich_text(content):
    return ' '.join(str(content.get(key, '')) for key in ('title', 'body', 'summary'))


class PublicCase(AppCase):
    def setUp(self):
        super().setUp()
        self._screeners = list(screen.SCREENERS)
        self._governance = screen.GOVERNANCE_HOOK
        screen.GOVERNANCE_HOOK = False  # 公开层测试不依赖 GOV-1 规则阈值
        self.enable()
        for key, value in CONFIG.items():
            self.set_config(key, value)

    def tearDown(self):
        del screen.SCREENERS[:]
        screen.SCREENERS.extend(self._screeners)
        screen.GOVERNANCE_HOOK = self._governance
        super().tearDown()

    def enable(self):
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'public.enabled'")

    def disable(self):
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 0 WHERE key = 'public.enabled'")

    def set_config(self, key, value):
        with self.db.write() as conn:
            conn.execute(
                'INSERT INTO public_config (key, value, updated_at) VALUES (?, ?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
                (key, str(value), clock.now()))

    def add_rich_types(self):
        with self.db.write() as conn:
            for name in RICH_TYPES:
                objects.register_type(name, validate=lambda content: content if isinstance(content, dict) else {},
                                      text=rich_text)
                conn.execute(
                    'INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, '
                    "note, updated_at) VALUES (?, 1, '[]', 0, 0, NULL, 'test-only type', ?)",
                    (f'object.create.{name}', clock.now()))

    def make(self, client, type_='knowledge', title='公开知识', content=None):
        return self.obj(client, type=type_, title=title,
                        content=content or {'body': '正文内容', 'summary': '摘要'})

    def publish(self, client, object_id, kind='knowledge', slug='hello', **extra):
        body = {'object_id': object_id, 'kind': kind, 'slug': slug}
        body.update(extra)
        return client.post('/api/public/publish', headers=HDRS, json=body)

    def publish_ok(self, client, object_id, kind='knowledge', slug='hello', **extra):
        response = self.publish(client, object_id, kind, slug, **extra)
        self.assertIn(response.status_code, (201, 202), response.text)
        return response.json()['data']

    def snapshot_count(self):
        with self.db.read() as conn:
            return conn.execute('SELECT count(*) FROM public_snapshot').fetchone()[0]
