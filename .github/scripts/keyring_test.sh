#!/usr/bin/env bash
#
# Runs the backend smoke test against a REAL Secret Service (gnome-keyring)
# inside a private, throw-away D-Bus session.
#
# Usage: keyring_test.sh <path-to-PacketSnifferBackend>
#
set -euo pipefail

BINARY="${1:?usage: keyring_test.sh <backend binary>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec dbus-run-session -- bash -c '
  set -euo pipefail

  # Create and unlock the default ("login") keyring without any prompt.
  echo -n "ci-keyring-password" | gnome-keyring-daemon --unlock --components=secrets > /dev/null

  # Prove the Secret Service really answers before testing PacketSniffer.
  echo -n "probe-value" | secret-tool store --label="ci probe" service ci-probe
  test "$(secret-tool lookup service ci-probe)" = "probe-value"
  echo "Secret Service is working in this CI session."

  python3 "$0" --binary "$1" --mode keyring
' "$SCRIPT_DIR/smoke_backend.py" "$BINARY"
