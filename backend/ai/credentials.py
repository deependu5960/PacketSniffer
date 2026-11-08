"""
Secure storage for the Gemini API key.

Windows : Windows Credential Manager (through ``keyring``).
Linux   : Secret Service (GNOME Keyring, KDE Wallet / ksecretd, KeePassXC...)
          through ``keyring``.

Some Linux setups have no Secret Service at all (minimal window managers,
containers, headless sessions) or have a keyring that cannot be unlocked.
In that case the key is kept in a private file (permissions 0600, inside a
0700 directory) in the user's PacketSniffer config folder, so saving the key
and using it later in chat still works instead of failing.

Every method here is BLOCKING (D-Bus calls, possibly an unlock prompt).
Call them from a worker thread, never directly from the event loop.
"""

import logging
import os
import tempfile
from pathlib import Path

import keyring
from keyring.errors import PasswordDeleteError

logger = logging.getLogger(__name__)

STORAGE_KEYRING = "system_keyring"
STORAGE_FILE = "local_file"


class CredentialStore:

    def __init__(self, service: str, username: str, fallback_file: Path):
        self.service = service
        self.username = username
        self.fallback_file = Path(fallback_file)

        # Where the key was last found / written:
        # "system_keyring", "local_file" or None.
        self.storage: str | None = None

    # -----------------------------------------
    # FALLBACK FILE HELPERS
    # -----------------------------------------

    def _read_file(self) -> str | None:

        try:
            value = self.fallback_file.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return None
        except OSError as exc:
            logger.warning("Could not read fallback credential file: %s", exc)
            return None

        return value or None

    def _write_file(self, value: str) -> None:

        directory = self.fallback_file.parent
        directory.mkdir(parents=True, exist_ok=True)

        if os.name != "nt":
            os.chmod(directory, 0o700)

        fd, temp_name = tempfile.mkstemp(
            dir=directory,
            prefix=".credential-",
        )

        try:
            # mkstemp already creates the file with mode 0600.
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(value)
                handle.flush()
                os.fsync(handle.fileno())

            os.replace(temp_name, self.fallback_file)

            if os.name != "nt":
                os.chmod(self.fallback_file, 0o600)

        except Exception:
            try:
                os.unlink(temp_name)
            except OSError:
                pass

            raise

    def _remove_file(self) -> None:

        try:
            self.fallback_file.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning(
                "Could not remove fallback credential file: %s", exc
            )

    # -----------------------------------------
    # PUBLIC API (blocking)
    # -----------------------------------------

    def get(self) -> str | None:
        """Return the stored API key, or None when nothing is stored."""

        try:
            value = keyring.get_password(self.service, self.username)

            if value:
                self.storage = STORAGE_KEYRING
                return value

        except Exception as exc:
            logger.warning(
                "System keyring unavailable (%s). Checking local file.",
                type(exc).__name__,
            )

        value = self._read_file()

        self.storage = STORAGE_FILE if value else None

        return value

    def set(self, value: str) -> str:
        """
        Store the API key and return where it was stored
        ("system_keyring" or "local_file").
        """

        try:
            keyring.set_password(self.service, self.username, value)

        except Exception as exc:
            logger.warning(
                "System keyring unavailable (%s). "
                "Storing the key in a private local file instead.",
                type(exc).__name__,
            )

            self._write_file(value)

            self.storage = STORAGE_FILE

            return STORAGE_FILE

        # The key now lives in the keyring: never leave a stale copy on disk.
        self._remove_file()

        self.storage = STORAGE_KEYRING

        return STORAGE_KEYRING

    def delete(self) -> None:
        """Remove the stored API key from every location."""

        try:
            keyring.delete_password(self.service, self.username)

        except PasswordDeleteError:
            # Nothing was stored in the keyring.
            pass

        except Exception as exc:
            logger.warning(
                "System keyring unavailable while deleting (%s).",
                type(exc).__name__,
            )

        self._remove_file()

        self.storage = None
