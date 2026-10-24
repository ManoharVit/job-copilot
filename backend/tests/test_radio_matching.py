"""Radio options carry labels, not opaque HTML input values."""
from field_matcher import match_fields


def test_questionnaire_notice_maps_to_visible_option(client):
    assert client.put('/api/profile', json={'notice_period': '15 days'}).status_code == 200
    response = client.post('/api/match-fields', json=[{
        'index': 0, 'type': 'radio',
        'label': '4. What is your official notice period (as per your offer letter)',
        'options': ['Served notice, available immediately', '15 days', '30 days', '45 days', '60 days', 'Above 60 days'],
    }])
    assert response.status_code == 200
    assert response.json() == {'0': '15 days'}


def test_total_experience_does_not_claim_specific_skill_durations():
    labels = ['How much experience do you have in Python?',
              'Do you have hands on experience with AI APIs, LLMs, vector search or RAG in a project?',
              'Do you have experience with FFmpeg?', 'Python proficiency']
    fields = [{'index': i, 'label': label, 'type': 'radio', 'options': ['Not much', '6 months - 1 year', '1-2 years', '2-3 years']}
              for i, label in enumerate(labels)]
    assert match_fields(fields, {'years_experience': 2, 'skills': '["Python"]'}) == {}


def test_total_experience_radio_still_uses_saved_years():
    fields = [{'index': 0, 'type': 'radio', 'label': 'Overall years of professional experience',
               'options': ['0 to 1 years', '2 to 5 years']}]
    assert match_fields(fields, {'years_experience': 3}) == {0: '2 to 5 years'}
    assert match_fields(fields, {}) == {}


def test_confirmed_skill_durations_drive_questionnaire_options(client):
    records = {'Python': 3.5, 'AI APIs': 3.5, 'LLMs': 3.5, 'RAG': 3.5,
               'vector search': 3.5, 'FFmpeg': 0, 'video processing': 0}
    assert client.put('/api/profile', json={'skill_experience': records}).status_code == 200
    options = ['Not much', '6 months - 1 year', '1-2 years', '2-3 years', '3-5 years', '5+ years']
    labels = ['How much experience do you have in Python?',
              'Do you have hands on experience with AI APIs, LLMs, vector search or RAG in a project?',
              'Do you have experience with video/media processing workflows or tools such as FFmpeg?']
    fields = [{'index': i, 'type': 'radio', 'label': label, 'options': options} for i, label in enumerate(labels)]
    assert client.post('/api/match-fields', json=fields).json() == {'0': '3-5 years', '1': '3-5 years', '2': 'Not much'}
    # Missing or conflicting durations must not be collapsed into one answer.
    profile = {'skill_experience': {'AI APIs': 3.5, 'LLMs': 1, 'RAG': 3.5, 'vector search': 3.5}}
    assert match_fields([fields[1]], profile) == {}
    assert match_fields([fields[0]], {'years_experience': 10}) == {}


def test_invalid_skill_durations_reject_without_overwriting_saved_data(client):
    import json
    assert client.put('/api/profile', json={'skill_experience': {'Python': 3.5}}).status_code == 200
    for value in [{'Python': True}, {'Python': '3.5'}, {'Python': -1}, {'Python': 101}, [], {'': 3}]:
        assert client.put('/api/profile', json={'skill_experience': value}).status_code == 422
        assert json.loads(client.get('/api/profile').json()['skill_experience']) == {'Python': 3.5}


def test_skill_duration_migration_keeps_existing_profile(tmp_path):
    from sqlalchemy import text
    from .conftest import migrate, downgrade, make_engine
    path = tmp_path / 'durations.db'
    url = f'sqlite:///{path}'
    migrate(url, '0005_compensation_breakdown')
    engine = make_engine(path)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO profiles (name, current_fixed_ctc) VALUES ('Synthetic Person', '9 LPA')"))
    migrate(url)
    with engine.connect() as connection:
        assert tuple(connection.execute(text('SELECT name, current_fixed_ctc, skill_experience FROM profiles')).one()) == ('Synthetic Person', '9 LPA', '{}')
    downgrade(url, '0005_compensation_breakdown')
    with engine.connect() as connection:
        assert tuple(connection.execute(text('SELECT name, current_fixed_ctc FROM profiles')).one()) == ('Synthetic Person', '9 LPA')
    engine.dispose()
