
import asyncio
import logging

from google.genai import types
from ai.prompts import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

MAX_RETRIES = 1

RETRYABLE_STATUS_CODES = {
    408, 429, 500, 502, 503, 504
}


def get_error_status(error: Exception):
    code = getattr(error, "code", None)

    if code is None:
        response = getattr(error, "response", None)
        code = getattr(response, "status_code", None)

    try:
        return int(code)
    except (TypeError, ValueError):
        return None


async def generate_response(
    client,
    model: str,
    message: str,
    context: dict | None = None,
):

    prompt = f"""
USER MESSAGE:
{message}

PACKET SNIFFER CONTEXT:
{context or "No HTTP context supplied."}
"""

    for attempt in range(MAX_RETRIES + 1):

        try:
            response = await client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.3,
                    max_output_tokens=4096,
                ),
            )

            return response.text or "No response generated."

        except Exception as error:

            status = get_error_status(error)

            if status not in RETRYABLE_STATUS_CODES:
                logger.error(
                    "[AI] Gemini request failed. Status: %s",
                    status or "unknown",
                )
                raise

            if attempt == MAX_RETRIES:
                raise

            delay = 2 ** (attempt + 1)

            logger.warning(
                "[AI] Gemini returned HTTP %s. Retrying in %s seconds.",
                status,
                delay,
            )

            await asyncio.sleep(delay)

    return "No response generated."
