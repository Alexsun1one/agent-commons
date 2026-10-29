"""R13 ROOM-1 · 房间测试。运行：cd server && python3 -m unittest discover -s modules/rooms/tests -t . -q"""
import json
import unittest
from unittest import mock

from app import accounts, clock
from app.authz import Actor
from modules.rooms import consent, livekit, service
from tests.helpers import HDRS, AppCase

SECRET = b'lk-test-secret-' + b'x' * 32


class FakeTransport:
    def __init__(self, status=200):
        self.calls = []
        self.status = status

    def post(self, url, headers, body):
        self.calls.append({'method': url.rsplit('/', 1)[-1], 'url': url, 'headers': headers,
                           'body': json.loads(body)})
        return self.status, b'{}'

    def named(self, method):
        return [c for c in self.calls if c['method'] == method]


class RoomCase(AppCase):
    def setUp(self):
        super().setUp()
        self.transport = FakeTransport()
        self.app.state.rooms_rtc = livekit.RtcConfig('wss://commons.test', 'http://127.0.0.1:7880', 'APItest',
                                                     SECRET, transport=self.transport)
        self.flag(service.FLAG, True)

    def flag(self, key, value):
        with self.db.write() as conn:
            conn.execute('UPDATE feature_flag SET enabled = ? WHERE key = ?', (int(value), key))

    def room(self, client, status=201, **body):
        body.setdefault('kind', 'discussion')
        body.setdefault('title', '周五 Agent 验收清单')
        body.setdefault('duration_min', 30)
        r = client.post('/api/rooms', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 201 else r.json()

    def join(self, client, rid, status=200):
        r = client.post(f'/api/rooms/{rid}/join', headers=HDRS)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status in (200, 202) else r.json()

    def gate(self, client, token):
        return client.get('/api/rooms/gate', headers={'X-Forwarded-Uri': f'/rtc?access_token={token}&sdk=js'})

    def host(self, client, rid, status=200, **body):
        r = client.post(f'/api/rooms/{rid}/host', headers=HDRS, json=body)
        self.assertEqual(r.status_code, status, r.text)
        return r.json()['data'] if status == 200 else r.json()

    def code(self, response):
        body = response if isinstance(response, dict) else response.json()
        return body['error']['code']

    def claims(self, data):
        return livekit.verify(data['media']['token'], SECRET)

    def participant(self, rid, pid):
        with self.db.read() as conn:
            return dict(service.participant(conn, rid, pid))

    def live_room(self, **body):
        """L3 主持人建一个讨论室并进房（房间变成 live）。"""
        h = self.user('u_host_' + body.get('kind', 'discussion'), level=4)
        room = self.room(h, **body)
        self.join(h, room['id'])
        return h, room['id']


class CreateTest(RoomCase):
    def test_who_can_create_which_kind(self):
        l2, l3, l4 = self.user('u_l2', level=2), self.user('u_l3', level=3), self.user('u_l4', level=4)
        hostrole, lecturer = self.user('u_hr', level=1, roles=('host',)), self.user('u_lc', level=1, roles=('lecturer',))
        self.assertEqual(self.code(self.room(l2, 403)), 'action_not_allowed')
        self.room(l3)
        self.assertEqual(self.code(self.room(l3, 403, kind='stage')), 'action_not_allowed')
        self.room(l4, kind='stage')
        self.room(hostrole, kind='stage')
        self.room(lecturer)
        self.assertEqual(self.code(self.room(lecturer, 403, kind='stage')), 'action_not_allowed')
        l5 = self.user('u_l5', level=5, roles=('host', 'lecturer'))
        for kind in ('live', 'workshop'):
            self.assertEqual(self.code(self.room(l5, 501, kind=kind)), 'capability_unavailable')
        self.assertEqual(self.code(self.room(l5, 422, kind='party')), 'validation_failed')

    def test_rules_live_in_action_rule_table(self):
        l2 = self.user('u_l2', level=2)
        with self.db.write() as conn:
            conn.execute("UPDATE action_rule SET min_level = 2 WHERE action = 'rooms.create.discussion'")
        self.room(l2)

    def test_duration_cap_by_level(self):
        l3, l4 = self.user('u_l3', level=3), self.user('u_l4', level=4)
        hostrole = self.user('u_hr', level=2, roles=('host',))
        self.room(l3, duration_min=60)
        r = self.room(l3, 422, duration_min=61)
        self.assertEqual((self.code(r), r['error']['cap']), ('room_duration_cap', 60))
        self.room(l4, kind='stage', duration_min=120)
        self.assertEqual(self.code(self.room(l4, 422, duration_min=121)), 'room_duration_cap')
        self.room(hostrole, kind='stage', duration_min=180)
        self.assertEqual(self.code(self.room(hostrole, 422, kind='stage', duration_min=181)), 'room_duration_cap')
        self.assertEqual(self.code(self.room(l4, 422, duration_min=10)), 'validation_failed')
        with self.db.write() as conn:
            conn.execute("UPDATE room_duration_cap SET max_minutes = 90 WHERE id = 'l3'")
        self.room(l3, duration_min=90)

    def test_extend_once_within_cap(self):
        h = self.user('u_h', level=3)
        rid = self.room(h, duration_min=45)['id']
        self.join(h, rid)
        self.assertEqual(self.code(self.host(h, rid, 422, action='extend', minutes=20)), 'room_duration_cap')
        data = self.host(h, rid, action='extend', minutes=15)
        self.assertEqual(data['duration_min'], 60)
        self.assertFalse(data['policy']['can_extend'])
        self.assertEqual(self.code(self.host(h, rid, 409, action='extend', minutes=5)), 'state_conflict')

    def test_weekly_series(self):
        h = self.user('u_h', level=3)
        start = '2026-11-06T12:00:00+00:00'
        with mock.patch('app.clock.now_ts', return_value=clock.parse('2026-10-30T00:00:00.000000Z')):
            data = self.room(h, starts_at=start, repeat_weekly=3)
            self.assertEqual(self.code(self.room(h, 422, starts_at=start, repeat_weekly=1)), 'validation_failed')
        self.assertEqual(len(data['occurrences']), 3)
        with self.db.read() as conn:
            rows = conn.execute('SELECT starts_at, series_index FROM room WHERE series_id = ? ORDER BY series_index',
                                (data['series']['id'],)).fetchall()
        gaps = [clock.parse(rows[i + 1][0]) - clock.parse(rows[i][0]) for i in range(2)]
        self.assertEqual(gaps, [7 * 86400, 7 * 86400])
        self.assertEqual([r[1] for r in rows], [1, 2, 3])

    def test_agenda_progress(self):
        h = self.user('u_h', level=3)
        rid = self.room(h, agenda=[{'title': '开场', 'minutes': 5}, {'title': '逐条过清单', 'minutes': 20}])['id']
        self.assertEqual(self.code(self.room(h, 422, agenda=[{'title': '太长', 'minutes': 40}])), 'validation_failed')
        self.join(h, rid)
        data = self.host(h, rid, action='agenda_next')
        self.assertEqual([a['state'] for a in data['agenda']], ['done', 'current'])

    def test_abilities_and_estimate(self):
        l3 = self.user('u_l3', level=3)
        self.user('u_a2', level=2)
        self.user('u_a4', level=4)
        data = l3.get('/api/rooms/abilities').json()['data']
        kinds = {k['kind']: k for k in data['kinds']}
        self.assertTrue(kinds['discussion']['allowed'])
        self.assertEqual(kinds['discussion']['duration_cap'], 60)
        self.assertFalse(kinds['stage']['allowed'])
        self.assertEqual(kinds['stage']['need'], {'level': 4, 'roles': ['host']})
        self.assertEqual((kinds['live']['reason'], kinds['workshop']['reason']), ('step_two', 'step_two'))
        r = l3.post('/api/rooms/estimate', headers=HDRS, json={'access': [{'kind': 'level', 'min_level': 3}]})
        self.assertEqual(r.json()['data']['count'], 2)
        l2 = self.user('u_l2', level=2)
        r = l2.post('/api/rooms/estimate', headers=HDRS, json={'access': []})
        self.assertEqual(r.status_code, 403)


class FlagTest(RoomCase):
    def test_everything_off_when_flag_off(self):
        h = self.user('u_h', level=4)
        rid = self.room(h)['id']
        token = self.join(h, rid)['media']['token']
        self.flag(service.FLAG, False)
        calls = [h.get('/api/rooms'), h.get('/api/rooms/abilities'), h.get(f'/api/rooms/{rid}'),
                 h.post('/api/rooms', headers=HDRS, json={'kind': 'discussion', 'title': 't', 'duration_min': 30}),
                 h.post(f'/api/rooms/{rid}/join', headers=HDRS), h.post(f'/api/rooms/{rid}/leave', headers=HDRS),
                 h.post(f'/api/rooms/{rid}/host', headers=HDRS, json={'action': 'lock'}),
                 h.post(f'/api/rooms/{rid}/hand', headers=HDRS, json={'action': 'raise'}),
                 h.post('/api/rooms/estimate', headers=HDRS, json={'access': []})]
        self.assertEqual({r.status_code for r in calls}, {501})
        self.assertEqual(self.gate(h, token).status_code, 403)
        self.assertFalse(self.client().get('/api/flags').json()['data']['rooms.enabled'])



class DefaultFlagTest(AppCase):
    def test_flags_default_off(self):
        flags = self.client().get('/api/flags').json()['data']
        self.assertEqual((flags['rooms.enabled'], flags['rooms.recording']), (False, False))
        c = self.user('u_l5', level=5)
        r = c.post('/api/rooms', headers=HDRS, json={'kind': 'discussion', 'title': 't', 'duration_min': 30})
        self.assertEqual(r.status_code, 501)


class AccessTest(RoomCase):
    def test_conditions_stack_and_hidden_rooms_are_404(self):
        h = self.user('u_h', level=4)
        with self.db.write() as conn:
            sid = accounts.create_space(conn, h.pid, 'agents', 'Agent 实践组')
        l2_in, l3_out, l3_in = self.user('u_a', level=2), self.user('u_b', level=3), self.user('u_c', level=3)
        with self.db.write() as conn:
            accounts.set_membership(conn, sid, l2_in.pid)
            accounts.set_membership(conn, sid, l3_in.pid)
        rid = self.room(h, access=[{'kind': 'level', 'min_level': 3}, {'kind': 'space', 'space_id': sid}])['id']
        self.join(h, rid)
        for c in (l2_in, l3_out):
            self.assertEqual(self.code(c.get(f'/api/rooms/{rid}')), 'resource_not_found')
            self.assertEqual(self.code(self.join(c, rid, 404)), 'resource_not_found')
            self.assertEqual(c.get('/api/rooms').json()['data'], [])
        self.assertEqual(self.join(l3_in, rid)['role'], 'listener')
        self.assertEqual([r['id'] for r in l3_in.get('/api/rooms').json()['data']], [rid])
        body = l3_out.get(f'/api/rooms/{rid}').json()['error']
        ghost = l3_out.get('/api/rooms/00000000-0000-0000-0000-000000000000').json()['error']
        self.assertEqual((body['code'], body['message']), (ghost['code'], ghost['message']))

    def test_space_condition_requires_creator_membership(self):
        h, other = self.user('u_h', level=4), self.user('u_o', level=4)
        with self.db.write() as conn:
            sid = accounts.create_space(conn, other.pid, 'private', '别人的空间')
        self.assertEqual(self.code(self.room(h, 422, access=[{'kind': 'space', 'space_id': sid}])), 'validation_failed')

    def test_invite_list(self):
        h, invited, other = self.user('u_h', level=4), self.user('u_i', level=1), self.user('u_o', level=5)
        rid = self.room(h, access=[{'kind': 'invite', 'principal_ids': [invited.pid]}])['id']
        self.join(h, rid)
        self.assertEqual(self.join(other, rid, 404)['error']['code'], 'resource_not_found')
        self.join(invited, rid)

    def test_signup_waiting_room_202_then_approval(self):
        h, a, b = self.user('u_h', level=4), self.user('u_a', level=2), self.user('u_b', level=2)
        rid = self.room(h, kind='stage', provider='external_link', external_url='https://meeting.tencent.com/dm/AbC123',
                        access=[{'kind': 'signup'}])['id']
        self.join(h, rid)
        waiting = self.join(a, rid, 202)
        self.assertEqual((waiting['state'], waiting['message']), ('waiting', '等待主持人批准'))
        self.assertIsNone(a.get(f'/api/rooms/{rid}').json()['data']['external'])
        self.join(b, rid, 202)
        detail = h.get(f'/api/rooms/{rid}').json()['data']
        self.assertEqual({s['id'] for s in detail['signups']}, {a.pid, b.pid})
        self.host(h, rid, action='signup_approve', principal_id=a.pid)
        self.host(h, rid, action='signup_reject', principal_id=b.pid)
        data = self.join(a, rid)
        self.assertEqual(data['media'], {'provider': 'external_link', 'url': 'https://meeting.tencent.com/dm/AbC123',
                                         'label': '腾讯会议'})
        self.assertEqual(a.get(f'/api/rooms/{rid}').json()['data']['external']['url'],
                         'https://meeting.tencent.com/dm/AbC123')
        self.assertEqual(self.code(self.join(b, rid, 403)), 'room_signup_rejected')
        self.assertEqual(self.transport.calls, [])

    def test_rsvp_before_start(self):
        h, a = self.user('u_h', level=4), self.user('u_a', level=1)
        rid = self.room(h)['id']
        r = a.post(f'/api/rooms/{rid}/signup', headers=HDRS)
        self.assertEqual(r.json()['data']['signup'], 'approved')
        self.assertEqual(self.code(self.join(a, rid, 409)), 'room_not_live')
        self.assertEqual(a.get('/api/rooms', params={'state': 'scheduled'}).json()['data'][0]['my_signup'], 'approved')

    def test_capacity(self):
        h, rid = self.live_room()
        with self.db.write() as conn:
            conn.execute('UPDATE room SET capacity = 2 WHERE id = ?', (rid,))
        a, b, c = self.user('u_a'), self.user('u_b'), self.user('u_c')
        self.join(a, rid)
        self.join(b, rid)
        self.assertEqual(self.code(self.join(c, rid, 409)), 'room_full')
        self.join(a, rid)


class GrantTest(RoomCase):
    def test_listener_token_cannot_publish(self):
        h = self.user('u_h', level=4)
        rid = self.room(h, kind='stage')['id']
        hc = self.claims(self.join(h, rid))
        self.assertTrue(hc['video']['canPublish'])
        self.assertEqual(hc['video']['canPublishSources'], ['microphone'])
        lc = self.user('u_l', level=2)
        listener = self.join(lc, rid)
        c = self.claims(listener)
        self.assertEqual(listener['role'], 'listener')
        self.assertFalse(c['video']['canPublish'])
        self.assertEqual(c['video']['canPublishSources'], [])
        self.assertFalse(c['video']['canUpdateOwnMetadata'])
        self.assertEqual(c['exp'] - c['nbf'], 600)
        self.assertEqual(c['attributes'][livekit.GRANT_ATTR], listener['grant_id'])
        self.assertEqual((c['sub'], c['video']['room'], c['iss']), (lc.pid, rid, 'APItest'))

    def test_discussion_self_unmute_gives_mic_only(self):
        h = self.user('u_h', level=3)
        rid = self.room(h, self_unmute=True)['id']
        self.join(h, rid)
        data = self.join(self.user('u_s', level=1), rid)
        self.assertEqual(data['role'], 'speaker')
        self.assertEqual(self.claims(data)['video']['canPublishSources'], ['microphone'])
        closed = self.room(h)['id']
        self.join(h, closed)
        self.assertFalse(self.claims(self.join(self.user('u_t', level=1), closed))['video']['canPublish'])

    def test_gate_first_connect_reconnect_and_headers(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        data = self.join(a, rid)
        for _ in range(2):
            r = self.gate(a, data['media']['token'])
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.headers['X-Commons-Principal'], a.pid)
            self.assertEqual(r.headers['X-Commons-Room-Grant'], data['grant_id'])
        again = self.join(a, rid)
        self.assertEqual(again['grant_id'], data['grant_id'])
        r = a.get('/api/rooms/gate', headers={'Authorization': 'Bearer ' + again['media']['token']})
        self.assertEqual(r.status_code, 200)

    def test_gate_requires_matching_session(self):
        h, rid = self.live_room()
        a, b = self.user('u_a', level=2), self.user('u_b', level=2)
        token = self.join(a, rid)['media']['token']
        self.assertEqual(self.gate(b, token).status_code, 403)
        self.assertEqual(self.gate(self.client(), token).status_code, 403)
        self.assertEqual(self.gate(a, token[:-2] + 'xx').status_code, 403)
        self.assertEqual(self.gate(a, '').status_code, 403)

    def test_removed_participant_rejected_on_next_request(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        data = self.join(a, rid)
        before = self.participant(rid, a.pid)['epoch']
        r = h.post(f'/api/rooms/{rid}/host', headers=HDRS,
                   json={'action': 'remove', 'principal_id': a.pid, 'reason_code': 'disruptive'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers['X-Commons-RTC'], 'RemoveParticipant:ok')
        self.assertEqual(self.participant(rid, a.pid)['epoch'], before + 1)
        call = self.transport.named('RemoveParticipant')[0]
        self.assertEqual(call['body'], {'room': rid, 'identity': a.pid})
        self.assertEqual(call['url'], 'http://127.0.0.1:7880/twirp/livekit.RoomService/RemoveParticipant')
        admin = livekit.verify(call['headers']['Authorization'][7:], SECRET)
        self.assertEqual(admin['video'], {'room': rid, 'roomAdmin': True})
        self.assertEqual(self.gate(a, data['media']['token']).status_code, 403)
        err = self.join(a, rid, 404)['error']
        self.assertEqual(err['code'], 'resource_not_found')
        self.assertNotIn('reason', err)
        detail = a.get(f'/api/rooms/{rid}')
        self.assertEqual(detail.status_code, 404)
        self.assertEqual(self.code(detail), 'resource_not_found')
        self.assertEqual(a.get('/api/rooms').json()['data'], [])
        with self.db.read() as conn:
            g = conn.execute('SELECT revoke_reason FROM join_grant WHERE id = ?', (data['grant_id'],)).fetchone()
            audit = conn.execute("SELECT reason_code FROM audit_event WHERE action = 'rooms.host.remove'").fetchone()
            gate = conn.execute("SELECT reason_code FROM audit_event WHERE action = 'rooms.gate'").fetchone()
            event = conn.execute("SELECT 1 FROM outbox_event WHERE event_type = 'rooms.participant.removed'").fetchone()
        self.assertEqual((g[0], audit[0], gate[0]), ('removed', 'disruptive', 'grant_revoked'))
        self.assertIsNotNone(event)

    def test_livekit_failure_does_not_undo_removal(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        token = self.join(a, rid)['media']['token']
        self.transport.status = 500
        r = h.post(f'/api/rooms/{rid}/host', headers=HDRS, json={'action': 'remove', 'principal_id': a.pid})
        self.assertEqual(r.headers['X-Commons-RTC'], 'RemoveParticipant:failed:500')
        self.assertEqual(self.gate(a, token).status_code, 403)
        with self.db.read() as conn:
            row = conn.execute("SELECT outcome FROM audit_event WHERE action = 'rooms.rtc'").fetchone()
        self.assertEqual(row[0], 'error')

    def test_level_drop_rejects_reconnect(self):
        h = self.user('u_h', level=4)
        rid = self.room(h, access=[{'kind': 'level', 'min_level': 2}])['id']
        self.join(h, rid)
        a = self.user('u_a', level=2)
        token = self.join(a, rid)['media']['token']
        self.assertEqual(self.gate(a, token).status_code, 200)
        with self.db.write() as conn:
            conn.execute('UPDATE profile SET level = 1 WHERE principal_id = ?', (a.pid,))
        self.assertEqual(self.gate(a, token).status_code, 403)
        self.assertEqual(self.code(self.join(a, rid, 404)), 'resource_not_found')

    def test_suspended_member_rejected(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        token = self.join(a, rid)['media']['token']
        with self.db.write() as conn:
            conn.execute("UPDATE principal SET status = 'suspended' WHERE id = ?", (a.pid,))
        self.assertEqual(self.gate(a, token).status_code, 403)

    def test_lock_blocks_newcomers_not_present_people(self):
        h, rid = self.live_room()
        a, late = self.user('u_a', level=2), self.user('u_late', level=2)
        token = self.join(a, rid)['media']['token']
        self.assertTrue(self.host(h, rid, action='lock')['locked'])
        self.assertEqual(self.code(self.join(late, rid, 403)), 'room_locked')
        self.assertEqual(self.gate(a, token).status_code, 200)
        self.join(a, rid)
        a.post(f'/api/rooms/{rid}/leave', headers=HDRS)
        self.assertEqual(self.gate(a, token).status_code, 403)
        self.assertEqual(self.code(self.join(a, rid, 403)), 'room_locked')
        self.host(h, rid, action='unlock')
        self.join(late, rid)

    def test_token_expiry_and_renewal(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        token = self.join(a, rid)['media']['token']
        later = clock.now_ts() + 11 * 60
        with mock.patch('app.clock.now_ts', return_value=later):
            self.assertEqual(self.gate(a, token).status_code, 403)
            fresh = self.join(a, rid)['media']['token']
            self.assertEqual(self.gate(a, fresh).status_code, 200)

    def test_forged_publish_claim_rejected(self):
        h = self.user('u_h', level=4)
        rid = self.room(h, kind='stage')['id']
        self.join(h, rid)
        a = self.user('u_a', level=2)
        data = self.join(a, rid)
        claims = self.claims(data)
        claims['video']['canPublish'] = True
        claims['video']['canPublishSources'] = ['microphone']
        forged = livekit.sign(claims, SECRET)
        self.assertEqual(self.gate(a, forged).status_code, 403)
        with self.db.read() as conn:
            row = conn.execute("SELECT reason_code FROM audit_event WHERE action = 'rooms.gate'").fetchone()
        self.assertEqual(row[0], 'publish_not_granted')

    def test_media_unconfigured_is_501(self):
        self.app.state.rooms_rtc = False
        h = self.user('u_h', level=4)
        rid = self.room(h)['id']
        self.assertEqual(self.code(self.join(h, rid, 501)), 'capability_unavailable')
        ext = self.room(h, provider='external_link', external_url='https://vc.feishu.cn/j/123456789')['id']
        self.assertEqual(self.join(h, ext)['media']['provider'], 'external_link')


class ScreenShareTest(RoomCase):
    def speaker(self):
        h = self.user('u_screen_host', level=4)
        rid = self.room(h, kind='stage')['id']
        self.join(h, rid)
        sp = self.user('u_screen_speaker', level=2)
        self.join(sp, rid)
        sp.post(f'/api/rooms/{rid}/hand', headers=HDRS, json={'action': 'raise'})
        self.host(h, rid, action='approve', principal_id=sp.pid)
        return h, sp, rid

    def test_listener_denied_and_speaker_needs_host_approval(self):
        h, sp, rid = self.speaker()
        listener = self.user('u_screen_listener', level=2)
        self.join(listener, rid)
        denied = listener.post(f'/api/rooms/{rid}/screen', headers=HDRS,
                               json={'action': 'request', 'share_audio': True})
        self.assertEqual(self.code(denied), 'action_not_allowed')

        before = self.join(sp, rid)
        self.assertEqual(self.claims(before)['video']['canPublishSources'], ['microphone'])
        requested = sp.post(f'/api/rooms/{rid}/screen', headers=HDRS,
                            json={'action': 'request', 'share_audio': True})
        self.assertEqual(requested.status_code, 200, requested.text)
        self.assertEqual(requested.json()['data']['screen_share']['mine'], 'pending')
        still_before = self.join(sp, rid)
        self.assertFalse(still_before['can_screen_share'])
        self.assertNotIn('screen_share', self.claims(still_before)['video']['canPublishSources'])

        approved = self.host(h, rid, action='screen_approve', principal_id=sp.pid)
        self.assertEqual(approved['screen_share']['active']['principal']['id'], sp.pid)
        granted = self.join(sp, rid)
        self.assertTrue(granted['can_screen_share'])
        self.assertEqual(self.claims(granted)['video']['canPublishSources'],
                         ['microphone', 'screen_share', 'screen_share_audio'])
        self.assertEqual(self.gate(sp, granted['media']['token']).status_code, 200)

    def test_stop_revokes_old_screen_token_and_host_can_take_over(self):
        h, sp, rid = self.speaker()
        sp.post(f'/api/rooms/{rid}/screen', headers=HDRS, json={'action': 'request', 'share_audio': True})
        self.host(h, rid, action='screen_approve', principal_id=sp.pid)
        old = self.join(sp, rid)
        self.assertTrue(old['can_screen_share'])

        host_before = self.join(h, rid)
        detail = self.host(h, rid, action='screen_takeover', share_audio=False)
        self.assertEqual(detail['screen_share']['active']['principal']['id'], h.pid)
        self.assertFalse(detail['screen_share']['active']['share_audio'])
        self.assertEqual(self.gate(sp, old['media']['token']).status_code, 403)
        self.assertEqual(self.gate(h, host_before['media']['token']).status_code, 403)
        host_screen = self.join(h, rid)
        self.assertIn('screen_share', self.claims(host_screen)['video']['canPublishSources'])
        self.host(h, rid, action='screen_stop', principal_id=h.pid)
        self.assertEqual(self.gate(h, host_screen['media']['token']).status_code, 403)
        fresh = self.join(h, rid)
        self.assertNotIn('screen_share', self.claims(fresh)['video']['canPublishSources'])

    def test_demoted_screen_owner_is_revoked(self):
        h, sp, rid = self.speaker()
        sp.post(f'/api/rooms/{rid}/screen', headers=HDRS, json={'action': 'request'})
        self.host(h, rid, action='screen_approve', principal_id=sp.pid)
        old = self.join(sp, rid)
        self.host(h, rid, action='down', principal_id=sp.pid)
        self.assertEqual(self.gate(sp, old['media']['token']).status_code, 403)
        detail = h.get(f'/api/rooms/{rid}').json()['data']
        self.assertIsNone(detail['screen_share']['active'])


class SpeakTest(RoomCase):
    def test_hand_raise_approve_down(self):
        h = self.user('u_h', level=4)
        rid = self.room(h, kind='stage')['id']
        self.join(h, rid)
        l1, l2 = self.user('u_one', level=1), self.user('u_two', level=2)
        self.join(l1, rid)
        old = self.join(l2, rid)
        r = l1.post(f'/api/rooms/{rid}/hand', headers=HDRS, json={'action': 'raise'})
        self.assertEqual(self.code(r), 'action_not_allowed')
        r = l2.post(f'/api/rooms/{rid}/hand', headers=HDRS, json={'action': 'raise'})
        self.assertEqual(r.json()['data']['me']['hand'], 'raised')
        queue = h.get(f'/api/rooms/{rid}').json()['data']['queue']
        self.assertEqual([q['principal']['id'] for q in queue], [l2.pid])
        self.assertEqual(l1.get(f'/api/rooms/{rid}').json()['data']['queue'], [])
        self.host(h, rid, action='approve', principal_id=l2.pid)
        self.assertEqual(self.participant(rid, l2.pid)['role'], 'speaker')
        self.assertEqual(self.gate(l2, old['media']['token']).status_code, 403)
        new = self.join(l2, rid)
        self.assertTrue(self.claims(new)['video']['canPublish'])
        self.assertEqual(self.gate(l2, new['media']['token']).status_code, 200)
        upd = self.transport.named('UpdateParticipant')[-1]['body']
        self.assertEqual((upd['identity'], upd['permission']['canPublish'], upd['permission']['canPublishSources']),
                         (l2.pid, True, ['MICROPHONE']))
        self.assertEqual(upd['attributes'][livekit.GRANT_ATTR], new['grant_id'])
        self.host(h, rid, action='down', principal_id=l2.pid)
        self.assertFalse(self.claims(self.join(l2, rid))['video']['canPublish'])
        self.assertEqual(self.code(self.host(h, rid, 409, action='approve', principal_id=l1.pid)), 'state_conflict')

    def test_invite_then_accept_and_mute(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=1)
        self.join(a, rid)
        self.host(h, rid, action='invite', principal_id=a.pid)
        self.assertEqual(a.get(f'/api/rooms/{rid}').json()['data']['me']['hand'], 'invited')
        a.post(f'/api/rooms/{rid}/hand', headers=HDRS, json={'action': 'accept'})
        self.assertEqual(self.participant(rid, a.pid)['role'], 'speaker')
        self.host(h, rid, action='mute', principal_id=a.pid)
        data = self.join(a, rid)
        self.assertTrue(data['muted'])
        self.assertFalse(self.claims(data)['video']['canPublish'])
        self.host(h, rid, action='unmute', principal_id=a.pid)
        self.assertTrue(self.claims(self.join(a, rid))['video']['canPublish'])

    def test_only_host_moderates_and_transfer(self):
        h, rid = self.live_room()
        a, b = self.user('u_a', level=3), self.user('u_b', level=3)
        self.join(a, rid)
        self.join(b, rid)
        self.assertEqual(self.code(self.host(a, rid, 403, action='lock')), 'action_not_allowed')
        self.assertEqual(self.code(self.host(h, rid, 422, action='remove', principal_id=h.pid)), 'validation_failed')
        data = self.host(h, rid, action='transfer', principal_id=a.pid)
        self.assertEqual(data['host']['id'], a.pid)
        self.assertEqual(self.participant(rid, a.pid)['role'], 'host')
        self.assertEqual(self.participant(rid, h.pid)['role'], 'speaker')
        self.assertEqual(self.code(self.host(h, rid, 403, action='lock')), 'action_not_allowed')
        self.host(a, rid, action='lock')

    def test_end_room(self):
        h, rid = self.live_room()
        a = self.user('u_a', level=2)
        token = self.join(a, rid)['media']['token']
        r = h.post(f'/api/rooms/{rid}/host', headers=HDRS, json={'action': 'end'})
        self.assertEqual(r.headers['X-Commons-RTC'], 'DeleteRoom:ok')
        data = r.json()['data']
        self.assertEqual(data['state'], 'ended')
        self.assertEqual(data['recording']['state'], 'not_recorded')
        self.assertEqual(data['minutes']['state'], 'none')
        self.assertEqual(self.gate(a, token).status_code, 403)
        self.assertEqual(self.code(self.join(a, rid, 409)), 'room_ended')
        self.assertEqual([x['id'] for x in a.get('/api/rooms', params={'state': 'ended'}).json()['data']], [rid])

    def test_host_cannot_open_too_early(self):
        h = self.user('u_h', level=4)
        start = clock.iso(clock.now_ts() + 3600).replace('Z', '+00:00')
        rid = self.room(h, starts_at=start)['id']
        self.assertEqual(self.code(self.join(h, rid, 409)), 'room_not_live')
        a = self.user('u_a', level=2)
        self.assertEqual(self.code(self.join(a, rid, 409)), 'room_not_live')


class LinkTest(RoomCase):
    def test_external_link_allow_list(self):
        h = self.user('u_h', level=4)
        good = ['https://meeting.tencent.com/dm/AbC123', 'https://vc.feishu.cn/j/123456789',
                'https://VC.FEISHU.CN/j/1?from=cal', 'https://voovmeeting.com/dm/x1y2z3']
        for url in good:
            self.room(h, provider='external_link', external_url=url)
        bad = ['http://meeting.tencent.com/dm/AbC123', 'https://meeting.tencent.com.evil.cn/dm/1',
               'https://evil.cn/?u=meeting.tencent.com', 'https://user:pw@meeting.tencent.com/dm/1',
               'https://meeting.tencent.com:8443/dm/1', 'javascript:alert(1)//meeting.tencent.com',
               'https://meeting.tencent.com/dm/"><script>', 'https://feishu.cn/j/1', 'ftp://vc.feishu.cn/j/1',
               'https://meeting.tencent.com\\@evil.cn/']
        for url in bad:
            self.assertEqual(self.code(self.room(h, 422, provider='external_link', external_url=url)),
                             'room_link_rejected', url)
        self.assertEqual(self.code(self.room(h, 422, provider='external_link')), 'room_link_rejected')
        self.assertEqual(self.transport.calls, [])
        with self.db.write() as conn:
            conn.execute("INSERT INTO room_link_host (host, label, updated_at) VALUES ('meet.example.org', '测试', ?)",
                         (clock.now(),))
        self.room(h, provider='external_link', external_url='https://meet.example.org/r/1')

    def test_link_only_shown_to_admitted(self):
        h = self.user('u_h', level=4)
        rid = self.room(h, provider='external_link', external_url='https://vc.feishu.cn/j/987654321',
                        access=[{'kind': 'level', 'min_level': 3}])['id']
        low, high = self.user('u_low', level=2), self.user('u_high', level=3)
        self.assertNotIn('vc.feishu.cn', low.get(f'/api/rooms/{rid}').text)
        self.assertNotIn('vc.feishu.cn', low.get('/api/rooms', params={'state': 'scheduled'}).text)
        self.assertNotIn('vc.feishu.cn', high.get('/api/rooms', params={'state': 'scheduled'}).text)
        self.assertEqual(high.get(f'/api/rooms/{rid}').json()['data']['external']['label'], '飞书会议')


class MaterialTest(RoomCase):
    def test_materials_respect_object_visibility(self):
        h, rid = self.live_room()
        secret = self.obj(h, type='knowledge', title='只给 L3 看的方法', visibility='level', min_level=3)
        shared = self.obj(h, type='knowledge', title='大家都能看的方法')
        for oid in (secret['id'], shared['id']):
            r = h.post(f'/api/rooms/{rid}/materials', headers=HDRS, json={'kind': 'object', 'object_id': oid})
            self.assertEqual(r.status_code, 201, r.text)
        r = h.post(f'/api/rooms/{rid}/materials', headers=HDRS,
                   json={'kind': 'link', 'url': 'https://example.org/slides.pdf', 'title': '讲义'})
        self.assertEqual(r.status_code, 201)
        bad = h.post(f'/api/rooms/{rid}/materials', headers=HDRS,
                     json={'kind': 'link', 'url': 'javascript:alert(1)', 'title': 'x'})
        self.assertEqual(bad.status_code, 422)
        low, high = self.user('u_low', level=2), self.user('u_high', level=3)
        titles = lambda c: [m['title'] for m in c.get(f'/api/rooms/{rid}').json()['data']['materials']]
        self.assertEqual(titles(low), ['大家都能看的方法', '讲义'])
        self.assertEqual(titles(high), ['只给 L3 看的方法', '大家都能看的方法', '讲义'])
        self.assertNotIn('只给 L3', low.get(f'/api/rooms/{rid}').text)
        r = low.post(f'/api/rooms/{rid}/materials', headers=HDRS, json={'kind': 'object', 'object_id': shared['id']})
        self.assertEqual(r.status_code, 403)

    def test_board_snapshot_attachment(self):
        h, rid = self.live_room()
        doc = {'version': 1, 'objects': [{'id': 'r1', 'type': 'rect', 'x': 0, 'y': 0}]}
        r = h.post(f'/api/rooms/{rid}/board', headers=HDRS, json={'doc': doc, 'title': '课后白板'})
        self.assertEqual(r.status_code, 201, r.text)
        mid = r.json()['data']['id']
        a = self.user('u_a', level=1)
        self.assertEqual(a.get(f'/api/rooms/{rid}/board/{mid}').json()['data']['doc'], doc)
        self.assertEqual(a.post(f'/api/rooms/{rid}/board', headers=HDRS, json={'doc': doc}).status_code, 403)
        boards = [m for m in a.get(f'/api/rooms/{rid}').json()['data']['materials'] if m['kind'] == 'board']
        self.assertEqual(boards[0]['title'], '课后白板')


class ReminderTest(RoomCase):
    def test_reminders_once_and_in_detail(self):
        h = self.user('u_h', level=3)
        start = clock.iso(clock.now_ts() + 8 * 60).replace('Z', '+00:00')
        rid = self.room(h, starts_at=start, duration_min=30)['id']
        self.assertEqual(h.get(f'/api/rooms/{rid}').json()['data']['reminders']['starts_in_min'], 7)
        with self.db.write() as conn:
            self.assertEqual(service.remind_due(conn), [(rid, 'starts_soon')])
            self.assertEqual(service.remind_due(conn), [])
        with mock.patch('app.clock.now_ts', return_value=clock.now_ts() + 8 * 60):
            self.join(h, rid)
        with mock.patch('app.clock.now_ts', return_value=clock.now_ts() + 34 * 60):
            self.assertLessEqual(h.get(f'/api/rooms/{rid}').json()['data']['reminders']['ends_in_min'], 5)
            with self.db.write() as conn:
                self.assertEqual(service.remind_due(conn), [(rid, 'overtime_soon')])


class ConsentMachineTest(unittest.TestCase):
    def machine(self):
        m = consent.Recording(host_id='host')
        m.publishers = {'host', 'sp'}
        return m

    def test_all_publishers_must_consent(self):
        m = self.machine()
        self.assertEqual(m.propose('host'), 'collecting_consent')
        self.assertEqual(m.consent('host', 'host', True), 'collecting_consent')
        self.assertEqual(m.consent('listener', 'listener', True), 'collecting_consent')
        self.assertEqual(m.consent('sp', 'sp', True), 'ready')
        self.assertEqual(m.start('host'), 'starting')
        self.assertEqual(m.media_started(), 'active')
        self.assertEqual(m.recorded_tracks(), {'host', 'sp'})

    def test_host_cannot_consent_for_others(self):
        m = self.machine()
        m.propose('host')
        with self.assertRaises(consent.ConsentError) as ctx:
            m.consent('host', 'sp', True)
        self.assertEqual(ctx.exception.code, 'consent_is_personal')
        with self.assertRaises(consent.ConsentError):
            m.propose('sp')
        with self.assertRaises(consent.ConsentError):
            m.start('host')

    def test_decline_before_start_denies(self):
        m = self.machine()
        m.propose('host')
        m.consent('host', 'host', True)
        self.assertEqual(m.consent('sp', 'sp', False), 'denied')
        self.assertEqual(m.propose('host'), 'collecting_consent')
        self.assertEqual(m.version, 2)
        self.assertEqual(m.consents, {})

    def test_withdraw_stops_only_that_track_and_new_speaker_pauses(self):
        m = self.machine()
        m.propose('host')
        m.consent('host', 'host', True)
        m.consent('sp', 'sp', True)
        m.start('host')
        m.media_started()
        self.assertEqual(m.consent('sp', 'sp', False), 'active')
        self.assertEqual(m.recorded_tracks(), {'host'})
        self.assertEqual(m.publisher_joined('new'), 'paused')
        self.assertEqual(m.consent('new', 'new', True), 'active')
        self.assertEqual(m.recorded_tracks(), {'host', 'new'})
        m.consent('host', 'host', False)
        m.consent('new', 'new', False)
        self.assertEqual(m.state, 'paused')
        self.assertEqual(m.stop('host'), 'stopping')
        self.assertEqual(m.media_stopped(), 'stopped')

    def test_screen_and_computer_audio_need_separate_owner_consent(self):
        m = self.machine()
        m.require_track('sp', 'screen_track')
        m.require_track('sp', 'screen_share_audio')
        m.propose('host')
        self.assertEqual(m.consent_tracks('host', 'host', ['microphone'], True), 'collecting_consent')
        self.assertEqual(m.consent_tracks('sp', 'sp', ['microphone'], True), 'collecting_consent')
        self.assertEqual(m.consent_tracks('sp', 'sp', ['screen_track'], True), 'collecting_consent')
        self.assertEqual(m.consent_tracks('sp', 'sp', ['screen_share_audio'], True), 'ready')
        with self.assertRaises(consent.ConsentError) as ctx:
            m.consent_tracks('host', 'sp', ['screen_track'], True)
        self.assertEqual(ctx.exception.code, 'consent_is_personal')
        self.assertEqual(m.recorded_media_tracks(), {
            ('host', 'microphone'), ('sp', 'microphone'), ('sp', 'screen_track'), ('sp', 'screen_share_audio')})


class RecordingApiTest(RoomCase):
    def test_recording_is_step_two(self):
        h, rid = self.live_room()
        self.assertEqual(h.post(f'/api/rooms/{rid}/recording', headers=HDRS, json={'action': 'propose'}).status_code,
                         501)
        self.assertEqual(h.post(f'/api/rooms/{rid}/consent', headers=HDRS, json={'grant': True}).status_code, 501)
        self.flag(service.REC_FLAG, True)
        r = h.post(f'/api/rooms/{rid}/recording', headers=HDRS, json={'action': 'start'})
        self.assertEqual(self.code(r), 'capability_unavailable')
        r = h.post(f'/api/rooms/{rid}/recording', headers=HDRS, json={'action': 'propose'})
        self.assertEqual(r.json()['data']['state'], 'collecting_consent')
        a = self.user('u_a', level=1)
        self.join(a, rid)
        r = h.post(f'/api/rooms/{rid}/consent', headers=HDRS, json={'grant': True, 'principal_id': a.pid})
        self.assertEqual(self.code(r), 'unknown_field')
        r = h.post(f'/api/rooms/{rid}/consent', headers=HDRS, json={'grant': True})
        self.assertEqual(r.json()['data']['state'], 'ready')
        with self.db.read() as conn:
            rows = conn.execute('SELECT principal_id FROM room_recording_consent WHERE room_id = ?', (rid,)).fetchall()
        self.assertEqual([r[0] for r in rows], [h.pid])

    def test_replay_slots_are_present_but_disabled(self):
        h, rid = self.live_room()
        recording = h.get(f'/api/rooms/{rid}').json()['data']['recording']
        self.assertEqual(recording['screen_track'], None)
        self.assertEqual(recording['audio_tracks'], [])
        self.assertIsNone(recording['talk_id'])
        self.assertEqual(recording['replay_draft'], {
            'schema': 'commons.talk.review/1', 'gateway': 'AI-1', 'enabled': False})


class ExportTest(RoomCase):
    def test_export_includes_rooms(self):
        h, rid = self.live_room()
        data = h.get('/api/me/export').json()['data']
        self.assertEqual(data['rooms']['hosted'][0]['id'], rid)


class AgentProviderTest(RoomCase):
    def actor(self, client):
        pid = client.get('/api/me').json()['data']['id']
        with self.db.read() as conn:
            row = conn.execute('SELECT level, status FROM profile pr JOIN principal p ON p.id = pr.principal_id '
                               'WHERE p.id = ?', (pid,)).fetchone()
        return Actor(id=pid, level=row['level'], status=row['status'])

    def test_upcoming_respects_access_and_flag(self):
        h = self.user('u_h', level=4)
        start = clock.iso(clock.now_ts() + 1800).replace('Z', '+00:00')
        rid = self.room(h, kind='stage', starts_at=start, access=[{'kind': 'level', 'min_level': 3}])['id']
        l2, l3 = self.actor(self.user('u_l2', level=2)), self.actor(self.user('u_l3', level=3))
        with self.db.read() as conn:
            self.assertEqual(service.upcoming(conn, l2, 24, 10), [])
            items = service.upcoming(conn, l3, 24, 10)
            self.assertEqual([i['id'] for i in items], [rid])
            self.assertEqual(items[0]['meta']['room_kind'], 'stage')
            self.assertNotIn('external_url', json.dumps(items))
        self.flag(service.FLAG, False)
        with self.db.read() as conn:
            self.assertEqual(service.upcoming(conn, l3, 24, 10), [])


if __name__ == '__main__':
    unittest.main()
