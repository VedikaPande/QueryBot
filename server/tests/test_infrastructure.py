"""
Tests for rate limiting, cache degradation and the API documentation.
"""
import pytest

from app.utils import cache


class TestRateLimiting:
    def test_the_analysis_endpoint_is_limited(self, app):
        """The expensive endpoint must carry a tighter limit than the default."""
        assert app.config['RATELIMIT_ANALYSIS'] != app.config.get('RATELIMIT_QUERY')
        assert 'per minute' in app.config['RATELIMIT_ANALYSIS']

    def test_exceeding_the_limit_returns_429_with_the_shared_envelope(
        self, app, client, sign_in, user, dataset, stub_agent
    ):
        app.config['RATELIMIT_ANALYSIS'] = '2 per minute'
        sign_in(user.email)

        payload = {'question': 'How many rows?', 'databaseUuid': str(dataset.external_uuid)}
        statuses = [
            client.post('/api/langgraph/run', json=payload).status_code for _ in range(5)
        ]

        assert 429 in statuses, f'the limit was never enforced: {statuses}'

        response = client.post('/api/langgraph/run', json=payload)
        body = response.get_json()
        assert body['success'] is False
        assert 'too quickly' in body['message']

    def test_the_limit_is_per_user_not_per_process(
        self, app, client, sign_in, user, other_user, dataset, stub_agent
    ):
        """One user exhausting their allowance must not lock everyone else out."""
        app.config['RATELIMIT_ANALYSIS'] = '1 per minute'

        sign_in(user.email)
        payload = {'question': 'First', 'databaseUuid': str(dataset.external_uuid)}
        client.post('/api/langgraph/run', json=payload)
        assert client.post('/api/langgraph/run', json=payload).status_code == 429

        # A different user starts with a fresh allowance. They do not own this
        # dataset, so a 404 proves the limiter let the request through.
        client.post('/api/auth/logout')
        sign_in(other_user.email)
        assert client.post('/api/langgraph/run', json=payload).status_code == 404

    def test_health_endpoints_are_exempt(self, app, client):
        """Probes fire constantly and must never be throttled."""
        app.config['RATELIMIT_ANALYSIS'] = '1 per minute'
        for _ in range(30):
            assert client.get('/api/langgraph/health').status_code == 200


class TestCacheDegradation:
    def test_reads_and_writes_are_no_ops_without_redis(self, app):
        """
        A cache outage should slow the app down, not break it. Every helper is
        expected to swallow the failure rather than propagate it.
        """
        with app.app_context():
            assert cache.get_client() is None
            assert cache.get_json('querybot:missing') is None

            # None of these may raise.
            cache.set_json('querybot:k', {'a': 1}, ttl=60)
            cache.delete('querybot:k')
            cache.delete_prefix('querybot:')

    def test_the_producer_still_runs_when_the_cache_is_unavailable(self, app):
        calls = []

        with app.app_context():
            for _ in range(3):
                value = cache.cached_json('querybot:x', 60, lambda: calls.append(1) or 'computed')
                assert value == 'computed'

        # Without a cache every call recomputes, which is the correct fallback.
        assert len(calls) == 3

    @pytest.mark.parametrize(
        'parts,expected',
        [
            (('dataset', 'abc', 'schema'), 'querybot:dataset:abc:schema'),
            (('a',), 'querybot:a'),
        ],
    )
    def test_keys_are_namespaced(self, parts, expected):
        assert cache.build_key(*parts) == expected

    def test_long_components_are_hashed_to_bound_key_length(self):
        """A raw SQL statement as a key component would be unbounded."""
        key = cache.build_key('query', 'SELECT ' + 'x' * 500)
        assert len(key) < 100
        assert 'xxxxx' not in key


class TestApiDocumentation:
    def test_the_openapi_document_is_served(self, client):
        response = client.get('/api/openapi.yaml')
        assert response.status_code == 200
        assert b'openapi: 3.1.0' in response.data

    def test_the_specification_covers_the_real_routes(self, app):
        yaml = pytest.importorskip('yaml')

        spec_path = __import__('pathlib').Path(app.root_path) / 'static' / 'openapi.yaml'
        spec = yaml.safe_load(spec_path.read_text(encoding='utf-8'))

        documented = set(spec['paths'])
        # Guards against the specification drifting away from the application.
        for path in ('/auth/login', '/datasets', '/langgraph/run', '/conversations'):
            assert path in documented, f'{path} is missing from the OpenAPI document'
