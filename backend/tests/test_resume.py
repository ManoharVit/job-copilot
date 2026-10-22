import base64
import io
import json
import os
import zipfile
from types import SimpleNamespace

import pytest

import resume_store

PDF = b'%PDF-1.7\nSynthetic test resume\n%%EOF'


def upload(blob=PDF, filename='resume.pdf'):
    return {'filename': filename, 'content_base64': base64.b64encode(blob).decode()}


@pytest.fixture(autouse=True)
def private_resume(tmp_path, monkeypatch):
    path = tmp_path / 'private' / 'resume.json'
    monkeypatch.setattr(resume_store, 'get_settings', lambda: SimpleNamespace(resume_path=path))
    return path


def test_resume_round_trip_metadata_and_private_storage(client, private_resume):
    assert client.get('/api/resume').json() == {'configured': False}
    created = client.put('/api/resume', json=upload())
    assert created.status_code == 200
    assert created.json()['configured'] is True
    assert 'content_base64' not in created.json()
    assert created.headers['cache-control'] == 'no-store'
    stored = client.get('/api/resume/file')
    assert stored.status_code == 200
    assert base64.b64decode(stored.json()['content_base64']) == PDF
    assert stored.json()['size'] == len(PDF)
    assert stored.json()['mime_type'] == 'application/pdf'
    assert os.stat(private_resume).st_mode & 0o777 == 0o600
    assert client.get('/static/resume.json').status_code == 404
    assert 'content_base64' not in client.get('/api/profile').json()


def test_resume_delete_is_idempotent(client, private_resume):
    client.put('/api/resume', json=upload())
    for _ in range(2):
        assert client.delete('/api/resume').json() == {'configured': False}
    assert not private_resume.exists()
    assert client.get('/api/resume/file').json() == {'configured': False}


def docx(macro=False):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', '<document/>')
        if macro:
            archive.writestr('word/vbaProject.bin', 'macro')
    return output.getvalue()


def test_docx_is_supported(client):
    response = client.put('/api/resume', json=upload(docx(), 'resume.docx'))
    assert response.status_code == 200
    assert response.json()['mime_type'] == resume_store.DOCX_TYPE


@pytest.mark.parametrize(('filename', 'blob'), [
    ('resume.pdf', b'<html>not a PDF</html>'), ('resume.docx', PDF), ('resume.doc', PDF),
    ('../resume.pdf', PDF), ('/tmp/resume.pdf', PDF), ('folder\\resume.pdf', PDF),
    ('bad\nresume.pdf', PDF), ('resume.pdf', b''), ('resume.docx', docx(macro=True)),
])
def test_invalid_uploads_preserve_the_existing_resume(client, filename, blob):
    assert client.put('/api/resume', json=upload()).status_code == 200
    original = client.get('/api/resume/file').json()
    assert client.put('/api/resume', json=upload(blob, filename)).status_code == 422
    assert client.get('/api/resume/file').json() == original


@pytest.mark.parametrize('body', [None, [], {'filename': 'resume.pdf', 'content_base64': 'not!base64'},
    {**upload(), 'path': '/tmp/anything'}])
def test_malformed_resume_payload_is_rejected(client, body):
    assert client.put('/api/resume', content=json.dumps(body), headers={'Content-Type': 'application/json'}).status_code == 422


def test_resume_body_limit_is_enforced_before_json_parsing(client):
    response = client.put('/api/resume', content=b' ' * (resume_store.MAX_REQUEST_BYTES + 1), headers={'Content-Type': 'application/json'})
    assert response.status_code == 413


def test_non_json_and_cross_site_uploads_are_rejected(client):
    assert client.put('/api/resume', content='{}', headers={'Content-Type': 'text/plain'}).status_code == 415
    assert client.put('/api/resume', json=upload(), headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert client.get('/api/resume').json() == {'configured': False}


def test_corrupt_stored_resume_has_a_safe_error(client, private_resume):
    client.put('/api/resume', json=upload())
    record = json.loads(private_resume.read_text())
    record['sha256'] = 'invalid'
    private_resume.write_text(json.dumps(record))
    response = client.get('/api/resume/file')
    assert response.status_code == 409
    assert 'Replace it' in response.json()['detail']
    assert 'content_base64' not in response.text


def test_failed_atomic_replace_keeps_original_file(client, private_resume, monkeypatch):
    client.put('/api/resume', json=upload())
    original = private_resume.read_bytes()
    def fail(*_args):
        raise OSError('synthetic disk failure')
    monkeypatch.setattr(resume_store.os, 'replace', fail)
    assert client.put('/api/resume', json=upload(PDF + b'new')).status_code == 500
    assert private_resume.read_bytes() == original
    assert list(private_resume.parent.iterdir()) == [private_resume]
