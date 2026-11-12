"""Read only managed workspace session metadata. Never return prompts or credentials."""
import datetime
import json
import math
import sqlite3
import subprocess
from collections import defaultdict


def number(value):
    return max(0, value) if isinstance(value, (float, int)) and math.isfinite(value) else 0


def timestamp(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 100000000000 else value
    try:
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError):
        return 0


def records(path):
    if path.suffix == '.zstd':
        # Optional system decoder: no dependency installation or remote state changes.
        result = subprocess.run(['zstd', '-dc', str(path)], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=20)
        lines = result.stdout.decode('utf-8').splitlines()
    else:
        lines = path.read_text(encoding='utf-8').splitlines()
    for line in lines:
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                yield value
        except ValueError:
            continue  # Includes the incomplete tail of a live session.


def gemini_messages(path):
    if path.suffix == '.json':
        return json.loads(path.read_text(encoding='utf-8')).get('messages', [])
    messages = {}
    for event in records(path):
        if '$rewindTo' in event:
            keys = list(messages)
            if event['$rewindTo'] in keys:
                messages = {key: messages[key] for key in keys[:keys.index(event['$rewindTo']) + 1]}
        elif isinstance(event.get('id'), str):
            messages[event['id']] = event
        else:
            checkpoint = event.get('$set', event)
            if isinstance(checkpoint.get('messages'), list):
                messages = {message['id']: message for message in checkpoint['messages'] if message.get('id')}
    return list(messages.values())


def collect(root):
    rows, warnings, seen = [], set(), set()

    def add(tool, key, when, model, usage, provider='', inclusive=False, cost=None):
        identity = (tool, str(key))
        if identity in seen:
            return
        seen.add(identity)
        fresh = number(usage.get('input', 0))
        cached = number(usage.get('cached', 0))
        write = number(usage.get('write', 0))
        output = number(usage.get('output', 0))
        if inclusive:
            fresh = max(0, fresh - cached)
        if not fresh + cached + write + output:
            return
        rows.append(dict(id=str(key), tool=tool, timestamp=timestamp(when),
                         model=str(model or 'unknown'), provider=str(provider or '会话日志'),
                         input=fresh, output=output, cached=cached, write=write,
                         cost=number(cost) if isinstance(cost, (float, int)) else None))

    for home in ('codex-home', 'codex-chatgpt-home'):
        for directory in ('sessions', 'archived_sessions'):
            for path in sorted((root / home / directory).rglob('*.jsonl')):
                try:
                    previous, model, provider, session, continuation = {}, '', '', path.stem, False
                    for event in records(path):
                        payload = event.get('payload') or {}
                        if event.get('type') == 'session_meta':
                            session = payload.get('id', session)
                            provider = payload.get('model_provider', '')
                            continuation = payload.get('history_mode') == 'paginated' or bool(payload.get('history_base')) or bool(payload.get('forked_from_id'))
                        if event.get('type') == 'turn_context':
                            model = payload.get('model', model)
                        if event.get('type') != 'event_msg' or payload.get('type') != 'token_count':
                            continue
                        info = payload.get('info') or {}
                        total, last = info.get('total_token_usage') or {}, info.get('last_token_usage')
                        if total and total == previous:
                            continue
                        if continuation and not previous and not isinstance(last, dict):
                            # A missing continuation baseline must not bill inherited history.
                            previous = total
                            warnings.add('部分 Codex 续写记录缺少单次用量，已跳过无法确认的历史基线')
                            continue
                        # A cumulative counter is never summed as a per-request value.
                        reset = any(number(total.get(key)) < number(previous.get(key)) for key in ('input_tokens', 'output_tokens'))
                        delta = last if isinstance(last, dict) else {
                            k: number(v) if reset else max(0, number(v) - number(previous.get(k))) for k, v in total.items()}
                        previous = total or previous
                        when = event.get('timestamp')
                        add('codex', (session, when, json.dumps(total or delta, sort_keys=True)), when, model,
                            dict(input=delta.get('input_tokens'), output=delta.get('output_tokens'),
                                 cached=delta.get('cached_input_tokens')), provider, True)
                except (OSError, ValueError, TypeError):
                    warnings.add('部分 Codex 会话无法读取')

    for home in ('claude-home', 'claude-official-home'):
        for path in (root / home / 'projects').rglob('*.jsonl'):
            try:
                # Streaming revisions share a message ID. Keep the final usage revision.
                messages = {}
                for event in records(path):
                    message = event.get('message') or {}
                    if event.get('type') == 'assistant' and message.get('usage'):
                        messages[message.get('id') or event.get('uuid')] = event
                for key, event in messages.items():
                    message = event['message']; usage = message['usage']
                    add('claude', key, event.get('timestamp'), message.get('model'),
                        dict(input=usage.get('input_tokens'), output=usage.get('output_tokens'),
                             cached=usage.get('cache_read_input_tokens'), write=usage.get('cache_creation_input_tokens')))
            except (OSError, ValueError, TypeError):
                warnings.add('部分 Claude Code 会话无法读取')

    for home in ('gemini-home', 'gemini-official-home'):
        for path in (root / home / '.gemini/tmp').glob('*/chats/session-*'):
            try:
                messages = gemini_messages(path)
                for message in messages:
                    tokens = message.get('tokens') or {}
                    if message.get('type') != 'gemini' or not tokens:
                        continue
                    add('gemini', message.get('id'), message.get('timestamp'), message.get('model'),
                        dict(input=tokens.get('input'), output=number(tokens.get('output')) + number(tokens.get('thoughts')),
                             cached=tokens.get('cached')), inclusive=True)
            except (OSError, ValueError, TypeError):
                warnings.add('部分 Gemini CLI 会话无法读取')

    for path in (root / 'harness-home/sessions').rglob('session*.jsonl*'):
        try:
            for event in records(path):
                if event.get('type') != 'assistant/message':
                    continue
                data = event.get('data') or {}; message = data.get('message') or {}
                usage = data.get('usage') or {}; source = message.get('source') or {}
                add('harness', message.get('id') or (path.parent.name, data.get('turn'), data.get('step')),
                    event.get('time'), source.get('model'),
                    dict(input=usage.get('inputTokens'), output=usage.get('outputTokens'),
                         cached=usage.get('cacheReadTokens'), write=usage.get('cacheWriteTokens')), source.get('provider'))
        except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
            warnings.add('部分 Harness 会话无法读取；压缩日志需要板卡安装 zstd')

    for home in ('opencode-home', 'opencode-official-home'):
        database = root / home / 'data/opencode/opencode.db'
        if not database.is_file():
            continue
        try:
            connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
            try:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                table = 'session_message' if 'session_message' in tables else 'message'
                for key, raw in connection.execute('SELECT id, data FROM ' + table):
                    message = json.loads(raw); tokens = message.get('tokens') or {}
                    if not (message.get('time') or {}).get('completed') or not tokens:
                        continue
                    cache = tokens.get('cache') or {}
                    add('opencode', key, message['time'].get('created'), message.get('modelID'),
                        dict(input=tokens.get('input'), output=number(tokens.get('output')) + number(tokens.get('reasoning')),
                             cached=cache.get('read'), write=cache.get('write')), message.get('providerID'), cost=message.get('cost'))
            finally:
                connection.close()
        except (sqlite3.Error, ValueError, TypeError):
            warnings.add('部分 OpenCode 会话无法读取')
    return rows, sorted(warnings)


def price_rows(rows, rates):
    for row in rows:
        recorded = row.get('cost')
        if isinstance(recorded, (int, float)) and math.isfinite(recorded) and recorded >= 0:
            row['cost_source'] = 'recorded'
            continue
        row.update(cost=None, cost_source='unknown')
        model, provider = row['model'], row['provider']
        normalized = model.rsplit('/', 1)[-1].rsplit(':', 1)[-1].lower()
        for suffix in ('-minimal', '-medium', '-xhigh', '-high', '-low'):
            if normalized.endswith(suffix):
                normalized = normalized[:-len(suffix)]
                break
        rate = next((r for r in rates if r.get('provider') == provider and r.get('model') == model), None)
        rate = rate or next((r for r in rates if r.get('provider') == '*' and r.get('model') == model), None)
        rate = rate or next((r for r in rates if r.get('provider') == '*' and r.get('model') == normalized), None)
        if rate is None or (provider == 'deepseek-account' and rate['provider'] == '*'):
            continue
        row.update(cost=sum(number(row.get(key)) * number(rate.get(key)) / 1000000
                            for key in ('input', 'output', 'cached', 'write')), cost_source='estimated')


def query(root, params):
    rows, warnings = collect(root)
    start, end = number(params.get('start')), number(params.get('end'))
    selected = [row for row in rows if start <= row['timestamp'] < end]
    options = {key: sorted({row[key] for row in selected}) for key in ('provider', 'model')}
    selected = [row for row in selected if all(not params.get(key) or row[key] == params[key]
                                              for key in ('tool', 'provider', 'model'))]
    price_rows(selected, params.get('rates') or [])
    totals = {key: sum(row[key] for row in selected) for key in ('input', 'output', 'cached', 'write')}
    known = [row['cost'] for row in selected if row['cost'] is not None]
    totals.update(requests=len(selected), cost=sum(known) if known or not selected else None, priced=len(known),
                  estimated=sum(row['cost_source'] == 'estimated' for row in selected),
                  recorded=sum(row['cost_source'] == 'recorded' for row in selected), unpriced=len(selected) - len(known))
    bucket = 3600 if end - start <= 86400 else 86400
    trend, groups = defaultdict(int), {}
    for row in selected:
        tokens = sum(row[key] for key in ('input', 'output', 'cached', 'write'))
        trend[int((row['timestamp'] - start) // bucket)] += tokens
        group = groups.setdefault((row['provider'], row['model']), dict(provider=row['provider'], model=row['model'], requests=0, tokens=0))
        group['requests'] += 1; group['tokens'] += tokens
    selected.sort(key=lambda row: row['timestamp'], reverse=True)
    page = max(0, int(number(params.get('page'))))
    return dict(totals=totals, options=options, trend=[dict(index=i, tokens=trend[i]) for i in range(math.ceil((end - start) / bucket))],
                groups=list(groups.values()), rows=selected[page * 50:(page + 1) * 50], warnings=warnings)
