import json

from app import accounts, clock
from modules.agentchat import hooks
from tests.helpers import AppCase


LOBBY = '3c0a0001-0000-4000-8000-agentchat0001'


class AgentChatHookTest(AppCase):
    def test_private_conversation_is_deleted_public_message_is_kept_anonymous(self):
        member = self.user('chat_purge')
        peer = self.user('chat_peer')
        other = self.user('chat_other')
        first, second = sorted((member.pid, peer.pid))
        now = clock.now()
        with self.db.write() as conn:
            conn.execute('INSERT INTO chat_channel '
                         '(id, kind, slug, title, participant_a, participant_b, created_at, created_by) '
                         "VALUES ('dm-purge', 'dm', 'dm-purge', '私聊', ?, ?, ?, ?)",
                         (first, second, now, member.pid))
            conn.execute('INSERT INTO chat_message '
                         '(id, channel_id, author_id, author_kind, body, mentions_json, created_at) '
                         "VALUES ('dm-message', 'dm-purge', ?, 'human', '私密正文', '[]', ?)",
                         (member.pid, now))
            conn.execute('INSERT INTO chat_message '
                         '(id, channel_id, author_id, author_kind, body, mentions_json, created_at) '
                         'VALUES (?, ?, ?, ?, ?, ?, ?)',
                         ('public-message', LOBBY, member.pid, 'human', '公开经验', json.dumps([other.pid]), now))
            conn.execute('INSERT INTO chat_message '
                         '(id, channel_id, author_id, author_kind, body, mentions_json, created_at) '
                         'VALUES (?, ?, ?, ?, ?, ?, ?)',
                         ('other-message', LOBBY, other.pid, 'human', '提及', json.dumps([member.pid]), now))
            hooks.purge(conn, member.pid)
        self.assertIn(hooks.purge, accounts.PURGERS)
        self.assertIsNone(self.db.conn().execute("SELECT 1 FROM chat_channel WHERE id = 'dm-purge'").fetchone())
        self.assertIsNotNone(self.db.conn().execute(
            "SELECT 1 FROM chat_message WHERE id = 'public-message'").fetchone())
        mentions = self.db.conn().execute(
            "SELECT mentions_json FROM chat_message WHERE id = 'other-message'").fetchone()[0]
        self.assertNotIn(member.pid, json.loads(mentions))
