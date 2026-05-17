# Security note — IndexNow key rotation (2026-05-17)

A Bing IndexNow site-ownership key file (`.indexnow_key`) was committed to this
public repository on 2026-05-15 and remained visible until 2026-05-17.

## Impact

The key proved ownership of the `faultkey.com` apex to the IndexNow protocol.
Anyone who pulled the key could:

1. Verify that `https://faultkey.com/<key>.txt` returned `200`, confirming
   `faultkey.com` was live and accepting IndexNow pings.
2. **Not** submit URLs for `faultkey.com` to IndexNow — IndexNow requires a POST
   from a server that controls the apex DNS, and the key alone is insufficient.
3. **Not** read or modify any user data — `faultkey.com` does not store user data.

The exposure is therefore: site-existence confirmation + a pivot for an unrelated
third party to fingerprint the live MCP demo (`mcp.faultkey.com`). No credential
to any production system was exposed.

## Remediation

1. The key has been deleted from `main` (this commit) and `.indexnow_key` has been
   added to `.gitignore`.
2. The key remains in git history. Anyone who cloned before 2026-05-17 still has
   it.
3. A fresh IndexNow key has been generated for `faultkey.com` and re-deployed to
   the landing site (separate change in the `faultkey-landing` repo). The old
   key file at `/1aed1f8d5b7166d45807cc48c9f9b55d0bcc03b0332571951ae2825b9510a9ec.txt`
   is now dead from the IndexNow protocol's perspective.

## Reproducing the Cloudflare evidence

The exposure was identified by analysing 24 hours of `httpRequestsAdaptiveGroups`
data on the `faultkey.com` zone. An Ecuadorian IP `45.71.252.6` requested the
exact key file path on 2026-05-17 00:52 UTC, immediately after running an
MCP-client-fingerprinting battery against `mcp.faultkey.com`. See
`/home/ubuntu/delivery/faultkey-traffic-forensic-attribution-2026-05-17.pdf`
in the operator's records.
