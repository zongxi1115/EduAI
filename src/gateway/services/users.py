from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from edu_multi_agent.config import Settings
from edu_multi_agent.file_io import now_iso

from ..schemas.auth import AuthUser


AUTH_COOKIE_NAME = "edu_auth"
SESSION_DAYS = 7
PASSWORD_ITERATIONS = 210_000


class UserService:
    """Local file-backed user service for development-stage auth."""

    def __init__(self, settings: Settings) -> None:
        self.root = (settings.output_root / "_users").resolve()
        self.users_path = self.root / "users.json"
        self.secret = settings.auth_secret or settings.api_key
        self._lock = threading.RLock()

    def register(self, username: str, password: str, display_name: str | None = None) -> AuthUser:
        normalized_username = self._normalize_username(username)
        if len(password) < 6:
            raise ValueError("密码至少需要 6 位。")

        with self._lock:
            payload = self._load_payload()
            users = payload.setdefault("users", {})
            username_index = payload.setdefault("username_index", {})
            if normalized_username in username_index:
                raise ValueError("该用户名已被注册。")

            user_id = f"usr_{uuid4().hex[:16]}"
            user_record = {
                "id": user_id,
                "username": normalized_username,
                "display_name": (display_name or "").strip() or normalized_username,
                "learner_id": f"user_{user_id}",
                "created_at": now_iso(),
                "password": self._hash_password(password),
            }
            users[user_id] = user_record
            username_index[normalized_username] = user_id
            self._save_payload(payload)
            return self._public_user(user_record)

    def authenticate(self, username: str, password: str) -> AuthUser | None:
        normalized_username = self._normalize_username(username)
        with self._lock:
            payload = self._load_payload()
            user_id = payload.get("username_index", {}).get(normalized_username)
            record = payload.get("users", {}).get(user_id) if user_id else None
            if not isinstance(record, dict):
                return None
            password_record = record.get("password")
            if not isinstance(password_record, dict):
                return None
            if not self._verify_password(password, password_record):
                return None
            return self._public_user(record)

    def get_user(self, user_id: str) -> AuthUser | None:
        with self._lock:
            payload = self._load_payload()
            record = payload.get("users", {}).get(user_id)
            return self._public_user(record) if isinstance(record, dict) else None

    def upsert_zx_auth_user(
        self,
        *,
        subject: str,
        username: str | None = None,
        display_name: str | None = None,
        email: str | None = None,
    ) -> AuthUser:
        normalized_subject = subject.strip()
        if not normalized_subject:
            raise ValueError("ZX Auth did not return a subject.")

        with self._lock:
            payload = self._load_payload()
            users = payload.setdefault("users", {})
            username_index = payload.setdefault("username_index", {})
            zx_auth_index = payload.setdefault("zx_auth_index", {})

            user_id = zx_auth_index.get(normalized_subject)
            record = users.get(user_id) if isinstance(user_id, str) else None
            if isinstance(record, dict):
                record["display_name"] = (display_name or username or email or record.get("display_name") or "").strip()
                record["email"] = email
                record["zx_auth_subject"] = normalized_subject
                self._save_payload(payload)
                return self._public_user(record)

            user_id = f"usr_{uuid4().hex[:16]}"
            username_base = self._normalize_external_username(username or email or normalized_subject)
            local_username = username_base
            suffix = 2
            while local_username in username_index:
                local_username = f"{username_base}_{suffix}"
                suffix += 1

            user_record = {
                "id": user_id,
                "username": local_username,
                "display_name": (display_name or username or email or local_username).strip(),
                "email": email,
                "learner_id": f"user_{user_id}",
                "created_at": now_iso(),
                "password": None,
                "zx_auth_subject": normalized_subject,
            }
            users[user_id] = user_record
            username_index[local_username] = user_id
            zx_auth_index[normalized_subject] = user_id
            self._save_payload(payload)
            return self._public_user(user_record)

    def create_session_token(self, user: AuthUser) -> tuple[str, str]:
        expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
        session_payload = {
            "sub": user.id,
            "exp": int(expires_at.timestamp()),
        }
        raw_payload = _urlsafe_encode(json.dumps(session_payload, separators=(",", ":")).encode("utf-8"))
        signature = self._sign(raw_payload)
        return f"{raw_payload}.{signature}", expires_at.isoformat()

    def user_from_token(self, token: str | None) -> AuthUser | None:
        if not token or "." not in token:
            return None
        raw_payload, signature = token.split(".", 1)
        if not hmac.compare_digest(self._sign(raw_payload), signature):
            return None
        try:
            payload = json.loads(_urlsafe_decode(raw_payload).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return None

        expires_at = payload.get("exp")
        user_id = payload.get("sub")
        if not isinstance(expires_at, int) or not isinstance(user_id, str):
            return None
        if expires_at <= int(datetime.now(timezone.utc).timestamp()):
            return None
        return self.get_user(user_id)

    def _load_payload(self) -> dict[str, Any]:
        if not self.users_path.is_file():
            return {"users": {}, "username_index": {}}
        try:
            payload = json.loads(self.users_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"users": {}, "username_index": {}}
        if not isinstance(payload, dict):
            return {"users": {}, "username_index": {}}
        payload.setdefault("users", {})
        payload.setdefault("username_index", {})
        payload.setdefault("zx_auth_index", {})
        return payload

    def _save_payload(self, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.users_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _normalize_username(username: str) -> str:
        normalized = username.strip().lower()
        if not normalized:
            raise ValueError("用户名不能为空。")
        return normalized

    @staticmethod
    def _normalize_external_username(value: str) -> str:
        normalized = "".join(
            char.lower() if char.isalnum() or char in {"_", "-", "."} else "_"
            for char in value.strip()
        ).strip("._-")
        return normalized or f"zx_{uuid4().hex[:8]}"

    @staticmethod
    def _hash_password(password: str) -> dict[str, str | int]:
        salt = secrets.token_urlsafe(18)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            PASSWORD_ITERATIONS,
        )
        return {
            "algorithm": "pbkdf2_sha256",
            "iterations": PASSWORD_ITERATIONS,
            "salt": salt,
            "hash": digest.hex(),
        }

    @staticmethod
    def _verify_password(password: str, record: dict[str, Any]) -> bool:
        salt = record.get("salt")
        expected_hash = record.get("hash")
        iterations = record.get("iterations")
        if not isinstance(salt, str) or not isinstance(expected_hash, str) or not isinstance(iterations, int):
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(digest.hex(), expected_hash)

    def _sign(self, raw_payload: str) -> str:
        signature = hmac.new(
            self.secret.encode("utf-8"),
            raw_payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return _urlsafe_encode(signature)

    @staticmethod
    def _public_user(record: dict[str, Any]) -> AuthUser:
        return AuthUser(
            id=str(record["id"]),
            username=str(record["username"]),
            display_name=str(record.get("display_name") or record["username"]),
            learner_id=str(record["learner_id"]),
            created_at=str(record["created_at"]),
        )


def _urlsafe_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _urlsafe_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)
