from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    actor: str
    role: str


def _load_bearer_tokens() -> dict[str, AuthContext]:
    raw = settings.auth_bearer_tokens_json
    if not raw or not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("AUTH_BEARER_TOKENS_JSON must be a JSON object.")
    tokens: dict[str, AuthContext] = {}
    for token, payload in parsed.items():
        if not isinstance(token, str) or not token.strip():
            raise ValueError("AUTH_BEARER_TOKENS_JSON keys must be non-empty strings.")
        if not isinstance(payload, dict):
            raise ValueError("AUTH_BEARER_TOKENS_JSON entry for token must be an object.")
        actor = payload.get("actor")
        role = payload.get("role")
        if not isinstance(actor, str) or not actor.strip():
            raise ValueError("AUTH_BEARER_TOKENS_JSON entry for token must include actor.")
        if not isinstance(role, str) or not role.strip():
            raise ValueError("AUTH_BEARER_TOKENS_JSON entry for token must include role.")
        tokens[token] = AuthContext(actor=actor.strip(), role=role.strip().lower())
    return tokens


def resolve_auth_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> AuthContext:
    if not settings.require_authentication:
        return AuthContext(actor="local-user", role="admin")

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_map = _load_bearer_tokens()
    if not token_map:
        raise HTTPException(
            status_code=503,
            detail="Authentication is enabled but AUTH_BEARER_TOKENS_JSON is not configured.",
        )

    auth = token_map.get(credentials.credentials)
    if auth is None:
        raise HTTPException(status_code=401, detail="Invalid bearer token.")

    request.state.auth_actor = auth.actor
    request.state.auth_role = auth.role
    return auth
