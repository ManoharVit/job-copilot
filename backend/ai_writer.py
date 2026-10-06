"""
AI-powered content generator for job applications.
Uses Gemini to generate human-like cover letters, answers, and resume bullets.
Anti-AI-detection: writes like a real person, not a chatbot.
"""
import os
import json
import random

# Load API key from .env file if exists
_env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

# Try to initialize Gemini client
try:
    _api_key = os.environ.get("GEMINI_API_KEY", "")
    if not _api_key:
        raise ValueError("No API key found. Set GEMINI_API_KEY in .env file.")
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=_api_key)
    AI_AVAILABLE = True
except Exception as _e:
    client = None
    types = None
    AI_AVAILABLE = False
    import logging
    logger = logging.getLogger("job_copilot.ai")
    logger.warning("Gemini AI not available. Check credentials or network connectivity.")

MODEL = "gemini-3.5-flash"

# ──────────────────────────────────────────────────────────────
# Anti-detection system prompt — the secret sauce
# ──────────────────────────────────────────────────────────────
HUMAN_WRITER_SYSTEM = """You are ghostwriting for a real job applicant. Your writing MUST pass as genuinely human-written.

STRICT RULES — violating any makes the text detectable as AI:

1. NEVER use these AI-giveaway phrases:
   - "I'm excited to..." / "I am thrilled..."
   - "I believe I would be a great fit"
   - "leveraging" / "cutting-edge" / "innovative" / "detail-oriented team player"
   - "In conclusion" / "Furthermore" / "Moreover"
   - "I possess" / "I am confident"
   - "align with" / "resonate with"
   - "multifaceted" / "synergy" / "streamline" / "holistic"
   - "collaborative environment" / "dynamic team"
   - Starting 3+ sentences with "I"

2. DO write like a real person:
   - Mix sentence lengths. Some short. Others stretch out with detail.
   - Start some sentences with "The", "My", "After", "One thing", "During"
   - Use concrete numbers instead of vague adjectives.
   - Reference SPECIFIC tools/projects, never vague.
   - Use contractions naturally: "I've", "didn't", "won't", "that's"
   - Show personality, not perfection. Sound human and clear.

3. Structure (Cover Letters):
   - 3 short paragraphs MAX (keep it around 150-200 words).
   - No bullet points in cover letters.
   - Don't repeat the job title or company name more than twice.

4. Voice: Direct, slightly informal, competent. Think "senior dev writing an email to a hiring manager they respect" — not "college student trying to impress."
"""

ANSWER_SYSTEM = """You are helping a job applicant answer screening questions. Write like a real person typing quickly.

Rules:
- Keep answers SHORT (1-3 sentences max unless told otherwise)
- Use contractions (I've, I'm, didn't)  
- Be specific with numbers/tools when relevant
- Don't sound over-eager or robotic
- Never start with "I am excited" or "I believe"
- Sound like someone quickly but honestly answering a form question
"""

RESUME_SYSTEM = """You are helping rewrite resume bullet points to better match a job description. 

Rules:
- Keep the SAME facts — don't invent achievements
- Reorder emphasis to highlight what the job description cares about
- Use strong action verbs: built, shipped, reduced, automated, designed
- Include metrics where the original has them
- Each bullet: 1 line, start with past-tense verb
- Don't use "leveraged", "spearheaded", "orchestrated" — too corporate/AI-sounding
- Sound like a real developer wrote it, not a career coach
"""

INTERVIEW_SYSTEM = """You are an expert interview coach. Generate realistic interview questions a hiring manager would ask for this role.

Rules:
- Generate 8-10 questions mixing behavioral, technical, and situational
- For each question, provide 2-3 bullet point talking points the applicant can use
- Base talking points on the applicant's actual experience and skills
- Include at least 2 "tell me about a time when..." behavioral questions
- Include 1-2 questions about weaknesses/failures — with honest-sounding talking points
- Format: Q: [question]\\n  • [talking point]\\n  • [talking point]
- Keep talking points specific (reference real tools/numbers from their profile)
- Don't include generic advice like "be confident" — only concrete talking points
"""


import time

def _call_gemini(system_instruction: str, prompt: str, temperature: float = 0.8) -> str:
    """Helper to call Gemini API with proper config, retries, and fallback models."""
    max_retries = 3
    fallback_models = [MODEL, "gemini-1.5-flash", "gemini-1.5-pro"]
    
    last_error = None
    for attempt in range(max_retries):
        for m in fallback_models:
            try:
                response = client.models.generate_content(
                    model=m,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=temperature,
                        max_output_tokens=2048,
                    ),
                )
                return response.text or ""
            except Exception as e:
                last_error = e
                error_str = str(e)
                # If model is simply not found, try the next model immediately
                if "404" in error_str:
                    continue
                # If the model is overloaded, we can try the fallback model immediately
                if "503" in error_str or "429" in error_str or "UNAVAILABLE" in error_str:
                    continue
                    
        # If all fallback models failed for this attempt due to capacity, sleep and retry
        time.sleep(2 ** attempt)
        
    # If we get here, all retries failed
    if last_error:
        raise last_error
    return ""


def _parse_skills(profile: dict) -> list:
    """Parse skills from profile (handles JSON string or list)."""
    skills_raw = profile.get("skills", "[]")
    if isinstance(skills_raw, str):
        try:
            return json.loads(skills_raw)
        except json.JSONDecodeError:
            return [skills_raw]
    return skills_raw


def generate_cover_letter(job_description: str, profile: dict, company_name: str = "", target_product: str = "") -> str:
    """Generate a human-like cover letter tailored to the job using research-backed best practices."""
    import datetime
    name = profile.get("name", "Applicant")
    title = profile.get("current_title", "Developer")
    
    if not AI_AVAILABLE:
        return profile.get("cover_letter_template", f"Hi, I'm {name}, a {title}. I'd love to discuss this role further.")

    skills = _parse_skills(profile)
    experience = profile.get("years_experience", 2)
    education = profile.get("education_level", "")
    location = profile.get("location", "")
    current_date = datetime.datetime.now().strftime("%b %d, %Y")
    
    comp_context = company_name if company_name else "[Company Name]"
    prod_context = target_product if target_product else "your specific product/models"

    prompt = f"""Applicant: {name}, {title} with {experience} years of experience.
Skills: {', '.join(skills[:8])}
Education: {education}
Location: {location}

JOB DESCRIPTION:
{job_description[:2000]}

Write a cover letter that follows this EXACT visual format and incorporates strict feedback rules:

{current_date}

Dear {comp_context} Team,

[Paragraph 1: The Hook. NO thought-leadership cliches or quotes. Open directly by naming {comp_context} and referencing {prod_context}. Be forward-looking about how your background directly helps them solve data/backend challenges for that product.]

[Paragraph 2: Results & Mechanisms. Highlight 1-2 highly relevant accomplishments using the STAR method. CONTEXTUALIZE METRICS (e.g. if you say you cut latency by 40%, give a baseline like "from X to Y seconds"). EXPLAIN MECHANISMS (e.g. do not say you "prevented drift"; explain *what* you monitored or triggered). Avoid filler like "constant communication" or "bridging the gap".]

[Paragraph 3: Stack Reality. Do NOT keyword stuff. If the job description asks for a skill you lack (e.g. Deep Learning, PyTorch, Go) but you have a different background (e.g. classical ML, scikit-learn, Python backends), address the gap head-on! Mention a side project, coursework, or acknowledge you are growing into it, rather than pretending your current stack is the same thing.]

[Paragraph 4: Confident Closing. Reiterate enthusiasm briefly. End with a confident, specific ask (e.g., "I'd welcome 20 minutes to talk about how I'd approach your inference pipeline.") rather than a passive template.]

Sincerely,

{name}

RULES FOR CONTENT:
1. You MUST include the Date and "Dear {comp_context} Team," exactly as shown above. No "Dear Hiring Manager".
2. You MUST include "Sincerely," and the applicant's name at the bottom.
3. The tone must be professional but human. Avoid overly robotic buzzwords.
4. Focus on ROI (Return on Investment) for the employer — be forward-looking.
5. Do NOT stop mid-sentence. Ensure the letter is fully completed.
"""

    try:
        return _call_gemini(HUMAN_WRITER_SYSTEM, prompt, temperature=0.85)
    except Exception as e:
        return f"[Error generating cover letter: {e}]"






def generate_answer(question: str, profile: dict, job_description: str = "") -> str:
    """Generate a human-like answer to a screening question."""
    if not AI_AVAILABLE:
        return f"I have {profile.get('years_experience', 2)} years of experience as a {profile.get('current_title', 'developer')}. Happy to discuss further."
    
    name = profile.get("name", "")
    title = profile.get("current_title", "")
    skills = _parse_skills(profile)
    experience = profile.get("years_experience", 2)
    
    prompt = f"""Applicant: {name}, {title}, {experience} years experience.
Skills: {', '.join(skills[:6])}

Question from job application: "{question}"
{f'Job context: {job_description[:500]}' if job_description else ''}

Write a SHORT answer (1-3 sentences). Be honest and specific."""

    try:
        return _call_gemini(ANSWER_SYSTEM, prompt, temperature=0.85)
    except Exception as e:
        return f"[Error: {e}]"


def tailor_resume_bullets(bullets: list[str], job_description: str, profile: dict) -> list[str]:
    """Rewrite resume bullets to better match a job description."""
    
    prompt = f"""Here are resume bullet points:
{chr(10).join(f'- {b}' for b in bullets)}

JOB DESCRIPTION:
{job_description[:1500]}

Rewrite each bullet to better emphasize what this job cares about.
Keep the same facts — just reorder emphasis and adjust wording.
Return ONLY the rewritten bullets, one per line, starting with "- ".
"""

    try:
        text = _call_gemini(RESUME_SYSTEM, prompt, temperature=0.7)
        # Parse bullets
        result = []
        for line in text.strip().split("\n"):
            line = line.strip()
            if line.startswith("- "):
                result.append(line[2:])
            elif line.startswith("* "):
                result.append(line[2:])
            elif line:
                result.append(line)
        return result if result else bullets
    except Exception as e:
        return bullets  # Return originals on error


def humanize_text(text: str) -> str:
    """Take AI-sounding text and make it sound human."""
    
    prompt = f"""Rewrite this text to sound like a real person wrote it, not AI.
Fix any of these AI tells:
- Remove "I'm excited", "I believe", "I am confident"
- Replace "leveraging"/"innovative"/"cutting-edge" with normal words
- Mix sentence lengths
- Add a contraction or two
- Make it sound like a competent professional, not a chatbot

TEXT:
{text}

Return ONLY the rewritten text, nothing else."""

    try:
        return _call_gemini(
            "You rewrite text to remove AI-detection markers. Return only the rewritten text.",
            prompt,
            temperature=0.8,
        )
    except Exception:
        return text


def generate_interview_prep(job_description: str, profile: dict) -> str:
    """Generate likely interview questions with talking points."""
    if not AI_AVAILABLE:
        return "AI not available. Set GEMINI_API_KEY in .env to enable interview prep."

    name = profile.get("name", "")
    title = profile.get("current_title", "")
    skills = _parse_skills(profile)
    experience = profile.get("years_experience", 2)
    education = profile.get("education_level", "")

    prompt = f"""Applicant: {name}, {title}, {experience} years experience.
Skills: {', '.join(skills[:8])}
Education: {education}

JOB DESCRIPTION:
{job_description[:2000]}

Generate interview questions with talking points this applicant can use to prepare."""

    try:
        return _call_gemini(INTERVIEW_SYSTEM, prompt, temperature=0.7)
    except Exception as e:
        return f"[Error generating interview prep: {e}]"
