import sys

import pytest

import tripmap as tm


def test_help_exits_cleanly(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["tripmap", "--help"])
    with pytest.raises(SystemExit) as exc:
        tm.main()
    assert exc.value.code == 0
    assert "draft" in capsys.readouterr().out


def test_draft_requires_a_date_range(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["tripmap", "draft"])
    with pytest.raises(SystemExit) as exc:
        tm.main()
    assert exc.value.code == 2
