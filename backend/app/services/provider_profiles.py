from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from extraction_core.models import LLMProviderSettings
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tenant import build_tenant_setting_key
from app.models import Setting
from app.schemas.api import CustomProviderProfile

CUSTOM_PROVIDER_PROFILES_KEY = "custom_provider_profiles"


def list_custom_provider_profiles(db: Session, tenant_id: str) -> list[CustomProviderProfile]:
    setting = (
        db.query(Setting)
        .filter(Setting.key == build_tenant_setting_key(tenant_id, CUSTOM_PROVIDER_PROFILES_KEY))
        .first()
    )
    payload = setting.value if setting else []
    return [CustomProviderProfile.model_validate(item) for item in payload]


def create_custom_provider_profile(
    db: Session, tenant_id: str, name: str, settings: LLMProviderSettings
) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db, tenant_id)
    if any(profile.name == name for profile in profiles):
        raise HTTPException(status_code=409, detail="Custom provider profile name already exists.")

    now = datetime.now(UTC)
    profile = CustomProviderProfile(
        id=str(uuid4()),
        name=name,
        settings=settings,
        last_probe_at=None,
        last_probe_status=None,
        last_probe_detail=None,
        created_at=now,
        updated_at=now,
    )
    _save_profiles(db, tenant_id, [*profiles, profile])
    return profile


def update_custom_provider_profile(
    db: Session, tenant_id: str, profile_id: str, name: str, settings: LLMProviderSettings
) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db, tenant_id)
    target = next((profile for profile in profiles if profile.id == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    if any(profile.name == name and profile.id != profile_id for profile in profiles):
        raise HTTPException(status_code=409, detail="Custom provider profile name already exists.")

    updated = CustomProviderProfile(
        id=target.id,
        name=name,
        settings=settings,
        last_probe_at=target.last_probe_at,
        last_probe_status=target.last_probe_status,
        last_probe_detail=target.last_probe_detail,
        created_at=target.created_at,
        updated_at=datetime.now(UTC),
    )
    next_profiles = [updated if profile.id == profile_id else profile for profile in profiles]
    _save_profiles(db, tenant_id, next_profiles)
    return updated


def delete_custom_provider_profile(db: Session, tenant_id: str, profile_id: str) -> None:
    profiles = list_custom_provider_profiles(db, tenant_id)
    if not any(profile.id == profile_id for profile in profiles):
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    next_profiles = [profile for profile in profiles if profile.id != profile_id]
    _save_profiles(db, tenant_id, next_profiles)


def get_custom_provider_profile(db: Session, tenant_id: str, profile_id: str) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db, tenant_id)
    target = next((profile for profile in profiles if profile.id == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    return target


def record_custom_provider_profile_probe(
    db: Session,
    tenant_id: str,
    profile_id: str,
    *,
    status: str,
    detail: str,
) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db, tenant_id)
    target = next((profile for profile in profiles if profile.id == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")

    updated = CustomProviderProfile(
        id=target.id,
        name=target.name,
        settings=target.settings,
        last_probe_at=datetime.now(UTC),
        last_probe_status=status,
        last_probe_detail=detail,
        created_at=target.created_at,
        updated_at=datetime.now(UTC),
    )
    next_profiles = [updated if profile.id == profile_id else profile for profile in profiles]
    _save_profiles(db, tenant_id, next_profiles)
    return updated


def custom_provider_profile_probe_is_stale(profile: CustomProviderProfile) -> bool:
    if not profile.last_probe_at:
        return True
    if profile.last_probe_status != "reachable":
        return True
    return datetime.now(UTC) - profile.last_probe_at > timedelta(hours=settings.custom_provider_probe_max_age_hours)


def require_fresh_custom_provider_profile_probe(profile: CustomProviderProfile) -> None:
    if not custom_provider_profile_probe_is_stale(profile):
        return

    if not profile.last_probe_at:
        raise HTTPException(
            status_code=400,
            detail="Custom provider activation blocked until the saved profile is reverified. No successful probe is recorded.",
        )

    raise HTTPException(
        status_code=400,
        detail=(
            "Custom provider activation blocked until the saved profile is reverified. "
            f"Last successful probe is older than {settings.custom_provider_probe_max_age_hours} hours."
        ),
    )


def _save_profiles(db: Session, tenant_id: str, profiles: list[CustomProviderProfile]) -> None:
    setting_key = build_tenant_setting_key(tenant_id, CUSTOM_PROVIDER_PROFILES_KEY)
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    payload = [profile.model_dump(mode="json") for profile in profiles]
    if setting:
        setting.value = payload
    else:
        setting = Setting(key=setting_key, value=payload)
        db.add(setting)
    db.commit()
