"""PyInstaller entry point for PacketSniffer backend."""

import multiprocessing
import sys
import os
import uvicorn


def main() -> int:
    multiprocessing.freeze_support()

    # Windowed PyInstaller builds may have no stdout/stderr.
    # Uvicorn requires valid streams during logging initialization.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")

    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    from main import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        log_level="info",
        access_log=False,
        workers=1,
        reload=False,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
