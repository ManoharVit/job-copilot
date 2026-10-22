"""Tests for field matching rules and /api/match-fields."""
from field_matcher import match_fields


def test_name_matching_excludes_certifications_and_issuers():
    profile = {
        "name": "Alex Morgan Example",
        "email": "alex@example.com",
        "linkedin_url": "https://linkedin.example/alex",
        "education_level": "Master of Science in Data Analytics Engineering",
        "graduation_year": 2024,
        "gpa": "3.5",
    }

    fields = [
        {"index": 0, "label": "Certification Name"},
        {"index": 1, "label": "Issued By", "name": "issuer_name", "placeholder": "Enter organization name"},
        {"index": 2, "label": "Certification URL"},
        {"index": 3, "label": "Full Name"},
        {"index": 4, "label": "First Name"},
        {"index": 5, "label": "Last Name"},
    ]

    res = match_fields(fields, profile)

    # Certification fields must never match applicant personal info
    assert 0 not in res or res[0] is None
    assert 1 not in res or res[1] is None
    assert 2 not in res or res[2] is None

    # Personal name fields must match correctly
    assert res[3] == "Alex Morgan Example"
    assert res[4] == "Alex"
    assert res[5] == "Example"


def test_academic_and_link_matching():
    profile = {
        "name": "Alex Morgan Example",
        "linkedin_url": "https://linkedin.example/alex",
        "github_url": "https://github.example/alex",
        "education_level": "Master of Science in Data Analytics Engineering",
        "graduation_year": 2024,
        "gpa": "3.5",
    }

    fields = [
        {"index": 0, "label": "Education"},
        {"index": 1, "label": "Enter & Select University/College"},
        {"index": 2, "label": "Platform", "options": ["LinkedIn", "GitHub"]},
        {"index": 3, "label": "Link"},
        {"index": 4, "label": "Course Type", "options": ["Full Time", "Part Time"]},
        {"index": 5, "label": "Start Year"},
        {"index": 6, "label": "End Year"},
        {"index": 7, "label": "Grading System"},
        {"index": 8, "label": "Obtained Marks"},
    ]

    res = match_fields(fields, profile)

    assert res[0] == "Master of Science"
    assert 1 not in res  # University is absent from this profile.
    assert res[2] == "LinkedIn"
    assert res[3] == "https://linkedin.example/alex"
    assert 4 not in res  # Course type requires an explicit record.
    assert 5 not in res  # Start year cannot be inferred from graduation.
    assert res[6] == "2024"
    assert 7 not in res  # GPA scale is not supplied.
    assert res[8] == "3.5"


def test_api_match_fields_endpoint(client):
    client.put("/api/profile", json={"name": "Alex Morgan Example"})
    payload = [
        {"index": 0, "label": "Certification Name"},
        {"index": 1, "label": "Issued By"},
        {"index": 2, "label": "Certification URL"},
        {"index": 3, "label": "Full Name"},
    ]
    response = client.post("/api/match-fields", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "0" not in data or data["0"] is None
    assert "1" not in data or data["1"] is None
    assert "2" not in data or data["2"] is None
    assert data.get("3") == "Alex Morgan Example"


def test_certification_matching_when_profile_has_certifications():
    import json

    certs = [
        {
            "name": "Certified Machine Learning Engineer - Associate",
            "issuer": "Amazon Web Services (AWS)",
            "issue_year": 2024,
            "expire_year": 2027,
            "does_not_expire": False,
            "credential_url": "https://www.credly.com/aws/cmla",
            "credential_id": "AWS-MLA-12345",
        }
    ]

    profile = {
        "name": "Alex Morgan Example",
        "certifications": json.dumps(certs),
    }

    fields = [
        {"index": 0, "label": "Certification Name"},
        {"index": 1, "label": "Issued By"},
        {"index": 2, "label": "Issue Year", "options": ["2023", "2024", "2025"]},
        {"index": 3, "label": "Expire Year", "options": ["2026", "2027", "2028"]},
        {"index": 4, "label": "Certification URL"},
        {"index": 5, "label": "Credential ID"},
        {"index": 6, "label": "This certification does not expire", "type": "checkbox"},
    ]

    res = match_fields(fields, profile)

    assert res[0] == "Certified Machine Learning Engineer - Associate"
    assert res[1] == "Amazon Web Services (AWS)"
    assert res[2] == "2024"
    assert res[3] == "2027"
    assert res[4] == "https://www.credly.com/aws/cmla"
    assert res[5] == "AWS-MLA-12345"
    assert res[6] == "false"


def test_single_skill_vs_multi_skill_matching():
    import json

    profile = {
        "skills": json.dumps(["Python", "SQL", "FastAPI", "Docker"]),
    }

    fields = [
        {"index": 0, "label": "Skill", "placeholder": "Enter Skill"},
        {"index": 1, "label": "Add Skill"},
        {"index": 2, "label": "Key Skills"},
        {"index": 3, "label": "Technical Skills", "tag": "textarea"},
    ]

    res = match_fields(fields, profile)

    # Singular skill inputs receive primary skill to work with autocomplete dropdowns
    assert res[0] == "Python"
    assert res[1] == "Python"

    # Multi-skill inputs receive comma-separated string
    assert res[2] == "Python, SQL, FastAPI, Docker"
    assert res[3] == "Python, SQL, FastAPI, Docker"


def test_multiple_degrees_matching_with_degree_preference():
    import json

    records = [
        {
            "level": "master",
            "degree": "M.Sc - Computers",
            "degree_alt": "Master of Science",
            "specialization": "Data Analytics Engineering",
            "university": "Example Graduate University",
            "course_type": "Full Time",
            "start_year": "2022",
            "end_year": "2024",
            "grading_system": "Scale 4 (GPA)",
            "gpa": "3.64",
        },
        {
            "level": "bachelor",
            "degree": "B.Tech/B.E.",
            "degree_alt": "Bachelor of Technology",
            "specialization": "Computer Science and Engineering",
            "university": "Example Institute of Technology",
            "course_type": "Full Time",
            "start_year": "2018",
            "end_year": "2022",
            "grading_system": "Scale 10 (CGPA)",
            "gpa": "8.5",
        },
    ]

    profile = {
        "education_records": json.dumps(records),
        "education_level": "Master of Science in Data Analytics Engineering",
        "graduation_year": 2024,
        "gpa": "3.64",
    }

    # 1. Test Bachelor's degree preference (e.g. adding undergraduate degree when master is already present)
    bachelor_fields = [
        {"index": 0, "label": "Education", "degree_preference": "bachelor"},
        {"index": 1, "label": "Institute / University", "degree_preference": "bachelor"},
        {"index": 2, "label": "Course / Specialization", "degree_preference": "bachelor"},
        {"index": 3, "label": "Course Type", "degree_preference": "bachelor"},
        {"index": 4, "label": "Starting Year", "degree_preference": "bachelor"},
        {"index": 5, "label": "Passing Year", "degree_preference": "bachelor"},
        {"index": 6, "label": "Grading System", "degree_preference": "bachelor", "options": ["Scale 10 (CGPA)", "Scale 4 (GPA)"]},
        {"index": 7, "label": "Obtained Marks", "degree_preference": "bachelor"},
    ]

    res_bachelor = match_fields(bachelor_fields, profile)
    assert res_bachelor[0] == "B.Tech/B.E."
    assert res_bachelor[1] == "Example Institute of Technology"
    assert res_bachelor[2] == "Computer Science and Engineering"
    assert res_bachelor[3] == "Full Time"
    assert res_bachelor[4] == "2018"
    assert res_bachelor[5] == "2022"
    assert res_bachelor[6] == "Scale 10 (CGPA)"
    assert res_bachelor[7] == "8.5"

    # 2. Test Master's degree preference
    master_fields = [
        {"index": 0, "label": "Education", "degree_preference": "master"},
        {"index": 1, "label": "Institute / University", "degree_preference": "master"},
        {"index": 2, "label": "Course / Specialization", "degree_preference": "master"},
        {"index": 3, "label": "Course Type", "degree_preference": "master"},
        {"index": 4, "label": "Starting Year", "degree_preference": "master"},
        {"index": 5, "label": "Passing Year", "degree_preference": "master"},
        {"index": 6, "label": "Grading System", "degree_preference": "master", "options": ["Scale 10 (CGPA)", "Scale 4 (GPA)"]},
        {"index": 7, "label": "Obtained Marks", "degree_preference": "master"},
    ]

    res_master = match_fields(master_fields, profile)
    assert res_master[0] == "M.Sc - Computers"
    assert res_master[1] == "Example Graduate University"
    assert res_master[2] == "Data Analytics Engineering"
    assert res_master[3] == "Full Time"
    assert res_master[4] == "2022"
    assert res_master[5] == "2024"
    assert res_master[6] == "Scale 4 (GPA)"
    assert res_master[7] == "3.64"


def test_api_match_fields_dict_payload(client):
    import json

    records = [
        {
            "level": "bachelor",
            "degree": "B.Tech/B.E.",
            "university": "Example Institute of Technology",
            "specialization": "Computer Science and Engineering",
            "start_year": "2018",
            "end_year": "2022",
            "grading_system": "Scale 10 (CGPA)",
            "gpa": "8.5",
        }
    ]
    client.put("/api/profile", json={"education_records": json.dumps(records)})

    payload = {
        "degree_preference": "bachelor",
        "fields": [
            {"index": 0, "label": "Education"},
            {"index": 1, "label": "Institute / University"},
            {"index": 2, "label": "Obtained Marks"},
        ],
    }

    response = client.post("/api/match-fields", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data.get("0") == "B.Tech/B.E."
    assert data.get("1") == "Example Institute of Technology"
    assert data.get("2") == "8.5"


def test_dover_compensation_matching_text_and_number():
    profile = {
        "current_ctc": "11.5 LPA",
        "expected_ctc": "15 LPA",
    }

    # Dover fields with type='number'
    number_fields = [
        {"index": 0, "label": "Current annual fixed compensation (Rs LPA) *", "type": "number"},
        {"index": 1, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "number"},
    ]
    res_num = match_fields(number_fields, profile)
    assert res_num[0] == "11.5"
    assert res_num[1] == "15"

    # Dover fields with type='text'
    text_fields = [
        {"index": 0, "label": "Current annual fixed compensation (Rs LPA) *", "type": "text"},
        {"index": 1, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "text"},
    ]
    res_text = match_fields(text_fields, profile)
    assert res_text[0] == "11.5 LPA"
    assert res_text[1] == "15 LPA"


def test_compensation_variations_and_input_types():
    profile = {
        "current_ctc": "11.5 LPA",
        "expected_ctc": "15 LPA",
    }

    fields = [
        {"index": 0, "label": "Annual fixed compensation", "type": "number"},
        {"index": 1, "label": "Fixed compensation", "type": "text"},
        {"index": 2, "label": "Compensation (Rs LPA)", "type": "number"},
        {"index": 3, "label": "Expected Compensation", "type": "text"},
        {"index": 4, "label": "Current CTC", "type": "number"},
        {"index": 5, "label": "Expected CTC", "type": "text"},
        {"index": 6, "label": "Mention your current CTC", "type": "text"},
        {"index": 7, "label": "Desired Salary", "type": "number"},
        {"index": 8, "label": "Present salary", "type": "text"},
        {"index": 9, "label": "Expected annual fixed compensation", "type": "text"},
    ]

    res = match_fields(fields, profile)
    assert res[0] == "11.5"
    assert res[1] == "11.5 LPA"
    assert res[2] == "11.5"
    assert res[3] == "15 LPA"
    assert res[4] == "11.5"
    assert res[5] == "15 LPA"
    assert res[6] == "11.5 LPA"
    assert res[7] == "15"
    assert res[8] == "11.5 LPA"
    assert res[9] == "15 LPA"


def test_bare_numeric_profile_ctc():
    profile = {
        "current_ctc": "11.5",
        "expected_ctc": "15",
    }

    fields = [
        {"index": 0, "label": "Current annual fixed compensation (Rs LPA) *", "type": "number"},
        {"index": 1, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "number"},
        {"index": 2, "label": "Current annual fixed compensation (Rs LPA) *", "type": "text"},
        {"index": 3, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "text"},
        {"index": 4, "label": "Current CTC", "type": "text"},
        {"index": 5, "label": "Expected CTC", "type": "text"},
        {"index": 6, "label": "Current compensation", "type": "text"},
        {"index": 7, "label": "Expected compensation", "type": "text"},
        {"index": 8, "label": "Current CTC", "type": "number"},
        {"index": 9, "label": "Expected CTC", "type": "number"},
    ]

    res = match_fields(fields, profile)
    assert res[0] == "11.5"
    assert res[1] == "15"
    assert res[2] == "11.5 LPA"
    assert res[3] == "15 LPA"
    assert res[4] == "11.5 LPA"
    assert res[5] == "15 LPA"
    assert res[6] == "11.5 LPA"
    assert res[7] == "15 LPA"
    assert res[8] == "11.5"
    assert res[9] == "15"


def test_api_match_fields_compensation(client):
    client.put("/api/profile", json={"current_ctc": "11.5 LPA", "expected_ctc": "15 LPA"})

    payload = [
        {"index": 0, "label": "Current annual fixed compensation (Rs LPA) *", "type": "number"},
        {"index": 1, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "number"},
        {"index": 2, "label": "Current annual fixed compensation (Rs LPA) *", "type": "text"},
        {"index": 3, "label": "Expected annual fixed compensation (Rs LPA) *", "type": "text"},
    ]

    response = client.post("/api/match-fields", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data.get("0") == "11.5"
    assert data.get("1") == "15"
    assert data.get("2") == "11.5 LPA"
    assert data.get("3") == "15 LPA"


def test_compensation_field_types_and_exclusions():
    profile = {
        "current_ctc": "11.5 LPA",
        "expected_ctc": "15 LPA",
    }

    fields = [
        {"index": 0, "label": "Current annual fixed compensation", "type": "numeric"},
        {"index": 1, "label": "Expected annual fixed compensation", "type": "decimal"},
        {"index": 2, "label": "Current CTC", "type": "select", "options": ["10 LPA", "11.5 LPA", "15 LPA"]},
        {"index": 3, "label": "Expected CTC", "type": "select", "options": ["10 LPA", "12 LPA", "15 LPA"]},
        {"index": 4, "label": "Workers Compensation Claim"},
        {"index": 5, "label": "Equity Compensation"},
    ]

    res = match_fields(fields, profile)
    assert res[0] == "11.5"
    assert res[1] == "15"
    assert res[2] == "11.5 LPA"
    assert res[3] == "15 LPA"
    assert 4 not in res or res[4] is None
    assert 5 not in res or res[5] is None


def test_greenhouse_field_matching():
    profile = {
        "name": "Alex Morgan Example",
        "email": "alex@example.com",
        "phone": "+91 0000000000",
        "location": "Pune, Maharashtra, India",
        "linkedin_url": "https://linkedin.example/alex",
    }

    # Greenhouse React inputs often lack a `name` attribute but have standard IDs
    fields = [
        {"index": 0, "label": "First Name*", "name": "", "id": "first_name", "type": "text"},
        {"index": 1, "label": "Last Name*", "name": "", "id": "last_name", "type": "text"},
        {"index": 2, "label": "Preferred First Name", "name": "", "id": "preferred_name", "type": "text"},
        {"index": 3, "label": "Email*", "name": "", "id": "email", "type": "text"},
        {"index": 4, "label": "Country*", "name": "", "id": "country", "type": "text"},
        {"index": 5, "label": "Phone*", "name": "", "id": "phone", "type": "tel"},
        {"index": 6, "label": "Location (City)*", "name": "", "id": "candidate-location", "type": "text"},
        {"index": 7, "label": "LinkedIn Profile", "name": "", "id": "question_8832187005", "type": "text"},
    ]

    res = match_fields(fields, profile)
    assert res[0] == "Alex"
    assert res[1] == "Example"
    assert res[2] == "Alex"
    assert res[3] == "alex@example.com"
    assert res[4] == "India"
    assert res[5] == "+91 0000000000"
    assert res[6] == "Pune"
    assert res[7] == "https://linkedin.example/alex"


def test_instahyre_links_matching():
    # Profile with LinkedIn and GitHub, but no portfolio or other social profiles
    profile = {
        "name": "Alex Morgan Example",
        "linkedin_url": "https://linkedin.example/alex",
        "github_url": "https://github.example/alex",
        "portfolio_url": "",
    }

    fields = [
        {"index": 0, "label": "LinkedIn Profile URL"},
        {"index": 1, "label": "X / Twitter URL"},
        {"index": 2, "label": "Github URL"},
        {"index": 3, "label": "BitBucket URL"},
        {"index": 4, "label": "Website / Blog / Portfolio URL"},
        {"index": 5, "label": "StackOverflow URL"},
        {"index": 6, "label": "Dribbble URL"},
        {"index": 7, "label": "Behance URL"},
    ]

    res = match_fields(fields, profile)

    # 1. Exact matches must match candidate's actual profiles
    assert res.get(0) == "https://linkedin.example/alex"
    assert res.get(2) == "https://github.example/alex"

    # 2. Specific absent platforms must NEVER be filled with LinkedIn or GitHub
    assert 1 not in res or not res[1]  # X / Twitter URL
    assert 3 not in res or not res[3]  # BitBucket URL
    assert 4 not in res or not res[4]  # Website / Blog / Portfolio URL (empty in profile)
    assert 5 not in res or not res[5]  # StackOverflow URL
    assert 6 not in res or not res[6]  # Dribbble URL
    assert 7 not in res or not res[7]  # Behance URL

    # 3. When portfolio_url is present, Website/Blog/Portfolio must fill with portfolio_url
    profile_with_portfolio = {
        **profile,
        "portfolio_url": "https://alex.example",
        "twitter_url": "https://social.example/alex",
        "stackoverflow_url": "https://questions.example/users/123/alex",
    }
    res2 = match_fields(fields, profile_with_portfolio)
    assert res2.get(0) == "https://linkedin.example/alex"
    assert res2.get(1) == "https://social.example/alex"
    assert res2.get(2) == "https://github.example/alex"
    assert 3 not in res2 or not res2[3]  # BitBucket still empty
    assert res2.get(4) == "https://alex.example"
    assert res2.get(5) == "https://questions.example/users/123/alex"
    assert 6 not in res2 or not res2[6]  # Dribbble still empty
    assert 7 not in res2 or not res2[7]  # Behance still empty
