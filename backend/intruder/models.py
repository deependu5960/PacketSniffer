from typing import Literal

from pydantic import BaseModel, Field


class IntruderPayloadSet(BaseModel):
    source: Literal[
        "list",
        "numbers",
        "wordlist",
        "brute",
        "null",
    ] = "list"

    values: list[str] = Field(default_factory=list)

    number_start: int | None = None
    number_end: int | None = None
    number_step: int = 1
    number_min_digits: int = 1


class IntruderSettings(BaseModel):
    concurrency: int = Field(default=5, ge=1, le=20)

    requests_per_second: float = Field(
        default=0,
        ge=0,
        le=100,
    )

    timeout_seconds: float = Field(
        default=15,
        ge=1,
        le=120,
    )

    max_requests: int = Field(
        default=1000,
        ge=1,
        le=10000,
    )

    follow_redirects: bool = False
    verify_tls: bool = True


class IntruderAttackRequest(BaseModel):
    raw_request: str

    # Used when the request target is a relative path.
    scheme: Literal["http", "https"] = "https"

    attack_type: Literal[
        "sniper",
        "battering_ram",
        "pitchfork",
        "cluster_bomb",
    ] = "sniper"

    payload_sets: list[IntruderPayloadSet] = Field(
        default_factory=list
    )

    settings: IntruderSettings = Field(
        default_factory=IntruderSettings
    )
