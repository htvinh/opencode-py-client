"""Minimal ask example (needs `opencode serve` on 127.0.0.1:4096)."""

from opencode_py_client import OpenCodeClient

with OpenCodeClient() as oc:
    sid = oc.create_session("example")
    print("session:", sid)
    resp = oc.ask(sid, "Reply with exactly: hello-probe-ok")
    print("assistant:", resp.text)
