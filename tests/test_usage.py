"""Usage import fixtures use temporary managed homes, never real account data."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from workbench import usage


class UsageTests(unittest.TestCase):
    def test_costs_use_configured_prices_and_total_all_pages(self):
        self.write('claude-home/projects/test/session.jsonl', [
            dict(type='assistant', timestamp=1794358800000 + index,
                 message=dict(id=str(index), model='test', usage=dict(input_tokens=1000000, output_tokens=1000000, cache_read_input_tokens=1000000)))
            for index in range(61)])
        rates = [dict(provider='*', model='test', input=2, output=10, cached=0.1, write=0)]
        result = usage.query(self.root, dict(self.params, rates=rates))
        self.assertAlmostEqual(result['totals']['cost'], 61 * 12.1)
        self.assertEqual(result['totals']['estimated'], 61)
        self.assertEqual(result['totals']['unpriced'], 0)
        self.assertEqual(len(result['rows']), 50)
        second = usage.query(self.root, dict(self.params, rates=rates, page=1))
        self.assertEqual(second['totals'], result['totals'])
        rates.append(dict(provider='会话日志', model='test', input=1, output=1, cached=0, write=0))
        discounted = usage.query(self.root, dict(self.params, rates=rates))
        self.assertAlmostEqual(discounted['totals']['cost'], 122)

    def test_account_routes_and_unknown_models_remain_unpriced(self):
        rows = [dict(provider='deepseek-account', model='deepseek-flash', input=1000000, output=0, cached=0, write=0, cost=None),
                dict(provider='api', model='unknown', input=10, output=0, cached=0, write=0, cost=None),
                dict(provider='api', model='unknown', cost=0.03)]
        usage.price_rows(rows, [dict(provider='*', model='deepseek-flash', input=1, output=2, cached=0, write=0)])
        self.assertIsNone(rows[0]['cost'])
        self.assertIsNone(rows[1]['cost'])
        self.assertEqual(rows[2]['cost'], 0.03)
        self.assertEqual(rows[2]['cost_source'], 'recorded')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.params = dict(start=1794355200, end=1794441600)  # 2026-11-11 UTC

    def write(self, name, events):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('\n'.join(json.dumps(event) for event in events), encoding='utf-8')
        return path

    def token(self, total, last=None, when='2026-11-11T01:00:00Z'):
        info = dict(total_token_usage=total)
        if last is not None:
            info['last_token_usage'] = last
        return dict(type='event_msg', timestamp=when, payload=dict(type='token_count', info=info))

    def test_codex_deltas_duplicate_events_and_archive_copies(self):
        first = dict(input_tokens=100, cached_input_tokens=80, output_tokens=10)
        second = dict(input_tokens=160, cached_input_tokens=120, output_tokens=30)
        events = [dict(type='session_meta', payload=dict(id='session', model_provider='custom')),
                  dict(type='turn_context', payload=dict(model='gpt-test')),
                  self.token(first), self.token(first, when='2026-11-11T01:00:01Z'),
                  self.token(second, when='2026-11-11T02:00:00Z')]
        path = self.write('codex-home/sessions/rollout.jsonl', events)
        path.write_text(path.read_text() + '\n{"incomplete":', encoding='utf-8')
        self.write('codex-home/archived_sessions/copy.jsonl', events)
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['requests'], 2)
        self.assertEqual(result['totals']['input'], 40)
        self.assertEqual(result['totals']['cached'], 120)
        self.assertEqual(result['totals']['output'], 30)
        self.assertIsNone(result['totals']['cost'])
        self.assertEqual(result['groups'][0]['tokens'], 190)

    def test_codex_last_usage_keeps_baseline_across_model_changes(self):
        self.write('codex-chatgpt-home/sessions/test.jsonl', [
            self.token(dict(input_tokens=1000, output_tokens=300), dict(input_tokens=100, output_tokens=30)),
            dict(type='turn_context', payload=dict(model='new-model')),
            self.token(dict(input_tokens=1100, output_tokens=350), when='2026-11-11T03:00:00Z')])
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['input'], 200)
        self.assertEqual(result['totals']['output'], 80)

    def test_claude_streaming_revision_and_no_prompt_or_secret_returned(self):
        events = [dict(type='assistant', timestamp='2026-11-11T03:00:00Z',
                       message=dict(id='msg1', model='claude-test', content='private prompt',
                                    usage=dict(input_tokens=10, output_tokens=output, cache_read_input_tokens=100,
                                               cache_creation_input_tokens=5))) for output in (1, 20)]
        self.write('claude-home/projects/project/session.jsonl', events)
        self.write('claude-home/credentials.json', [dict(token='private secret')])
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['requests'], 1)
        self.assertEqual(result['totals']['input'], 10)
        self.assertEqual(result['totals']['output'], 20)
        self.assertEqual(result['totals']['write'], 5)
        self.assertNotIn('private', json.dumps(result))

    def test_codex_reset_and_missing_continuation_baseline(self):
        self.write('codex-home/sessions/continued.jsonl', [
            dict(type='session_meta', payload=dict(id='continued', history_mode='paginated')),
            self.token(dict(input_tokens=10000, output_tokens=1000)),
            self.token(dict(input_tokens=10100, output_tokens=1010), when='2026-11-11T02:00:00Z'),
            self.token(dict(input_tokens=20, output_tokens=5), when='2026-11-11T03:00:00Z')])
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['input'], 120)
        self.assertEqual(result['totals']['output'], 15)
        self.assertTrue(result['warnings'])

    def test_gemini_jsonl_revisions_checkpoint_and_rewind(self):
        def message(key, output):
            return dict(id=key, type='gemini', model='gemini', timestamp='2026-11-11T01:00:00Z',
                        tokens=dict(input=10, output=output, cached=2))
        self.write('gemini-home/.gemini/tmp/project/chats/session-log.jsonl', [
            dict(sessionId='g', messages=[message('old', 200)]),
            {'$set': dict(messages=[message('new', 1)])},
            message('new', 10), message('discarded', 500), {'$rewindTo': 'new'}])
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['requests'], 1)
        self.assertEqual(result['totals']['output'], 10)

    def test_harness_and_gemini_cache_semantics(self):
        self.write('harness-home/sessions/project/session/session.v4.jsonl', [
            dict(type='assistant/message', time=1794358800000, data=dict(
                message=dict(id='h1', source=dict(model='deepseek', provider='deepseek-account')),
                usage=dict(inputTokens=20, outputTokens=5, cacheReadTokens=100, cacheWriteTokens=2)))])
        path = self.root / 'gemini-home/.gemini/tmp/project/chats/session-1.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(dict(messages=[dict(type='gemini', id='g1', model='gemini',
            timestamp='2026-11-11T01:00:00Z', tokens=dict(input=120, output=5, thoughts=3, cached=100))])))
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['input'], 40)
        self.assertEqual(result['totals']['output'], 13)
        self.assertEqual(result['totals']['cached'], 200)
        filtered = usage.query(self.root, dict(self.params, provider='deepseek-account'))
        self.assertEqual(filtered['totals']['requests'], 1)
        self.assertEqual(filtered['rows'][0]['tool'], 'harness')

    def test_opencode_database_readonly_cost_and_completed_messages(self):
        database = self.root / 'opencode-home/data/opencode/opencode.db'
        database.parent.mkdir(parents=True)
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('CREATE TABLE message (id TEXT, data TEXT)')
            for key, completed in [('done', 1794358800000), ('pending', None)]:
                message = dict(role='assistant', modelID='test', providerID='edge-workbench', cost=0.03,
                               time=dict(created=1794358800000, completed=completed),
                               tokens=dict(input=4, output=2, reasoning=1, cache=dict(read=10, write=1)))
                connection.execute('INSERT INTO message VALUES (?, ?)', (key, json.dumps(message)))
            connection.commit()
        before = database.read_bytes()
        result = usage.query(self.root, self.params)
        self.assertEqual(result['totals']['requests'], 1)
        self.assertEqual(result['totals']['cost'], 0.03)
        self.assertEqual(before, database.read_bytes())

    def test_date_filter_pagination_groups_and_empty_results(self):
        self.write('claude-home/projects/test/session.jsonl', [
            dict(type='assistant', timestamp=1794358800 + index,
                 message=dict(id=str(index), model='test', usage=dict(input_tokens=10, output_tokens=2)))
            for index in range(61)])
        first = usage.query(self.root, self.params)
        second = usage.query(self.root, dict(self.params, page=1))
        self.assertEqual(first['totals']['requests'], 61)
        self.assertEqual(len(first['rows']), 50)
        self.assertEqual(len(second['rows']), 11)
        self.assertEqual(first['groups'][0]['requests'], 61)
        self.assertEqual(sum(item['tokens'] for item in first['trend']), 732)
        empty = usage.query(self.root, dict(self.params, model='missing'))
        self.assertEqual(empty['totals']['requests'], 0)
        self.assertEqual(empty['rows'], [])


if __name__ == '__main__':
    unittest.main()
