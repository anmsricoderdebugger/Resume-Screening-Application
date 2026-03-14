import os
import json
import re
import traceback
from flask import Flask, request, jsonify, render_template
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
from pypdf import PdfReader
from docx import Document

app = Flask(__name__)

# --- CONFIGURATION ---
PROJECT_ID = "project-01-test-488412" 
REGION = "us-central1"

vertexai.init(project=PROJECT_ID, location=REGION)
# model = GenerativeModel("gemini-2.5-pro") 
# Note: Agar gemini-2.5-pro available nahi hai toh gemini-1.5-pro use karein
model = GenerativeModel("gemini-2.5-pro")

def extract_text_from_file(file):
    filename = file.filename.lower()
    try:
        if filename.endswith('.pdf'):
            reader = PdfReader(file)
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
            return text
        elif filename.endswith('.docx'):
            doc = Document(file)
            return "\n".join([para.text for para in doc.paragraphs])
        else:
            file.seek(0) 
            return file.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Extraction error on {filename}: {e}")
        return ""

def clean_and_parse_json(raw_response):
    """AI ke response se JSON extract aur clean karne ka function"""
    try:
        # 1. Sirf JSON portion extract karein (agar AI ne extra text likha ho)
        match = re.search(r'\{.*\}', raw_response, re.DOTALL)
        if match:
            raw_response = match.group(0)
        
        # 2. Invalid control characters aur newlines fix karein
        cleaned_str = raw_response.replace('\n', ' ').replace('\r', '').strip()
        
        # 3. JSON parse karein
        data = json.loads(cleaned_str)
        
        # 4. Agar response list mein hai toh pehla element lein
        if isinstance(data, list):
            data = data[0]
            
        return data
    except Exception as e:
        print(f"JSON Parsing Error: {e}")
        raise ValueError(f"Failed to parse AI response: {str(e)}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/screen', methods=['POST'])
def screen_cv():
    try:
        jd_file = request.files.get('jd')
        cv_file = request.files.get('cv')
        recruiter_notes = request.form.get('notes', '')

        if not cv_file:
            return jsonify({"success": False, "error": "CV file missing"}), 400

        jd_text = extract_text_from_file(jd_file) if jd_file else "Not provided"
        cv_text = extract_text_from_file(cv_file)

        screening_prompt = f"""
            Act as a Strategic Talent Architect. 
            TASK: Conduct a forensic audit of the CV against the JD.

            CORE INSTRUCTION: 
            1. Identify the Candidate's actual name from the CV content (usually found at the top). 
            2. If no name is clearly identifiable, use the filename provided in context.

            RECRUITER OVERRIDES:
            {recruiter_notes if recruiter_notes else "None."}

            CRITICAL FORMATTING RULES:
            - Every string in every array MUST be a single concise sentence, max 15 words.
            - Each array MUST have at most 3 items.
            - Write in plain professional English only.

            OUTPUT ONLY VALID JSON:
            {{
                "candidate_name": "Extract real name from CV here",
                "overallScore": 0-100,
                "recommendation": "Hierarchy Level",
                "rationale": "One sentence summary.",
                "strengths": {{
                    "NIRF_and_Pedigree": ["max 2 items, each under 15 words"],
                    "Experience_Alignment": ["max 2 items, each under 15 words"],
                    "Projects_and_Quantifiable_Impact": ["max 2 items, each under 15 words"]
                }},
                "proximity_matches": ["max 2 items, each under 15 words"],
                "gaps": {{ "Functional_Gaps": ["max 2 items, each under 15 words"], "Domain_Mismatch": ["max 1 item, under 15 words"] }},
                "jd_enhancement": {{ "missing_in_jd": [] }}
            }}

            JD: {jd_text}
            CV: {cv_text}
        """

        response = model.generate_content(screening_prompt)
        
        # Clean and Parse Logic Call
        parsed_data = clean_and_parse_json(response.text)

        return jsonify({"success": True, "data": parsed_data})

    except Exception as e:
        print(f"Error: {traceback.format_exc()}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/enhance-jd', methods=['POST'])
def enhance_jd():
    try:
        jd_file = request.files.get('jd_file')
        recruiter_notes = request.form.get('notes', '')

        if not jd_file:
            return jsonify({"success": False, "error": "No file uploaded"}), 400

        base_jd_text = extract_text_from_file(jd_file)

        enhancer_prompt = f"""
            Rewrite this JD into a high-performance Job Description.
            Notes: {recruiter_notes}
    
            CRITICAL FORMATTING RULE: The output must be plain text only.
            Do NOT use any markdown syntax — no ## headers, no ** bold **, no * bullets, no --- dividers.
            Use simple line breaks and paragraph spacing for structure.
            Use UPPERCASE for section headings instead of markdown.
    
            Return JSON format: {{"enhanced_text": "Plain text content here, absolutely no markdown formatting"}}
            
            BASE JD: {base_jd_text}
        """

        response = model.generate_content(enhancer_prompt)
        parsed_result = clean_and_parse_json(response.text)

        return jsonify({"success": True, "enhanced_text": parsed_result.get('enhanced_text', '')})

    except Exception as e:
        print(f"Enhancement Error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
        
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))