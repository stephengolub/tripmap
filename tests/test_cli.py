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


def test_find_chrome_prefers_the_env_override(tmp_path, monkeypatch):
    fake = tmp_path / "chrome"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(0o755)
    monkeypatch.setenv("TRIPMAP_CHROME", str(fake))
    assert tm.find_chrome() == str(fake)


def test_find_chrome_rejects_a_bad_override(tmp_path, monkeypatch):
    monkeypatch.setenv("TRIPMAP_CHROME", str(tmp_path / "nope"))
    with pytest.raises(SystemExit) as exc:
        tm.find_chrome()
    assert "TRIPMAP_CHROME" in str(exc.value)


def test_find_chrome_falls_back_to_path(tmp_path, monkeypatch):
    monkeypatch.delenv("TRIPMAP_CHROME", raising=False)
    monkeypatch.setattr(tm, "CHROME_APP", str(tmp_path / "missing"))
    monkeypatch.setattr(tm.shutil, "which", lambda name: "/opt/x/chromium" if name == "chromium" else None)
    assert tm.find_chrome() == "/opt/x/chromium"


def test_find_chrome_reports_when_nothing_is_installed(tmp_path, monkeypatch):
    monkeypatch.delenv("TRIPMAP_CHROME", raising=False)
    monkeypatch.setattr(tm, "CHROME_APP", str(tmp_path / "missing"))
    monkeypatch.setattr(tm.shutil, "which", lambda name: None)
    with pytest.raises(SystemExit) as exc:
        tm.find_chrome()
    assert "TRIPMAP_CHROME" in str(exc.value)
