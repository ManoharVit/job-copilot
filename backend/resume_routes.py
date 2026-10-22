"""Bounded resume API. Binary contents never enter prompts or static assets."""
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import resume_store

router = APIRouter(prefix="/api/resume", tags=["resume"])


def _response(data: dict) -> JSONResponse:
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.get("", summary="Get saved resume metadata without its contents")
def get_resume():
    try:
        return _response(resume_store.metadata(resume_store.load_resume()))
    except resume_store.ResumeInvalid as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/file", summary="Read the local resume for an explicit Autofill attachment")
def get_resume_file():
    try:
        record = resume_store.load_resume()
        return _response({"configured": True, **record} if record else {"configured": False})
    except resume_store.ResumeInvalid as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("", summary="Save or replace the local resume (PDF or DOCX, up to 5 MB)", openapi_extra={
    "requestBody": {"required": True, "content": {"application/json": {
        "schema": resume_store.ResumeUpload.model_json_schema(),
        "examples": {"pdf": {"value": {"filename": "resume.pdf", "content_base64": "JVBERi0xLjcKJSVFT0Y="}}},
    }}},
})
async def put_resume(request: Request):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Use application/json")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > resume_store.MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="Resume must be no larger than 5 MB")
        body.extend(chunk)
    try:
        value = json.loads(body)
        record = await run_in_threadpool(resume_store.save_resume, value)
        return _response(resume_store.metadata(record))
    except (ValueError, TypeError, resume_store.ResumeInvalid) as exc:
        raise HTTPException(status_code=422, detail="Choose a valid PDF or DOCX resume, up to 5 MB, with a plain filename.") from exc


@router.delete("", summary="Remove the saved local resume")
def remove_resume():
    resume_store.delete_resume()
    return _response({"configured": False})
