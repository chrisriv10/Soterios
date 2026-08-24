# Process Inspector helper protocol

Protocol version 1 is newline-delimited JSON over the helper's stdin/stdout. No TCP listener, permanent service, or shared machine-wide endpoint is created.

The helper writes one `hello` frame containing `protocolVersion`, `collectorVersion`, and capability flags. Requests contain `protocolVersion`, a bounded `requestId`, `method`, and `params`. Responses echo the request ID and contain either `ok: true, data` or `ok: false, error`.

Supported methods are `snapshot`, `details`, and `action`. Frames are limited to 8 MiB. The JavaScript client enforces handshake and request timeouts, rejects oversized responses and unsupported versions, verifies the packaged helper against `checksums.json`, and fails pending requests if the child exits. All process operations use `{ pid, startedAt }`; the helper revalidates the Windows creation time before details or actions.

Unavailable facts are represented by `null` plus capability flags or `capabilityErrors`. Zero is reserved for a measured zero.
