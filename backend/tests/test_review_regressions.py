"""Security and data-integrity regressions found during the project review."""
import pytest

import ai_writer
from field_matcher import match_fields


def test_actual_untrusted_origin_cannot_invoke_generation(client, monkeypatch):
    calls = []
    monkeypatch.setattr(ai_writer, 'generate_answer', lambda *args: calls.append(args) or 'answer')
    # Verify the actual request boundary, independently of CORS preflight.
    response = client.post('/api/generate-answer', json={'question': 'Why this role?'},
                           headers={'Origin': 'https://untrusted.example'})
    assert response.status_code == 403
    assert calls == []


def test_rebinding_host_cannot_read_profile(client):
    response = client.get('/api/profile', headers={'Host': 'rebound.example:8765'})
    assert response.status_code == 400


@pytest.mark.parametrize('label', [
    'Are you authorized to work in the United States?', 'Will you need visa sponsorship?',
    'Are you eligible under ITAR?', 'I consent to a background check', 'Unrecognized checkbox',
])
def test_sensitive_or_unknown_choices_require_manual_review(label):
    assert match_fields([{'index': 0, 'label': label, 'type': 'checkbox'}],
                        {'work_authorized': False}) == {}


def test_relocation_respects_the_profile():
    assert match_fields([{'index': 0, 'label': 'Willing to relocate?', 'type': 'select'}],
                        {'willing_to_relocate': False}) == {0: 'No'}


def test_profile_rejects_malformed_json_without_modifying_stored_values(client):
    client.put('/api/profile', json={'name': 'Before'})
    response = client.put('/api/profile', json={'name': 'After', 'skills': '{broken'})
    assert response.status_code == 422
    assert client.get('/api/profile').json()['name'] == 'Before'


def test_profile_does_not_mass_assign_database_identifiers(client):
    original = client.get('/api/profile').json()
    response = client.put('/api/profile', json={'id': original['id'] + 100, 'name': 'Updated'})
    assert response.status_code == 200
    saved = client.get('/api/profile').json()
    assert saved['id'] == original['id']
    assert saved['name'] == 'Updated'


def test_negative_boolean_options_are_not_replaced_with_yes():
    assert match_fields([{'index': 0, 'label': 'Willing to relocate?', 'type': 'select', 'options': ['Yes', 'No']}],
                        {'willing_to_relocate': False}) == {0: 'No'}


def test_eligibility_generation_never_calls_the_model(client, monkeypatch):
    def fail(*args, **kwargs):
        pytest.fail('Eligibility question reached the model')
    monkeypatch.setattr(ai_writer, '_call_gemini', fail)
    monkeypatch.setattr(ai_writer, 'AI_AVAILABLE', True)
    response = client.post('/api/generate-answer', json={'question': 'Do you need visa sponsorship?'})
    assert response.status_code == 422
    assert ai_writer.generate_answer('Are you eligible under ITAR?', {}).startswith('[Error]')


def test_failed_generation_does_not_fabricate_candidate_history(monkeypatch):
    monkeypatch.setattr(ai_writer, 'AI_AVAILABLE', True)
    def fail(*args, **kwargs):
        raise RuntimeError('Simulated model failure')
    monkeypatch.setattr(ai_writer, '_call_gemini', fail)
    assert ai_writer.generate_answer('Describe the hardest bug you fixed', {}).startswith('[Error]')


@pytest.mark.parametrize('payload', [ {'fields': 'not-a-list'}, {'fields': [None]},
    [{'index': 0, 'options': [None]}], [{'index': '../bad'}]])
def test_malformed_matching_metadata_is_a_validation_error(client, payload):
    assert client.post('/api/match-fields', json=payload).status_code == 422


@pytest.mark.parametrize('field,value', [('skills', '{"not":"a list"}'),
    ('certifications', '["not an object"]'), ('education_records', '[{"level":7}]'),
    ('work_authorized', 'false')])
def test_profile_validation_checks_nested_structure_and_scalar_types(client, field, value):
    response = client.put('/api/profile', json={field: value})
    assert response.status_code == 422
    assert value not in response.text


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'data:text/html,example'])
def test_legacy_extension_log_rejects_script_urls(client, url):
    assert client.post('/api/log-application', json={'url': url, 'title': 'Engineer'}).status_code == 422


@pytest.mark.parametrize('label', ['University', 'Start year', 'Grading system', 'GPA', 'Degree', 'Specialization', 'Graduation year'])
def test_empty_profile_does_not_invent_education(label):
    assert match_fields([{'index': 0, 'label': label, 'type': 'text'}], {}) == {}


def test_tell_me_question_is_not_matched_as_a_telephone_field():
    assert match_fields([{'index': 0, 'label': 'Tell me about your proudest achievement', 'type': 'textarea'}],
                        {'phone': '+44 1234 567890'}) == {}


def test_notice_options_use_the_actual_profile_value():
    assert match_fields([{'index': 0, 'label': 'Notice period', 'options': ['Immediate', '15 days', '90 days']}],
                        {'notice_period': '90 days'}) == {0: '90 days'}


def test_experience_range_supports_the_word_to():
    assert match_fields([{'index': 0, 'label': 'Years experience', 'options': ['0 to 1', '2 to 5']}],
                        {'years_experience': 3}) == {0: '2 to 5'}


def test_compensation_options_match_the_whole_number():
    assert match_fields([{'index': 0, 'label': 'Expected CTC', 'options': ['150 LPA', '15 LPA']}],
                        {'expected_ctc': '15 LPA'}) == {0: '15 LPA'}


def test_non_numeric_compensation_does_not_crash_matching():
    assert match_fields([{'index': 0, 'label': 'Expected salary', 'options': ['10 LPA', '15 LPA']}],
                        {'expected_ctc': 'Negotiable'}) == {}


def test_bachelor_question_does_not_use_a_masters_record():
    profile = {'gpa': '3.9', 'graduation_year': 2024,
               'education_records': '[{"level":"master","university":"Graduate University","gpa":"3.9","end_year":"2024"}]'}
    fields = [{'index': 0, 'label': 'Bachelor university'}, {'index': 1, 'label': 'Bachelor GPA'},
              {'index': 2, 'label': 'Bachelor graduation year'}]
    assert match_fields(fields, profile) == {}
