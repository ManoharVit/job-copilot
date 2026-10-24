import json
import re

from skill_experience import confirmed_skill_years

from compensation import compensation_field, compensation_request

def match_fields(fields: list[dict], profile: dict) -> dict:
    """
    fields: list of {index, label, name, placeholder, type, tag, options}
    profile: user profile dict
    Returns: {index: value_to_fill}
    """
    result = {}
    
    for field in fields:
        idx = field.get("index")
        if idx is None:
            continue
            
        label = str(field.get("label", field.get("context", ""))).lower()
        name = str(field.get("name", "")).lower()
        placeholder = str(field.get("placeholder", "")).lower()
        field_id = str(field.get("id", "")).lower()
        field_type = str(field.get("type", "")).lower()
        tag = str(field.get("tag", "")).lower()
        options = field.get("options", [])
        
        degree_pref = field.get("degree_preference")
        combined_text = f"{label} {name} {field_id} {placeholder}"
        
        val = _get_best_match(combined_text, field_type, tag, options, profile, degree_pref)
        if val is not None and val != "":
            result[idx] = val
            
    return result

def _get_target_education(text: str, profile: dict, degree_pref: str = None) -> dict:
    records_raw = profile.get("education_records", "[]")
    if isinstance(records_raw, str):
        try:
            records = json.loads(records_raw)
        except Exception:
            records = []
    else:
        records = records_raw or []

    if records:
        pref = (degree_pref or "").lower()
        t = text.lower()

        # Explicit context signals in the field text/label
        if any(k in t for k in ["post grad", "post-grad", "postgraduate", "post graduation", "master", "m.sc", "ms "]):
            chosen_level = "master"
        elif any(k in t for k in ["under grad", "under-grad", "undergraduate", "bachelor", "b.tech", "b.e", "btech", "diploma"]):
            chosen_level = "bachelor"
        elif pref in ["master", "bachelor"]:
            chosen_level = pref
        else:
            chosen_level = "master"

        # Match by level attribute
        for r in records:
            if r.get("level", "").lower() == chosen_level:
                return r

        # Match by keywords in degree or degree_alt
        if chosen_level == "bachelor":
            for r in records:
                deg_str = f"{r.get('degree', '')} {r.get('degree_alt', '')}".lower()
                if any(k in deg_str for k in ["bachelor", "b.tech", "b.e", "undergraduate"]):
                    return r
        elif chosen_level == "master":
            for r in records:
                deg_str = f"{r.get('degree', '')} {r.get('degree_alt', '')}".lower()
                if any(k in deg_str for k in ["master", "m.sc", "ms", "postgraduate"]):
                    return r

        return {}  # Never substitute a different degree level.

    # Legacy profile fallback when no education_records exist
    edu_level = profile.get("education_level", "")
    deg = edu_level.split(" in ")[0].strip() if " in " in edu_level else edu_level
    spec = edu_level.split(" in ")[1].strip() if " in " in edu_level else ""
    grad_year = str(profile.get("graduation_year") or "")
    start_year = str(profile.get("start_year") or "")
    return {
        "level": "master" if any(k in edu_level.lower() for k in ["master", "ms", "m.s"]) else "bachelor" if edu_level else "",
        "degree": deg,
        "degree_alt": edu_level,
        "specialization": spec,
        "university": profile.get("university") or "",
        "course_type": profile.get("course_type", ""),
        "start_year": start_year,
        "end_year": grad_year,
        "grading_system": profile.get("grading_system", ""),
        "gpa": str(profile.get("gpa") or "")
    }

def _format_salary(val: str, field_type: str, text: str = "") -> str:
    if not val:
        return ""
    val_str = str(val).strip()
    if field_type in ["number", "numeric", "decimal"]:
        m = re.search(r'\d+(?:\.\d+)?', val_str.replace(",", ""))
        return m.group(0) if m else val_str

    if any(k in val_str.lower() for k in ["lpa", "k", "lac", "lakh", "$", "€", "£", "₹", "rs"]):
        return val_str

    if re.match(r'^\d+(?:\.\d+)?$', val_str):
        if any(k in text.lower() for k in ["lpa", "rs lpa", "(rs lpa)", "lac", "lakh", "ctc", "salary", "compensation"]) or not text:
            return f"{val_str} LPA"

    return val_str

_MANUAL_REVIEW = re.compile(
    r"\b(?:authori[sz](?:ed|ation)|visa|sponsor(?:ship|ed)?|work permit|"
    r"itar|citizenship|citizen|legally eligible|consent|background check|drug test)\b",
    re.IGNORECASE,
)


def requires_manual_review(text: str) -> bool:
    return bool(_MANUAL_REVIEW.search(text.replace('_', ' ')))


def _get_best_match(text, field_type, tag, options, profile, degree_pref=None):
    # Jurisdiction, eligibility and consent are candidate decisions, never guesses.
    if requires_manual_review(text):
        return None
    # Resolve components before general matching: total CTC is not fixed pay.
    if compensation_request(text) is not None:
        return compensation_field(text, field_type, options, profile, _format_salary)
    if re.search(r"\b(?:experience|proficiency)\b", text):
        specific, years = confirmed_skill_years(text, profile)
        if specific:
            if years is None:
                return None
            return _pick_experience_range(options, years) if options else str(years)
    # --- Certifications ---
    certs_raw = profile.get("certifications", "[]")
    if isinstance(certs_raw, str):
        try:
            certs = json.loads(certs_raw)
        except Exception:
            certs = []
    else:
        certs = certs_raw or []

    primary_cert = certs[0] if certs else {}

    # 1. Certification Name
    if any(k in text for k in ["cert name", "certificate name", "certification name", "name of certificate", "name of certification", "name of the certificate", "course / certification name"]) or (
        any(k in text for k in ["cert", "certificate", "certification"]) and "name" in text and not any(k in text for k in ["user", "applicant", "candidate", "your name"])
    ):
        return primary_cert.get("name") if primary_cert else None

    # 2. Issuer / Issued By
    elif any(k in text for k in ["issued by", "issuer", "issuing organization", "issuing body", "issuing authority", "certifying body", "institute / organization", "organization name"]) and (
        any(k in text for k in ["cert", "issue", "org", "authority"]) or not any(k in text for k in ["user", "applicant", "school", "college", "university"])
    ):
        return primary_cert.get("issuer") if primary_cert else None

    # 3. Validity / Issue Year / Expire Year
    elif any(k in text for k in ["issue year", "certification year", "cert year", "year of issue"]):
        yr = str(primary_cert.get("issue_year", "")) if primary_cert else None
        if yr and options:
            for opt in options:
                if yr in opt:
                    return opt
        return yr
    elif any(k in text for k in ["expire year", "expiry year", "expiration year", "valid till", "valid upto"]):
        yr = str(primary_cert.get("expire_year", "")) if primary_cert else None
        if yr and options:
            for opt in options:
                if yr in opt:
                    return opt
        return yr
    elif any(k in text for k in ["does not expire", "not expire", "no expiry", "lifetime validity"]):
        if primary_cert.get("does_not_expire"):
            return _handle_yes(options, "Yes")
        return "false" if field_type == "checkbox" else "No"

    # 4. Certification URL / Credential URL
    elif any(k in text for k in ["certification url", "certificate url", "credential url", "license url", "certificate link", "certification link"]):
        return primary_cert.get("credential_url") if primary_cert else None
    elif any(k in text for k in ["credential id", "license number", "certification number", "certificate id"]):
        return primary_cert.get("credential_id") if primary_cert else None

    # Fallback: do not let unhandled cert/issuer labels match applicant names/links
    elif any(k in text for k in ["cert", "certificate", "certification", "credential", "license"]):
        return None
    elif any(k in text for k in ["issued by", "issuer", "issuing organization", "issuing body", "issuing authority"]):
        return None

    # --- Name fields ---
    if any(k in text for k in ["first name", "first_name", "firstname", "given name"]):
        return profile.get("name", "").split()[0] if profile.get("name") else ""
    elif any(k in text for k in ["last name", "last_name", "lastname", "surname", "family name"]):
        return profile.get("name", "").split()[-1] if profile.get("name") else ""
    elif any(k in text for k in ["full name", "fullname", "your name", "candidate name", "applicant name"]):
        return profile.get("name", "")
    elif re.search(r'\bname\b', text) and not any(k in text for k in [
        "company", "user", "cert", "project", "school", "college", "university",
        "institute", "institution", "org", "issuer", "issue", "skill", "file",
        "course", "degree", "account", "bank", "branch", "referee", "reference",
        "nominee", "emergency"
    ]):
        return profile.get("name", "")
    
    # --- Contact ---
    elif any(k in text for k in ["email", "e-mail", "e_mail"]):
        return profile.get("email", "")
    elif re.search(r"\b(?:phone|mobile|tel|telephone)(?:number|no)?\b|\bcontact number\b", text.replace("_", " ")):
        return profile.get("phone", "")
    
    # --- Location ---
    elif any(k in text for k in ["city", "location", "where are you", "current city"]):
        if options:
            loc = profile.get("location", "").lower()
            # Try exact city match first
            city = loc.split(",")[0].strip() if "," in loc else loc
            for opt in options:
                if city and (city == opt.lower().strip() or loc == opt.lower().strip()):
                    return opt
            for opt in options:
                if "any" in opt.lower() or "other" in opt.lower():
                    return opt
        return profile.get("location", "").split(",")[0].strip() if "," in profile.get("location", "") else profile.get("location", "")
    elif any(k in text for k in ["state", "province"]):
        loc = profile.get("location", "")
        parts = [p.strip() for p in loc.split(",")]
        if options:
            for part in parts:
                for opt in options:
                    if part and part.lower() == opt.lower().strip():
                        return opt
        return parts[1] if len(parts) > 1 else ""
    elif any(k in text for k in ["country", "nation"]):
        loc = profile.get("location", "")
        parts = [p.strip() for p in loc.split(",")]
        if options:
            for part in parts:
                for opt in options:
                    if part and part.lower() == opt.lower().strip():
                        return opt
        return parts[-1] if len(parts) > 1 else loc
    
    # --- Links & Social Profiles ---
    # 1. Specific platforms (exact matchers)
    elif "linkedin" in text:
        return profile.get("linkedin_url", "")
    elif "github" in text or "gh link" in text or "gh url" in text:
        return profile.get("github_url", "")
    elif "bitbucket" in text:
        return profile.get("bitbucket_url", "") or None
    elif "gitlab" in text:
        return profile.get("gitlab_url", "") or None
    elif any(k in text for k in ["twitter", "tweet"]) or re.search(r'\b(?:x\s*[/|]\s*twitter|twitter\s*[/|]\s*x|x\s+url|x\s+profile|x\s+handle|x\s+link)\b', text):
        return profile.get("twitter_url", "") or profile.get("x_url", "") or None
    elif any(k in text for k in ["stackoverflow", "stack overflow"]):
        return profile.get("stackoverflow_url", "") or None
    elif any(k in text for k in ["dribbble", "dribble"]):
        return profile.get("dribbble_url", "") or None
    elif "behance" in text:
        return profile.get("behance_url", "") or None
    elif any(k in text for k in ["medium", "substack", "dev.to", "hashnode"]):
        return profile.get("blog_url", "") or profile.get("medium_url", "") or None
    elif "kaggle" in text:
        return profile.get("kaggle_url", "") or None
    elif any(k in text for k in ["leetcode", "hackerrank", "codechef", "codeforces"]):
        return profile.get("leetcode_url", "") or profile.get("coding_url", "") or None

    # 2. Platform dropdown selector
    elif any(k in text for k in ["platform", "link type", "social platform", "account type", "profile type", "select platform"]):
        if options:
            for opt in options:
                if "linkedin" in opt.lower() and profile.get("linkedin_url"):
                    return opt
                if "github" in opt.lower() and profile.get("github_url"):
                    return opt
            return None
        return "LinkedIn" if profile.get("linkedin_url") else "GitHub"

    # 3. Portfolio, personal website, or personal blog
    elif any(k in text for k in ["portfolio", "personal website", "personal site", "personal blog", "personal page"]) or re.search(r'\b(?:website\s*[/|]\s*blog|blog\s*[/|]\s*portfolio|website\s*[/|]\s*portfolio|personal\s+url)\b', text):
        return profile.get("portfolio_url", "") or None
    elif any(k in text for k in ["resume link", "resume url"]):
        return profile.get("portfolio_url", "") or profile.get("linkedin_url", "")

    # 4. Explicit non-applicant media or platform links
    elif any(k in text for k in [
        "cert", "credential", "license", "project", "company", "employer",
        "publication", "reference", "doc", "file", "video", "avatar", "photo",
        "image", "logo", "icon", "youtube", "vimeo", "twitch", "discord",
        "telegram", "reddit", "instagram", "facebook"
    ]):
        return None

    # 5. Generic profile link / web address (e.g. single generic "Link", "Profile URL", "Web Address")
    elif any(k in text for k in ["social link", "profile link", "web address"]) or re.search(r'^\s*(?:link|url|website|web\s*site|profile)\s*$', text) or re.search(r'\b(?:profile\s*url|profile\s*link|social\s*url|social\s*link|web\s*link)\b', text):
        return profile.get("linkedin_url", "") or profile.get("github_url", "") or profile.get("portfolio_url", "") or None
    
    # --- Professional ---
    elif any(k in text for k in ["current title", "job title", "current role", "current designation", "designation"]):
        return profile.get("current_title", "")
    elif any(k in text for k in ["enter skill", "search skill", "add skill", "select skill"]) or (re.search(r'\bskill\b', text) and not any(k in text for k in ["skills", "key", "technical", "core", "summary", "list"])):
        skills_raw = profile.get("skills", "[]")
        if isinstance(skills_raw, str):
            try:
                skills = json.loads(skills_raw)
            except Exception:
                skills = [skills_raw]
        else:
            skills = skills_raw
        return skills[0] if skills else ""
    elif any(k in text for k in ["key skill", "skills", "technical skill", "core skill"]):
        skills_raw = profile.get("skills", "[]")
        if isinstance(skills_raw, str):
            try:
                skills = json.loads(skills_raw)
            except:
                skills = [skills_raw]
        else:
            skills = skills_raw
        return ", ".join(skills[:10])
    elif any(k in text for k in ["experience level", "experience_level"]):
        exp = profile.get("years_experience", 2)
        if options:
            # Try to find matching option
            for opt in options:
                opt_l = opt.lower()
                if exp == 0 and ("fresher" in opt_l or "entry" in opt_l or "0" in opt_l):
                    return opt
                if 1 <= exp <= 3 and ("1" in opt_l or "2" in opt_l or "junior" in opt_l or "entry" in opt_l):
                    return opt
                if 3 < exp <= 6 and ("mid" in opt_l or "3" in opt_l or "5" in opt_l):
                    return opt
                if exp > 6 and ("senior" in opt_l or "6" in opt_l or "7" in opt_l):
                    return opt
            return None
        return str(exp)
    elif any(k in text for k in ["experience", "years", "how many", "how long", "proficiency"]):
        # Total tenure does not establish years in a specific skill or employer.
        if re.search(r"\bproficiency\b|\bexperience\b.*\b(?:in|with|using|on|at)\b", text):
            return None
        years = profile.get("years_experience")
        if isinstance(years, bool) or not isinstance(years, (int, float)) or years < 0:
            return None
        if options:
            return _pick_experience_range(options, years)
        return str(years)

    elif any(k in text for k in ["notice", "joining", "start date", "notice period", "when can you join"]):
        if options:
            notice = re.sub(r"[^a-z0-9]", "", profile.get("notice_period", "").lower())
            for opt in options:
                if notice and re.sub(r"[^a-z0-9]", "", opt.lower()) == notice:
                    return opt
            return None
        return profile.get("notice_period", "")
    
    # --- Education & Academic Details ---
    elif any(k in text for k in ["course type", "study mode", "full time", "part time", "education type"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        course_type = target_edu.get("course_type", "")
        if not course_type:
            return None
        if options:
            for opt in options:
                if course_type.lower() == opt.lower().strip():
                    return opt
            return None
        return course_type
    elif any(k in text for k in ["start year", "from year", "joining year", "commencement", "starting year"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        start_year = str(target_edu.get("start_year") or "")
        if not start_year:
            return None
        if options:
            for opt in options:
                if start_year in opt:
                    return opt
            return None
        return start_year
    elif any(k in text for k in ["end year", "completion", "passing year", "year of passing", "graduation", "batch", "to year", "passing out"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        end_year = str(target_edu.get("end_year") or target_edu.get("graduation_year") or profile.get("graduation_year") or "")
        if not end_year:
            return None
        if options:
            for opt in options:
                if end_year in opt:
                    return opt
            return None
        return end_year
    elif any(k in text for k in ["grading system", "grade scale", "grading scale"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        grading_sys = target_edu.get("grading_system", "")
        if not grading_sys:
            return None
        if options:
            for opt in options:
                if grading_sys.lower() in opt.lower() or opt.lower() in grading_sys.lower():
                    return opt
            if "10" in grading_sys or "cgpa" in grading_sys.lower():
                for opt in options:
                    if "10" in opt.lower() or "cgpa" in opt.lower():
                        return opt
            else:
                for opt in options:
                    if "4" in opt.lower() or ("gpa" in opt.lower() and "cgpa" not in opt.lower()):
                        return opt
            return None
        return grading_sys
    elif any(k in text for k in ["obtained marks", "marks", "score", "cgpa", "gpa", "grade", "percentage", "aggregate"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        return str(target_edu.get("gpa") or profile.get("gpa", ""))
    elif any(k in text for k in ["university", "college", "institute", "school", "institution", "campus"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        uni = target_edu.get("university") or profile.get("university") or ""
        if not uni:
            return None
        if options:
            for opt in options:
                if uni.lower() in opt.lower():
                    return opt
            if "vellore" in uni.lower():
                for opt in options:
                    if "vit" in opt.lower() or "vellore" in opt.lower():
                        return opt
            if tag == "select" or field_type == "select":
                return None
        return uni
    elif any(k in text for k in ["specialization", "stream", "branch", "major", "field of study", "course"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        spec = target_edu.get("specialization", "")
        if not spec:
            edu = profile.get("education_level", "")
            spec = edu.split(" in ")[1].strip() if " in " in edu else ""
        if not spec:
            return None
        if options:
            for opt in options:
                if spec.lower() in opt.lower():
                    return opt
            if any(w in spec.lower() for w in ["computer", "data", "analytics"]):
                for opt in options:
                    if any(w in opt.lower() for w in ["computer", "data", "analytics"]):
                        return opt
            if tag == "select" or field_type == "select":
                return None
        return spec
    elif any(k in text for k in ["education", "degree", "qualification", "highest qualification"]):
        target_edu = _get_target_education(text, profile, degree_pref)
        if not target_edu:
            return None
        deg = target_edu.get("degree", "")
        deg_alt = target_edu.get("degree_alt", "")
        if options:
            for opt in options:
                if deg and deg.lower() in opt.lower():
                    return opt
                if deg_alt and deg_alt.lower() in opt.lower():
                    return opt
            level = target_edu.get("level", "")
            if level == "bachelor":
                for opt in options:
                    if any(k in opt.lower() for k in ["b.tech", "b.e", "bachelor", "ug", "under"]):
                        return opt
                for opt in options:
                    if "graduat" in opt.lower() and "post" not in opt.lower():
                        return opt
            elif level == "master":
                for opt in options:
                    if any(k in opt.lower() for k in ["m.sc", "ms", "master", "pg", "post"]):
                        return opt
                for opt in options:
                    if "post" in opt.lower():
                        return opt
            return None
        return deg or deg_alt
    
    # --- Personal ---
    elif any(k in text for k in ["gender"]):
        if options:
            gender = profile.get("gender", "").lower()
            for opt in options:
                if gender in opt.lower():
                    return opt
        return profile.get("gender", "")
    elif any(k in text for k in ["date of birth", "dob", "birth date", "birthday"]):
        return profile.get("date_of_birth", "")
    elif any(k in text for k in ["age"]):
        return profile.get("date_of_birth", "")
    elif any(k in text for k in ["relocat", "willing to move"]):
        willing = profile.get("willing_to_relocate")
        return _handle_yes(options, "Yes" if willing else "No") if isinstance(willing, bool) else None
    
    # --- Content fields ---
    elif any(k in text for k in ["cover letter", "why this role", "about yourself", "about you",
                                   "professional summary", "professional background", "summary"]):
        return profile.get("cover_letter_template", "")
    elif any(k in text for k in ["additional", "comment", "note", "message", "anything else"]):
        return "Looking forward to this opportunity."
    
    # --- Boolean fields ---
    elif any(k in text for k in ["night shift", "rotational", "flexible", "weekend", "travel", "commute", "internship", "duration", "months"]):
        return None  # No explicit profile preference exists for these questions.
        
    # Unrecognized choices require manual review; no affirmative fallback.
        
    # Default fallback — don't fill with garbage
    return None

def _handle_yes(options, default_val):
    if options:
        expected = {"yes", "true", "y", "1"} if default_val.lower() == "yes" else {"no", "false", "n", "0"}
        return next((option for option in options if option.strip().lower() in expected), None)
    return default_val

def _pick_experience_range(options, years):
    """Pick the best matching experience range from dropdown options."""
    if years == 0:
        for opt in options:
            if opt.strip().lower() in {"not much", "none", "no experience", "0 years", "fresher"}:
                return opt
    # Try exact match first
    for opt in options:
        # Match patterns like "1-2", "2-3", etc.
        match = re.search(r'(\d+)\s*(?:-|–|to)\s*(\d+)', opt)
        if match:
            low, high = int(match.group(1)), int(match.group(2))
            if low <= years <= high:
                return opt
    
    # Try "X+ years" pattern
    for opt in options:
        match = re.search(r'(\d+)\+', opt)
        if match and years >= int(match.group(1)):
            return opt
    
    # Fresher
    if years <= 1:
        for opt in options:
            if "fresher" in opt.lower() or "0" in opt:
                return opt
    
    # Leave unmatched ranges for manual review.
    if options:
        return None
    return str(years)
