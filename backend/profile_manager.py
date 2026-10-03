import json
from sqlalchemy.orm import Session
from models import Profile

# Neutral defaults used only when no profile row exists yet (fresh install).
# Never put real personal data here: this file is committed to source control.
# Users fill in their own details through the Profile tab, which stores them
# in the local database only.
DEFAULT_PROFILE = {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin_url": "",
    "github_url": "",
    "portfolio_url": "",
    "education_level": "",
    "graduation_year": 0,
    "gpa": "",
    "expected_ctc": "",
    "current_ctc": "",
    "notice_period": "",
    "willing_to_relocate": False,
    "work_authorized": False,
    "years_experience": 0,
    "current_title": "",
    "skills": json.dumps([]),
    "cover_letter_template": "",
    "gender": "",
    "date_of_birth": ""
}

def get_profile(db: Session) -> dict:
    profile = db.query(Profile).first()
    if not profile:
        profile = create_default_profile(db)
    
    # Convert to dict
    return {c.name: getattr(profile, c.name) for c in profile.__table__.columns}

def update_profile(db: Session, data: dict):
    profile = db.query(Profile).first()
    if not profile:
        profile = create_default_profile(db)
        
    for key, value in data.items():
        if hasattr(profile, key):
            setattr(profile, key, value)
            
    db.commit()
    db.refresh(profile)
    return {c.name: getattr(profile, c.name) for c in profile.__table__.columns}

def create_default_profile(db: Session):
    profile = Profile(**DEFAULT_PROFILE)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile
