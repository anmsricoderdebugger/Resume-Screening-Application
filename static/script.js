const listify = (arr) => (arr && arr.length > 0) ? arr.map(i => `<li>${i}</li>`).join('') : '<li>None</li>';

async function runScreening() {
    const jdFile = document.getElementById('jdFileInput').files[0];
    const cvFiles = Array.from(document.getElementById('cvFileInput').files);
    const container = document.getElementById('resultsContainer');
    const loader = document.getElementById('screeningLoading');
    const downloadBtn = document.getElementById('downloadResultsBtn');
    
    // NEW: Get recruiter notes for screening
    const screeningNotes = document.getElementById('screeningNotesInput') ? document.getElementById('screeningNotesInput').value : "";

    if (!jdFile || cvFiles.length === 0) {
        alert("Please upload a JD and CVs.");
        return;
    }

    // Reset UI
    document.getElementById('screeningResults').style.display = 'block';
    document.getElementById('jdMarketAuditSection').style.display = 'none'; // Hide audit until data arrives
    loader.style.display = 'block';
    downloadBtn.style.display = 'none';
    container.innerHTML = '';

    let allResults = [];
    let jdAuditShown = false; // Flag to show JD benchmarking only once
    const queue = [...cvFiles];

    const process = async () => {
        while (queue.length > 0) {
            const file = queue.shift();
            const fd = new FormData();
            fd.append('jd', jdFile);
            fd.append('cv', file);
            fd.append('notes', screeningNotes); // Send notes to backend
            
            let attempts = 0;
            let success = false;

            while (attempts < 2 && !success) {
                try {
                    const response = await fetch('/api/screen', { method: 'POST', body: fd });
                    
                    const contentType = response.headers.get("content-type");
                    let res;

                    // Agar server ne JSON bheja hai (chahe error ho ya success)
                    if (contentType && contentType.includes("application/json")) {
                        res = await response.json();
                    } else {
                        // Agar waqai koi HTML crash page hai
                        const errorText = await response.text();
                        console.error("CRITICAL HTML ERROR:", errorText);
                        throw new Error(`Server Crash (Status ${response.status}). Check Console.`);
                    }

                    if (res.success) {
                        allResults.push(res.data);
                        if (!jdAuditShown && res.data.market_benchmarking) {
                            showJDMarketAudit(res.data.market_benchmarking);
                            jdAuditShown = true;
                        }
                        renderCard(res.data, container);
                        success = true;
                    } else {
                        // Yeh line "File unreadable" jaise errors ko catch karke attempts badhayegi
                        throw new Error(res.error || "Unknown Backend Error");
                    }
                } catch(e) {
                    attempts++;
                    console.error(`Attempt ${attempts} failed:`, e.message);                    
                    if (attempts >= 2) {
                        // Failed card
                        const errorData = {
                            candidate_name: file.name,
                            overallScore: 0,
                            recommendation: "Processing Failed",
                            rationale: `Error: ${e.message}`,
                            failed: true,
                            strengths: {}, gaps: {}, proximity_matches: []
                        };
                        renderCard(errorData, container);
                    } else {
                        await new Promise(r => setTimeout(r, 2000)); 
                    }
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
    };

    // Parallel workers
    const workers = [process()]; // Only 1 worker to prevent Auth 503 errors
    await Promise.all(workers);

    // Re-sort and re-render everything (Descending Score)
    container.innerHTML = '';
    allResults.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));
    allResults.forEach(data => renderCard(data, container));

    loader.style.display = 'none';
    if (allResults.length > 0) {
        downloadBtn.style.display = 'block';
    }
}

function showJDMarketAudit(auditData) {
    const section = document.getElementById('jdMarketAuditSection');
    const content = document.getElementById('jdMarketContent');
    
    section.style.display = 'block';
    content.innerHTML = `
        <p style="margin-bottom: 10px;"><strong>Role Identified:</strong> ${auditData.observed_role_category}</p>
        <div class="jd-gap-grid">
            <div class="jd-gap-column">
                <strong style="color: #b45309;">⚠️ Missing in your JD:</strong>
                <ul>${auditData.missing_from_your_jd.map(item => `<li>${item}</li>`).join('')}</ul>
            </div>
            <div class="jd-gap-column">
                <strong style="color: #0369a1;">💡 Industry Standards:</strong>
                <ul>${auditData.market_trends.map(item => `<li>${item}</li>`).join('')}</ul>
            </div>
        </div>
    `;
}

function renderCard(d, container) {
    let colorClass = "";
    const score = d.overallScore || 0;

    if (score > 70) colorClass = "score-green";
    else if (score >= 50) colorClass = "score-yellow";
    else colorClass = "score-red";

    // If it's an error card
    if (d.failed) {
        container.insertAdjacentHTML('beforeend', `
            <div class="cv-result-card" style="border-left: 5px solid #ef4444; opacity: 0.8;">
                <h3>❌ ${d.candidate_name}</h3>
                <p><strong>Status:</strong> ${d.rationale}</p>
            </div>
        `);
        return;
    }

    const html = `
        <div class="cv-result-card">
            <div class="res-header">
                <div>
                    <h3 style="margin:0;">${d.candidate_name}</h3>
                    <small style="color: #64748b;">${d.recommendation}</small>
                </div>
                <span class="score ${colorClass}">${score}%</span>
            </div>
            <p style="margin-top:15px;"><strong>Rationale:</strong> ${d.rationale}</p>
            <div class="sg-grid-3">
                <div class="sg-box strengths">
                    <strong>Strengths</strong>
                    <ul>
                        ${listify(d.strengths.NIRF_and_Pedigree)}
                        ${listify(d.strengths.Experience_Alignment)}
                    </ul>
                </div>
                <div class="sg-box proximity-box">
                    <strong>Proximity</strong>
                    <ul>${listify(d.proximity_matches)}</ul>
                </div>
                <div class="sg-box gaps">
                    <strong>Gaps</strong>
                    <ul>
                        ${listify(d.gaps.Functional_Gaps)}
                        ${listify(d.gaps.Domain_Mismatch)}
                    </ul>
                </div>
            </div>
        </div>`;
    container.insertAdjacentHTML('beforeend', html);
}

async function downloadAllResults() {
    // Select the wrapper that includes BOTH the JD Flag and CV Cards
    const element = document.getElementById('screeningResults'); 
    const btn = document.getElementById('downloadResultsBtn');

    btn.innerText = "⌛ Generating Audit PDF...";
    btn.disabled = true;

    // Wait for browser paint
    await new Promise(r => setTimeout(r, 800));

    const opt = {
        margin:       [0.4, 0.4],
        filename:     'Candidate_Audit_Report.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // Temporarily hide the download button from the PDF output
    btn.style.display = 'none';

    try {
        await html2pdf().set(opt).from(element).save();
    } catch (err) {
        alert("PDF Error: " + err.message);
    } finally {
        btn.style.display = 'block';
        btn.innerText = "📥 Download Full Analysis Report (PDF)";
        btn.disabled = false;
    }
}

// --- JD ENHANCEMENT LOGIC ---
async function runJDEnhancement() {
    const fileInput = document.getElementById('jdEnhanceFileInput');
    const notesText = document.getElementById('recruiterModInput').value;
    const modal = document.getElementById('jdModal');
    const view = document.getElementById('enhancedJdView');

    if (!fileInput.files[0]) {
        alert("Please upload a Base JD file first.");
        return;
    }

    const btn = document.querySelector("button[onclick='runJDEnhancement()']");
    btn.innerText = "Processing... Please wait...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append('jd_file', fileInput.files[0]);
    formData.append('notes', notesText);

    try {
        const response = await fetch('/api/enhance-jd', { method: 'POST', body: formData });
        const res = await response.json();

        if (res.success) {
            view.innerText = res.enhanced_text;
            modal.style.display = 'block';
        } else {
            alert("Enhancement failed: " + res.error);
        }
    } catch (err) {
        alert("Server connection failed.");
    } finally {
        btn.innerText = "🚀 Enhance JD";
        btn.disabled = false;
    }
}

function closeJdModal() { document.getElementById('jdModal').style.display = 'none'; }

function downloadEnhancedJD() {
    const element = document.getElementById('enhancedJdView');
    const originalStyle = element.style.cssText;
    element.style.maxHeight = "none";
    element.style.overflow = "visible";
    element.style.height = "auto";

    const opt = {
        margin: 0.5,
        filename: 'Enhanced_JD.pdf',
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        element.style.cssText = originalStyle;
    });
}