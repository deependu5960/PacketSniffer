
import asyncio
import h11

from config import MAX_HEADER_SIZE
from proxy.https_handler import handle_https_connect
from proxy.http_handler import handle_http_connection


READ_SIZE = 65536


async def _read_event(connection, reader):
    while True:
        event = connection.next_event()

        if event is h11.NEED_DATA:
            data = await reader.read(READ_SIZE)
            connection.receive_data(data)
            continue

        return event


async def handle_client(reader, writer, storage, interceptor=None):
    """Dispatch one browser connection to the appropriate handler."""

    client_address = writer.get_extra_info("peername")

    try:
        connection = h11.Connection(
            h11.SERVER,
            max_incomplete_event_size=MAX_HEADER_SIZE,
        )

        request = await _read_event(connection, reader)

        if not isinstance(request, h11.Request):
            return

        method = request.method.decode("ascii", errors="replace")

        if method == "CONNECT":
            authority = request.target.decode("latin-1")

            await handle_https_connect(
                reader,
                writer,
                authority,
                storage,
                interceptor,
            )
            return

        await handle_http_connection(
            reader,
            writer,
            connection,
            request,
            storage,
            interceptor,
        )

    except asyncio.CancelledError:
        raise

    except Exception as exc:
        print(
            f"[CONNECTION ERROR] {client_address}: "
            f"{type(exc).__name__}: {exc}"
        )

    finally:
        if not writer.is_closing():
            writer.close()

        try:
            await writer.wait_closed()
        except Exception:
            pass
