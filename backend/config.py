from pathlib import Path
from platformdirs import user_data_path

import sys as _sys
import sqlite3 as _sqlite3

# ==========================================
# APPLICATION
# ==========================================

APP_NAME = "PacketSniffer"

APP_DATA_DIR = user_data_path(
    APP_NAME,
    appauthor=False,
)
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)


# ==========================================
# CERTIFICATE STORAGE
# ==========================================

CERT_DIR = APP_DATA_DIR / "certificates"
CERT_DIR.mkdir(parents=True, exist_ok=True)


# ==========================================
# DATABASE STORAGE
# ==========================================

# Persistent, per-user, survives updates and reinstalls.
DATA_DIR = APP_DATA_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH = DATA_DIR / "packetsniff.db"

# Backwards-compatible alias
DB_PATH = DATABASE_PATH

# Kept for any code that imports BASE_DIR; no longer used for data.
BASE_DIR = Path(__file__).resolve().parent


# ==========================================
# PROXY CONFIGURATION
# ==========================================

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 8080

MAX_CONNECTIONS = 100
MAX_HEADER_SIZE = 65536

# Maximum captured HTTP request/response body: 10 MiB
MAX_BODY_SIZE = 10 * 1024 * 1024


# ==========================================
# API CONFIGURATION
# ==========================================

API_HOST = "127.0.0.1"
API_PORT = 8765


# ==========================================
# SAFETY ASSERTIONS
# ==========================================
#
# PacketSniffer must NEVER read a database bundled with the application.
# Each installation creates its own empty database in the per-user data
# directory. These assertions fail loudly if that invariant is violated.


_assert_db_path = str(DATABASE_PATH.resolve())
_assert_expected_root = str(APP_DATA_DIR.resolve())

if not _assert_db_path.startswith(_assert_expected_root):
    raise RuntimeError(
        "PacketSniffer refused to start: DATABASE_PATH is not inside "
        "APP_DATA_DIR.\n"
        f"  DATABASE_PATH  = {_assert_db_path}\n"
        f"  APP_DATA_DIR   = {_assert_expected_root}\n"
        "A bundled packetsniff.db was likely shipped in the installation "
        "folder. Never ship user data with the installer."
    )

if DATABASE_PATH.exists() and DATABASE_PATH.stat().st_size > 0:
    try:
        _conn = _sqlite3.connect(DATABASE_PATH)
        _tables = {
            row[0]
            for row in _conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        _conn.close()
    except Exception as _exc:
        raise RuntimeError(
            f"PacketSniffer refused to start: existing database at "
            f"{_assert_db_path} is not a valid SQLite file ({_exc!r})."
        ) from _exc

    _expected_table_candidates = {
        "traffic", "requests", "packets", "flows", "captured_traffic",
        "traffic_records", "http_traffic",
    }
    if _tables and not (_tables & _expected_table_candidates):
        raise RuntimeError(
            "PacketSniffer refused to start: database at "
            f"{_assert_db_path} contains unexpected tables "
            f"({sorted(_tables)!r}). This may be a bundled or "
            "foreign database."
        )