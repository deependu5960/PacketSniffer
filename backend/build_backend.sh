#!/usr/bin/env bash
#
# Builds the PacketSniffer backend into a self-contained PyInstaller folder:
#   backend/dist/PacketSnifferBackend/PacketSnifferBackend
#
# The Tauri desktop app bundles that folder as its "backend/" resource.
#
# Usage (from anywhere):
#   pip install -r backend/requirements-build.txt
#   bash backend/build_backend.sh
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PYTHON="${PYTHON:-python3}"

rm -rf build dist ./*.spec

# Why the extra flags:
#  * uvicorn picks its event loop / HTTP / websocket implementation by NAME at
#    runtime, so PyInstaller cannot see those imports.
#  * keyring loads its backends (SecretService, kwallet, ...) by name and
#    discovers plugins through package metadata.
#  * Without them the frozen app would silently lose the keyring and the
#    faster uvloop / httptools stack.
"$PYTHON" -m PyInstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name PacketSnifferBackend \
    --paths . \
    --collect-submodules uvicorn \
    --collect-submodules keyring.backends \
    --collect-submodules secretstorage \
    --collect-submodules jeepney \
    --copy-metadata keyring \
    --copy-metadata SecretStorage \
    --copy-metadata jeepney \
    --hidden-import uvloop \
    --hidden-import httptools \
    --hidden-import websockets \
    --hidden-import wsproto \
    --hidden-import brotli \
    --hidden-import zstandard \
    --exclude-module tkinter \
    packetsniffer_entry.py

BINARY="dist/PacketSnifferBackend/PacketSnifferBackend"

if [ ! -x "$BINARY" ]; then
    echo "ERROR: build finished but $BINARY was not produced." >&2
    exit 1
fi

echo "Backend built: $(pwd)/$BINARY"
