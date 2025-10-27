// app.js
// Sistem Pakar dengan interpolasi, forward chaining, dan Certainty Factor
// versi dinamis + threshold + log debug

const logEl = document.getElementById('log');
const resultsEl = document.getElementById('results');
const runBtn = document.getElementById('runBtn');

// ======== Helper Logging ========
function log(...args) {
  const txt = args.join(' ');
  logEl.textContent += txt + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

// ======== Load Rules from JSON ========
async function loadRules() {
  try {
    const r = await fetch('rules.json');
    const json = await r.json();
    return json;
  } catch (e) {
    log('⚠️ Gagal membaca rules.json. Pastikan file ada dan dijalankan lewat server lokal.');
    throw e;
  }
}

// ======== Interpolation Functions ========
function interpAscending(x, A, B, min = 0, max = 1) {
  if (x <= A) return min;
  if (x >= B) return max;
  return ((x - A) / (B - A)) * (max - min) + min;
}
function interpDescending(x, C, D, min = 0, max = 1) {
  if (x <= C) return max;
  if (x >= D) return min;
  return ((x - D) / (C - D)) * (min - max) + max;
}
function interpTrapezoid(x, A, B, C, D, min = 0, max = 1) {
  if (x <= A) return min;
  if (x >= D) return min;
  if (x >= B && x <= C) return max;
  if (x > A && x < B) return ((x - A) / (B - A)) * (max - min) + min;
  if (x > C && x < D) return ((D - x) / (D - C)) * (max - min) + min;
  return min;
}

// ======== Ambil Input User ========
function gatherFacts() {
  const facts = {};
  facts['G02'] = Number(document.getElementById('G02').value);
  facts['G03'] = Number(document.getElementById('G03').value) / 10;
  facts['G04'] = Number(document.getElementById('G04').value) / 10;
  facts['G11'] = Number(document.getElementById('G11').value);
  facts['G12'] = Number(document.getElementById('G12').value);
  facts['G27'] = Number(document.getElementById('G27').value);
  facts['G28'] = Number(document.getElementById('G28').value);
  return facts;
}

// ======== Cek Premis Terpenuhi (pakai threshold) ========
function allPremisesTrue(premises, workingFacts) {
  const threshold = 0.25; // minimal 25% agar dianggap terpenuhi
  for (const p of premises) {
    if (!workingFacts.hasOwnProperty(p)) return false;
    const v = workingFacts[p];
    if (v === null || v === undefined) return false;
    if (typeof v === 'number' && v < threshold) return false;
  }
  return true;
}

// ======== Gabungkan CF (Certainty Factor Combination) ========
function combineCFs(cfArray) {
  if (cfArray.length === 0) return 0;
  let c = cfArray[0];
  for (let i = 1; i < cfArray.length; i++) {
    c = c + cfArray[i] * (1 - c);
  }
  return c;
}

// ======== Slider Display ========
document.getElementById('G03').addEventListener('input', e => {
  document.getElementById('G03v').textContent = e.target.value;
});
document.getElementById('G04').addEventListener('input', e => {
  document.getElementById('G04v').textContent = e.target.value;
});

// ======== Main Inference Process ========
runBtn.addEventListener('click', async () => {
  logEl.textContent = '';
  resultsEl.innerHTML = '';
  log('📥 Memuat rules.json ...');
  const kb = await loadRules();
  log(`✅ Rules loaded (${kb.rules.length} rules)`);
  const inputs = gatherFacts();
  log('Input pasien:', JSON.stringify(inputs));

  // ======== Langkah 1: Interpolasi ========
  const workingFacts = {};
  workingFacts['G03'] = inputs['G03'];
  workingFacts['G04'] = inputs['G04'];

  for (const interp of kb.interpolations) {
    const s = interp.symptom;
    const t = interp.type;
    const p = interp.params;
    const raw = inputs[s];
    if (raw === undefined || raw === null) continue;
    let val = 0;
    if (t === 'ascending') {
      val = interpAscending(raw, p.A, p.B, p.min, p.max);
    } else if (t === 'descending') {
      val = interpDescending(raw, p.C, p.D, p.min, p.max);
    } else if (t === 'trapezoid') {
      val = interpTrapezoid(raw, p.A, p.B, p.C, p.D, p.min, p.max);
    }
    val = Math.round(val * 1000) / 1000;
    workingFacts[s] = val;
    log(`🔹 Interpolasi ${s} (${t}) raw=${raw} → normalized=${val}`);
  }

  // ======== Langkah 2: Forward Chaining ========
  const firedRules = new Set();
  let progress = true;
  const hypothesisEvidence = {};

  log('⚙️  Memulai forward chaining...');
  while (progress) {
    progress = false;
    for (const rule of kb.rules) {
      if (firedRules.has(rule.id)) continue;
      const premises = rule.if;
      if (allPremisesTrue(premises, workingFacts)) {
        log(`✅ Rule ${rule.id} terpenuhi → if(${premises.join(',')}) => ${rule.then}`);
        const contributions = [];
        for (const p of premises) {
          const cf_user = Number(workingFacts[p] || 0);
          const cf_single = Math.round(cf_user * rule.cf * 1000) / 1000;
          contributions.push({ premise: p, cf_user, cf_single });
          log(`   • ${p}: CF_user=${cf_user} × CF_expert=${rule.cf} → CF_single=${cf_single}`);
          if (!hypothesisEvidence[rule.then]) hypothesisEvidence[rule.then] = [];
          hypothesisEvidence[rule.then].push(cf_single);
        }
        const combinedForThisRule = combineCFs(contributions.map(c => c.cf_single));
        workingFacts[rule.then] = Math.round(combinedForThisRule * 1000) / 1000;
        firedRules.add(rule.id);
        progress = true;
        log(`   ➕ Kesimpulan baru: ${rule.then} (CF=${workingFacts[rule.then]})`);
      } else {
        log(`❌ Rule ${rule.id} dilewati (premis belum terpenuhi / nilai < 0.25)`);
      }
    }
  }

  // ======== Langkah 3: Kombinasi Akhir ========
  const finalHypotheses = [];
  for (const k of Object.keys(hypothesisEvidence)) {
    const arr = hypothesisEvidence[k];
    const combined = Math.round(combineCFs(arr) * 1000) / 1000;
    finalHypotheses.push({ hypothesis: k, evidence: arr, combined });
    log(`📊 ${k}: evidence=[${arr.join(', ')}] → CF_akhir=${combined}`);
  }

  finalHypotheses.sort((a, b) => b.combined - a.combined);
  resultsEl.innerHTML = finalHypotheses
    .map(
      h =>
        `<div class="result-item"><strong>${h.hypothesis}</strong><br>CF akhir: <b>${h.combined}</b><br>Evidence: ${h.evidence
          .map(x => x.toFixed(3))
          .join(', ')}</div>`
    )
    .join('');

  if (finalHypotheses.length === 0) {
    resultsEl.innerHTML = `<div class="result-item">Tidak ada hipotesis yang terbentuk (semua gejala normal / tidak cukup kuat).</div>`;
  }

  log('✅ Proses selesai.');
});
