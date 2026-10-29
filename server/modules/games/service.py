"""GAMES-1 纯业务：题库、判分、每日轮换、奖励、抽签与抢沙发。"""

import hashlib
import json
import random
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from app import clock, flags, outbox
from app.errors import ApiError
from modules.admin import params as admin_params

from .sample_questions import questions as sample_questions

try:  # ECON-1 可能晚于本卡落地；测试按契约 patch 这个对象。
    from modules.economy import service as eco
except ImportError:  # pragma: no cover - 由未接 ECON 的测试覆盖行为
    eco = None


DIRECTIONS = {'agent', 'prompt', 'coding', 'model', 'safety'}
EXAM_QUESTIONS = 10
EXAM_SECONDS = 10 * 60
SOFA_REWARD = 3
SOFA_DAILY_LIMIT = 5

admin_params.declare('games', 'exam_questions', 'exam_seconds', 'sofa_reward', 'sofa_daily_limit')


def _param(conn, key, fallback):
    return int(admin_params.value(conn, 'games', key, fallback))

GUESS_ITEMS = [
    {'id': 'guess-01', 'output': '先固定输入、期望与观测点，再列三个可证伪的根因假设。',
     'options': ['prompt-03', 'prompt-08', 'prompt-10', 'prompt-14'], 'answer': 'prompt-03'},
    {'id': 'guess-02', 'output': '按直接证据、间接支持、推断与缺口分类，并限制每类材料能支持的结论。',
     'options': ['prompt-09', 'prompt-01', 'prompt-13', 'prompt-16'], 'answer': 'prompt-09'},
    {'id': 'guess-03', 'output': '比较候选，写不可逆成本，最后只推荐一个并给出改选条件。',
     'options': ['prompt-08', 'prompt-02', 'prompt-05', 'prompt-11'], 'answer': 'prompt-08'},
    {'id': 'guess-04', 'output': '首选工具失败后记录错误摘要，再按顺序使用降级方案；同一失败不无限重试。',
     'options': ['prompt-13', 'prompt-04', 'prompt-07', 'prompt-15'], 'answer': 'prompt-13'},
    {'id': 'guess-05', 'output': '职责、允许、禁止、前检、停止条件和回执组成一份可判定合同。',
     'options': ['prompt-12', 'prompt-06', 'prompt-10', 'prompt-16'], 'answer': 'prompt-12'},
    {'id': 'guess-06', 'output': '先定义对象、事件、去重、排除和时区，字段不足就停止并列缺口。',
     'options': ['prompt-07', 'prompt-02', 'prompt-11', 'prompt-14'], 'answer': 'prompt-07'},
    {'id': 'guess-07', 'output': '从第一次来、键盘和 390px 手机三个视角走最短路径，没验证的不写通过。',
     'options': ['prompt-15', 'prompt-05', 'prompt-09', 'prompt-01'], 'answer': 'prompt-15'},
    {'id': 'guess-08', 'output': '目标、允许文件、不做事项、最小切片、验证命令与跨团队接线一次写全。',
     'options': ['prompt-04', 'prompt-03', 'prompt-08', 'prompt-12'], 'answer': 'prompt-04'},
    {'id': 'guess-09', 'output': '抽取外部事实，只保留有来源的项目；易变字段不必要就删除。',
     'options': ['prompt-16', 'prompt-06', 'prompt-02', 'prompt-10'], 'answer': 'prompt-16'},
    {'id': 'guess-10', 'output': '围绕观点同时写支持证据、反例和适用边界，避免单向宣传。',
     'options': ['prompt-02', 'prompt-01', 'prompt-05', 'prompt-11'], 'answer': 'prompt-02'},
]

FORTUNE_PAIRS = [
    ('重构', '周五上线'), ('先写复现', '边猜边改'), ('小步提交', '一口吃完'), ('补测试', '只看绿灯'),
    ('删空话', '堆说明'), ('核对来源', '补造事实'), ('先做主路径', '沉迷边角'), ('保留回退', '不可逆操作'),
    ('问清边界', '顺手越界'), ('看真实画面', '脑补像素'), ('固定口径', '混算指标'), ('记录失败', '静默吞错'),
    ('短事务', '锁里联网'), ('显式权限', '默认全权'), ('及时收工', '留死代码'),
]
FORTUNES = [
    {'key': f'fortune-{i:02d}-{j}', 'text': f'今日宜：{good}；忌：{bad}{tail}'}
    for i, (good, bad) in enumerate(FORTUNE_PAIRS, 1)
    for j, tail in enumerate(('。', '，先喝口水。', '，熊猫已记账。', '，明天也一样。'), 1)
]


def _dt(value=None):
    if value is None:
        return datetime.fromtimestamp(clock.now_ts(), timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), timezone.utc)
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return datetime.combine(date.fromisoformat(value), datetime.min.time(), timezone.utc)
    return datetime.fromtimestamp(clock.parse(value), timezone.utc)


def day_key(value=None):
    return _dt(value).date().isoformat()


def week_start(value=None):
    current = _dt(value).date()
    return (current - timedelta(days=current.weekday())).isoformat()


def seed_questions(conn):
    stamp = clock.now()
    for row in sample_questions():
        conn.execute(
            'INSERT OR IGNORE INTO game_question '
            '(id, direction, kind, prompt, options_json, answer_json, explanation, source_kind, source_id, '
            'source_route, review_status, sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (row['id'], row['direction'], row['kind'], row['prompt'], json.dumps(row['options'], ensure_ascii=False),
             json.dumps(row['answer'], ensure_ascii=False), row['explanation'], row['source_kind'], row['source_id'],
             row['source_route'], row['review_status'], row['sample'], stamp),
        )
    return conn.execute("SELECT count(*) FROM game_question WHERE review_status = 'reviewed'").fetchone()[0]


def _shuffle(values, rng):
    values = list(values)
    rng.shuffle(values)
    return values


def start_exam(conn, principal_id, direction=None, rng=None, now=None):
    if direction is not None and direction not in DIRECTIONS:
        raise ApiError('validation_failed', '考试方向不在可选范围内')
    seed_questions(conn)
    params = []
    where = "review_status = 'reviewed'"
    if direction:
        where += ' AND direction = ?'
        params.append(direction)
    pool = [dict(row) for row in conn.execute(
        f'SELECT * FROM game_question WHERE {where} ORDER BY id', params
    ).fetchall()]
    question_count = _param(conn, 'exam_questions', EXAM_QUESTIONS)
    exam_seconds = _param(conn, 'exam_seconds', EXAM_SECONDS)
    if len(pool) < question_count:
        raise ApiError('service_unavailable', f'当前方向的审核题还不足 {question_count} 道')
    rng = rng or random.SystemRandom()
    chosen = rng.sample(pool, question_count)
    exam_id = str(uuid.uuid4())
    started = _dt(now)
    expires = started + timedelta(seconds=exam_seconds)
    conn.execute(
        'INSERT INTO game_exam '
        '(id, principal_id, direction, question_count, duration_seconds, started_at, expires_at, sample) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        (exam_id, principal_id, direction, question_count, exam_seconds,
         clock.iso(started.timestamp()), clock.iso(expires.timestamp())),
    )
    for slot, question in enumerate(chosen, 1):
        options = _shuffle(json.loads(question['options_json']), rng)
        conn.execute(
            'INSERT INTO game_exam_question (exam_id, slot, question_id, options_json, answer_json) '
            'VALUES (?, ?, ?, ?, ?)',
            (exam_id, slot, question['id'], json.dumps(options, ensure_ascii=False), question['answer_json']),
        )
    return exam_view(conn, principal_id, exam_id, now=started)


def _exam(conn, principal_id, exam_id):
    row = conn.execute(
        'SELECT * FROM game_exam WHERE id = ? AND principal_id = ?', (exam_id, principal_id)
    ).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    return row


def exam_view(conn, principal_id, exam_id, now=None, include_results=False):
    exam = _exam(conn, principal_id, exam_id)
    current = _dt(now)
    remaining = max(0, int(clock.parse(exam['expires_at']) - current.timestamp()))
    rows = conn.execute(
        'SELECT eq.slot, eq.options_json, q.id, q.direction, q.kind, q.prompt, q.explanation, '
        'q.source_kind, q.source_id, q.source_route, a.response_json, a.correct '
        'FROM game_exam_question eq JOIN game_question q ON q.id = eq.question_id '
        'LEFT JOIN game_exam_answer a ON a.exam_id = eq.exam_id AND a.slot = eq.slot '
        'WHERE eq.exam_id = ? ORDER BY eq.slot', (exam_id,)
    ).fetchall()
    submitted = exam['submitted_at'] is not None
    questions = []
    for row in rows:
        item = {
            'slot': row['slot'], 'id': row['id'], 'direction': row['direction'], 'kind': row['kind'],
            'prompt': row['prompt'], 'options': json.loads(row['options_json']),
        }
        if submitted or include_results:
            item.update({
                'response': json.loads(row['response_json']) if row['response_json'] else [],
                'correct': bool(row['correct']) if row['correct'] is not None else False,
                'explanation': row['explanation'],
                'source': {'kind': row['source_kind'], 'id': row['source_id'], 'route': row['source_route']},
            })
        questions.append(item)
    return {
        'id': exam['id'], 'direction': exam['direction'], 'startedAt': exam['started_at'],
        'expiresAt': exam['expires_at'], 'remainingSeconds': remaining,
        'durationSeconds': exam['duration_seconds'], 'submittedAt': exam['submitted_at'],
        'score': exam['score'], 'correctCount': exam['correct_count'], 'sample': bool(exam['sample']),
        'questions': questions,
    }


def _normalized_response(kind, value):
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ApiError('validation_failed', '答案必须是字符串数组')
    if kind in ('single', 'boolean') and len(value) != 1:
        raise ApiError('validation_failed', '单选和判断题只能提交一个答案')
    return value


def submit_exam(conn, principal_id, exam_id, answers, now=None):
    exam = _exam(conn, principal_id, exam_id)
    if exam['submitted_at'] is not None:
        raise ApiError('game_already_submitted')
    current = _dt(now)
    if current.timestamp() > clock.parse(exam['expires_at']):
        raise ApiError('game_expired')
    if not isinstance(answers, dict):
        raise ApiError('validation_failed', 'answers 必须按题号提交')
    rows = conn.execute(
        'SELECT eq.slot, eq.answer_json, q.kind FROM game_exam_question eq '
        'JOIN game_question q ON q.id = eq.question_id WHERE eq.exam_id = ? ORDER BY eq.slot', (exam_id,)
    ).fetchall()
    correct_count = 0
    for row in rows:
        raw = answers.get(str(row['slot']), answers.get(row['slot'], []))
        response = _normalized_response(row['kind'], raw)
        expected = json.loads(row['answer_json'])
        correct = response == expected if row['kind'] == 'order' else set(response) == set(expected)
        correct_count += int(correct)
        conn.execute(
            'INSERT INTO game_exam_answer (exam_id, slot, response_json, correct, answered_at) '
            'VALUES (?, ?, ?, ?, ?)',
            (exam_id, row['slot'], json.dumps(response, ensure_ascii=False), int(correct), clock.iso(current.timestamp())),
        )
    score = round(correct_count * 100 / len(rows))
    elapsed = max(0, int(current.timestamp() - clock.parse(exam['started_at'])))
    submitted_at = clock.iso(current.timestamp())
    conn.execute(
        'UPDATE game_exam SET submitted_at = ?, score = ?, correct_count = ? WHERE id = ?',
        (submitted_at, score, correct_count, exam_id),
    )
    best = conn.execute('SELECT * FROM game_best_score WHERE principal_id = ?', (principal_id,)).fetchone()
    if best is None or score > best['score'] or (score == best['score'] and elapsed < best['duration_seconds']):
        conn.execute(
            'INSERT INTO game_best_score (principal_id, exam_id, score, duration_seconds, updated_at) '
            'VALUES (?, ?, ?, ?, ?) ON CONFLICT(principal_id) DO UPDATE SET '
            'exam_id = excluded.exam_id, score = excluded.score, duration_seconds = excluded.duration_seconds, '
            'updated_at = excluded.updated_at',
            (principal_id, exam_id, score, elapsed, submitted_at),
        )
    outbox.emit(conn, 'games.exam_submitted', 'exam', exam_id,
                {'principal_id': principal_id, 'score': score, 'correct_count': correct_count},
                actor_id=principal_id)
    return exam_view(conn, principal_id, exam_id, now=current, include_results=True)


def exam_leaderboard(conn, limit=20):
    return [
        {'rank': index, 'displayName': row['display_name'], 'score': row['score'],
         'durationSeconds': row['duration_seconds'], 'updatedAt': row['updated_at']}
        for index, row in enumerate(conn.execute(
            'SELECT p.display_name, b.score, b.duration_seconds, b.updated_at FROM game_best_score b '
            'JOIN profile p ON p.principal_id = b.principal_id '
            'ORDER BY b.score DESC, b.duration_seconds, b.updated_at LIMIT ?', (limit,)
        ).fetchall(), 1)
    ]


def ensure_daily_rotation(conn, value=None):
    day = day_key(value)
    anchor = date.fromisoformat(day).toordinal() % len(GUESS_ITEMS)
    stamp = clock.now()
    for slot in range(1, 6):
        item = GUESS_ITEMS[(anchor + (slot - 1) * 3) % len(GUESS_ITEMS)]
        conn.execute(
            'INSERT OR IGNORE INTO game_daily_rotation (day, kind, slot, item_id, created_at) '
            "VALUES (?, 'guess', ?, ?, ?)", (day, slot, item['id'], stamp),
        )
    deliver_pending_rewards(conn)
    return day


def _guess_item(item_id):
    return next((item for item in GUESS_ITEMS if item['id'] == item_id), None)


def guess_today(conn, principal_id, value=None):
    day = ensure_daily_rotation(conn, value)
    attempts = {row['slot']: row for row in conn.execute(
        'SELECT * FROM game_guess_attempt WHERE principal_id = ? AND day = ?', (principal_id, day)
    ).fetchall()}
    rows = conn.execute(
        "SELECT slot, item_id FROM game_daily_rotation WHERE day = ? AND kind = 'guess' ORDER BY slot", (day,)
    ).fetchall()
    items = []
    for row in rows:
        item = _guess_item(row['item_id'])
        attempt = attempts.get(row['slot'])
        items.append({
            'slot': row['slot'], 'output': item['output'],
            'options': [{'id': option, 'label': option.replace('prompt-', '提示词 ')} for option in item['options']],
            'attempted': attempt is not None, 'correct': bool(attempt['correct']) if attempt else None,
            'reward': attempt['reward'] if attempt else 0,
        })
    return {'day': day, 'completed': len(attempts), 'total': 5, 'items': items}


def _deliver_reward(conn, principal_id, reward_key, reason, requested, ref=None):
    existing = conn.execute(
        'SELECT * FROM game_reward WHERE principal_id = ? AND reward_key = ?', (principal_id, reward_key)
    ).fetchone()
    if existing is not None:
        if not existing['delivered']:
            _retry_reward(conn, existing)
            existing = conn.execute(
                'SELECT * FROM game_reward WHERE principal_id = ? AND reward_key = ?', (principal_id, reward_key)
            ).fetchone()
        return existing['granted']
    granted, delivered = 0, 0
    if eco is not None and hasattr(eco, 'credit'):
        granted = int(eco.credit(conn, principal_id, 'bamboo', requested, reason, reward_key, ref=ref))
        delivered = 1
    conn.execute(
        'INSERT INTO game_reward '
        '(principal_id, reward_key, reason, requested, granted, delivered, ref, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (principal_id, reward_key, reason, requested, granted, delivered, ref, clock.now()),
    )
    if delivered:
        outbox.emit(conn, 'games.rewarded', 'principal', principal_id,
                    {'reason': reason, 'amount': granted, 'ref': ref}, actor_id=principal_id)
    return granted


def _retry_reward(conn, row):
    if eco is None or not hasattr(eco, 'credit'):
        return 0
    granted = int(eco.credit(conn, row['principal_id'], 'bamboo', row['requested'], row['reason'],
                             row['reward_key'], ref=row['ref']))
    conn.execute(
        'UPDATE game_reward SET granted = ?, delivered = 1 WHERE principal_id = ? AND reward_key = ?',
        (granted, row['principal_id'], row['reward_key']),
    )
    ref = row['ref'] or ''
    if ref.startswith('guess:'):
        _, day, slot = ref.split(':', 2)
        conn.execute(
            'UPDATE game_guess_attempt SET reward = ? WHERE principal_id = ? AND day = ? AND slot = ?',
            (granted, row['principal_id'], day, int(slot)),
        )
    elif ref.startswith('object:'):
        conn.execute(
            'UPDATE game_sofa_reply SET reward = ? WHERE principal_id = ? AND object_id = ?',
            (granted, row['principal_id'], ref.removeprefix('object:')),
        )
    outbox.emit(conn, 'games.rewarded', 'principal', row['principal_id'],
                {'reason': row['reason'], 'amount': granted, 'ref': row['ref']}, actor_id=row['principal_id'])
    return granted


def deliver_pending_rewards(conn):
    if eco is None or not hasattr(eco, 'credit'):
        return 0
    delivered = 0
    for row in conn.execute('SELECT * FROM game_reward WHERE delivered = 0 ORDER BY created_at, reward_key').fetchall():
        _retry_reward(conn, row)
        delivered += 1
    return delivered


def answer_guess(conn, principal_id, slot, option_id, value=None):
    day = ensure_daily_rotation(conn, value)
    existing = conn.execute(
        'SELECT * FROM game_guess_attempt WHERE principal_id = ? AND day = ? AND slot = ?',
        (principal_id, day, slot),
    ).fetchone()
    if existing is not None:
        return {'slot': slot, 'correct': bool(existing['correct']), 'streak': existing['streak'],
                'reward': existing['reward'], 'replayed': True}
    rotation = conn.execute(
        "SELECT item_id FROM game_daily_rotation WHERE day = ? AND kind = 'guess' AND slot = ?", (day, slot)
    ).fetchone()
    if rotation is None:
        raise ApiError('resource_not_found')
    item = _guess_item(rotation['item_id'])
    if option_id not in item['options']:
        raise ApiError('validation_failed', '选项不属于这道题')
    previous = conn.execute(
        'SELECT correct, streak FROM game_guess_attempt WHERE principal_id = ? AND day = ? AND slot = ?',
        (principal_id, day, slot - 1),
    ).fetchone()
    correct = option_id == item['answer']
    streak = (previous['streak'] if previous and previous['correct'] else 0) + 1 if correct else 0
    requested = min(8, 2 + streak) if correct else 0
    reward = _deliver_reward(conn, principal_id, f'games:guess:{day}:{slot}', 'games.guess', requested,
                             ref=f'guess:{day}:{slot}') if requested else 0
    conn.execute(
        'INSERT INTO game_guess_attempt '
        '(principal_id, day, slot, option_id, correct, streak, reward, attempted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (principal_id, day, slot, option_id, int(correct), streak, reward, clock.now()),
    )
    return {'slot': slot, 'correct': correct, 'streak': streak, 'reward': reward, 'replayed': False}


def draw_fortune(conn, principal_id, value=None):
    day = day_key(value)
    row = conn.execute(
        'SELECT fortune_key FROM game_fortune WHERE principal_id = ? AND day = ?', (principal_id, day)
    ).fetchone()
    if row is None:
        digest = hashlib.sha256(f'{principal_id}:{day}'.encode()).digest()
        fortune = FORTUNES[int.from_bytes(digest[:4], 'big') % len(FORTUNES)]
        conn.execute(
            'INSERT INTO game_fortune (principal_id, day, fortune_key, created_at) VALUES (?, ?, ?, ?)',
            (principal_id, day, fortune['key'], clock.now()),
        )
    else:
        fortune = next(item for item in FORTUNES if item['key'] == row['fortune_key'])
    return {'day': day, 'key': fortune['key'], 'text': fortune['text'], 'sample': True}


def preference(conn, principal_id):
    row = conn.execute('SELECT playground_enabled FROM game_preference WHERE principal_id = ?', (principal_id,)).fetchone()
    return {'playgroundEnabled': bool(row['playground_enabled']) if row else True}


def set_preference(conn, principal_id, enabled):
    conn.execute(
        'INSERT INTO game_preference (principal_id, playground_enabled, updated_at) VALUES (?, ?, ?) '
        'ON CONFLICT(principal_id) DO UPDATE SET playground_enabled = excluded.playground_enabled, '
        'updated_at = excluded.updated_at', (principal_id, int(enabled), clock.now()),
    )
    return preference(conn, principal_id)


def weekly_bamboo(conn, value=None, limit=10):
    start = week_start(value)
    rows = conn.execute(
        'SELECT r.principal_id, p.display_name, sum(r.granted) AS earned '
        'FROM game_reward r JOIN profile p ON p.principal_id = r.principal_id '
        'WHERE r.created_at >= ? AND r.delivered = 1 AND r.granted > 0 '
        'GROUP BY r.principal_id, p.display_name ORDER BY earned DESC, p.display_name LIMIT ?', (start, limit)
    ).fetchall()
    return [{'rank': index, 'displayName': row['display_name'], 'earned': row['earned']}
            for index, row in enumerate(rows, 1)]


def sofa_today(conn, value=None, limit=20):
    day = day_key(value)
    return [dict(row) for row in conn.execute(
        'SELECT s.root_id AS rootId, s.position, s.reward, s.created_at AS createdAt, p.display_name AS displayName '
        'FROM game_sofa_reply s JOIN profile p ON p.principal_id = s.principal_id '
        'WHERE substr(s.created_at, 1, 10) = ? ORDER BY s.created_at DESC LIMIT ?', (day, limit)
    ).fetchall()]


def home(conn, principal_id):
    balance = None
    if eco is not None and hasattr(eco, 'balance'):
        balance = int(eco.balance(conn, principal_id, 'bamboo'))
    return {
        'preference': preference(conn, principal_id), 'bambooBalance': balance,
        'leaderboard': weekly_bamboo(conn), 'sofas': sofa_today(conn),
    }


def _all_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ' '.join(_all_text(item) for item in value)
    if isinstance(value, dict):
        return ' '.join(_all_text(item) for item in value.values())
    return ''


def on_object(conn, event):
    if event.get('event_type') != 'object.created' or (event.get('payload') or {}).get('type') != 'reply':
        return
    flags.gate(conn, 'games.enabled')
    actor_id = event.get('actor_id')
    if not actor_id:
        return
    row = conn.execute(
        'SELECT h.root_id, h.current_version, v.content_json FROM object_head h '
        'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        "WHERE h.id = ? AND h.type = 'reply' AND h.lifecycle = 'active'", (event['aggregate_id'],)
    ).fetchone()
    if row is None or not row['root_id']:
        return
    root = conn.execute('SELECT type, lifecycle FROM object_head WHERE id = ?', (row['root_id'],)).fetchone()
    if root is None or root['lifecycle'] != 'active' or root['type'] not in ('discussion', 'problem'):
        return
    text = re.sub(r'\s+', '', _all_text(json.loads(row['content_json'])))
    if len(text) < 15 or not re.search(r'[A-Za-z0-9\u3400-\u9fff]', text):
        return
    position = conn.execute('SELECT count(*) + 1 FROM game_sofa_reply WHERE root_id = ?', (row['root_id'],)).fetchone()[0]
    if position > 3:
        return
    occurred_at = event.get('occurred_at') or clock.now()
    rewarded_today = conn.execute(
        "SELECT count(*) FROM game_reward WHERE principal_id = ? AND reason = 'games.sofa' "
        'AND substr(created_at, 1, 10) = ?',
        (actor_id, occurred_at[:10]),
    ).fetchone()[0]
    reward = 0
    if rewarded_today < _param(conn, 'sofa_daily_limit', SOFA_DAILY_LIMIT):
        reward = _deliver_reward(conn, actor_id, f'games:sofa:{event["aggregate_id"]}', 'games.sofa',
                                 _param(conn, 'sofa_reward', SOFA_REWARD),
                                 ref=f'object:{event["aggregate_id"]}')
    conn.execute(
        'INSERT OR IGNORE INTO game_sofa_reply '
        '(object_id, root_id, principal_id, position, body_length, reward, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (event['aggregate_id'], row['root_id'], actor_id, position, len(text), reward, occurred_at),
    )

