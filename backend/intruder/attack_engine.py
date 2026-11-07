from itertools import product

from intruder.models import IntruderAttackRequest
from intruder.payloads import generate_payloads, PayloadError
from intruder.request_builder import (
    find_payload_positions,
    build_request_with_payload,
    build_request_with_payloads,
)


class AttackEngineError(Exception):
    pass


def generate_attack_requests(
    attack: IntruderAttackRequest,
) -> list[str]:

    raw_request = attack.raw_request
    positions = find_payload_positions(raw_request)

    if not positions:
        raise AttackEngineError("No payload positions found.")

    if not attack.payload_sets:
        raise AttackEngineError("At least one payload set is required.")

    try:
        payload_sets = [
            generate_payloads(payload_set)
            for payload_set in attack.payload_sets
        ]
    except PayloadError as exc:
        raise AttackEngineError(str(exc)) from exc

    if any(not values for values in payload_sets):
        raise AttackEngineError("A payload set is empty.")

    attack_type = attack.attack_type
    generated = []

    # SNIPER
    if attack_type == "sniper":

        if len(payload_sets) != 1:
            raise AttackEngineError(
                "Sniper requires one payload set."
            )

        for position_index in range(len(positions)):
            for payload in payload_sets[0]:
                generated.append(
                    build_request_with_payload(
                        raw_request,
                        position_index,
                        payload,
                    )
                )

    # BATTERING RAM
    elif attack_type == "battering_ram":

        if len(payload_sets) != 1:
            raise AttackEngineError(
                "Battering Ram requires one payload set."
            )

        for payload in payload_sets[0]:
            generated.append(
                build_request_with_payloads(
                    raw_request,
                    [payload] * len(positions),
                )
            )

    # PITCHFORK
    elif attack_type == "pitchfork":

        if len(payload_sets) != len(positions):
            raise AttackEngineError(
                "Pitchfork requires one payload set per position."
            )

        lengths = {len(values) for values in payload_sets}

        if len(lengths) != 1:
            raise AttackEngineError(
                "Pitchfork payload sets must have equal lengths."
            )

        for payload_group in zip(*payload_sets):
            generated.append(
                build_request_with_payloads(
                    raw_request,
                    list(payload_group),
                )
            )

    # CLUSTER BOMB
    elif attack_type == "cluster_bomb":

        if len(payload_sets) != len(positions):
            raise AttackEngineError(
                "Cluster Bomb requires one payload set per position."
            )

        for payload_group in product(*payload_sets):
            generated.append(
                build_request_with_payloads(
                    raw_request,
                    list(payload_group),
                )
            )

    else:
        raise AttackEngineError(
            f"Unsupported attack type: {attack_type}"
        )

    if len(generated) > attack.settings.max_requests:
        raise AttackEngineError(
            f"Attack would generate {len(generated)} requests, "
            f"exceeding the configured limit of "
            f"{attack.settings.max_requests}."
        )

    return generated