import asyncio
import json
from pathlib import Path
from asyncio import Lock

from platformdirs import user_config_path
from google import genai
from google.genai import types

from ai.credentials import CredentialStore
from ai.gemini import generate_response


APP_NAME = "PacketSniffer"
KEYRING_SERVICE = "PacketSniffer.Gemini"
KEYRING_USERNAME = "gemini_api_key"
DEFAULT_MODEL = "gemini-3.5-flash-lite"

# On Linux a locked keyring can show an unlock prompt. The backend must not
# hold up its own startup (the desktop shell gives it 30 seconds) while the
# user types a password, so the key is loaded in the background if the
# credential store is slow to answer.
KEYRING_STARTUP_TIMEOUT = 10.0


class AIManager:

    def __init__(self):
        self.config_dir = Path(
            user_config_path(APP_NAME, APP_NAME)
        )

        self.config_file = self.config_dir / "ai.json"

        self.credentials = CredentialStore(
            service=KEYRING_SERVICE,
            username=KEYRING_USERNAME,
            fallback_file=self.config_dir / "gemini_api_key.secret",
        )

        self.client = None
        self.model = DEFAULT_MODEL
        self.api_key_configured = False

        self.lock = Lock()

        # Incremented whenever the user changes settings, so a slow
        # background key lookup can never overwrite newer settings.
        self._settings_version = 0
        self._pending_lookup = None

    # -----------------------------------------
    # LOAD MODEL CONFIGURATION
    # -----------------------------------------

    def _load_model(self):

        if not self.config_file.exists():
            return

        try:
            data = json.loads(
                self.config_file.read_text(
                    encoding="utf-8"
                )
            )

            model = data.get("model")

            if isinstance(model, str) and model.strip():
                self.model = model.strip()

        except (OSError, ValueError, TypeError):
            self.model = DEFAULT_MODEL

    # -----------------------------------------
    # SAVE MODEL CONFIGURATION
    # -----------------------------------------

    def _save_model(self, model: str):

        self.config_dir.mkdir(
            parents=True,
            exist_ok=True
        )

        temporary_file = self.config_file.with_suffix(".tmp")

        temporary_file.write_text(
            json.dumps(
                {"model": model},
                indent=2
            ),
            encoding="utf-8"
        )

        temporary_file.replace(self.config_file)

    # -----------------------------------------
    # CREDENTIAL STORE ACCESS (OFF THE EVENT LOOP)
    #
    # Windows: Credential Manager
    # Linux:   Secret Service keyring, or a private 0600 file
    #          when no keyring is available
    # -----------------------------------------

    async def _get_key(self):

        return await asyncio.to_thread(self.credentials.get)

    # -----------------------------------------
    # CREATE GEMINI CLIENT
    # -----------------------------------------

    @staticmethod
    def _create_client(api_key: str):

        return genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=45000
            )
        ).aio

    # -----------------------------------------
    # INITIALIZE AI
    # -----------------------------------------

    def _apply_loaded_key(self, api_key: str | None):

        if api_key:

            self.client = self._create_client(api_key)

            self.api_key_configured = True

            print("[AI] Gemini configuration loaded.")

        else:

            self.client = None

            self.api_key_configured = False

            print("[AI] Gemini API key not configured.")

    async def _finish_key_lookup(self, lookup, version: int):

        try:
            api_key = await lookup

        except asyncio.CancelledError:
            raise

        except Exception as exc:
            print(f"[AI] Credential store lookup failed: {exc!r}")
            return

        async with self.lock:

            # The user changed settings while we were waiting.
            if version != self._settings_version or self.client is not None:
                return

            if api_key:
                self._apply_loaded_key(api_key)

    async def initialize(self):

        self._load_model()

        lookup = asyncio.ensure_future(
            asyncio.to_thread(self.credentials.get)
        )

        try:
            api_key = await asyncio.wait_for(
                asyncio.shield(lookup),
                timeout=KEYRING_STARTUP_TIMEOUT,
            )

        except asyncio.TimeoutError:

            print(
                "[AI] Credential store is still waiting (it may be locked). "
                "Continuing startup; the API key will load once available."
            )

            self._pending_lookup = asyncio.ensure_future(
                self._finish_key_lookup(lookup, self._settings_version)
            )

            return

        except Exception as exc:

            print(f"[AI] Credential store lookup failed: {exc!r}")

            api_key = None

        self._apply_loaded_key(api_key)

    # -----------------------------------------
    # UPDATE USER SETTINGS
    # -----------------------------------------

    async def update_settings(
        self,
        api_key: str | None,
        model: str,
        clear_api_key: bool = False
    ):

        async with self.lock:

            model = model.strip()

            if not model:
                raise ValueError(
                    "Model name cannot be empty."
                )

            self._settings_version += 1

            # USER WANTS TO REMOVE API KEY
            if clear_api_key:

                await asyncio.to_thread(self.credentials.delete)

                new_key = None

            # USER ENTERED A NEW API KEY
            elif api_key and api_key.strip():

                new_key = api_key.strip()

                await asyncio.to_thread(
                    self.credentials.set,
                    new_key
                )

            # KEEP EXISTING API KEY
            else:

                new_key = await self._get_key()

            new_client = (
                self._create_client(new_key)
                if new_key
                else None
            )

            # SAVE MODEL
            self._save_model(model)

            old_client = self.client

            self.client = new_client

            self.model = model

            self.api_key_configured = bool(new_key)

            # CLOSE PREVIOUS CLIENT
            if old_client:

                await old_client.aclose()

            return self.get_settings()

    # -----------------------------------------
    # GET SAFE SETTINGS FOR FRONTEND
    # -----------------------------------------

    def get_settings(self):

        return {
            "success": True,
            "provider": "Google Gemini",
            "configured": self.api_key_configured,
            "model": self.model,
            "api_key_masked": (
                "••••••••"
                if self.api_key_configured
                else None
            ),
            # "system_keyring" or "local_file" (Linux without a keyring).
            "credential_storage": (
                self.credentials.storage
                if self.api_key_configured
                else None
            )
        }

    # -----------------------------------------
    # GENERATE AI RESPONSE
    # -----------------------------------------

    async def generate(
        self,
        message: str,
        context: dict | None = None
    ):

        async with self.lock:

            if not self.client:

                raise RuntimeError(
                    "Gemini API key is not configured."
                )

            return await generate_response(
                client=self.client,
                model=self.model,
                message=message,
                context=context
            )

    # -----------------------------------------
    # TEST GEMINI CONNECTION
    # -----------------------------------------

    async def validate(self):

        async with self.lock:

            if not self.client:

                raise RuntimeError(
                    "Gemini API key is not configured."
                )

            response = await self.client.models.generate_content(
                model=self.model,
                contents=(
                    "Reply with exactly: "
                    "PacketSniffer AI connected"
                ),
                config=types.GenerateContentConfig(
                    temperature=0,
                    max_output_tokens=50
                )
            )

            return {
                "success": True,
                "provider": "Google Gemini",
                "model": self.model,
                "message": (
                    response.text
                    or "Connection successful."
                )
            }

    # -----------------------------------------
    # CLOSE GEMINI CLIENT
    # -----------------------------------------

    async def close(self):

        pending = self._pending_lookup

        if pending is not None and not pending.done():
            pending.cancel()

        async with self.lock:

            if self.client:

                await self.client.aclose()

                self.client = None
