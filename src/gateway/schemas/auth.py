from __future__ import annotations

from pydantic import BaseModel, Field


class AuthUser(BaseModel):
    """Public user profile returned to the frontend."""

    id: str = Field(description="用户唯一标识。")
    username: str = Field(description="登录用户名。")
    display_name: str = Field(description="用户展示名称。")
    learner_id: str = Field(description="该用户绑定的学习者画像标识。")
    created_at: str = Field(description="用户创建时间。")


class AuthCredentials(BaseModel):
    """Username/password credentials for login."""

    username: str = Field(..., min_length=1, description="用户名。")
    password: str = Field(..., min_length=1, description="密码。")


class AuthRegisterRequest(AuthCredentials):
    """Registration payload."""

    display_name: str | None = Field(default=None, description="可选展示名称。")


class AuthSessionResponse(BaseModel):
    """Successful auth response with the current user and expiry."""

    user: AuthUser = Field(description="当前登录用户。")
    expires_at: str = Field(description="本次会话过期时间。")


class AuthMeResponse(BaseModel):
    """Current user response."""

    user: AuthUser = Field(description="当前登录用户。")


class AuthLogoutResponse(BaseModel):
    """Logout response."""

    ok: bool = Field(description="是否成功退出。")


class ZxAuthCallbackRequest(BaseModel):
    """ZX Auth authorization-code callback payload from the frontend."""

    code: str = Field(..., min_length=1, description="授权服务器返回的 code。")
    state: str = Field(..., min_length=1, description="登录发起时生成的 state。")
