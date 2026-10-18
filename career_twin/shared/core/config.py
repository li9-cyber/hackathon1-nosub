"""Server-only settings; an external environment always takes precedence."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'career_twin'
WEB = RUNTIME / 'web'
load_dotenv(ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    api_key: str = field(default="", repr=False)
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-flash"
    timeout_seconds: float = 90
    max_tokens: int = 6000


def get_settings() -> Settings:
    return Settings(
        api_key=os.getenv("DEEPSEEK_API_KEY", "").strip(),
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        timeout_seconds=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "90")),
        max_tokens=int(os.getenv("DEEPSEEK_MAX_TOKENS", "6000")),
    )


@dataclass(frozen=True)
class TechmapSettings:
    api_key: str = field(default="", repr=False)
    base_url: str = "https://daily-international-job-postings.p.rapidapi.com"
    host: str = "daily-international-job-postings.p.rapidapi.com"
    country_code: str = "hk"
    location: str = "Hong Kong"
    page_size: int = 10
    timeout_seconds: float = 30


def get_techmap_settings() -> TechmapSettings:
    return TechmapSettings(
        api_key=os.getenv("TECHMAP_RAPIDAPI_KEY", "").strip(),
        base_url=os.getenv("TECHMAP_API_BASE_URL", "https://daily-international-job-postings.p.rapidapi.com").strip().rstrip("/"),
        host=os.getenv("TECHMAP_RAPIDAPI_HOST", "daily-international-job-postings.p.rapidapi.com").strip(),
        country_code=os.getenv("TECHMAP_COUNTRY_CODE", "hk").strip().lower(),
    )


@dataclass(frozen=True)
class DatabaseSettings:
    hostname: str = "127.0.0.1"
    port: int = 5432
    name: str = "hackathon1"
    username: str = "postgres"
    password: str = field(default="", repr=False)


def get_database_settings() -> DatabaseSettings:
    try:
        port = int(os.getenv("DATABASE_PORT", "5432"))
    except ValueError:
        raise ValueError("DATABASE_PORT 必須是有效的連接埠數字。") from None
    if not 1 <= port <= 65535:
        raise ValueError("DATABASE_PORT 必須介於 1 與 65535。")
    settings = DatabaseSettings(
        hostname=os.getenv("DATABASE_HOSTNAME", "127.0.0.1").strip(),
        port=port,
        name=os.getenv("DATABASE_NAME", "hackathon1").strip(),
        username=os.getenv("DATABASE_USERNAME", "postgres").strip(),
        password=os.getenv("DATABASE_PASSWORD", ""),
    )
    if not settings.hostname or not settings.name or not settings.username:
        raise ValueError("請填寫 DATABASE_HOSTNAME、DATABASE_NAME 及 DATABASE_USERNAME。")
    return settings
