"""录制同意状态机（第二步才会真的录；内测只留数据位和这套规则）。

规则（架构 §7.2 的保守策略）：
- 会被采集的发布者（主持人 + 发言人）每一位都同意，才能从 collecting_consent 进 ready，ready 才能开始；
- 主持人不能替别人同意：同意只能由本人记录（actor 必须等于 subject）；
- 开录前有人拒绝 → denied，不录；
- 录制中有人撤回同意 → 停录该人的音轨（excluded），其余人继续；没人可录时转 paused；
- 录制中有新的发布者上台、且还没同意 → 整体 paused，等他同意后恢复；
- 投屏画面和电脑声音是两条独立轨道，都只能由投屏者本人同意；普通听众没有被采集的轨道。
"""
from dataclasses import dataclass, field

STATES = ('not_recorded', 'proposed', 'collecting_consent', 'ready', 'starting', 'active', 'paused',
          'stopping', 'stopped', 'denied', 'expired')

TRANSITIONS = {
    'not_recorded': {'propose': 'collecting_consent'},
    'stopped': {'propose': 'collecting_consent'},
    'denied': {'propose': 'collecting_consent'},
    'expired': {'propose': 'collecting_consent'},
    'collecting_consent': {'all_granted': 'ready', 'decline': 'denied', 'expire': 'expired'},
    'ready': {'start': 'starting', 'consent_missing': 'collecting_consent', 'decline': 'denied', 'expire': 'expired'},
    'starting': {'media_started': 'active', 'media_failed': 'stopped'},
    'active': {'consent_missing': 'paused', 'nothing_to_record': 'paused', 'stop': 'stopping'},
    'paused': {'all_granted': 'active', 'stop': 'stopping'},
    'stopping': {'media_stopped': 'stopped'},
}


class ConsentError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


@dataclass
class Recording:
    host_id: str
    state: str = 'not_recorded'
    version: int = 1
    publishers: set = field(default_factory=set)
    consents: dict = field(default_factory=dict)
    excluded: set = field(default_factory=set)
    extra_tracks: dict = field(default_factory=dict)
    track_consents: dict = field(default_factory=dict)
    excluded_tracks: set = field(default_factory=set)

    def _go(self, event):
        nxt = TRANSITIONS.get(self.state, {}).get(event)
        if nxt is None:
            raise ConsentError('invalid_transition')
        self.state = nxt
        return nxt

    def _granted(self, pid):
        return self.consents.get(pid) == 'granted'

    def recorded_tracks(self):
        return {p for p in self.publishers if self._granted(p) and p not in self.excluded}

    def require_track(self, owner_id, kind):
        if kind not in ('screen_track', 'screen_share_audio'):
            raise ConsentError('unknown_track')
        self.extra_tracks[(owner_id, kind)] = owner_id
        return self._settle()

    def required_media_tracks(self):
        return {(p, 'microphone') for p in self.publishers} | set(self.extra_tracks)

    def recorded_media_tracks(self):
        out = {(p, 'microphone') for p in self.recorded_tracks()}
        out |= {key for key in self.extra_tracks
                if self.track_consents.get(key) == 'granted' and key not in self.excluded_tracks}
        return out

    def _settle(self):
        required = self.required_media_tracks()
        recorded = self.recorded_media_tracks()
        excluded = self.excluded_tracks | {(p, 'microphone') for p in self.excluded}
        missing = required - recorded - excluded
        if self.state == 'collecting_consent' and self.publishers and not missing:
            self._go('all_granted')
        elif self.state == 'ready' and missing:
            self._go('consent_missing')
        elif self.state == 'active' and missing:
            self._go('consent_missing')
        elif self.state == 'active' and not recorded:
            self._go('nothing_to_record')
        elif self.state == 'paused' and not missing and recorded:
            self._go('all_granted')
        return self.state

    def settle(self):
        """在从持久化记录恢复同意状态后，重新计算录制状态。"""
        return self._settle()

    def propose(self, actor_id):
        if actor_id != self.host_id:
            raise ConsentError('host_only')
        if self.state != 'not_recorded':
            self.version += 1
        self._go('propose')
        self.consents, self.excluded = {}, set()
        self.track_consents, self.excluded_tracks = {}, set()
        return self._settle()

    def consent(self, actor_id, subject_id, granted):
        if actor_id != subject_id:
            raise ConsentError('consent_is_personal')
        if self.state in ('not_recorded', 'stopped', 'denied', 'expired', 'stopping'):
            raise ConsentError('nothing_to_consent')
        before = self.consents.get(subject_id)
        if granted:
            self.consents[subject_id] = 'granted'
            self.excluded.discard(subject_id)
        elif self.state in ('active', 'paused', 'starting') and before == 'granted':
            self.consents[subject_id] = 'withdrawn'
            self.excluded.add(subject_id)
        else:
            self.consents[subject_id] = 'declined'
            if subject_id in self.publishers and self.state in ('collecting_consent', 'ready'):
                self._go('decline')
                return self.state
        return self._settle()

    def consent_tracks(self, actor_id, subject_id, kinds, granted):
        if actor_id != subject_id:
            raise ConsentError('consent_is_personal')
        kinds = tuple(dict.fromkeys(kinds or ('microphone',)))
        if not kinds or any(k not in ('microphone', 'screen_track', 'screen_share_audio') for k in kinds):
            raise ConsentError('unknown_track')
        if self.state in ('not_recorded', 'stopped', 'denied', 'expired', 'stopping'):
            raise ConsentError('nothing_to_consent')
        for kind in kinds:
            if kind == 'microphone':
                self.consents[subject_id] = 'granted' if granted else (
                    'withdrawn' if self.state in ('active', 'paused', 'starting') else 'declined')
                if granted:
                    self.excluded.discard(subject_id)
                elif self.state in ('active', 'paused', 'starting'):
                    self.excluded.add(subject_id)
            else:
                key = (subject_id, kind)
                if key not in self.extra_tracks:
                    raise ConsentError('track_not_owned')
                before = self.track_consents.get(key)
                if granted:
                    self.track_consents[key] = 'granted'
                    self.excluded_tracks.discard(key)
                elif self.state in ('active', 'paused', 'starting') and before == 'granted':
                    self.track_consents[key] = 'withdrawn'
                    self.excluded_tracks.add(key)
                else:
                    self.track_consents[key] = 'declined'
        if not granted and self.state in ('collecting_consent', 'ready'):
            self._go('decline')
            return self.state
        return self._settle()

    def publisher_joined(self, pid):
        self.publishers.add(pid)
        return self._settle()

    def publisher_left(self, pid):
        self.publishers.discard(pid)
        self.excluded.discard(pid)
        return self._settle()

    def start(self, actor_id):
        if actor_id != self.host_id:
            raise ConsentError('host_only')
        return self._go('start')

    def media_started(self):
        self._go('media_started')
        return self._settle()

    def stop(self, actor_id):
        if actor_id != self.host_id:
            raise ConsentError('host_only')
        return self._go('stop')

    def media_stopped(self):
        return self._go('media_stopped')

    def expire(self):
        return self._go('expire')
