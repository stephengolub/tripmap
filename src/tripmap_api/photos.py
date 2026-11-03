"""Photos access check. Reads a temp copy of the library database, as `load_photos` does,
and reports only a count: no coordinates, no photo paths."""
import shutil
import sqlite3
import tempfile
from pathlib import Path

import tripmap

FDA_MESSAGE = ("macOS blocked reading the Photos library. Grant Full Disk Access to the app "
               "running the server (your terminal, or whatever launched tripmap-api) in "
               "System Settings > Privacy & Security > Full Disk Access, then restart it.")

COUNT_SQL = """
    SELECT COUNT(*) FROM ZASSET
    WHERE ZTRASHEDSTATE = 0 AND ZLATITUDE IS NOT NULL AND ZLONGITUDE IS NOT NULL
      AND ZLATITUDE BETWEEN -90 AND 90 AND ZLONGITUDE BETWEEN -180 AND 180
      AND NOT (ZLATITUDE = 0 AND ZLONGITUDE = 0)"""


def photos_status(library=None):
    """The `/api/photos/status` body as a dict. `library` defaults to `tripmap.LIBRARY`."""
    library = Path(library or tripmap.LIBRARY)
    db = library / "database" / "Photos.sqlite"

    def fail(reason, message):
        return {"ok": False, "library": str(library), "reason": reason, "message": message}

    tmp = Path(tempfile.mkdtemp(prefix="tripmap-status-"))
    try:
        if not db.is_file():
            return fail("not_found", f"No Photos library at {library} (missing database/Photos.sqlite).")
        for suf in ("", "-wal", "-shm"):
            src = Path(str(db) + suf)
            if src.exists():
                shutil.copy2(src, tmp / ("Photos.sqlite" + suf))
        con = sqlite3.connect(tmp / "Photos.sqlite")
        try:
            (count,) = con.execute(COUNT_SQL).fetchone()
        finally:
            con.close()
        return {"ok": True, "library": str(library), "geotagged_assets": count}
    except PermissionError:
        return fail("permission_denied", FDA_MESSAGE)
    except FileNotFoundError:
        return fail("not_found", f"No Photos library at {library} (missing database/Photos.sqlite).")
    except sqlite3.Error as e:
        return fail("unreadable", f"The Photos database copy could not be read ({type(e).__name__}).")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
