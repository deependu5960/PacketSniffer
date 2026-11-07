
import asyncio
from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class PausedRequest:
    id: str
    request: dict
    future: asyncio.Future = field(repr=False)


@dataclass
class PausedResponse:
    id: str
    response: dict
    future: asyncio.Future = field(repr=False)


class InterceptorController:
    """
    Holds outgoing requests and incoming responses until
    the user explicitly chooses Forward or Drop.
    """

    def __init__(self, event_publisher=None):
        self.enabled = False

        self.pending: dict[str, PausedRequest] = {}
        self.pending_responses: dict[str, PausedResponse] = {}

        self.lock = asyncio.Lock()
        self.event_publisher = event_publisher

    def publish(self, event):
        if self.event_publisher:
            self.event_publisher(event)

    async def set_enabled(self, enabled: bool):
        async with self.lock:
            self.enabled = bool(enabled)

        self.publish({
            "type": "interceptor.status",
            "data": self.status(),
        })

        return self.status()

    def status(self):
        request_count = len(self.pending)
        response_count = len(self.pending_responses)

        return {
            "enabled": self.enabled,
            "pending": request_count + response_count,
            "pending_requests": request_count,
            "pending_responses": response_count,
        }

    # ---------------------------------------------------------
    # REQUEST INTERCEPTION
    # ---------------------------------------------------------

    async def get_pending(self):
        async with self.lock:
            return [
                {
                    **item.request,
                    "id": item.id,
                    "direction": "request",
                }
                for item in self.pending.values()
            ]

    async def pause(self, request_data: dict):
        """
        Pause an outgoing request.

        Returns:
            Edited request dictionary on Forward.
            None on Drop.
            Original request when interception is disabled.
        """

        async with self.lock:
            if not self.enabled:
                return request_data

            request_id = str(uuid4())
            future = asyncio.get_running_loop().create_future()

            paused = PausedRequest(
                id=request_id,
                request=dict(request_data),
                future=future,
            )

            self.pending[request_id] = paused

        self.publish({
            "type": "interceptor.request_paused",
            "data": {
                **paused.request,
                "id": request_id,
                "direction": "request",
            },
        })

        try:
            return await future

        except asyncio.CancelledError:
            async with self.lock:
                self.pending.pop(request_id, None)

            self.publish({
                "type": "interceptor.request_removed",
                "data": {"id": request_id},
            })

            raise

    async def forward(self, request_id: str, edited_request: dict):
        async with self.lock:
            paused = self.pending.get(request_id)

            if paused is None or paused.future.done():
                return False

            paused.future.set_result(dict(edited_request))
            self.pending.pop(request_id, None)

        self.publish({
            "type": "interceptor.request_forwarded",
            "data": {"id": request_id},
        })

        return True

    async def drop(self, request_id: str):
        async with self.lock:
            paused = self.pending.get(request_id)

            if paused is None or paused.future.done():
                return False

            paused.future.set_result(None)
            self.pending.pop(request_id, None)

        self.publish({
            "type": "interceptor.request_dropped",
            "data": {"id": request_id},
        })

        return True

    # ---------------------------------------------------------
    # RESPONSE INTERCEPTION
    # ---------------------------------------------------------

    async def get_pending_responses(self):
        async with self.lock:
            return [
                {
                    **item.response,
                    "id": item.id,
                    "direction": "response",
                }
                for item in self.pending_responses.values()
            ]

    async def pause_response(self, response_data: dict):
        """
        Pause an incoming server response before it reaches
        the browser.

        Returns:
            Edited response dictionary on Forward.
            None on Drop.
            Original response when interception is disabled.
        """

        async with self.lock:
            if not self.enabled:
                return response_data

            response_id = str(uuid4())
            future = asyncio.get_running_loop().create_future()

            paused = PausedResponse(
                id=response_id,
                response=dict(response_data),
                future=future,
            )

            self.pending_responses[response_id] = paused

        self.publish({
            "type": "interceptor.response_paused",
            "data": {
                **paused.response,
                "id": response_id,
                "direction": "response",
            },
        })

        try:
            return await future

        except asyncio.CancelledError:
            async with self.lock:
                self.pending_responses.pop(response_id, None)

            self.publish({
                "type": "interceptor.response_removed",
                "data": {"id": response_id},
            })

            raise

    async def forward_response(
        self,
        response_id: str,
        edited_response: dict,
    ):
        async with self.lock:
            paused = self.pending_responses.get(response_id)

            if paused is None or paused.future.done():
                return False

            paused.future.set_result(dict(edited_response))
            self.pending_responses.pop(response_id, None)

        self.publish({
            "type": "interceptor.response_forwarded",
            "data": {"id": response_id},
        })

        return True

    async def drop_response(self, response_id: str):
        async with self.lock:
            paused = self.pending_responses.get(response_id)

            if paused is None or paused.future.done():
                return False

            paused.future.set_result(None)
            self.pending_responses.pop(response_id, None)

        self.publish({
            "type": "interceptor.response_dropped",
            "data": {"id": response_id},
        })

        return True
