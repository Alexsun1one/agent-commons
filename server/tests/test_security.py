import unittest

from tests.helpers import HDRS, ORIGIN, AppCase


class RequestGuardTest(AppCase):
    overrides = {'rate_limits': {'auth': (3, 60), 'write': (10000, 60), 'admin': (1000, 60)}}

    def login(self, client, headers=HDRS, **kwargs):
        return client.post('/api/auth/login', headers=headers, **kwargs)

    def test_origin_and_csrf(self):
        c = self.client()
        body = {'json': {'handle': 'x', 'password': 'y'}}
        self.assertEqual(self.code(self.login(c, headers={'X-Commons-CSRF': '1'}, **body)), 'origin_rejected')
        evil = {'Origin': 'https://evil.example', 'X-Commons-CSRF': '1'}
        self.assertEqual(self.code(self.login(c, headers=evil, **body)), 'origin_rejected')
        self.assertEqual(self.code(self.login(c, headers={'Origin': ORIGIN}, **body)), 'csrf_failed')
        self.assertEqual(self.login(c, **body).status_code, 401)

    def test_bearer_only_agent_posts_skip_cookie_csrf_but_cookie_requests_do_not(self):
        message = {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}
        bearer = {'Authorization': 'Bearer vca_' + 'x' * 43}
        bare = self.client()
        response = bare.post('/api/agents/mcp', headers=bearer, json=message)
        self.assertEqual(response.status_code, 401)

        with_cookie = self.client()
        with_cookie.cookies.set(self.settings.cookie_name, 'not-a-session')
        response = with_cookie.post('/api/agents/mcp', headers=bearer, json=message)
        self.assertEqual((response.status_code, self.code(response)), (403, 'origin_rejected'))

        response = bare.post('/api/auth/login', headers=bearer, json={'handle': 'x', 'password': 'y'})
        self.assertEqual((response.status_code, self.code(response)), (403, 'origin_rejected'))

    def test_json_only(self):
        c = self.client()
        r = self.login(c, content='handle=x&password=y', headers={**HDRS, 'Content-Type': 'application/x-www-form-urlencoded'})
        self.assertEqual((r.status_code, self.code(r)), (415, 'unsupported_media_type'))
        r = self.login(c, content='{bad json', headers={**HDRS, 'Content-Type': 'application/json'})
        self.assertEqual((r.status_code, self.code(r)), (400, 'malformed_request'))
        r = self.login(c, json={'handle': 'x', 'password': 'y', 'admin': True})
        self.assertEqual((r.status_code, self.code(r)), (422, 'unknown_field'))
        r = self.login(c, content='{"handle": "' + 'x' * (3 * 1024 * 1024) + '"}',
                       headers={**HDRS, 'Content-Type': 'application/json'})
        self.assertEqual((r.status_code, self.code(r)), (413, 'payload_too_large'))

    def test_rate_limit_429(self):
        c = self.client()
        codes = [self.login(c, json={'handle': 'ghost', 'password': 'wrong one'}).status_code for _ in range(4)]
        self.assertEqual(codes, [401, 401, 401, 429])
        r = self.login(c, json={'handle': 'ghost', 'password': 'wrong one'})
        self.assertEqual(self.code(r), 'rate_limited')
        self.assertTrue(r.json()['error']['retryable'])
        self.assertGreater(int(r.headers['retry-after']), 0)

    def test_headers_and_error_shape(self):
        c = self.client()
        for r in (c.get('/api/flags'), c.get('/api/me'), c.get('/api/objects/nope'), c.get('/api/unknown')):
            self.assertEqual(r.headers['cache-control'], 'no-store')
            self.assertTrue(r.headers['x-request-id'])
        r = c.get('/api/me')
        err = r.json()['error']
        self.assertEqual(set(err), {'code', 'message', 'request_id', 'retryable'})
        self.assertEqual(err['request_id'], r.headers['x-request-id'])
        self.assertEqual(self.code(c.get('/api/unknown')), 'resource_not_found')
        self.assertEqual(self.code(c.delete('/api/flags', headers=HDRS)), 'method_not_allowed')

    def test_public_module_cache_control_is_not_overwritten(self):
        with self.db.write() as conn:
            conn.execute("UPDATE feature_flag SET enabled = 1 WHERE key = 'public.enabled'")
        response = self.client().get('/api/public/robots.txt')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers['cache-control'].startswith('public,'))

    def test_get_needs_no_csrf(self):
        self.assertEqual(self.client().get('/api/flags').status_code, 200)
        self.assertEqual(self.client().get('/api/health').json()['data']['status'], 'ok')


if __name__ == '__main__':
    unittest.main()
