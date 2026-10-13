import unittest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
CONTRACT = '0x' + '1' * 40
SPENDER = '2' * 40
OWNER = '0x' + '3' * 40


def review(selector, amount, **extra):
    tx = {'to': CONTRACT, 'from': OWNER, 'data': selector + SPENDER.zfill(64) + hex(amount)[2:].zfill(64), **extra}
    return client.post('/api/simulate', json={'transaction': tx, 'chain_id': 1})


class ApiTests(unittest.TestCase):
    def test_workspace_and_health_are_served(self):
        self.assertEqual(client.get('/').status_code, 200)
        self.assertEqual(client.get('/api/health').json()['status'], 'active')

    def test_trusted_hosts_and_subdomains(self):
        for url in ['https://opensea.io', 'https://www.opensea.io', 'https://opensea.io/?redirect=malicious', 'https://example.com/?next=metamask.io']:
            with self.subTest(url=url):
                result = client.post('/api/analyze-url', json={'url': url}).json()
                self.assertFalse(result['is_phishing'])

    def test_trusted_domain_in_attacker_hostname_cannot_bypass_check(self):
        for url in ['https://opensea.io.example.com', 'https://fake-opensea.io', 'https://metamask-login.example', 'https://opensea.io@evil.example', 'https://drainer.example']:
            with self.subTest(url=url):
                result = client.post('/api/analyze-url', json={'url': url}).json()
                self.assertTrue(result['is_phishing'])
                self.assertGreaterEqual(result['risk_score'], 80)

    def test_bad_url_rejected(self):
        for url in ['javascript:alert(1)', 'not a URL', 'https://', 'https://example.com:bad']:
            self.assertEqual(client.post('/api/analyze-url', json={'url': url}).status_code, 422)

    def test_http_and_punycode_require_review(self):
        for url in ['http://example.com', 'https://xn--example-9db.com']:
            self.assertGreaterEqual(client.post('/api/analyze-url', json={'url': url}).json()['risk_score'], 30)

    def test_unlimited_allowance_decoded(self):
        response = review('0x095ea7b3', 2**256 - 1)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['status'], 'critical')
        self.assertEqual(result['approval']['spender'], '0x' + SPENDER)
        self.assertEqual(result['approval']['amount'], str(2**256 - 1))
        self.assertEqual(result['asset_changes'], [])

    def test_finite_approval_requires_review(self):
        result = review('0x095ea7b3', 123).json()
        self.assertEqual(result['status'], 'warning')
        self.assertEqual(result['approval']['amount'], '123')

    def test_erc721_token_id_zero_is_not_silently_treated_as_safe_revocation(self):
        result = review('0x095ea7b3', 0).json()
        self.assertEqual(result['status'], 'warning')
        self.assertIn('ERC-721', result['summary'])

    def test_collection_grant_and_revoke_are_different(self):
        self.assertEqual(review('0xa22cb465', 1).json()['status'], 'critical')
        revoke = review('0xa22cb465', 0).json()
        self.assertEqual(revoke['status'], 'low')
        self.assertTrue(revoke['approval']['is_revocation'])
        self.assertEqual(review('0xa22cb465', 2).status_code, 422)

    def test_approval_payment_is_flagged(self):
        self.assertEqual(review('0x095ea7b3', 0, value='0x1').json()['status'], 'critical')

    def test_invalid_transactions_rejected(self):
        for tx in [{'to': 'not-an-address'}, {'to': CONTRACT, 'data': '0x095ea7b3'}, {'to': CONTRACT, 'data': '0xz'}, {'to': CONTRACT, 'value': '-1'}, {'to': CONTRACT, 'value': True}]:
            self.assertEqual(client.post('/api/simulate', json={'transaction': tx}).status_code, 422)

    def test_unknown_contract_call_never_claims_safe_or_fake_balance_changes(self):
        result = client.post('/api/simulate', json={'transaction': {'to': CONTRACT, 'data': '0xdeadbeef'}}).json()
        self.assertEqual(result['status'], 'warning')
        self.assertEqual(result['asset_changes'], [])

    def test_signature_requires_review(self):
        for method in ['personal_sign', 'eth_sign', 'eth_signTypedData_v4']:
            result = client.post('/api/simulate', json={'transaction': {}, 'method': method}).json()
            self.assertEqual(result['status'], 'warning')


if __name__ == '__main__':
    unittest.main()
