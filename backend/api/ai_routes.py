
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ai.config import AIManager

router = APIRouter(
    prefix="/api/ai",
    tags=["PacketSniffer AI"],
)

logger = logging.getLogger(__name__)


class SettingsRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, min_length=1, max_length=150)
    clear_api_key: bool = False


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    context: dict | None = None


class AnalyzeRequest(BaseModel):
    request: dict
    response: dict | None = None


def get_ai_manager(request: Request) -> AIManager:
    manager = getattr(request.app.state, "ai_manager", None)

    if manager is None:
        raise HTTPException(
            status_code=503,
            detail="AI manager is unavailable.",
        )

    return manager


def handle_ai_error(exc: Exception, operation: str):
    code = getattr(exc, "code", None)

    if code is None:
        response = getattr(exc, "response", None)
        code = getattr(response, "status_code", None)

    try:
        code = int(code) if code is not None else None
    except (TypeError, ValueError):
        code = None

    logger.exception(
        "[AI] %s failed. Provider status: %s",
        operation,
        code or "unknown",
    )

    if code == 429:
        detail = "Gemini quota or rate limit reached."

    elif code in (401, 403):
        detail = "Gemini authentication or permission error. Check your API key."

    elif code == 404:
        detail = "Gemini model not found. Check the selected model name."

    elif code in (408, 500, 502, 503, 504):
        detail = "Gemini is temporarily unavailable. Please try again."

    else:
        detail = "AI request failed. Check your API key, model and backend logs."

    return HTTPException(
        status_code=502,
        detail=detail,
    )


@router.get("/status")
async def ai_status(request: Request):
    manager = get_ai_manager(request)
    return manager.get_settings()


@router.get("/settings")
async def get_settings(request: Request):
    manager = get_ai_manager(request)
    return manager.get_settings()


@router.put("/settings")
async def update_settings(
    data: SettingsRequest,
    request: Request,
):
    manager = get_ai_manager(request)

    selected_model = (
        data.model.strip()
        if data.model
        else manager.model
    )

    try:
        return await manager.update_settings(
            api_key=data.api_key,
            model=selected_model,
            clear_api_key=data.clear_api_key,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("[AI] Failed to save AI settings.")

        raise HTTPException(
            status_code=500,
            detail="Could not save AI settings. Check backend logs.",
        ) from exc


@router.post("/validate")
async def validate_settings(request: Request):
    manager = get_ai_manager(request)

    try:
        return await manager.validate()

    except Exception as exc:
        raise handle_ai_error(
            exc,
            "Gemini connection validation",
        ) from exc


@router.post("/chat")
async def chat(
    data: ChatRequest,
    request: Request,
):
    manager = get_ai_manager(request)

    try:
        result = await manager.generate(
            message=data.message,
            context=data.context,
        )

        return {
            "success": True,
            "response": result,
            "model": manager.model,
        }

    except Exception as exc:
        if isinstance(exc, RuntimeError) and "not configured" in str(exc):
            raise HTTPException(
                status_code=503,
                detail="Configure your Gemini API key first.",
            ) from exc

        raise handle_ai_error(exc, "Gemini chat") from exc


@router.post("/analyze")
async def analyze(
    data: AnalyzeRequest,
    request: Request,
):
    manager = get_ai_manager(request)

    try:
        result = await manager.generate(
            message=(
                "Analyze the supplied HTTP transaction for "
                "potential security vulnerabilities. "
                "Explain evidence, impact and suggested tests."
            ),
            context={
                "request": data.request,
                "response": data.response,
            },
        )

        return {
            "success": True,
            "analysis": result,
            "model": manager.model,
        }

    except Exception as exc:
        if isinstance(exc, RuntimeError) and "not configured" in str(exc):
            raise HTTPException(
                status_code=503,
                detail="Configure your Gemini API key first.",
            ) from exc

        raise handle_ai_error(
            exc,
            "Gemini security analysis",
        ) from exc
