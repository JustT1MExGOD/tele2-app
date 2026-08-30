# Test-only TLS fixture

`test-key.pem`/`test-cert.pem` — a self-signed keypair for `CN=localhost`
(SAN: `localhost`, `127.0.0.1`), generated once via `openssl req -x509`,
valid 10 years. Used **only** to run local, ephemeral HTTPS test servers
in `tests/helpers/local-https-server.ts` — never a real host, never
anything reachable outside the test process, never trusted by any
production code path (production code always validates against the real
system CA trust store; only the test harness explicitly points at this
fixture's CA for the specific local servers it starts).

The private key being checked into the repo is intentional and safe: it
secures nothing except a loopback-only test server that exists for the
duration of one test run. Regenerate any time with:

```
openssl req -x509 -newkey rsa:2048 -keyout test-key.pem -out test-cert.pem \
  -days 3650 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
