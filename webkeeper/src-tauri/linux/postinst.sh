#!/bin/sh
# PacketSniffer .deb post-install script.
#
# Guarantees that the bundled Python backend is executable, whatever
# permissions the packaging step recorded for it.
set -e

find /usr/lib -maxdepth 3 -type f -name PacketSnifferBackend \
    -path '*/backend/PacketSnifferBackend' -exec chmod 755 {} + 2>/dev/null || true

exit 0
