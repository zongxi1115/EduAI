from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse

from edu_multi_agent.config import Settings

from ..dependencies import get_optional_current_user, get_settings, get_user_service
from ..schemas.auth import (
    AuthCredentials,
    AuthLogoutResponse,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthSessionResponse,
    AuthUser,
    ZxAuthCallbackRequest,
)
from ..services.users import AUTH_COOKIE_NAME, SESSION_DAYS, UserService


router = APIRouter(prefix="/api/v1/auth", tags=["用户认证"])

UserServiceDep = Annotated[UserService, Depends(get_user_service)]
CurrentUserDep = Annotated[AuthUser | None, Depends(get_optional_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ZX_STATE_TTL_MINUTES = 10


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _urlsafe_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _urlsafe_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def _sign_value(value: str, secret: str) -> str:
    return _urlsafe_encode(
        hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    )


def _create_zx_state(settings: Settings, next_path: str) -> str:
    safe_next = next_path if next_path.startswith("/") else "/"
    payload = {
        "next": safe_next,
        "nonce": secrets.token_urlsafe(16),
        "exp": int((datetime.now(timezone.utc) + timedelta(minutes=ZX_STATE_TTL_MINUTES)).timestamp()),
    }
    encoded_payload = _urlsafe_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{encoded_payload}.{_sign_value(encoded_payload, settings.auth_secret or settings.api_key)}"


def _read_zx_state(settings: Settings, state: str) -> dict[str, Any]:
    if "." not in state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ZX Auth state.")
    encoded_payload, signature = state.split(".", 1)
    expected = _sign_value(encoded_payload, settings.auth_secret or settings.api_key)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ZX Auth state.")
    try:
        payload = json.loads(_urlsafe_decode(encoded_payload).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ZX Auth state.") from exc
    if int(payload.get("exp") or 0) <= int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ZX Auth state expired.")
    return payload


def _require_zx_auth_settings(settings: Settings) -> None:
    missing = [
        name
        for name, value in (
            ("ZX_AUTH_ISSUER_URL", settings.zx_auth_issuer_url),
            ("ZX_AUTH_CLIENT_ID", settings.zx_auth_client_id),
            ("ZX_AUTH_CLIENT_SECRET", settings.zx_auth_client_secret),
            ("ZX_AUTH_REDIRECT_URI", settings.zx_auth_redirect_uri),
        )
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Missing ZX Auth settings: " + ", ".join(missing),
        )


async def _load_zx_discovery(settings: Settings) -> dict[str, Any]:
    discovery_url = f"{settings.zx_auth_issuer_url}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(discovery_url, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to load ZX Auth discovery document.",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid ZX Auth discovery document.")
    return payload


def _extract_zx_claims(token_payload: dict[str, Any], userinfo: dict[str, Any] | None) -> dict[str, str | None]:
    claims = {**token_payload, **(userinfo or {})}
    subject = claims.get("sub") or claims.get("id") or claims.get("user_id") or claims.get("openid")
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ZX Auth did not return a user id.")
    username = claims.get("preferred_username") or claims.get("username") or claims.get("name") or claims.get("email")
    display_name = claims.get("name") or claims.get("nickname") or username
    email = claims.get("email")
    return {
        "subject": subject.strip(),
        "username": username.strip() if isinstance(username, str) else None,
        "display_name": display_name.strip() if isinstance(display_name, str) else None,
        "email": email.strip() if isinstance(email, str) else None,
    }


def _decode_unverified_jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    try:
        payload = json.loads(_urlsafe_decode(parts[1]).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


@router.post(
    "/register",
    response_model=AuthSessionResponse,
    summary="注册并登录",
    response_description="新注册用户与本次会话过期时间。",
)
def register(
    payload: AuthRegisterRequest,
    response: Response,
    user_service: UserServiceDep,
) -> AuthSessionResponse:
    try:
        user = user_service.register(
            payload.username,
            payload.password,
            display_name=payload.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    token, expires_at = user_service.create_session_token(user)
    _set_session_cookie(response, token)
    return AuthSessionResponse(user=user, expires_at=expires_at)


@router.post(
    "/login",
    response_model=AuthSessionResponse,
    summary="登录",
    response_description="当前用户与本次会话过期时间。",
)
def login(
    payload: AuthCredentials,
    response: Response,
    user_service: UserServiceDep,
) -> AuthSessionResponse:
    user = user_service.authenticate(payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误。")

    token, expires_at = user_service.create_session_token(user)
    _set_session_cookie(response, token)
    return AuthSessionResponse(user=user, expires_at=expires_at)


@router.get(
    "/zx/login",
    include_in_schema=False,
)
async def zx_auth_login(
    settings: SettingsDep,
    next_path: str = Query("/", alias="next"),
) -> RedirectResponse:
    _require_zx_auth_settings(settings)
    discovery = await _load_zx_discovery(settings)
    authorization_endpoint = discovery.get("authorization_endpoint")
    if not isinstance(authorization_endpoint, str) or not authorization_endpoint:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ZX Auth missing authorization endpoint.")

    state_value = _create_zx_state(settings, next_path)
    params = {
        "response_type": "code",
        "client_id": settings.zx_auth_client_id,
        "redirect_uri": settings.zx_auth_redirect_uri,
        "scope": settings.zx_auth_scope,
        "state": state_value,
    }
    return RedirectResponse(f"{authorization_endpoint}?{urlencode(params)}")


@router.post(
    "/zx/callback",
    response_model=AuthSessionResponse,
    summary="ZX Auth 回调换取登录态",
    response_description="当前用户与本次会话过期时间。",
)
async def zx_auth_callback(
    payload: ZxAuthCallbackRequest,
    response: Response,
    settings: SettingsDep,
    user_service: UserServiceDep,
) -> AuthSessionResponse:
    _require_zx_auth_settings(settings)
    _read_zx_state(settings, payload.state)
    discovery = await _load_zx_discovery(settings)
    token_endpoint = discovery.get("token_endpoint")
    if not isinstance(token_endpoint, str) or not token_endpoint:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ZX Auth missing token endpoint.")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_response = await client.post(
                token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": payload.code,
                    "redirect_uri": settings.zx_auth_redirect_uri,
                    "client_id": settings.zx_auth_client_id,
                    "client_secret": settings.zx_auth_client_secret,
                },
                headers={"Accept": "application/json"},
            )
            token_response.raise_for_status()
            token_payload = token_response.json()

            userinfo = None
            userinfo_endpoint = discovery.get("userinfo_endpoint")
            access_token = token_payload.get("access_token") if isinstance(token_payload, dict) else None
            if isinstance(userinfo_endpoint, str) and isinstance(access_token, str) and access_token:
                userinfo_response = await client.get(
                    userinfo_endpoint,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {access_token}",
                    },
                )
                userinfo_response.raise_for_status()
                userinfo_payload = userinfo_response.json()
                userinfo = userinfo_payload if isinstance(userinfo_payload, dict) else None
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ZX Auth token exchange failed.") from exc

    if not isinstance(token_payload, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ZX Auth returned invalid token payload.")
    id_token_payload = (
        _decode_unverified_jwt_payload(token_payload["id_token"])
        if isinstance(token_payload.get("id_token"), str)
        else {}
    )
    claims = _extract_zx_claims(id_token_payload, userinfo)
    user = user_service.upsert_zx_auth_user(
        subject=str(claims["subject"]),
        username=claims["username"],
        display_name=claims["display_name"],
        email=claims["email"],
    )
    session_token, expires_at = user_service.create_session_token(user)
    _set_session_cookie(response, session_token)
    return AuthSessionResponse(user=user, expires_at=expires_at)


@router.get(
    "/me",
    response_model=AuthMeResponse,
    summary="获取当前登录用户",
    response_description="当前登录用户。",
)
def me(current_user: CurrentUserDep) -> AuthMeResponse:
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return AuthMeResponse(user=current_user)


@router.post(
    "/logout",
    response_model=AuthLogoutResponse,
    summary="退出登录",
    response_description="退出结果。",
)
def logout(response: Response) -> AuthLogoutResponse:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/", samesite="lax")
    return AuthLogoutResponse(ok=True)
