"""悬赏与积分的数据库操作。托管和发放都在调用方的同一个写事务里完成；积分流水只追加，触发器保证余额不为负。"""
import json
import re
import uuid

from app import audit, clock, flags, objects, outbox
from app.authz import require, visible_predicate
from app.errors import ApiError
from modules.admin import params as admin_params

admin_params.declare('bounty', 'minimum_credits')

from . import logic

LEDGER_LABELS = {
    'adopted': '知识被采纳或验证', 'useful': '回答被标「有用」', 'reproduced': '作品被别人复现',
    'host': '主持房间', 'curate': '整理被确认', 'report': '举报成立', 'violation': '违规成立',
}


def ready(conn):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credit_entry'").fetchone() is not None


def new_id():
    return str(uuid.uuid4())


def season_id(conn, ts=None):
    ts = clock.now_ts() if ts is None else ts
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'growth_season'").fetchone():
        at = clock.iso(ts)
        row = conn.execute('SELECT id FROM growth_season WHERE starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC '
                           'LIMIT 1', (at, at)).fetchone()
        if row:
            return row['id']
    return logic.quarter_season(ts)


# ---------------------------------------------------------------- 积分流水

def balances(conn, pid):
    row = conn.execute('SELECT coalesce(sum(amount), 0), coalesce(sum(held_delta), 0) FROM credit_entry '
                       'WHERE principal_id = ?', (pid,)).fetchone()
    return row[0], row[1]


def held_on(conn, bounty_id, pid=None):
    sql = 'SELECT principal_id, coalesce(sum(held_delta), 0) AS held FROM credit_entry WHERE bounty_id = ?'
    params = [bounty_id]
    if pid:
        sql += ' AND principal_id = ?'
        params.append(pid)
    rows = conn.execute(sql + ' GROUP BY principal_id ORDER BY principal_id', params).fetchall()
    return {r['principal_id']: r['held'] for r in rows if r['held'] > 0}


def post(conn, *, pid, kind, amount, held=0, bounty_id=None, source_type, source_ref=None, season, key,
         actor_id=None, reason=None):
    existing = conn.execute('SELECT * FROM credit_entry WHERE idempotency_key = ?', (key,)).fetchone()
    if existing:
        same = (existing['principal_id'], existing['kind'], existing['amount'], existing['held_delta'],
                existing['bounty_id']) == (pid, kind, amount, held, bounty_id)
        if not same:
            raise ApiError('idempotency_conflict')
        return existing['id']
    if amount < 0 and balances(conn, pid)[0] + amount < 0:
        raise ApiError('credits_insufficient')
    entry_id = new_id()
    conn.execute('INSERT INTO credit_entry (id, principal_id, kind, amount, held_delta, bounty_id, source_type, source_ref, '
                 'season, idempotency_key, actor_id, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (entry_id, pid, kind, amount, held, bounty_id, source_type, source_ref, season, key, actor_id, reason,
                  clock.now()))
    return entry_id


def ensure_season_grant(conn, pid, level, ts=None):
    if level < logic.SEASON_GRANT_MIN_LEVEL:
        return None
    season = season_id(conn, ts)
    key = f'season:{season}:{pid}'
    if conn.execute('SELECT 1 FROM credit_entry WHERE idempotency_key = ?', (key,)).fetchone():
        return None
    return post(conn, pid=pid, kind='grant', amount=logic.SEASON_GRANT, source_type='season_start', season=season,
                key=key, reason='season_start')


def season_grant_due(conn, pid, level):
    if level < logic.SEASON_GRANT_MIN_LEVEL:
        return False
    key = f'season:{season_id(conn)}:{pid}'
    return conn.execute('SELECT 1 FROM credit_entry WHERE idempotency_key = ?', (key,)).fetchone() is None


def _hold(conn, actor, bounty_id, amount, source_type, source_ref, key, season):
    available, _ = balances(conn, actor.id)
    if available < amount:
        raise ApiError('credits_insufficient', f'可用积分 {available}，这次需要 {amount}')
    return post(conn, pid=actor.id, kind='hold', amount=-amount, held=amount, bounty_id=bounty_id,
                source_type=source_type, source_ref=source_ref, season=season, key=key, actor_id=actor.id)


def _refund_all(conn, bounty, reason, actor_id, request_id):
    season = season_id(conn)
    total = 0
    for pid, amount in held_on(conn, bounty['id']).items():
        post(conn, pid=pid, kind='refund', amount=amount, held=-amount, bounty_id=bounty['id'], source_type='refund',
             source_ref=bounty['id'], season=season, key=f'refund:{bounty["id"]}:{pid}', actor_id=actor_id,
             reason=reason)
        total += amount
    return total


# ---------------------------------------------------------------- 读取

def load(conn, actor, bounty_id):
    row = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    objects.load_visible(conn, actor, row['object_id'])
    return row


def _object_lifecycle(conn, object_id):
    row = conn.execute('SELECT lifecycle FROM object_head WHERE id = ?', (object_id,)).fetchone()
    return row['lifecycle'] if row else None


def promo_rules(conn):
    rows = conn.execute('SELECT * FROM bounty_promo_rule ORDER BY position, id').fetchall()
    return [dict(r, enabled=bool(r['enabled'])) for r in rows]


def _parse_rewards(conn, rewards, *, need_credits):
    seen = {}
    for item in rewards:
        kind = item['type']
        if kind in logic.UNAVAILABLE_REWARDS:
            raise ApiError('capability_unavailable', '现金和实物奖励暂不开放，需要 Sun 和法务批准')
        if kind in seen:
            raise ApiError('validation_failed', '同一种奖励只能写一次')
        seen[kind] = item
    credits = (seen.get('credits') or {}).get('amount') or 0
    if 'credits' in seen and credits < 1:
        raise ApiError('validation_failed', '积分奖励要写数量')
    minimum = int(admin_params.value(conn, 'bounty', 'minimum_credits', logic.MIN_CREDITS))
    if need_credits and credits < minimum:
        raise ApiError('validation_failed', f'求助悬赏至少托管 {minimum} 积分')
    cosmetic = (seen.get('cosmetic') or {}).get('id')
    if 'cosmetic' in seen and cosmetic not in logic.COSMETICS:
        raise ApiError('validation_failed', '外观奖励要从平台列表里选')
    perk = ((seen.get('perk') or {}).get('note') or '').strip() or None
    if 'perk' in seen and not perk:
        raise ApiError('validation_failed', '自备权益要写清楚承诺给什么')
    if perk and logic.looks_like_code(perk):
        raise ApiError('validation_failed', '这里不保存兑换码。只写承诺给什么（例如「一个月会员」），发奖后由你交付，领奖人在这里确认收到')
    return credits, cosmetic, perk


def _open_count(conn, owner_id):
    return conn.execute("SELECT count(*) FROM bounty WHERE owner_id = ? AND kind = 'help' AND status = 'open'",
                        (owner_id,)).fetchone()[0]


# ---------------------------------------------------------------- 发起、追加

def create(conn, actor, body, request_id=None):
    kind = body['kind']
    require(conn, actor, f'bounty.create.{kind}')
    obj = objects.load_visible(conn, actor, body['object_id'])
    if obj['author_id'] != actor.id:
        raise ApiError('action_not_allowed', '只能给自己发的帖子设悬赏')
    if obj['root_id'] is not None or obj['lifecycle'] != 'active':
        raise ApiError('state_conflict', '只能给已发布的主帖设悬赏')
    allowed = logic.HELP_TYPES if kind == 'help' else logic.PROMO_TYPES
    if obj['type'] not in allowed:
        raise ApiError('validation_failed', '求助悬赏挂在讨论帖上；推广挂在作品或讨论帖上')
    if conn.execute("SELECT 1 FROM bounty WHERE object_id = ? AND status = 'open'", (obj['id'],)).fetchone():
        raise ApiError('state_conflict', '这个帖子已经有进行中的悬赏')
    now_ts = clock.now_ts()
    if kind == 'promo':
        if body.get('rewards'):
            raise ApiError('validation_failed', '推广的奖励挂在试用任务上')
        since = clock.iso(now_ts - 7 * logic.DAY)
        weekly = conn.execute("SELECT count(*) FROM bounty WHERE owner_id = ? AND kind = 'promo' AND created_at >= ?",
                              (actor.id, since)).fetchone()[0]
        if weekly >= logic.PROMO_PER_WEEK:
            raise ApiError('bounty_limit_reached', '每人每周最多发 1 条推广帖')
        credits, cosmetic, perk = 0, None, None
    else:
        if _open_count(conn, actor.id) >= logic.concurrent_limit(actor.level):
            raise ApiError('bounty_limit_reached',
                           f'L{actor.level} 同时最多 {logic.concurrent_limit(actor.level)} 个进行中的求助悬赏')
        credits, cosmetic, perk = _parse_rewards(conn, body.get('rewards') or [], need_credits=True)
        if credits > logic.cap(actor.level):
            raise ApiError('bounty_cap_exceeded', f'L{actor.level} 单个悬赏最多 {logic.cap(actor.level)} 积分')
    ensure_season_grant(conn, actor.id, actor.level, now_ts)
    bounty_id = new_id()
    now = clock.iso(now_ts)
    deadline = clock.iso(now_ts + body['days'] * logic.DAY)
    settle_after = clock.iso(now_ts + body['days'] * logic.DAY + logic.GRACE_SECONDS)
    season = season_id(conn, now_ts)
    conn.execute('INSERT INTO bounty (id, kind, object_id, owner_id, status, credits, cosmetic_id, perk_note, deadline_at, '
                 "settle_after, season, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)",
                 (bounty_id, kind, obj['id'], actor.id, credits, cosmetic, perk, deadline, settle_after, season, now, now))
    if credits:
        _hold(conn, actor, bounty_id, credits, 'bounty', bounty_id, f'hold:{bounty_id}:owner', season)
    outbox.emit(conn, 'bounty.created', 'bounty', bounty_id,
                {'kind': kind, 'object_id': obj['id'], 'credits': credits, 'deadline_at': deadline},
                space_id=obj['space_id'], actor_id=actor.id, request_id=request_id)
    if kind == 'promo':
        outbox.emit(conn, 'bounty.promo_created', 'object', obj['id'], {'bounty_id': bounty_id, 'owner_id': actor.id},
                    space_id=obj['space_id'], actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, f'bounty.create.{kind}', 'bounty', bounty_id, request_id=request_id,
                 meta={'object_id': obj['id'], 'credits': credits})
    return bounty_id


def topup(conn, actor, bounty_id, amount, request_id=None):
    require(conn, actor, 'bounty.topup')
    bounty = load(conn, actor, bounty_id)
    settle(conn, bounty, request_id=request_id)
    bounty = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
    if bounty['kind'] != 'help':
        raise ApiError('validation_failed', '只有求助悬赏可以追加')
    if logic.display_status(bounty['status'], bounty['deadline_at'], bounty['settle_after'], clock.now()) != 'active':
        raise ApiError('state_conflict', '悬赏已截止，不能再追加')
    mine = conn.execute("SELECT coalesce(-sum(amount), 0) FROM credit_entry WHERE bounty_id = ? AND principal_id = ? "
                        "AND kind = 'hold'", (bounty_id, actor.id)).fetchone()[0]
    if mine + amount > logic.cap(actor.level):
        raise ApiError('bounty_cap_exceeded', f'你在这个悬赏上最多投 {logic.cap(actor.level)} 积分（L{actor.level}）')
    ensure_season_grant(conn, actor.id, actor.level)
    topup_id = new_id()
    entry = _hold(conn, actor, bounty_id, amount, 'topup', topup_id, f'hold:{bounty_id}:topup:{topup_id}',
                  season_id(conn))
    conn.execute('INSERT INTO bounty_topup (id, bounty_id, contributor_id, amount, credit_entry_id, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?)', (topup_id, bounty_id, actor.id, amount, entry, clock.now()))
    conn.execute('UPDATE bounty SET updated_at = ? WHERE id = ?', (clock.now(), bounty_id))
    outbox.emit(conn, 'bounty.topped_up', 'bounty', bounty_id, {'amount': amount}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'bounty.topup', 'bounty', bounty_id, request_id=request_id, meta={'amount': amount})
    return topup_id


# ---------------------------------------------------------------- 发奖

def _pair(conn, season, payer, recipient):
    row = conn.execute('SELECT count(*) AS n, coalesce(sum(flagged), 0) AS f FROM bounty_award WHERE season = ? AND '
                       '((payer_id = ? AND recipient_id = ?) OR (payer_id = ? AND recipient_id = ?))',
                       (season, payer, recipient, recipient, payer)).fetchone()
    if row['n'] == 0:
        return 1, 0, False
    return 0, 1, row['f'] + 1 >= logic.PAIR_REVIEW_AFTER


def _record_award(conn, bounty, *, mode, recipient_id, credits, answer_id=None, submission_id=None, share=None,
                  cosmetic_id=None, perk_note=None, task_id=None, actor_id=None, request_id=None):
    season = season_id(conn)
    counted, flagged, review = _pair(conn, season, bounty['owner_id'], recipient_id)
    award_id = new_id()
    conn.execute('INSERT INTO bounty_award (id, bounty_id, kind, mode, answer_id, submission_id, payer_id, recipient_id, '
                 'share_pct, credits, cosmetic_id, season, pair_counted, flagged, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (award_id, bounty['id'], bounty['kind'], mode, answer_id, submission_id, bounty['owner_id'],
                  recipient_id, share, credits, cosmetic_id, season, counted, flagged, clock.now()))
    if credits:
        post(conn, pid=recipient_id, kind='award', amount=credits, bounty_id=bounty['id'], source_type='award',
             source_ref=award_id, season=season, key=f'award:{award_id}', actor_id=actor_id)
    promise_id = None
    if perk_note:
        promise_id = new_id()
        conn.execute("INSERT INTO reward_promise (id, bounty_id, task_id, award_id, promiser_id, recipient_id, note, "
                     "status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'owed', ?)",
                     (promise_id, bounty['id'], task_id, award_id, bounty['owner_id'], recipient_id, perk_note,
                      clock.now()))
    outbox.emit(conn, 'bounty.awarded', 'bounty_award', award_id, {
        'bounty_id': bounty['id'], 'kind': bounty['kind'], 'mode': mode, 'object_id': bounty['object_id'],
        'answer_id': answer_id, 'submission_id': submission_id, 'payer_id': bounty['owner_id'],
        'recipient_id': recipient_id, 'credits': credits, 'cosmetic_id': cosmetic_id, 'promise_id': promise_id,
        'counted': bool(counted), 'flagged': bool(flagged), 'season': season,
    }, actor_id=actor_id, request_id=request_id)
    audit.record(conn, actor_id, 'bounty.award', 'bounty_award', award_id, request_id=request_id,
                 meta={'bounty_id': bounty['id'], 'mode': mode, 'credits': credits, 'flagged': bool(flagged)})
    if review:
        outbox.emit(conn, 'bounty.review_requested', 'bounty_award', award_id,
                    {'reason': 'pair_repeat', 'payer_id': bounty['owner_id'], 'recipient_id': recipient_id,
                     'season': season}, actor_id=actor_id, request_id=request_id)
        audit.record(conn, actor_id, 'bounty.pair_flagged', 'bounty_award', award_id, reason='pair_repeat',
                     request_id=request_id, meta={'bounty_id': bounty['id']})
    return award_id


def _pay_help(conn, bounty, picks, mode, actor_id, request_id):
    """picks: [(answer_row, share)]。整笔托管按比例发完，各托管人的托管全部释放。"""
    pool_by = held_on(conn, bounty['id'])
    pool = sum(pool_by.values())
    season = season_id(conn)
    for pid, amount in pool_by.items():
        post(conn, pid=pid, kind='release', amount=0, held=-amount, bounty_id=bounty['id'], source_type='award',
             source_ref=bounty['id'], season=season, key=f'release:{bounty["id"]}:{pid}', actor_id=actor_id)
    amounts = logic.split(pool, [s for _, s in picks])
    awards = []
    for (answer, share), credits in zip(picks, amounts):
        awards.append(_record_award(conn, bounty, mode=mode, recipient_id=answer['author_id'], credits=credits,
                                    answer_id=answer['id'], share=share, cosmetic_id=bounty['cosmetic_id'],
                                    perk_note=bounty['perk_note'], actor_id=actor_id, request_id=request_id))
    now = clock.now()
    conn.execute("UPDATE bounty SET status = 'awarded', settle_reason = ?, settled_at = ?, updated_at = ? WHERE id = ?",
                 (mode, now, now, bounty['id']))
    return awards, pool


def award(conn, actor, bounty_id, picks, request_id=None):
    bounty = load(conn, actor, bounty_id)
    require(conn, actor, 'bounty.award', {'author_id': bounty['owner_id']})
    settle(conn, bounty, request_id=request_id)
    bounty = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
    if bounty['kind'] != 'help':
        raise ApiError('validation_failed', '推广任务按提交逐条验收')
    if bounty['status'] != 'open':
        raise ApiError('state_conflict', '这个悬赏已经结束')
    shares = [p['share'] for p in picks]
    if not logic.valid_shares(shares):
        raise ApiError('validation_failed', f'最多分给 {logic.MAX_SPLIT} 个回答，比例加起来要等于 100')
    rows, authors = [], set()
    for p in picks:
        answer = objects.load_visible(conn, actor, p['answer_id'])
        if answer['root_id'] != bounty['object_id'] or answer['lifecycle'] != 'active':
            raise ApiError('validation_failed', '只能采纳这个帖子下面已发布的回答')
        if answer['author_id'] == bounty['owner_id']:
            raise ApiError('validation_failed', '不能发给自己')
        if answer['author_id'] in authors:
            raise ApiError('validation_failed', '同一个人的回答只选一条')
        authors.add(answer['author_id'])
        rows.append((answer, p['share']))
    awards, pool = _pay_help(conn, bounty, rows, 'owner', actor.id, request_id)
    return awards, pool


# ---------------------------------------------------------------- 结算

def qualified_useful(conn, answer_ids, cutoff):
    if not answer_ids:
        return {}
    marks = ','.join('?' * len(answer_ids))
    rows = conn.execute(
        f'SELECT m.object_id, m.marker_id, m.marked_at, pf.level, pr.created_at, pr.status, a.author_id '
        f'FROM bounty_useful_mark m JOIN principal pr ON pr.id = m.marker_id '
        f'JOIN profile pf ON pf.principal_id = m.marker_id JOIN object_head a ON a.id = m.object_id '
        f'WHERE m.object_id IN ({marks}) AND m.marked_at <= ? AND (m.removed_at IS NULL OR m.removed_at > ?)',
        (*answer_ids, cutoff, cutoff)).fetchall()
    counts = {aid: 0 for aid in answer_ids}
    for r in rows:
        if r['status'] != 'active' or r['marker_id'] == r['author_id']:
            continue
        if logic.marker_qualifies(r['level'], clock.parse(r['created_at']), clock.parse(r['marked_at'])):
            counts[r['object_id']] += 1
    return counts


def _answers(conn, bounty):
    rows = conn.execute("SELECT id, author_id, created_at FROM object_head WHERE root_id = ? AND lifecycle = 'active' "
                        'AND created_at <= ? ORDER BY created_at, id', (bounty['object_id'], bounty['deadline_at'])).fetchall()
    useful = qualified_useful(conn, [r['id'] for r in rows], bounty['settle_after'])
    return [dict(r, useful=useful.get(r['id'], 0)) for r in rows]


def _expire_pending(conn, bounty_id):
    conn.execute("UPDATE promo_submission SET status = 'expired', decided_at = ? WHERE bounty_id = ? AND status = 'pending'",
                 (clock.now(), bounty_id))


def settle(conn, bounty, now=None, request_id=None):
    """惰性结算：读取或操作前调一次。返回是否改了状态。"""
    if bounty['status'] != 'open':
        return False
    now = now or clock.now()
    lifecycle = _object_lifecycle(conn, bounty['object_id'])
    answers = _answers(conn, bounty) if bounty['kind'] == 'help' and now >= bounty['settle_after'] else ()
    action, arg = logic.decide(bounty, lifecycle, now, answers)
    if action in ('none', 'wait'):
        return False
    if action == 'auto_award':
        answer = conn.execute('SELECT id, author_id FROM object_head WHERE id = ?', (arg,)).fetchone()
        _pay_help(conn, bounty, [(answer, 100)], 'auto', None, request_id)
        return True
    status = {'cancel': 'cancelled', 'refund': 'refunded', 'close': 'closed'}[action]
    total = _refund_all(conn, bounty, arg, None, request_id)
    if bounty['kind'] == 'promo':
        _expire_pending(conn, bounty['id'])
    conn.execute('UPDATE bounty SET status = ?, settle_reason = ?, settled_at = ?, updated_at = ? WHERE id = ?',
                 (status, arg, now, now, bounty['id']))
    outbox.emit(conn, 'bounty.refunded', 'bounty', bounty['id'], {'reason': arg, 'status': status, 'credits': total},
                request_id=request_id)
    audit.record(conn, None, 'bounty.settle', 'bounty', bounty['id'], reason=arg, request_id=request_id,
                 meta={'status': status, 'refunded': total})
    return True


def due_ids(conn, now, limit=50, bounty_ids=None):
    sql = ("SELECT b.id FROM bounty b JOIN object_head h ON h.id = b.object_id WHERE b.status = 'open' "
           "AND (b.settle_after <= ? OR h.lifecycle IN ('hidden', 'withdrawn'))")
    params = [now]
    if bounty_ids is not None:
        if not bounty_ids:
            return []
        sql += f' AND b.id IN ({",".join("?" * len(bounty_ids))})'
        params += list(bounty_ids)
    return [r[0] for r in conn.execute(sql + ' ORDER BY b.settle_after LIMIT ?', (*params, limit))]


def settle_due(conn, now=None, limit=50, request_id=None):
    """给 worker 定时调用，也给读取接口惰性调用。"""
    now = now or clock.now()
    done = 0
    for bid in due_ids(conn, now, limit):
        row = conn.execute('SELECT * FROM bounty WHERE id = ?', (bid,)).fetchone()
        done += settle(conn, row, now, request_id)
    return done


# ---------------------------------------------------------------- 推广任务

def add_task(conn, actor, bounty_id, body, request_id=None):
    bounty = load(conn, actor, bounty_id)
    require(conn, actor, 'bounty.promo.task', {'author_id': bounty['owner_id']})
    settle(conn, bounty, request_id=request_id)
    bounty = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty_id,)).fetchone()
    if bounty['kind'] != 'promo':
        raise ApiError('validation_failed', '试用任务只能挂在推广帖上')
    if logic.display_status(bounty['status'], bounty['deadline_at'], bounty['settle_after'], clock.now()) != 'active':
        raise ApiError('state_conflict', '推广已截止，不能再加任务')
    hit = logic.screen(f'{body["title"]}\n{body["description"]}', promo_rules(conn))
    if hit:
        audit.record(conn, actor.id, 'bounty.promo.task', 'bounty', bounty_id, outcome='denied', reason=hit['id'],
                     request_id=request_id)
        raise ApiError('promo_task_refused', hit['message'], rule_id=hit['id'], category=hit['category'])
    credits, cosmetic, perk = _parse_rewards(conn, body['rewards'], need_credits=False)
    if not (credits or cosmetic or perk):
        raise ApiError('validation_failed', '至少给一种奖励')
    budget = credits * body['max_claims']
    spent = conn.execute("SELECT coalesce(-sum(amount), 0) FROM credit_entry WHERE bounty_id = ? AND principal_id = ? "
                         "AND kind = 'hold'", (bounty_id, actor.id)).fetchone()[0]
    if spent + budget > logic.cap(actor.level):
        raise ApiError('bounty_cap_exceeded', f'L{actor.level} 一条推广的任务总预算最多 {logic.cap(actor.level)} 积分')
    ensure_season_grant(conn, actor.id, actor.level)
    task_id = new_id()
    conn.execute('INSERT INTO promo_task (id, bounty_id, title, task_kind, description, credits_per, max_claims, '
                 'cosmetic_id, perk_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (task_id, bounty_id, body['title'].strip(), body['kind'], body['description'].strip(), credits,
                  body['max_claims'], cosmetic, perk, clock.now()))
    if budget:
        _hold(conn, actor, bounty_id, budget, 'task', task_id, f'hold:task:{task_id}', season_id(conn))
    outbox.emit(conn, 'bounty.task_created', 'promo_task', task_id, {
        'bounty_id': bounty_id, 'object_id': bounty['object_id'], 'budget': budget, 'kind': body['kind'],
        'title': body['title'].strip(), 'description': body['description'].strip(),
    }, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'bounty.promo.task', 'promo_task', task_id, request_id=request_id,
                 meta={'bounty_id': bounty_id, 'budget': budget})
    return task_id


def _task(conn, actor, task_id):
    task = conn.execute('SELECT * FROM promo_task WHERE id = ?', (task_id,)).fetchone()
    if task is None:
        raise ApiError('resource_not_found')
    bounty = load(conn, actor, task['bounty_id'])
    return task, bounty


def _accepted(conn, task_id):
    return conn.execute("SELECT count(*) FROM promo_submission WHERE task_id = ? AND status = 'accepted'",
                        (task_id,)).fetchone()[0]


def submit(conn, actor, task_id, body, request_id=None):
    require(conn, actor, 'bounty.promo.submit')
    task, bounty = _task(conn, actor, task_id)
    settle(conn, bounty, request_id=request_id)
    bounty = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty['id'],)).fetchone()
    if bounty['owner_id'] == actor.id:
        raise ApiError('validation_failed', '不能领自己的任务')
    if logic.display_status(bounty['status'], bounty['deadline_at'], bounty['settle_after'], clock.now()) != 'active':
        raise ApiError('state_conflict', '这个推广已截止')
    if _accepted(conn, task_id) >= task['max_claims']:
        raise ApiError('state_conflict', '这个任务的名额已经领完')
    evidence = body.get('evidence_object_id')
    if evidence:
        objects.load_visible(conn, actor, evidence)
    if conn.execute("SELECT 1 FROM promo_submission WHERE task_id = ? AND submitter_id = ? AND status IN "
                    "('pending', 'accepted')", (task_id, actor.id)).fetchone():
        raise ApiError('state_conflict', '你已经交过这个任务')
    sub_id = new_id()
    conn.execute("INSERT INTO promo_submission (id, task_id, bounty_id, submitter_id, body, evidence_object_id, status, "
                 "created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
                 (sub_id, task_id, bounty['id'], actor.id, body['body'].strip(), evidence, clock.now()))
    outbox.emit(conn, 'bounty.submission_created', 'promo_submission', sub_id,
                {'bounty_id': bounty['id'], 'task_id': task_id}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, 'bounty.promo.submit', 'promo_submission', sub_id, request_id=request_id,
                 meta={'task_id': task_id})
    return sub_id


def decide_submission(conn, actor, sub_id, accept, reason=None, request_id=None):
    sub = conn.execute('SELECT * FROM promo_submission WHERE id = ?', (sub_id,)).fetchone()
    if sub is None:
        raise ApiError('resource_not_found')
    task, bounty = _task(conn, actor, sub['task_id'])
    if bounty['owner_id'] != actor.id:
        raise ApiError('resource_not_found')
    require(conn, actor, 'bounty.promo.review', {'author_id': bounty['owner_id']})
    settle(conn, bounty, request_id=request_id)
    bounty = conn.execute('SELECT * FROM bounty WHERE id = ?', (bounty['id'],)).fetchone()
    sub = conn.execute('SELECT * FROM promo_submission WHERE id = ?', (sub_id,)).fetchone()
    if bounty['status'] != 'open' or sub['status'] != 'pending':
        raise ApiError('state_conflict', '这条提交已经处理过，或者推广已结束')
    now = clock.now()
    award_id = None
    if accept:
        if _accepted(conn, task['id']) >= task['max_claims']:
            raise ApiError('state_conflict', '这个任务的名额已经发完')
        if task['credits_per']:
            post(conn, pid=bounty['owner_id'], kind='release', amount=0, held=-task['credits_per'],
                 bounty_id=bounty['id'], source_type='award', source_ref=sub_id, season=season_id(conn),
                 key=f'release:sub:{sub_id}', actor_id=actor.id)
        conn.execute("UPDATE promo_submission SET status = 'accepted', decided_at = ?, decided_by = ? WHERE id = ?",
                     (now, actor.id, sub_id))
        award_id = _record_award(conn, bounty, mode='accept', recipient_id=sub['submitter_id'],
                                 credits=task['credits_per'], submission_id=sub_id, cosmetic_id=task['cosmetic_id'],
                                 perk_note=task['perk_note'], task_id=task['id'], actor_id=actor.id,
                                 request_id=request_id)
    else:
        if reason not in logic.REJECT_REASONS:
            raise ApiError('validation_failed', '退回要选一个原因')
        conn.execute("UPDATE promo_submission SET status = 'rejected', reason_code = ?, decided_at = ?, decided_by = ? "
                     'WHERE id = ?', (reason, now, actor.id, sub_id))
    outbox.emit(conn, 'bounty.submission_decided', 'promo_submission', sub_id,
                {'bounty_id': bounty['id'], 'accepted': bool(accept), 'reason': reason}, actor_id=actor.id,
                request_id=request_id)
    audit.record(conn, actor.id, 'bounty.promo.review', 'promo_submission', sub_id, reason=reason,
                 request_id=request_id, meta={'accepted': bool(accept)})
    return award_id


# ---------------------------------------------------------------- 自备权益

def respond_promise(conn, actor, promise_id, confirm, reason=None, request_id=None):
    require(conn, actor, 'bounty.promise.respond')
    row = conn.execute('SELECT * FROM reward_promise WHERE id = ?', (promise_id,)).fetchone()
    if row is None or row['recipient_id'] != actor.id:
        raise ApiError('resource_not_found')
    if row['status'] != 'owed':
        raise ApiError('state_conflict', '这条承诺已经确认或申诉过')
    if not confirm and reason not in logic.DISPUTE_REASONS:
        raise ApiError('validation_failed', '申诉要选一个原因')
    status = 'confirmed' if confirm else 'disputed'
    conn.execute('UPDATE reward_promise SET status = ?, reason_code = ?, responded_at = ? WHERE id = ?',
                 (status, None if confirm else reason, clock.now(), promise_id))
    if not confirm:
        outbox.emit(conn, 'bounty.promise_disputed', 'reward_promise', promise_id,
                    {'bounty_id': row['bounty_id'], 'promiser_id': row['promiser_id'], 'recipient_id': actor.id,
                     'reason': reason}, actor_id=actor.id, request_id=request_id)
    audit.record(conn, actor.id, f'bounty.promise.{status}', 'reward_promise', promise_id, reason=reason,
                 request_id=request_id, meta={'bounty_id': row['bounty_id']})
    return status


# ---------------------------------------------------------------- 规则表

RULE_REASONS = ('false_positive', 'missed_case', 'wording', 'tuning')


def update_rule(conn, actor, rule_id, body, request_id=None):
    require(conn, actor, 'bounty.rules.edit')
    if body['reason_code'] not in RULE_REASONS:
        raise ApiError('validation_failed', '原因码不在允许范围内')
    row = conn.execute('SELECT * FROM bounty_promo_rule WHERE id = ?', (rule_id,)).fetchone()
    pattern = body.get('pattern') if body.get('pattern') is not None else (row['pattern'] if row else None)
    message = body.get('message') if body.get('message') is not None else (row['message'] if row else None)
    enabled = body.get('enabled') if body.get('enabled') is not None else (bool(row['enabled']) if row else True)
    category = body.get('category') or (row['category'] if row else None)
    if not (pattern and message and category):
        raise ApiError('validation_failed', '新规则要有分类、匹配式和给人看的理由')
    try:
        re.compile(pattern)
    except re.error:
        raise ApiError('validation_failed', '匹配式写得不对') from None
    now = clock.now()
    version = (row['version'] + 1) if row else 1
    if row:
        conn.execute('UPDATE bounty_promo_rule SET category = ?, pattern = ?, message = ?, enabled = ?, version = ?, '
                     'updated_at = ?, updated_by = ? WHERE id = ?',
                     (category, pattern, message, int(enabled), version, now, actor.id, rule_id))
    else:
        conn.execute('INSERT INTO bounty_promo_rule (id, category, pattern, message, enabled, version, position, '
                     'updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 1, 100, ?, ?)',
                     (rule_id, category, pattern, message, int(enabled), now, actor.id))
    conn.execute('INSERT INTO bounty_rule_change (id, rule_id, version, pattern, message, enabled, reason_code, '
                 'changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                 (new_id(), rule_id, version, pattern, message, int(enabled), body['reason_code'], actor.id, now))
    audit.record(conn, actor.id, 'bounty.rule.update', 'bounty_promo_rule', rule_id, reason=body['reason_code'],
                 request_id=request_id, meta={'version': version, 'enabled': bool(enabled)})
    outbox.emit(conn, 'bounty.rule_changed', 'bounty_promo_rule', rule_id, {'version': version}, actor_id=actor.id,
                request_id=request_id)
    return version


# ---------------------------------------------------------------- 事件消费

def _mirror(conn, entry, request_id=None):
    if entry['reverses_id'] is not None or entry['points'] == 0:
        return
    if conn.execute('SELECT 1 FROM ledger_entry WHERE reverses_id = ?', (entry['id'],)).fetchone():
        return
    season = entry['season'] or season_id(conn)
    key = f'ledger:{entry["id"]}'
    if entry['points'] > 0:
        post(conn, pid=entry['subject_id'], kind='grant', amount=entry['points'], source_type='ledger',
             source_ref=entry['id'], season=season, key=key, reason=entry['event_type'])
        return
    _clamped_reverse(conn, entry['subject_id'], entry['points'], entry['id'], season, key, entry['event_type'],
                     request_id)


def _clamped_reverse(conn, pid, amount, ledger_id, season, key, reason, request_id):
    if conn.execute('SELECT 1 FROM credit_entry WHERE idempotency_key = ?', (key,)).fetchone():
        return
    available, _ = balances(conn, pid)
    take = max(amount, -available) if amount < 0 else amount
    if take != amount:
        audit.record(conn, None, 'bounty.credit.shortfall', 'ledger_entry', ledger_id, reason=reason,
                     request_id=request_id, meta={'shortfall': take - amount})
    if take == 0:
        return
    post(conn, pid=pid, kind='reverse', amount=take, source_type='ledger', source_ref=ledger_id, season=season,
         key=key, reason=reason)


def _capture_useful(conn, entry, removed_at=None):
    ref = entry['source_ref'] or ''
    if entry['event_type'] != 'useful' or not ref.startswith('object:') or not entry['actor_id']:
        return
    object_id = ref.split(':', 1)[1]
    if not conn.execute('SELECT 1 FROM object_head WHERE id = ?', (object_id,)).fetchone():
        return
    if removed_at:
        conn.execute('UPDATE bounty_useful_mark SET removed_at = ? WHERE object_id = ? AND marker_id = ? '
                     'AND removed_at IS NULL', (removed_at, object_id, entry['actor_id']))
    else:
        conn.execute("INSERT OR IGNORE INTO bounty_useful_mark (object_id, marker_id, marked_at, source) "
                     "VALUES (?, ?, ?, 'ledger')", (object_id, entry['actor_id'], entry['created_at']))


def on_ledger(conn, event):
    if not ready(conn):
        return
    row = conn.execute('SELECT * FROM ledger_entry WHERE id = ?', (event['aggregate_id'],)).fetchone()
    if row is None:
        return
    if event['event_type'] == 'ledger.recorded':
        _capture_useful(conn, row)
        _mirror(conn, row, event.get('request_id'))
    elif event['event_type'] == 'ledger.reversed' and row['reverses_id']:
        original = conn.execute('SELECT * FROM ledger_entry WHERE id = ?', (row['reverses_id'],)).fetchone()
        _capture_useful(conn, original, removed_at=row['created_at'])
        mirrored = conn.execute('SELECT amount FROM credit_entry WHERE idempotency_key = ?',
                                (f'ledger:{original["id"]}',)).fetchone()
        if mirrored:
            _clamped_reverse(conn, original['subject_id'], -mirrored['amount'], row['id'],
                             original['season'] or season_id(conn), f'ledger-rev:{row["id"]}', 'reversal',
                             event.get('request_id'))


def on_object(conn, event):
    if event['event_type'] not in ('object.lifecycle_changed', 'object.withdrawn') or not ready(conn):
        return
    for row in conn.execute("SELECT * FROM bounty WHERE object_id = ? AND status = 'open'",
                            (event['aggregate_id'],)).fetchall():
        settle(conn, row, request_id=event.get('request_id'))


def on_useful(conn, event):
    if not ready(conn):
        return
    payload = event['payload']
    object_id = payload.get('object_id') or event['aggregate_id']
    marker = payload.get('marker_id') or event.get('actor_id')
    if not object_id or not marker or not conn.execute('SELECT 1 FROM object_head WHERE id = ?', (object_id,)).fetchone():
        return
    if event['event_type'].endswith('unmarked'):
        conn.execute('UPDATE bounty_useful_mark SET removed_at = ? WHERE object_id = ? AND marker_id = ? '
                     'AND removed_at IS NULL', (event['occurred_at'], object_id, marker))
        return
    conn.execute('INSERT INTO bounty_useful_mark (object_id, marker_id, marked_at, source) VALUES (?, ?, ?, ?) '
                 "ON CONFLICT (object_id, marker_id) DO UPDATE SET removed_at = NULL, marked_at = excluded.marked_at, "
                 "source = 'content' WHERE removed_at IS NOT NULL",
                 (object_id, marker, event['occurred_at'], 'content'))


# ---------------------------------------------------------------- 视图

def _view_columns(actor):
    answers = visible_predicate(actor, 'r')
    return ('b.*, v.title AS object_title, v.content_json AS object_content, h.type AS object_type, '
            'h.lifecycle AS object_lifecycle, p.display_name AS owner_name, p.level AS owner_level, '
            f"(SELECT count(*) FROM object_head r WHERE r.root_id = b.object_id AND r.lifecycle = 'active' "
            f'AND {answers.sql}) AS answer_count, '
            '(SELECT count(*) FROM promo_submission s WHERE s.bounty_id = b.id '
            'AND (b.owner_id = :vp_actor OR s.submitter_id = :vp_actor)) AS submission_count, '
            '(SELECT count(*) FROM promo_task t WHERE t.bounty_id = b.id) AS task_count, '
            "(SELECT coalesce(-sum(c.amount), 0) FROM credit_entry c WHERE c.bounty_id = b.id AND c.kind = 'hold') "
            'AS funded, '
            '(SELECT coalesce(sum(c.held_delta), 0) FROM credit_entry c WHERE c.bounty_id = b.id) AS held')


BOUNTY_FROM = ('FROM bounty b JOIN object_head h ON h.id = b.object_id '
               'JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
               'JOIN profile p ON p.principal_id = b.owner_id')


def dto(row, actor, now):
    tags = []
    try:
        content = json.loads(row['object_content'])
        tags = [t for t in content.get('tags', []) if isinstance(t, str)][:3] if isinstance(content, dict) else []
    except (TypeError, ValueError):
        tags = []
    shown = logic.display_status(row['status'], row['deadline_at'], row['settle_after'], now)
    remaining = max(0, int(clock.parse(row['deadline_at']) - clock.parse(now))) if shown == 'active' else 0
    return {
        'id': row['id'], 'kind': row['kind'], 'status': shown, 'state': row['status'],
        'settle_reason': row['settle_reason'],
        'object': {'id': row['object_id'], 'title': row['object_title'], 'type': row['object_type'],
                   'lifecycle': row['object_lifecycle']},
        'owner': {'id': row['owner_id'], 'display_name': row['owner_name'], 'level': row['owner_level']},
        'mine': row['owner_id'] == actor.id,
        'credits': row['funded'], 'held': row['held'], 'cosmetic_id': row['cosmetic_id'],
        'cosmetic': (logic.COSMETICS.get(row['cosmetic_id']) or (None, None))[1],
        'has_perk': bool(row['perk_note']), 'perk_note': row['perk_note'],
        'deadline_at': row['deadline_at'], 'settle_after': row['settle_after'], 'remaining_seconds': remaining,
        'answer_count': row['answer_count'], 'submission_count': row['submission_count'],
        'task_count': row['task_count'], 'tags': tags, 'created_at': row['created_at'],
        'label': '推广' if row['kind'] == 'promo' else '求助',
    }


def list_rows(conn, actor, *, kind=None, status=None, object_id=None, mine=False, after=None, limit=20, now=None):
    now = now or clock.now()
    pred = visible_predicate(actor, 'h')
    where, params = [], {}
    if kind:
        where.append('b.kind = :kind')
        params['kind'] = kind
    if object_id:
        where.append('b.object_id = :object_id')
        params['object_id'] = object_id
    if mine:
        where.append('b.owner_id = :me')
        params['me'] = actor.id
    if status == 'active':
        where.append("b.status = 'open' AND b.deadline_at > :now")
    elif status == 'judging':
        where.append("b.status = 'open' AND b.deadline_at <= :now AND b.settle_after > :now")
    elif status == 'closed':
        where.append("(b.status != 'open' OR b.settle_after <= :now)")
    if status:
        params['now'] = now
    if after:
        where.append('(b.created_at, b.id) < (:c_at, :c_id)')
        params.update(c_at=after[0], c_id=after[1])
    clause = ''.join(f' AND {w}' for w in where)
    sql = (f'SELECT {_view_columns(actor)} {BOUNTY_FROM} WHERE {pred.sql}{clause} '
           'ORDER BY b.created_at DESC, b.id DESC LIMIT :n')
    return conn.execute(sql, {**pred.params, **params, 'n': limit}).fetchall()


def detail(conn, actor, bounty_id, now=None):
    now = now or clock.now()
    load(conn, actor, bounty_id)
    pred = visible_predicate(actor, 'h')
    row = conn.execute(f'SELECT {_view_columns(actor)} {BOUNTY_FROM} WHERE b.id = :id AND {pred.sql}',
                       {'id': bounty_id, **pred.params}).fetchone()
    if row is None:
        raise ApiError('resource_not_found')
    data = dto(row, actor, now)
    owner = row['owner_id'] == actor.id
    contributors = conn.execute("SELECT count(DISTINCT principal_id) FROM credit_entry WHERE bounty_id = ? "
                                "AND kind = 'hold'", (bounty_id,)).fetchone()[0]
    mine = conn.execute("SELECT coalesce(-sum(amount), 0) FROM credit_entry WHERE bounty_id = ? AND principal_id = ? "
                        "AND kind = 'hold'", (bounty_id, actor.id)).fetchone()[0]
    data['contributors'] = contributors
    data['my_stake'] = mine
    award_pred = visible_predicate(actor, 'ah')
    awards = conn.execute(
        'SELECT a.*, p.display_name FROM bounty_award a JOIN profile p ON p.principal_id = a.recipient_id '
        'WHERE a.bounty_id = :bounty AND (a.answer_id IS NULL OR EXISTS ('
        f'SELECT 1 FROM object_head ah WHERE ah.id = a.answer_id AND {award_pred.sql})) '
        'ORDER BY a.created_at, a.id', {'bounty': bounty_id, **award_pred.params}).fetchall()
    data['awards'] = [{'id': a['id'], 'mode': a['mode'], 'answer_id': a['answer_id'],
                       'submission_id': a['submission_id'] if owner or a['recipient_id'] == actor.id else None,
                       'recipient': {'id': a['recipient_id'], 'display_name': a['display_name']},
                       'share': a['share_pct'], 'credits': a['credits'], 'cosmetic_id': a['cosmetic_id'],
                       'created_at': a['created_at']} for a in awards]
    if row['kind'] == 'help':
        answer_pred = visible_predicate(actor, 'a')
        answers = conn.execute("SELECT a.id FROM object_head a WHERE a.root_id = :root AND a.lifecycle = 'active' "
                               f'AND {answer_pred.sql}', {**answer_pred.params, 'root': row['object_id']}).fetchall()
        data['useful'] = qualified_useful(conn, [a['id'] for a in answers], now)
    tasks = conn.execute('SELECT * FROM promo_task WHERE bounty_id = ? ORDER BY created_at, id', (bounty_id,)).fetchall()
    data['tasks'] = [{'id': t['id'], 'title': t['title'], 'kind': t['task_kind'], 'description': t['description'],
                      'credits_per': t['credits_per'], 'max_claims': t['max_claims'], 'cosmetic_id': t['cosmetic_id'],
                      'perk_note': t['perk_note'], 'accepted': _accepted(conn, t['id']),
                      'pending': conn.execute("SELECT count(*) FROM promo_submission WHERE task_id = ? AND status = "
                                              "'pending'", (t['id'],)).fetchone()[0]} for t in tasks]
    sub_sql = 'SELECT * FROM promo_submission WHERE bounty_id = ?' + ('' if owner else ' AND submitter_id = ?')
    subs = conn.execute(sub_sql + ' ORDER BY created_at, id', (bounty_id,) if owner else (bounty_id, actor.id)).fetchall()
    data['submissions'] = [{'id': s['id'], 'task_id': s['task_id'], 'submitter_id': s['submitter_id'],
                            'body': s['body'], 'evidence_object_id': s['evidence_object_id'], 'status': s['status'],
                            'reason_code': s['reason_code'], 'created_at': s['created_at']} for s in subs]
    promises = conn.execute('SELECT * FROM reward_promise WHERE bounty_id = ? AND (promiser_id = ? OR recipient_id = ?) '
                            'ORDER BY created_at', (bounty_id, actor.id, actor.id)).fetchall()
    data['promises'] = [promise_dto(p) for p in promises]
    return data


def promise_dto(p):
    return {'id': p['id'], 'bounty_id': p['bounty_id'], 'task_id': p['task_id'], 'promiser_id': p['promiser_id'],
            'recipient_id': p['recipient_id'], 'note': p['note'], 'status': p['status'],
            'reason_code': p['reason_code'], 'created_at': p['created_at'], 'responded_at': p['responded_at']}


def wallet(conn, actor, limit=100):
    season = season_id(conn)
    available, held = balances(conn, actor.id)
    pred = visible_predicate(actor, 'h')
    rows = conn.execute(
        'SELECT c.*, b.kind AS bounty_kind, b.object_id, '
        f'(SELECT v.title FROM object_head h JOIN object_version v ON v.object_id = h.id AND v.version = h.current_version '
        f'WHERE h.id = b.object_id AND {pred.sql}) AS object_title '
        'FROM credit_entry c LEFT JOIN bounty b ON b.id = c.bounty_id '
        'WHERE c.principal_id = :me AND c.season = :season ORDER BY c.created_at DESC, c.id DESC LIMIT :n',
        {**pred.params, 'me': actor.id, 'season': season, 'n': limit}).fetchall()
    flows = conn.execute('SELECT coalesce(sum(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0), '
                         'coalesce(sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) FROM credit_entry '
                         'WHERE principal_id = ? AND season = ?', (actor.id, season)).fetchone()
    promises = conn.execute("SELECT * FROM reward_promise WHERE (recipient_id = ? OR promiser_id = ?) "
                            "ORDER BY created_at DESC LIMIT 50", (actor.id, actor.id)).fetchall()
    return {
        'available': available, 'held': held, 'season': season,
        'season_in': flows[0], 'season_out': flows[1],
        'season_grant': logic.SEASON_GRANT if actor.level >= logic.SEASON_GRANT_MIN_LEVEL else 0,
        'cap': logic.cap(actor.level), 'concurrent_limit': logic.concurrent_limit(actor.level),
        'open_bounties': _open_count(conn, actor.id),
        'entries': [{
            'id': r['id'], 'kind': r['kind'], 'amount': r['amount'], 'held_delta': r['held_delta'],
            'source_type': r['source_type'], 'reason_code': r['reason_code'],
            'ledger_label': LEDGER_LABELS.get(r['reason_code']) if r['source_type'] == 'ledger' else None,
            'bounty': ({'id': r['bounty_id'], 'kind': r['bounty_kind'], 'title': r['object_title'],
                        'visible': r['object_title'] is not None} if r['bounty_id'] else None),
            'created_at': r['created_at'],
        } for r in rows],
        'promises': [promise_dto(p) for p in promises],
    }


def agent_open(conn, owner, skills, limit):
    """AGENT-1 的 'bounty.open' 供数：主人看得见的进行中悬赏，按技能关键词粗筛；开关关着返回空。
    标题等正文由 AGENT-1 再按成员内容规则裁剪，这里 public 一律 False（公开层归 OPEN-1 判断）。"""
    if not ready(conn) or not flags.enabled(conn, 'bounty.enabled'):
        return []
    promo_on = flags.enabled(conn, 'bounty.promo.enabled')
    now = clock.now()
    words = [w.strip().lower() for w in (skills or []) if isinstance(w, str) and w.strip()]
    limit = max(1, min(int(limit or 10), 50))
    items = []
    for row in list_rows(conn, owner, status='active', limit=200, now=now):
        d = dto(row, owner, now)
        if d['kind'] == 'promo' and not promo_on:
            continue
        text = ' '.join([d['object']['title'] or ''] + d['tags']).lower()
        if words and not any(w in text for w in words):
            continue
        items.append({'id': d['id'], 'kind': 'bounty', 'title': d['object']['title'], 'excerpt': None,
                      'author_id': d['owner']['id'], 'public': False, 'at': d['created_at'],
                      'url': f"#/bounties/{d['id']}",
                      'meta': {'bounty_kind': d['kind'], 'credits': d['credits'],
                               'remaining_seconds': d['remaining_seconds'], 'answer_count': d['answer_count']}})
        if len(items) >= limit:
            break
    return items


def export(conn, actor):
    if not ready(conn):
        return {}
    pid = actor.id
    q = lambda sql: [dict(r) for r in conn.execute(sql, (pid,)).fetchall()]  # noqa: E731
    return {
        'credit_entries': q('SELECT id, kind, amount, held_delta, bounty_id, source_type, source_ref, season, '
                            'reason_code, created_at FROM credit_entry WHERE principal_id = ? ORDER BY created_at'),
        'bounties': q('SELECT id, kind, object_id, status, credits, cosmetic_id, perk_note, deadline_at, settle_reason, '
                      'created_at FROM bounty WHERE owner_id = ? ORDER BY created_at'),
        'topups': q('SELECT id, bounty_id, amount, created_at FROM bounty_topup WHERE contributor_id = ? ORDER BY created_at'),
        'submissions': q('SELECT id, task_id, bounty_id, body, status, reason_code, created_at FROM promo_submission '
                         'WHERE submitter_id = ? ORDER BY created_at'),
        'awards_received': q('SELECT id, bounty_id, mode, credits, cosmetic_id, created_at FROM bounty_award '
                             'WHERE recipient_id = ? ORDER BY created_at'),
        'promises': [dict(r) for r in conn.execute(
            'SELECT id, bounty_id, note, status, created_at FROM reward_promise '
            'WHERE recipient_id = ? OR promiser_id = ? ORDER BY created_at', (pid, pid))],
    }
