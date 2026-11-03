"""The API entry point binds to loopback only."""
import ast
from pathlib import Path

import tripmap_api.__main__ as entry


def test_main_binds_loopback_only():
    tree = ast.parse(Path(entry.__file__).read_text())
    hosts = [kw.value.value for node in ast.walk(tree) if isinstance(node, ast.Call)
             for kw in node.keywords if kw.arg == "host"]
    assert hosts == ["127.0.0.1"]


def test_main_passes_port(monkeypatch):
    seen = {}
    monkeypatch.setattr(entry.uvicorn, "run", lambda app, **kw: seen.update(kw))
    entry.main(["--port", "8123"])
    assert seen == {"host": "127.0.0.1", "port": 8123}
