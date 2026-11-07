
import json
from pathlib import Path
from asyncio import Lock

import keyring
from platformdirs import user_config_path
from google import genai
from google.genai import types

from ai.gemini import generate_response


APP_NAME = "PacketSniffer"
KEYRING_SERVICE = "PacketSniffer.Gemini"
DEFAULT_MODEL = "gemini-2.5-flash"


class AIManager:

    def __init__(self):
        self.config_dir = Path(
            user_config_path(APP_NAME, APP_NAME)
        )

        self.config_file = self.config_dir / "ai.json"

        self.client = None
        self.model = DEFAULT_MODEL
        self.api_key_configured = False

        self.lock = Lock()

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
    # GET API KEY FROM WINDOWS CREDENTIAL STORE
    # -----------------------------------------

    def _get_key(self):

        return keyring.get_password(
            KEYRING_SERVICE,
            "gemini_api_key"
        )

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

    async def initialize(self):

        self._load_model()

        api_key = self._get_key()

        if api_key:

            self.client = self._create_client(api_key)

            self.api_key_configured = True

            print("[AI] Gemini configuration loaded.")

        else:

            self.client = None

            self.api_key_configured = False

            print("[AI] Gemini API key not configured.")

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

            current_key = self._get_key()

            # USER WANTS TO REMOVE API KEY
            if clear_api_key:

                try:
                    keyring.delete_password(
                        KEYRING_SERVICE,
                        "gemini_api_key"
                    )

                except keyring.errors.PasswordDeleteError:
                    pass

                new_key = None

            # USER ENTERED A NEW API KEY
            elif api_key and api_key.strip():

                new_key = api_key.strip()

                keyring.set_password(
                    KEYRING_SERVICE,
                    "gemini_api_key",
                    new_key
                )

            # KEEP EXISTING API KEY
            else:

                new_key = current_key

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

        async with self.lock:

            if self.client:

                await self.client.aclose()

                self.client = None
