from pathlib import Path

from intruder.models import IntruderPayloadSet


class PayloadError(Exception):
    pass


def generate_payloads(
    payload_set: IntruderPayloadSet,
) -> list[str]:

    source = payload_set.source

    if source == "list":
        return payload_set.values

    if source == "numbers":
        start = payload_set.number_start
        end = payload_set.number_end
        step = payload_set.number_step
        min_digits = payload_set.number_min_digits

        if start is None or end is None:
            raise PayloadError("Number range requires start and end.")

        if step == 0:
            raise PayloadError("Number step cannot be zero.")

        if (end - start) * step < 0:
            raise PayloadError("Invalid number step direction.")

        stop = end + (1 if step > 0 else -1)

        return [
            str(number).zfill(min_digits)
            for number in range(start, stop, step)
        ]

    if source == "wordlist":
        if not payload_set.values:
            raise PayloadError("Wordlist file path is missing.")

        path = Path(payload_set.values[0])

        if not path.is_file():
            raise PayloadError(f"Wordlist not found: {path}")

        try:
            return path.read_text(
                encoding="utf-8",
                errors="replace",
            ).splitlines()
        except OSError as exc:
            raise PayloadError(f"Could not read wordlist: {exc}")

    if source == "null":
        return [""]

    if source == "brute":
        raise PayloadError(
            "Brute-force generation is not implemented yet."
        )

    raise PayloadError(f"Unsupported payload source: {source}")