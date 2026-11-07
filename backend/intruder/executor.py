
import asyncio
import time

from intruder.models import IntruderAttackRequest
from intruder.attack_engine import (
    generate_attack_requests,
    AttackEngineError,
)
from intruder.request_builder import (
    build_sender_request,
    RequestBuildError,
)
from repeater.sender import send_request, RepeaterError


class IntruderExecutorError(Exception):
    pass


class RateLimiter:
    """Coordinates the request rate across concurrent workers."""

    def __init__(self, requests_per_second: float):
        self.interval = (
            1.0 / requests_per_second
            if requests_per_second > 0
            else 0
        )
        self.lock = asyncio.Lock()
        self.next_allowed = 0.0

    async def wait(self):
        if self.interval <= 0:
            return

        loop = asyncio.get_running_loop()

        async with self.lock:
            now = loop.time()

            if now < self.next_allowed:
                await asyncio.sleep(self.next_allowed - now)

            self.next_allowed = max(
                self.next_allowed,
                loop.time(),
            ) + self.interval


async def execute_attack(
    attack: IntruderAttackRequest,
) -> dict:
    """
    Generate and execute an Intruder attack.

    Returns an ordered list of request results, even when
    requests are executed concurrently.
    """

    settings = attack.settings

    if settings.follow_redirects:
        raise IntruderExecutorError(
            "Following redirects is not supported yet. "
            "Turn off 'Follow redirects' for this attack."
        )

    try:
        raw_requests = generate_attack_requests(attack)
    except AttackEngineError as exc:
        raise IntruderExecutorError(str(exc)) from exc

    if not raw_requests:
        raise IntruderExecutorError(
            "The attack did not generate any requests."
        )

    semaphore = asyncio.Semaphore(settings.concurrency)

    rate_limiter = RateLimiter(
        settings.requests_per_second
    )

    results = [None] * len(raw_requests)

    async def execute_one(index: int, raw_request: str):
        async with semaphore:
            started = time.perf_counter()

            try:
                # Convert the generated raw HTTP request into
                # the same structure used by Repeater.
                request_data = build_sender_request(
                    raw_request,
                    scheme=attack.scheme,
                )

                # Apply the rate limit immediately before sending.
                await rate_limiter.wait()

                response = await send_request(
                    method=request_data["method"],
                    url=request_data["url"],
                    headers=request_data["headers"],
                    body_base64=request_data["body_base64"],
                    verify_tls=settings.verify_tls,
                    timeout=settings.timeout_seconds,
                )

                results[index] = {
                    "request_index": index + 1,
                    "success": True,
                    "request": raw_request,
                    "method": request_data["method"],
                    "url": request_data["url"],
                    **response,
                }

            except (RequestBuildError, RepeaterError) as exc:
                results[index] = {
                    "request_index": index + 1,
                    "success": False,
                    "request": raw_request,
                    "error": str(exc),
                    "duration_ms": round(
                        (time.perf_counter() - started) * 1000,
                        1,
                    ),
                }

            except Exception as exc:
                results[index] = {
                    "request_index": index + 1,
                    "success": False,
                    "request": raw_request,
                    "error": f"Unexpected error: {exc}",
                    "duration_ms": round(
                        (time.perf_counter() - started) * 1000,
                        1,
                    ),
                }

    attack_started = time.perf_counter()

    await asyncio.gather(
        *[
            execute_one(index, raw_request)
            for index, raw_request in enumerate(raw_requests)
        ]
    )

    total_duration_ms = round(
        (time.perf_counter() - attack_started) * 1000,
        1,
    )

    successful = sum(
        1 for result in results if result["success"]
    )

    failed = len(results) - successful

    return {
        "attack_type": attack.attack_type,
        "total_requests": len(results),
        "successful_requests": successful,
        "failed_requests": failed,
        "duration_ms": total_duration_ms,
        "results": results,
    }
