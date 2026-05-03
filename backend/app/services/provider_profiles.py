from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Setting
from app.schemas.api import CustomProviderProfile
from extraction_core.models import LLMProviderSettings


CUSTOM_PROVIDER_PROFILES_KEY = "custom_provider_profiles"


def list_custom_provider_profiles(db: Session) -> list[CustomProviderProfile]:
    setting = db.query(Setting).filter(Setting.key == CUSTOM_PROVIDER_PROFILES_KEY).first()
    payload = setting.value if setting else []
    return [CustomProviderProfile.model_validate(item) for item in payload]


def create_custom_provider_profile(db: Session, name: str, settings: LLMProviderSettings) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db)
    if any(profile.name == name for profile in profiles):
        raise HTTPException(status_code=409, detail="Custom provider profile name already exists.")

    now = datetime.now(UTC)
    profile = CustomProviderProfile(
        id=str(uuid4()),
        name=name,
        settings=settings,
        created_at=now,
        updated_at=now,
    )
    _save_profiles(db, [*profiles, profile])
    return profile


def update_custom_provider_profile(db: Session, profile_id: str, name: str, settings: LLMProviderSettings) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db)
    target = next((profile for profile in profiles if profile.id == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    if any(profile.name == name and profile.id != profile_id for profile in profiles):
        raise HTTPException(status_code=409, detail="Custom provider profile name already exists.")

    updated = CustomProviderProfile(
        id=target.id,
        name=name,
        settings=settings,
        created_at=target.created_at,
        updated_at=datetime.now(UTC),
    )
    next_profiles = [updated if profile.id == profile_id else profile for profile in profiles]
    _save_profiles(db, next_profiles)
    return updated


def delete_custom_provider_profile(db: Session, profile_id: str) -> None:
    profiles = list_custom_provider_profiles(db)
    if not any(profile.id == profile_id for profile in profiles):
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    next_profiles = [profile for profile in profiles if profile.id != profile_id]
    _save_profiles(db, next_profiles)


def get_custom_provider_profile(db: Session, profile_id: str) -> CustomProviderProfile:
    profiles = list_custom_provider_profiles(db)
    target = next((profile for profile in profiles if profile.id == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Custom provider profile not found.")
    return target


def _save_profiles(db: Session, profiles: list[CustomProviderProfile]) -> None:
    setting = db.query(Setting).filter(Setting.key == CUSTOM_PROVIDER_PROFILES_KEY).first()
    payload = [profile.model_dump(mode="json") for profile in profiles]
    if setting:
        setting.value = payload
    else:
        setting = Setting(key=CUSTOM_PROVIDER_PROFILES_KEY, value=payload)
        db.add(setting)
    db.commit()
