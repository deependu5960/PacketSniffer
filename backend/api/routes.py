
import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from config import PROXY_HOST, PROXY_PORT
from certificates.ca import CA_CERT_PATH
from system_paths import export_file_to_downloads

from repeater.sender import RepeaterError, send_request

from intruder.models import IntruderAttackRequest
from intruder.executor import (
    execute_attack,
    IntruderExecutorError,
)


router = APIRouter(prefix="/api")


# ---------------------------------------------------------
# Request Models
# ---------------------------------------------------------

class InterceptorToggle(BaseModel):
    enabled: bool


class ForwardRequest(BaseModel):
    request: dict[str, Any] = Field(default_factory=dict)


class ForwardResponse(BaseModel):
    response: dict[str, Any] = Field(default_factory=dict)


class RepeaterSend(BaseModel):
    method: str = "GET"
    url: str
    headers: list[list[str]] = Field(default_factory=list)
    body_base64: str = ""
    verify_tls: bool = True
    timeout: float = Field(default=30, ge=1, le=120)


# ---------------------------------------------------------
# Shared Application State
# ---------------------------------------------------------

def get_manager(request: Request):
    return request.app.state.traffic_manager


def get_interceptor(request: Request):
    return request.app.state.interceptor


# ---------------------------------------------------------
# Application Status
# ---------------------------------------------------------

@router.get("/status")
async def get_status(request: Request):
    proxy = request.app.state.proxy_server
    interceptor = get_interceptor(request)

    return {
        "application": "PacketSniffer",
        "status": "online",
        "proxy": proxy.status(),
        "interceptor": interceptor.status(),
    }


# ---------------------------------------------------------
# Proxy
# ---------------------------------------------------------

@router.post("/proxy/start")
async def start_proxy(request: Request):
    proxy = request.app.state.proxy_server

    try:
        await proxy.start()

        return {
            "success": True,
            "proxy": proxy.status(),
        }

    except OSError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Could not start proxy: {exc}",
        ) from exc


@router.post("/proxy/stop")
async def stop_proxy(request: Request):
    proxy = request.app.state.proxy_server

    await proxy.stop()

    return {
        "success": True,
        "proxy": proxy.status(),
    }


# ---------------------------------------------------------
# Interceptor Status
# ---------------------------------------------------------

@router.get("/interceptor/status")
async def interceptor_status(request: Request):
    interceptor = get_interceptor(request)

    return interceptor.status()


@router.post("/interceptor/toggle")
async def toggle_interceptor(
    payload: InterceptorToggle,
    request: Request,
):
    interceptor = get_interceptor(request)

    return await interceptor.set_enabled(payload.enabled)


# ---------------------------------------------------------
# Request Interception
# ---------------------------------------------------------

@router.get("/interceptor/pending")
async def get_pending_requests(request: Request):
    interceptor = get_interceptor(request)

    items = await interceptor.get_pending()

    return {
        "count": len(items),
        "items": items,
    }


@router.post("/interceptor/{request_id}/forward")
async def forward_intercepted_request(
    request_id: str,
    payload: ForwardRequest,
    request: Request,
):
    interceptor = get_interceptor(request)

    if not payload.request:
        raise HTTPException(
            status_code=400,
            detail="Edited request data is required",
        )

    success = await interceptor.forward(
        request_id,
        payload.request,
    )

    if not success:
        raise HTTPException(
            status_code=404,
            detail="Paused request not found or already handled",
        )

    return {
        "success": True,
        "message": "Request forwarded",
        "id": request_id,
    }


@router.post("/interceptor/{request_id}/drop")
async def drop_intercepted_request(
    request_id: str,
    request: Request,
):
    interceptor = get_interceptor(request)

    success = await interceptor.drop(request_id)

    if not success:
        raise HTTPException(
            status_code=404,
            detail="Paused request not found or already handled",
        )

    return {
        "success": True,
        "message": "Request dropped",
        "id": request_id,
    }


# ---------------------------------------------------------
# Response Interception
# ---------------------------------------------------------

@router.get("/interceptor/responses/pending")
async def get_pending_responses(request: Request):
    interceptor = get_interceptor(request)

    items = await interceptor.get_pending_responses()

    return {
        "count": len(items),
        "items": items,
    }


@router.post("/interceptor/responses/{response_id}/forward")
async def forward_intercepted_response(
    response_id: str,
    payload: ForwardResponse,
    request: Request,
):
    interceptor = get_interceptor(request)

    if not payload.response:
        raise HTTPException(
            status_code=400,
            detail="Edited response data is required",
        )

    success = await interceptor.forward_response(
        response_id,
        payload.response,
    )

    if not success:
        raise HTTPException(
            status_code=404,
            detail="Paused response not found or already handled",
        )

    return {
        "success": True,
        "message": "Response forwarded",
        "id": response_id,
    }


@router.post("/interceptor/responses/{response_id}/drop")
async def drop_intercepted_response(
    response_id: str,
    request: Request,
):
    interceptor = get_interceptor(request)

    success = await interceptor.drop_response(response_id)

    if not success:
        raise HTTPException(
            status_code=404,
            detail="Paused response not found or already handled",
        )

    return {
        "success": True,
        "message": "Response dropped",
        "id": response_id,
    }


# ---------------------------------------------------------
# Repeater
# ---------------------------------------------------------

@router.post("/repeater/send")
async def repeater_send(payload: RepeaterSend):
    """
    Send one edited request directly to its target server.

    The request does not go through the proxy, is not paused
    by the interceptor, and is not saved to traffic history.
    """

    try:
        return await send_request(
            method=payload.method,
            url=payload.url,
            headers=payload.headers,
            body_base64=payload.body_base64,
            verify_tls=payload.verify_tls,
            timeout=payload.timeout,
        )

    except RepeaterError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from exc


# ---------------------------------------------------------
# Intruder
# ---------------------------------------------------------

@router.post("/intruder/attack")
async def intruder_attack(payload: IntruderAttackRequest):
    """
    Execute an Intruder attack.

    Supports:
    - Sniper
    - Battering Ram
    - Pitchfork
    - Cluster Bomb

    Returns individual request and response results.
    """

    try:
        result = await execute_attack(payload)

        return {
            "success": True,
            **result,
        }

    except IntruderExecutorError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc


# ---------------------------------------------------------
# Traffic History
# ---------------------------------------------------------

@router.get("/traffic")
async def get_traffic(
    request: Request,
    limit: int = 100,
):
    if not 1 <= limit <= 1000:
        raise HTTPException(
            status_code=400,
            detail="Limit must be between 1 and 1000",
        )

    manager = get_manager(request)

    records = await manager.get_recent(limit)

    return {
        "count": len(records),
        "items": records,
    }


@router.get("/traffic/{record_id}")
async def get_traffic_record(
    request: Request,
    record_id: str,
):
    manager = get_manager(request)

    record = await manager.get_by_id(record_id)

    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Traffic record not found",
        )

    return record


@router.delete("/traffic")
async def clear_traffic(request: Request):
    manager = get_manager(request)

    await manager.clear()

    return {
        "success": True,
        "message": "Traffic history cleared",
    }


# ---------------------------------------------------------
# Root CA Certificate
# ---------------------------------------------------------

@router.get("/certificate")
async def certificate_info():
    return {
        "available": CA_CERT_PATH.exists(),
        "certificate": CA_CERT_PATH.name,
        "download_endpoint": "/api/certificate/download",
        "private_key_exposed": False,
    }


@router.get("/certificate/download")
async def download_certificate():
    if not CA_CERT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="Root CA certificate not found",
        )

    return FileResponse(
        path=CA_CERT_PATH,
        media_type="application/x-pem-file",
        filename="packetsniff-ca.crt",
    )


@router.post("/certificate/save")
async def save_certificate_to_downloads():
    """
    Copy the public Root CA certificate into the user's Downloads folder.

    The desktop app uses this on Linux, where the embedded WebKitGTK view
    does not reliably handle browser-style blob downloads.
    """

    if not CA_CERT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="Root CA certificate not found",
        )

    try:
        saved_path = await asyncio.to_thread(
            export_file_to_downloads,
            CA_CERT_PATH,
            "packetsniff-ca.crt",
        )

    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save the certificate: {exc.strerror or exc}",
        ) from exc

    return {
        "success": True,
        "filename": saved_path.name,
        "path": str(saved_path),
    }
