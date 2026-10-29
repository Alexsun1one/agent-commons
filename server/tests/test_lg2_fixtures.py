"""Explicit adult declaration for LG-2 fixtures; shared helpers remain frozen."""
from tests.helpers import HDRS, PASSWORD


class ConfirmedAdultFixture:
    def register(self, client, handle, code=None, password=PASSWORD):
        return client.post('/api/auth/register', headers=HDRS, json={
            'invite_code': code or self.invite(), 'handle': handle, 'password': password,
            'display_name': handle, 'adult_confirmed': True})
