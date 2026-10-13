"""Streaming example (needs `opencode serve` on 127.0.0.1:4096)."""

from opencode_client import OpenCodeClient

with OpenCodeClient() as oc:
    sid = oc.create_session("stream-example")
    for delta in oc.ask_stream(sid, "Count to 5, one number per line."):
        print(delta, end="", flush=True)
    print()
