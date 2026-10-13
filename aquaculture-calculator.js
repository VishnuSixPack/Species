/* Aquaculture calculation engine. Pure functions, no DOM. */
const Calc = (() => {
  const GWP = {
    'R-12': 10900, 'R-22': 1810, 'R-134a': 1430, 'R-404A': 3922, 'R-407C': 1774,
    'R-410A': 2088, 'R-513A': 630, 'R-717 (NH3)': 0, 'NaCl brine': 0, 'Not available': 0
  };

  const defaultSD = () => ({
    juvenile: { psEF: 3.026, psFuel: 0.85 },
    towing: { intensity: 1.0, truckEF: 0.0000542 },
    feed: {
      efGen: 0.70, refrigKwh: 0.203, efGrid: 0.50, efWater: 0.541,
      pellet: [
        { name: 'Fishmeal', pct: 30, ef: 1.34 },
        { name: 'Fish oil', pct: 15, ef: 1.67 },
        { name: 'Soybean meal', pct: 25, ef: 0.64 },
        { name: 'Wheat / cereals', pct: 20, ef: 1.38 },
        { name: 'Additives', pct: 10, ef: 1.42 }
      ]
    },
    farming: { kwhPerKg: 0.50, efElec: 0.51, fuelLPerKg: 0.10, efDiesel: 2.64, co2PerTFuel: 3206 },
    harvest: { dieselEF: 3.20, fuelLPerKg: 0.05, efDiesel: 2.64, kwhPerKg: 0.03, efElec: 0.51, refrigPerKg: 0.10 },
    landing: { ef: 0.0000542, efElec: 0.4999 },
    agg: { kwhPerKg: 0.12, efElec: 0.4999, lPerKg: 1.0, efWater: 0.541, leakPerKg: 0.00007 },
    trans: {
      sashimi: { kwh: 0.11, efElec: 0.50, coolKwh: 0.449, efCool: 0.50, waterL: 5, efWater: 0.14, fuelL: 0.52, efDiesel: 2.64 },
      canned: { kwh: 0.11, efElec: 0.50, coolKwh: 0.449, efCool: 0.50, waterL: 5, efWater: 0.14, fuelL: 0.52, efDiesel: 2.64 },
      pellet: { kwh: 0.11, efElec: 0.50, coolKwh: 0.449, efCool: 0.50, waterL: 5, efWater: 0.14, fuelL: 0.52, efDiesel: 2.64 }
    },
    storage: { kwhPerKg: 0.12, efElec: 0.499 },
    dispatch: { reef: 0.01681, dry: 0.0129, reefShare: 0.9, dryShare: 0.1, air: 0.68 }
  });

  const defaultState = () => ({
    feedType: 'bait',
    fcr: { bait: 15, pellet: 5 },
    juvenile: { mode: 'ranching', weight: { v: 900, u: 'mt' }, fuelL: 368 },
    towing: {
      mode: 'tow', weight: { v: 100 / 3 / 0.95, u: 'mt' }, mortality: 5,
      fuelL: 0, distKm: 0
    },
    feed: {
      bait: { elecKwh: 0, coolKwh: 0, waterL: 0, fuelL: 368, distKm: 0 },
      pellet: { elecKwh: 0, coolKwh: 0, waterL: 0, fuelL: 368, distKm: 75 }
    },
    farming: {
      bait: { fuelTPerMT: 0.18 },
      pellet: { fuelTPerMT: 0.18 }
    },
    harvest: { growth: 3, fuelLPerMT: 0.012 },
    landing: { weight: null, distKm: 60, elecKwh: 0 },
    agg: { weight: null, refrigerant: 'R-404A', fuelL: 0, distKm: 0 },
    trans: [
      { product: 'sashimi', weight: null, yieldPct: 100 },
      { product: 'sashimi', weight: { v: 0, u: 'kg' }, yieldPct: 100 }
    ],
    storage: [{ weight: null }],
    dispatch: {
      mode: 'sea', weight: null, distKm: 17350, teu: 1, dryMT: 30.4, reeferMT: 34,
      aircraftMT: 250, airKm: 7000
    }
  });

  const kg = (q) => (q && q.u === 'mt' ? q.v * 1000 : q ? q.v : 0) || 0;
  const num = (x) => (Number.isFinite(+x) ? +x : 0);

  function compute(S, SD) {
    const dieselL = SD.juvenile.psEF * SD.juvenile.psFuel;
    const out = { stages: {} };

    // Biomass chain
    const wKg = kg(S.towing.weight);
    const yieldKg = wKg * (1 - num(S.towing.mortality) / 100);
    const harvestKg = yieldKg * num(S.harvest.growth);
    const gainKg = harvestKg - yieldKg;
    const feedMT = { bait: gainKg * S.fcr.bait / 1000, pellet: gainKg * S.fcr.pellet / 1000 };
    Object.assign(out, { towWeightKg: wKg, yieldKg, harvestKg, gainKg, feedMT });
    const t = S.feedType;

    // 1 Juvenile sourcing
    {
      const wMT = kg(S.juvenile.weight) / 1000;
      const fuelEm = num(S.juvenile.fuelL) * dieselL;
      const total = fuelEm * wMT;
      const basis = wMT * 1000;
      out.stages.juvenile = {
        total, basis, perKg: basis ? total / basis : 0, fuelEm,
        parts: [{ label: 'Fuel (diesel)', value: total }]
      };
    }

    // 2 Towing to cage
    {
      const T = S.towing;
      let base;
      if (T.mode === 'truck') base = wKg * num(T.distKm) * SD.towing.truckEF;
      else base = wKg * SD.towing.intensity;
      const fuel = num(T.fuelL) * dieselL;
      const total = base + fuel;
      out.stages.towing = {
        total, basis: wKg, perKg: wKg ? total / wKg : 0,
        parts: [{ label: T.mode === 'truck' ? 'Truck transfer' : 'Towing', value: base }, { label: 'Fuel', value: fuel }]
      };
    }

    // 3 Feed sourcing
    {
      const F = S.feed[t], fcr = S.fcr[t], fMT = feedMT[t], fKg = fMT * 1000;
      let prod, label;
      if (t === 'pellet') {
        const cf = SD.feed.pellet.reduce((a, c) => a + c.pct / 100 * c.ef, 0);
        prod = cf * fcr * gainKg; label = 'Pellet raw materials';
      } else {
        prod = SD.feed.refrigKwh * fcr * SD.feed.efGen * gainKg; label = 'Bait fish freezing';
      }
      const elec = num(F.elecKwh) * SD.feed.efGrid;
      const cool = num(F.coolKwh) * SD.feed.efGrid;
      const water = num(F.waterL) * SD.feed.efWater;
      const fuel = num(F.fuelL) * dieselL * fMT;
      const transport = fKg * num(F.distKm) * SD.towing.truckEF;
      const total = prod + elec + cool + water + fuel + transport;
      out.stages.feed = {
        total, basis: fKg, perKg: fKg ? total / fKg : 0,
        parts: [{ label, value: prod }, { label: 'Electricity', value: elec }, { label: 'Refrigeration', value: cool },
          { label: 'Water', value: water }, { label: 'Fuel', value: fuel }, { label: 'Transport', value: transport }]
      };
    }

    // 4 Farming
    {
      const A = S.farming[t], P = SD.farming;
      const elec = P.kwhPerKg * P.efElec * gainKg;
      const misc = P.fuelLPerKg * P.efDiesel * gainKg;
      const transport = feedMT[t] * num(A.fuelTPerMT) * P.co2PerTFuel;
      const total = elec + misc + transport;
      out.stages.farming = {
        total, basis: gainKg, perKg: gainKg ? total / gainKg : 0, elec, misc, transport,
        parts: [{ label: 'Electricity', value: elec }, { label: 'Misc fuel', value: misc }, { label: 'Feed transport fuel', value: transport }]
      };
    }

    // 5 Harvest
    {
      const P = SD.harvest, hMT = harvestKg / 1000;
      const fuel = num(S.harvest.fuelLPerMT) * hMT * P.dieselEF;
      const misc = P.fuelLPerKg * P.efDiesel * harvestKg;
      const elec = P.kwhPerKg * P.efElec * harvestKg;
      const refrig = P.refrigPerKg * harvestKg;
      const total = fuel + misc + elec + refrig;
      out.stages.harvest = {
        total, basis: harvestKg, perKg: harvestKg ? total / harvestKg : 0, fuel, misc, elec, refrig,
        parts: [{ label: 'Fuel', value: fuel }, { label: 'Misc fuel', value: misc }, { label: 'Electricity', value: elec }, { label: 'Refrigeration', value: refrig }]
      };
    }

    // 6 Landing
    const landKg = S.landing.weight ? kg(S.landing.weight) : harvestKg;
    {
      const em = landKg * num(S.landing.distKm) * SD.landing.ef;
      const elec = num(S.landing.elecKwh) * SD.landing.efElec;
      const total = em + elec;
      out.stages.landing = {
        total, basis: landKg, perKg: landKg ? total / landKg : 0, weightKg: landKg,
        parts: [{ label: 'Truck transport', value: em }, { label: 'Electricity', value: elec }]
      };
    }

    // 7 Aggregation / Disaggregation
    const aggKg = S.agg.weight ? kg(S.agg.weight) : landKg;
    {
      const P = SD.agg;
      const elec = aggKg * P.kwhPerKg * P.efElec;
      const water = aggKg * P.lPerKg * P.efWater;
      const refrig = aggKg * P.leakPerKg * (GWP[S.agg.refrigerant] || 0);
      const fuel = num(S.agg.fuelL) * dieselL;
      const transport = aggKg * num(S.agg.distKm) * SD.towing.truckEF;
      const total = elec + water + refrig + fuel + transport;
      out.stages.agg = {
        total, basis: aggKg, perKg: aggKg ? total / aggKg : 0, weightKg: aggKg, elec, water, refrig,
        parts: [{ label: 'Electricity', value: elec }, { label: 'Water', value: water }, { label: 'Refrigerant leakage', value: refrig },
          { label: 'Fuel', value: fuel }, { label: 'Transport', value: transport }]
      };
    }

    // 8 Transformation (events)
    {
      const events = S.trans.map((e, i) => {
        const raw = e.weight ? kg(e.weight) : (i === 0 ? aggKg : 0);
        const P = SD.trans[e.product];
        const elec = P.kwh * P.efElec, cool = P.coolKwh * P.efCool, water = P.waterL * P.efWater, fuel = P.fuelL * P.efDiesel;
        const perKgRaw = elec + cool + water + fuel;
        return { raw, yieldKg: raw * num(e.yieldPct) / 100, perKgRaw, total: perKgRaw * raw, elec: elec * raw, cool: cool * raw, water: water * raw, fuel: fuel * raw };
      });
      const total = events.reduce((a, e) => a + e.total, 0);
      const basis = events.reduce((a, e) => a + e.raw, 0);
      const yieldKgT = events.reduce((a, e) => a + e.yieldKg, 0);
      const sum = (k) => events.reduce((a, e) => a + e[k], 0);
      out.stages.trans = {
        total, basis, perKg: basis ? total / basis : 0, events, yieldKg: yieldKgT,
        parts: [{ label: 'Electricity', value: sum('elec') }, { label: 'Refrigeration', value: sum('cool') }, { label: 'Water', value: sum('water') }, { label: 'Fuel', value: sum('fuel') }]
      };
    }
    const transYield = out.stages.trans.yieldKg;

    // 9 Storage (events)
    {
      const events = S.storage.map((e, i) => {
        const w = e.weight ? kg(e.weight) : (i === 0 ? transYield : 0);
        return { weightKg: w, total: w * SD.storage.kwhPerKg * SD.storage.efElec };
      });
      const total = events.reduce((a, e) => a + e.total, 0);
      const basis = events.reduce((a, e) => a + e.weightKg, 0);
      out.stages.storage = { total, basis, perKg: basis ? total / basis : 0, events, weightKg: basis, parts: [{ label: 'Electricity', value: total }] };
    }

    // 10 Product dispatch
    {
      const D = S.dispatch, P = SD.dispatch;
      const yKg = D.weight ? kg(D.weight) : out.stages.storage.weightKg;
      const sea = num(D.teu) * num(D.reeferMT) * P.reefShare * P.reef * num(D.distKm)
        + num(D.teu) * num(D.dryMT) * P.dryShare * P.dry * num(D.distKm);
      const air = num(D.aircraftMT) * num(D.airKm) * P.air;
      const total = D.mode === 'air' ? air : sea;
      out.stages.dispatch = {
        total, basis: yKg, perKg: yKg ? total / yKg : 0, sea, air, weightKg: yKg,
        parts: [{ label: D.mode === 'air' ? 'Air freight' : 'Sea freight', value: total }]
      };
    }

    const order = ['juvenile', 'towing', 'feed', 'farming', 'harvest', 'landing', 'agg', 'trans', 'storage', 'dispatch'];
    out.order = order;
    out.sum = order.reduce((a, k) => a + out.stages[k].total, 0);
    out.headline = harvestKg ? out.sum / harvestKg : 0;
    order.forEach((k) => { out.stages[k].perHarvestKg = harvestKg ? out.stages[k].total / harvestKg : 0; });
    return out;
  }

  return { GWP, defaultSD, defaultState, compute, kg };
})();
if (typeof module !== 'undefined') module.exports = Calc;
/* Core: state, helpers, field renderer, outputs, events */
const S = Calc.defaultState();
const SD = Calc.defaultSD();
const M = {};                       // text / select / date fields that do not feed the maths
const UI = { stage: 'juvenile', view: 'stage', ev: { trans: 0, storage: 0 }, modal: false, sdTab: 'juvenile', sdSub: {} };
let R = Calc.compute(S, SD);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] || String(n + 1);

function fmt(n, d = 2) {
  n = +n; if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a > 0 && a < 0.001) return n.toExponential(2);
  if (a < 0.01 && a > 0) d = Math.max(d, 4);
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const ICON = {
  leaf: '<path d="M5 19c0-8 4-13 14-14 0 9-4 14-12 14"/><path d="M5 19c2-5 5-8 9-10"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  reset: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>'
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* path helpers (S tree). {ft} = active feed type, {ev:x} = active event index of stage x */
function resolve(p) {
  return p.replace('{ft}', S.feedType).replace(/\{ev:(\w+)\}/g, (_, k) => UI.ev[k]);
}
function getP(p) { return resolve(p).split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
function setP(p, v) {
  const ks = resolve(p).split('.'); const last = ks.pop();
  const o = ks.reduce((a, k) => a[k], S); o[last] = v;
}

/* linked quantities (kg) pulled from upstream stages */
const LINK = {
  landing: () => R.harvestKg,
  agg: () => R.stages.landing.weightKg,
  trans: () => (UI.ev.trans === 0 ? R.stages.agg.weightKg : 0),
  storage: () => (UI.ev.storage === 0 ? R.stages.trans.yieldKg : 0),
  dispatch: () => R.stages.storage.weightKg
};

/* computed read-only outputs: key -> string */
const OUT = {};
function out(k, f) { OUT[k] = f; }

function tipHTML(t) { return t ? `<span class="tip" tabindex="0">${ic('info')}<span class="tipbox" role="tooltip">${esc(t)}</span></span>` : ''; }
function lab(f, id) {
  return `<label class="lab" for="${id}">${esc(f.label)}${f.req ? '<b class="req">*</b>' : ''}${tipHTML(f.tip)}</label>`;
}

function fieldHTML(stage, f) {
  const id = `${stage}-${f.id}`;
  const key = `${stage}.${f.id}`;
  let body = '';
  if (f.t === 'text' || f.t === 'date' || f.t === 'select') {
    if (!f.p && M[key] === undefined) M[key] = f.def ?? '';
  }
  switch (f.t) {
    case 'text':
      body = `<input class="in" id="${id}" type="text" data-m="${key}" value="${esc(M[key])}" placeholder="${esc(f.ph || '')}" ${f.dis ? 'disabled' : ''}>`; break;
    case 'date':
      body = `<input class="in" id="${id}" type="date" data-m="${key}" value="${esc(M[key])}">`; break;
    case 'range': {
      const a = M[key + '.0'] ?? (M[key + '.0'] = f.def?.[0] ?? ''), b = M[key + '.1'] ?? (M[key + '.1'] = f.def?.[1] ?? '');
      body = `<div class="range"><input class="in" id="${id}" type="date" data-m="${key}.0" value="${esc(a)}" aria-label="${esc(f.label)} start"><span>to</span><input class="in" type="date" data-m="${key}.1" value="${esc(b)}" aria-label="${esc(f.label)} end"></div>`; break;
    }
    case 'select': {
      const cur = f.p ? getP(f.p) : M[key];
      body = `<div class="sel"><select class="in" id="${id}" ${f.p ? `data-p="${f.p}" data-num="${f.num ? 1 : 0}"` : `data-m="${key}"`}>${(f.ph ? `<option value="">${esc(f.ph)}</option>` : '')}${f.opts.map((o) => { const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></div>`; break;
    }
    case 'num': {
      const v = getP(f.p);
      body = `<div class="inp"><input class="in" id="${id}" type="number" step="${f.step || 'any'}" min="${f.min ?? 0}" data-p="${f.p}" value="${v}">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}</div>`; break;
    }
    case 'qty': {
      const q = getP(f.p);
      const linked = f.link && !q;
      const val = linked ? LINK[f.link]() : q.v, u = linked ? 'kg' : q.u;
      body = `<div class="qty ${linked ? 'linked' : ''}"><input class="in" id="${id}" type="number" step="any" min="0" data-q="${f.p}" ${f.link ? `data-link="${f.link}"` : ''} value="${+(+val).toFixed(4)}"><div class="sel"><select class="in" data-qu="${f.p}" ${f.link ? `data-link="${f.link}"` : ''} aria-label="${esc(f.label)} unit">${['kg', 'mt'].map((x) => `<option value="${x}" ${u === x ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select></div></div>${f.link ? `<button type="button" class="chip-link" data-reset="${f.p}" ${linked ? 'hidden' : ''}>${ic('reset')} Reset to ${esc(f.linkLabel)}</button><span class="chip-note" ${linked ? '' : 'hidden'}>${ic('link')} Linked to ${esc(f.linkLabel)}</span>` : ''}`; break;
    }
    case 'calc':
      body = `<div class="ro"><span data-out="${f.out}">${OUT[f.out] ? OUT[f.out]() : ''}</span>${f.unit ? `<em>${esc(f.unit)}</em>` : ''}</div>`; break;
    case 'chips': {
      const arr = (M[key] ??= [...(f.def || [])]);
      body = `<div class="chips" data-chips="${key}">${arr.map((c) => `<span class="chip">${esc(c)}<button type="button" data-rm="${esc(c)}" aria-label="Remove ${esc(c)}">${ic('x')}</button></span>`).join('')}<select class="chip-add" aria-label="Add ${esc(f.label)}"><option value="">+ Add</option>${f.opts.filter((o) => !arr.includes(o)).map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>`; break;
    }
    case 'note':
      return `<div class="fnote ${f.span ? 'span' : ''}">${f.html}</div>`;
  }
  return `<div class="fld t-${f.t}">${lab(f, id)}${body}</div>`;
}

function sectionHTML(stage, sec) {
  return `<section class="sec">${sec.title ? `<h3>${esc(sec.title)}</h3>` : ''}<div class="fields">${sec.fields.map((f) => fieldHTML(stage, f)).join('')}</div></section>`;
}

/* refresh every computed element in place (keeps focus and caret) */
function refresh() {
  R = Calc.compute(S, SD);
  $$('[data-out]').forEach((el) => { const f = OUT[el.dataset.out]; if (f) el.textContent = f(); });
  $$('[data-link]').forEach((el) => {
    if (el.tagName !== 'INPUT' || el === document.activeElement) return;
    const q = getP(el.dataset.q);
    if (!q) el.value = +(+LINK[el.dataset.link]()).toFixed(4);
  });
  updateBars(); updateRail(); updateBadge();
  if (UI.modal) updateModalComputed();
  if (UI.view === 'report') renderReport();
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* unit conversion keeps the physical quantity */
function convertQty(path, newU) {
  const q = getP(path); if (!q || q.u === newU) return;
  q.v = newU === 'mt' ? q.v / 1000 : q.v * 1000; q.u = newU;
}

function bindEvents(root) {
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.p && el.tagName === 'INPUT') { setP(el.dataset.p, el.value === '' ? 0 : +el.value); refresh(); }
    else if (el.dataset.q) {
      const path = el.dataset.q; let q = getP(path);
      if (!q) { const u = $(`[data-qu="${path}"]`, root).value; q = { v: 0, u }; setP(path, q); }
      q.v = el.value === '' ? 0 : +el.value;
      const row = el.closest('.fld'); row.querySelector('.qty')?.classList.remove('linked');
      row.querySelector('[data-reset]')?.removeAttribute('hidden'); row.querySelector('.chip-note')?.setAttribute('hidden', '');
      refresh();
    } else if (el.dataset.m) { M[el.dataset.m] = el.value; }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.qu) {
      const path = el.dataset.qu; let q = getP(path);
      if (!q) { // linked: switching unit turns it into an override of the same quantity
        const kgv = LINK[el.dataset.link](); q = { v: kgv, u: 'kg' }; setP(path, q);
      }
      convertQty(path, el.value);
      const inp = $(`[data-q="${path}"]`, root); inp.value = +(+q.v).toFixed(4);
      inp.closest('.qty').classList.remove('linked');
      inp.closest('.fld').querySelector('[data-reset]')?.removeAttribute('hidden'); inp.closest('.fld').querySelector('.chip-note')?.setAttribute('hidden', '');
      refresh();
    } else if (el.dataset.p && el.tagName === 'SELECT') {
      setP(el.dataset.p, el.dataset.num === '1' ? +el.value : el.value); refresh();
    } else if (el.dataset.m) { M[el.dataset.m] = el.value; }
    else if (el.classList.contains('chip-add') && el.value) {
      const key = el.closest('[data-chips]').dataset.chips; M[key].push(el.value); renderStage();
    }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rm) { const key = b.closest('[data-chips]').dataset.chips; M[key] = M[key].filter((c) => c !== b.dataset.rm); renderStage(); }
    else if (b.dataset.reset) { setP(b.dataset.reset, null); renderStage(); refresh(); }
    else if (b.dataset.mode) { const [st, val] = b.dataset.mode.split(':'); if (st === 'feedType') S.feedType = val; else S[st].mode = val; renderStage(); refresh(); }
    else if (b.dataset.ev) { const [st, i] = b.dataset.ev.split(':'); UI.ev[st] = +i; renderStage(); }
    else if (b.dataset.addev) { addEvent(b.dataset.addev); }
    else if (b.dataset.delev) { delEvent(b.dataset.delev); }
  });
}

function addEvent(st) {
  if (st === 'trans') S.trans.push({ product: 'sashimi', weight: { v: 0, u: 'kg' }, yieldPct: 100 });
  else S.storage.push({ weight: { v: 0, u: 'kg' } });
  UI.ev[st] = S[st].length - 1; renderStage(); refresh();
}
function delEvent(st) {
  if (S[st].length < 2) return;
  S[st].splice(UI.ev[st], 1); UI.ev[st] = Math.max(0, UI.ev[st] - 1); renderStage(); refresh();
}
/* Stage definitions 1-5 */
const T = (id, label, o = {}) => ({ t: 'text', id, label, ...o });
const SEL = (id, label, opts, o = {}) => ({ t: 'select', id, label, opts, ...o });
const NUM = (id, label, p, o = {}) => ({ t: 'num', id, label, p, ...o });
const CALC = (id, label, outKey, o = {}) => ({ t: 'calc', id, label, out: outKey, ...o });
const FUELS = ['Marine Diesel Oil', 'Diesel', 'Heavy Fuel Oil', 'LNG'];
const FAO = ['FAO 21', 'FAO 27', 'FAO 31', 'FAO 34', 'FAO 37', 'FAO 41', 'FAO 47', 'FAO 51', 'FAO 57', 'FAO 61', 'FAO 67', 'FAO 71', 'FAO 77', 'FAO 81', 'FAO 87'];
const SPECIES = 'Thunnus thynnus';
const FEED_MODES = [['bait', 'Bait Fish'], ['pellet', 'Pellet']];

const STAGES = [];

STAGES.push({
  id: 'juvenile', tab: 'Juvenile Sourcing', title: 'Sourcing',
  desc: 'Accounts for upstream emissions from hatchery operations and the fuel used to transport seed stock to the facility.',
  modeKey: 'juvenile', modes: [['ranching', 'Ranching'], ['fullcycle', 'Full Cycle']],
  cols: () => {
    if (S.juvenile.mode === 'fullcycle') return [[{ title: '', fields: [{ t: 'note', span: 1, html: '<strong>Full Cycle fields are not designed yet.</strong><br>Hatchery inputs for the full cycle will appear here once that screen is shared. Ranching is fully calculated.' }] }]];
    return [[{
      title: 'Sourcing', fields: [
        T('org', 'Organization', { def: 'Fishing Company' }),
        SEL('coords', 'Availability of Catch Coordinates', ['Yes', 'No'], { def: 'No' }),
        T('vessel', 'Vessel Name', { def: 'VESSEL NO.101' }),
        T('vesselId', 'Unique Vessel ID', { def: '9xxxxxx9' }),
        { t: 'chips', id: 'area', label: 'Catch Area', opts: FAO, def: ['FAO 71', 'FAO 77'] },
        { t: 'range', id: 'capture', label: 'Date(s) of Capture' },
        T('species', 'Species', { def: SPECIES }),
        T('form', 'Product Form', { def: 'Live Juvenile Fish' })
      ]
    }], [{
      title: 'Details', fields: [
        T('own', 'Product Ownership', { def: 'Unknown' }),
        T('kde', 'Linking KDE (batch, lot, or serial)', { def: 'Unknown' }),
        T('coc', 'Chain of Custody Certification', { def: 'Unknown' })
      ]
    }, {
      title: 'Calculation', fields: [
        { t: 'qty', id: 'w', label: 'Weight or quantity', p: 'juvenile.weight', tip: 'Total emission = fuel emission × weight in MT.' },
        SEL('fuel', 'Fuel type', FUELS, { def: 'Marine Diesel Oil' }),
        NUM('fuelL', 'Fuel consumption', 'juvenile.fuelL', { unit: 'Litre', tip: 'Litres × 0.85 × 3.026 kg CO₂e. Both constants are editable in Source Data.' }),
        SEL('ocean', 'Ocean', ['Pacific', 'Atlantic', 'Indian', 'Southern', 'Mediterranean'], { ph: 'Select an option' })
      ]
    }]];
  }
});

STAGES.push({
  id: 'towing', tab: 'Towing to cage', title: 'To Cage',
  desc: 'Tracks the emissions generated during the final transfer.',
  modeKey: 'towing', modes: [['tow', 'Towing/Support Vessel'], ['wellboat', 'Well boat'], ['truck', 'Truck']],
  cols: () => {
    const m = S.towing.mode;
    const prov = m === 'tow' ? [] : [{ t: 'note', span: 1, html: `The ${m === 'truck' ? 'Truck' : 'Well boat'} layout is provisional until its screen is shared.` }];
    return [[{
      title: 'General', fields: [
        T('gln', 'Location GLN', { ph: 'Enter value' }),
        { t: 'range', id: 'ev', label: 'Event Date(s)' },
        T('species', 'Species', { def: SPECIES }),
        T('form', 'Product form', { def: 'Live Juvenile Fish' }),
        T('kde', 'Linking KDE (batch, lot, or serial number)', { def: '--' })
      ]
    }, {
      title: 'Towing & Cage', fields: [
        ...prov,
        T('vessel', m === 'truck' ? 'Vehicle' : 'Vessel', { def: m === 'truck' ? 'TRUCK NO.12' : 'TUGBOAT NO.101' }),
        T('vesselId', m === 'truck' ? 'Plate number' : 'Unique Vessel ID', { def: m === 'truck' ? 'KL-07-AB-1234' : 'ICCAT Reg.123456' }),
        SEL('fuel', 'Fuel type', FUELS, { def: 'Marine Diesel Oil' }),
        NUM('fuelL', 'Fuel consumption', 'towing.fuelL', { unit: 'Litre', tip: 'Optional. Added on top of the transfer emission at 0.85 × 3.026 kg CO₂e per litre.' }),
        ...(m === 'truck' ? [NUM('dist', 'Distance travelled', 'towing.distKm', { unit: 'km', tip: 'Weight × distance × 0.0000542 kg CO₂e per kg·km.' })] : [])
      ]
    }], [{
      title: 'Quantity', fields: [
        T('cage', 'Cage Number', { def: '#AFR20S' }),
        NUM('cages', 'No. of cages', 'towing.cages', { step: 1 }),
        NUM('mort', 'Mortality', 'towing.mortality', { unit: '%', tip: 'Yield = weight × (1 − mortality).' }),
        { t: 'qty', id: 'w', label: 'Weight or Quantity', p: 'towing.weight' },
        CALC('yield', 'Yield', 'tow.yield', { unit: 'MT' })
      ]
    }]];
  }
});
S.towing.cages = 1;

STAGES.push({
  id: 'feed', tab: 'Feed sourcing', title: 'Feed',
  desc: 'This category measures the carbon emissions generated from feeding farmed fish using bait fish or manufactured feed pellets.',
  modeKey: 'feedType', modes: FEED_MODES,
  cols: () => {
    const t = S.feedType, b = t === 'bait';
    return [[{
      title: 'Section I', fields: [
        T('org', 'Organization', { def: 'Farm' }), T('gln', 'Location GLN', { def: "Farm's GLN" }),
        T('own', 'Product Ownership', { def: 'Farm' }), T('sku', 'Item/SKU/UPC/GTIN', { def: '--' }),
        T('kde', 'Linking KDE (batch, lot, or serial)', { def: '--' }), { t: 'range', id: 'ev', label: 'Event Date(s)' },
        T('coc', 'Chain of Custody Certification', { def: '--' }),
        CALC('qty', 'Quantity of feed required by net biomass', 'feed.mt', { unit: 'MT', tip: 'Net biomass gain × FCR. Net biomass gain = harvest quantity − towing yield.' }),
        T('cert', 'Certification', { def: '--' })
      ]
    }], [{
      title: 'Section II', fields: [
        T('name_' + t, 'Feed name', { def: b ? 'Frozen Bait Fish' : 'Pellet' }),
        NUM('fcr', 'Feed conversion ratio', 'fcr.{ft}', { step: 0.1, tip: 'Shared with the Farming stage.' }),
        NUM('elec', 'Electricity consumption', 'feed.{ft}.elecKwh', { unit: 'kWh', tip: 'Optional extra energy, at the grid factor in Source Data.' }),
        NUM('cool', 'Refrigeration energy', 'feed.{ft}.coolKwh', { unit: 'kWh', tip: 'Optional extra energy. Bait freezing is already included from Source Data.' }),
        SEL('refrigerant', 'Refrigerant type', Object.keys(Calc.GWP), { ph: 'Select an option' }),
        CALC('prod', b ? 'Bait freezing emission' : 'Pellet raw-material emission', 'feed.prod', { unit: 'kg CO₂e', tip: b ? 'CF of freezing per kg tuna × net biomass gain.' : 'Composition-weighted CF × FCR × net biomass gain.' })
      ]
    }], [{
      title: 'Section III', fields: [
        NUM('water', 'Water usage', 'feed.{ft}.waterL', { unit: 'L' }),
        NUM('dist', 'Distance', 'feed.{ft}.distKm', { unit: 'km', tip: 'Feed kg × distance × 0.0000542 kg CO₂e per kg·km.' }),
        SEL('fuel', 'Fuel type', FUELS, { def: 'Marine Diesel Oil' }),
        NUM('fuelL', 'Fuel consumption', 'feed.{ft}.fuelL', { unit: 'L per MT', tip: 'Litres × 0.85 × 3.026 × MT of feed.' })
      ]
    }]];
  }
});

STAGES.push({
  id: 'farming', tab: 'Farming', title: 'Farming',
  desc: 'Comprises the total footprint of all active daily operations on the farm: electricity for monitoring and handling, generator fuel, and fuel used to bring in feed.',
  modeKey: 'feedType', modes: FEED_MODES,
  cols: () => [[{
    title: 'General', fields: [
      T('gln', 'GLN of farm', { def: "Farm's GLN" }), T('cage', 'Cage ID', { def: '--' }),
      T('cert', 'Farm Certification', { def: 'ASC or BAP Certification' }), T('own', 'Product Ownership', { def: 'Farm' }),
      T('species', 'Species', { def: SPECIES }), T('sku', 'Item/SKU/UPC/GTIN', { def: '--' }),
      T('kde', 'Linking KDE (batch, lot, or serial)', { def: '--' }),
      { t: 'date', id: 'stock', label: 'Stocking date', def: '2026-10-12' }
    ]
  }], [{
    title: 'Energy', fields: [
      CALC('qfed', 'Quantity fed', 'farm.gain', { unit: 'kg', tip: 'Net biomass gain: harvest quantity minus towing yield.' }),
      NUM('fcr', 'FCR', 'fcr.{ft}', { step: 0.1, tip: 'Shared with the Feed sourcing stage.' }),
      CALC('fcons', 'Feed consumed by net biomass', 'farm.feedMT', { unit: 'MT' }),
      SEL('water', 'Water body type', ['Marine', 'Freshwater', 'Brackish'], { def: 'Marine', req: 1 }),
      CALC('elec', 'Electricity emission', 'farm.elec', { unit: 'kg CO₂e', tip: '0.50 kWh/kg × 0.51 kg CO₂e/kWh × net biomass gain. Monitoring, lighting and handling equipment.' }),
      SEL('fuel', 'Fuel Type', FUELS, { def: 'Marine Diesel Oil' }),
      NUM('fuelT', 'Fuel consumption for transport', 'farming.{ft}.fuelTPerMT', { unit: 't per MT feed', tip: 'Feed MT × tonnes of fuel per MT × 3,206 kg CO₂e per tonne of fuel.' }),
      CALC('misc', 'Misc fuel usage emission', 'farm.misc', { unit: 'kg CO₂e', tip: '0.10 L/kg × 2.64 kg CO₂e/L × net biomass gain. Generator and mooring inspection.' })
    ]
  }]]
});

STAGES.push({
  id: 'harvest', tab: 'Harvesting', title: 'Harvest',
  desc: 'Captures emissions from final collection operations.',
  cols: () => [[{
    title: 'General', fields: [
      T('gln', 'Location GLN', { def: "Farm's GLN" }), T('own', 'Product Ownership', { def: 'Farm' }),
      T('species', 'Species', { def: SPECIES }), T('form', 'Product form', { def: 'Whole fish live' }),
      T('sku', 'Item/SKU/UPC/GTIN', { def: 'N/A' }), T('kde', 'Linking KDE (batch, lot, or serial number)', { def: '--' }),
      T('coc', 'Chain of Custody Certification', { def: '--' })
    ]
  }], [{
    title: 'Energy', fields: [
      SEL('fuel', 'Fuel Type', FUELS, { def: 'Marine Diesel Oil' }),
      NUM('fuelLMT', 'Fuel consumption', 'harvest.fuelLPerMT', { unit: 'L/MT', tip: 'Litres per MT harvested × MT × 3.20 kg CO₂e per litre.' }),
      CALC('misc', 'Misc fuel usage emission', 'harv.misc', { unit: 'kg CO₂e', tip: '0.05 L/kg × 2.64 kg CO₂e/L × harvest quantity. Cage lifting and platform machinery.' }),
      CALC('refrig', 'Refrigeration emission', 'harv.refrig', { unit: 'kg CO₂e', tip: '0.10 kg CO₂e per kg harvested, for chilling at harvest.' }),
      CALC('elec', 'Electricity emission', 'harv.elec', { unit: 'kg CO₂e', tip: '0.03 kWh/kg × 0.51 kg CO₂e/kWh × harvest quantity.' })
    ]
  }], [{
    title: 'Collection', fields: [
      { t: 'range', id: 'dates', label: 'Harvesting date(s)' },
      NUM('growth', 'Growth Multiplier', 'harvest.growth', { step: 0.1, tip: 'Harvest quantity = towing yield × growth multiplier.' }),
      CALC('qty', 'Total Harvest quantity', 'harv.qty', { unit: 'KG' })
    ]
  }]]
});
/* Stage definitions 6-10 + computed outputs */
const DIST_UNITS = [['km', 'Kilometres'], ['mi', 'Miles']];

STAGES.push({
  id: 'landing', tab: 'Landing', title: 'Landing',
  desc: 'This category refers to emissions from truck transportation, including fuel burned during the delivery of goods from the farm to the facility.',
  cols: () => [[{
    title: 'Section I', fields: [
      T('org', 'Organization', { def: '--' }), T('gln', 'Location GLN', { def: '--' }), T('own', 'Product Ownership', { def: '--' }),
      T('species', 'Species', { def: SPECIES }), T('form', 'Product form', { def: 'Frozen' }), T('sku', 'Item/SKU/UPC/GTIN', { def: '--' }),
      { t: 'range', id: 'ev', label: 'Event Date(s)' }
    ]
  }], [{
    title: 'Section II', fields: [
      T('coc', 'Chain of Custody Certification', { def: '--' }),
      { t: 'qty', id: 'w', label: 'Weight or quantity', p: 'landing.weight', link: 'landing', linkLabel: 'Harvest', req: 1 },
      NUM('dist', 'Distance to facility', 'landing.distKm', { unit: 'km', req: 1, tip: 'Distance in kilometres from the farm to the receiving facility.' }),
      T('mode', 'Transport Mode', { def: 'Truck' })
    ]
  }], [{
    title: 'Section III', fields: [
      NUM('elec', 'Electricity consumption', 'landing.elecKwh', { unit: 'kWh', tip: 'Optional, at 0.4999 kg CO₂e per kWh.' }),
      SEL('fuel', 'Fuel type', ['Diesel', 'Marine Diesel Oil'], { def: 'Diesel' }),
      CALC('ef', 'Emission factor', 'land.ef', { unit: 'kg CO₂e / kg·km', tip: 'Refrigerated truck factor. Emissions = weight × distance × 0.0000542. Source: Climatiq refrigerated truck dataset.' })
    ]
  }]]
});

STAGES.push({
  id: 'agg', tab: 'Aggregation / Disaggregation', title: 'Aggregation and Disaggregation',
  desc: 'Emissions primarily come from electricity or fuel used to power refrigeration systems, along with leakage of refrigerants, which can have high global warming potential.',
  cols: () => [[{
    title: 'Section I', fields: [
      T('org', 'Organization', { def: 'Storage Facility' }), T('gln', 'Location GLN', { def: '--' }), T('own', 'Product Ownership', { def: '--' }),
      T('species', 'Species', { def: SPECIES }), T('form', 'Product form', { def: 'Frozen' }), T('sku', 'Item/SKU/UPC/GTIN', { def: '--' }),
      T('kde', 'Linking KDE (batch, lot, or serial number)', { def: '--' }), T('coc', 'Chain of Custody Certification', { def: '--' }),
      { t: 'range', id: 'ev', label: 'Event Date(s)' }
    ]
  }], [{
    title: 'Section II', fields: [
      { t: 'qty', id: 'w', label: 'Weight or quantity', p: 'agg.weight', link: 'agg', linkLabel: 'Landing', tip: 'Total aggregate weight of all batches grouped in this event.' },
      CALC('water', 'Water usage emission', 'agg.water', { unit: 'kg CO₂e', tip: 'Weight × 1.00 L/kg × 0.541. Benchmark of 1 L per kg of fish from FAO Fisheries Technical Paper 291.' }),
      SEL('refrigerant', 'Refrigerant type', Object.keys(Calc.GWP), { p: 'agg.refrigerant', tip: 'Sets the global warming potential, for example R-404A = 3,922.' }),
      CALC('refrig', 'Refrigerant leakage emission', 'agg.refrig', { unit: 'kg CO₂e', tip: 'Weight × 0.00007 kg leakage per kg of fish × GWP of the refrigerant.' }),
      CALC('elec', 'Electricity emission', 'agg.elec', { unit: 'kg CO₂e', tip: 'Weight × 0.12 kWh/kg × 0.4999 kg CO₂e/kWh (Thailand grid mix, TGO).' })
    ]
  }], [{
    title: 'Section III', fields: [
      SEL('fuel', 'Fuel type', ['None', 'Diesel', 'Marine Diesel Oil'], { def: 'None' }),
      NUM('fuelL', 'Fuel consumption', 'agg.fuelL', { unit: 'Litre', tip: 'Handling equipment fuel, at 0.85 × 3.026 kg CO₂e per litre.' }),
      T('mode', 'Transport Mode', { def: '--' }),
      NUM('dist', 'Distance to facility', 'agg.distKm', { unit: 'km' })
    ]
  }]]
});

const PRODUCTS = [['sashimi', 'Tuna Sashimi'], ['canned', 'Canned Tuna'], ['pellet', 'Pellet Processing']];
STAGES.push({
  id: 'trans', tab: 'Transformation', title: 'Transformation',
  desc: 'A stage where raw material is converted to product.', events: 'trans',
  cols: () => [[{
    title: 'Processing', fields: [
      T('org', 'Processor', { def: 'AT Seafood Global Limited' }), T('gln', 'Location GLN', { def: '--' }),
      T('own', 'Product Ownership', { def: '--' }), T('species', 'Species', { def: SPECIES }),
      T('kde', 'Linking KDE (batch, lot, or serial number)', { def: '--' }), { t: 'range', id: 'ev', label: 'Event Date(s)' }
    ]
  }], [{
    title: 'Quantity', fields: [
      SEL('product', 'Product type', PRODUCTS, { p: 'trans.{ev:trans}.product', tip: 'Selects the factor set from Source Data. Canned Tuna and Pellet Processing use placeholder factors until their data is provided.' }),
      { t: 'qty', id: 'w', label: 'Weight or Quantity', p: 'trans.{ev:trans}.weight', link: 'trans', linkLabel: 'Aggregation' },
      NUM('yield', 'Yield', 'trans.{ev:trans}.yieldPct', { unit: '%', tip: 'Share of raw weight that becomes product. Passed on to Storage.' }),
      CALC('yieldKg', 'Yield weight', 'trans.yieldKg', { unit: 'kg' })
    ]
  }], [{
    title: 'Emissions', fields: [
      CALC('elec', 'Electricity', 'trans.elec', { unit: 'kg CO₂e', tip: '0.11 kWh/kg × 0.50 kg CO₂e/kWh × raw weight.' }),
      CALC('cool', 'Refrigeration', 'trans.cool', { unit: 'kg CO₂e', tip: '0.449 kWh/kg × 0.50 kg CO₂e/kWh × raw weight.' }),
      CALC('water', 'Water', 'trans.water', { unit: 'kg CO₂e', tip: '5 L/kg × 0.14 kg CO₂e/L × raw weight.' }),
      CALC('fuel', 'Fuel', 'trans.fuel', { unit: 'kg CO₂e', tip: '0.52 L/kg × 2.64 kg CO₂e/L × raw weight.' })
    ]
  }]]
});

STAGES.push({
  id: 'storage', tab: 'Storage', title: 'Storage',
  desc: 'Cold storage of the finished product before it ships. Emissions come from the electricity used to hold the temperature.', events: 'storage',
  cols: () => [[{
    title: 'Facility', fields: [
      T('org', 'Organization', { def: 'Cold Storage Facility' }), T('gln', 'Location GLN', { def: '--' }),
      T('species', 'Species', { def: SPECIES }), T('form', 'Product form', { def: 'Frozen' }),
      T('kde', 'Linking KDE (batch, lot, or serial number)', { def: '--' }), { t: 'range', id: 'ev', label: 'Event Date(s)' }
    ]
  }], [{
    title: 'Quantity', fields: [
      { t: 'qty', id: 'w', label: 'Weight or Quantity', p: 'storage.{ev:storage}.weight', link: 'storage', linkLabel: 'Transformation yield' },
      CALC('elec', 'Electricity emission', 'stor.elec', { unit: 'kg CO₂e', tip: 'Weight × 0.12 kWh/kg × 0.499 kg CO₂e/kWh.' })
    ]
  }]]
});

STAGES.push({
  id: 'dispatch', tab: 'Product dispatch', title: 'Logistics',
  desc: 'Emissions generated during the shipping stage, when products are exported or transported to their final destination, by sea or by air.',
  modeKey: 'dispatch', modes: [['sea', 'Sea'], ['air', 'Air']],
  cols: () => {
    const sea = S.dispatch.mode === 'sea';
    return [[{
      title: 'Shipment', fields: [
        T('scope', 'Scope level', { def: 'Scope III', dis: true }),
        T('tx', 'Transaction No. (s)', { def: 'STC-EU-123' }),
        T(sea ? 'vessel' : 'carrier', sea ? 'Vessel Name' : 'Air Carrier Name', { def: sea ? 'CMA CGM CYRANO' : 'AIR CARGO' }),
        ...(sea ? [T('imo', 'Unique Vessel ID (IMO)', { def: '1021087' })] : []),
        T('species', 'Species', { def: SPECIES }), T('form', 'Product form', { def: 'Frozen' }),
        { t: 'date', id: 'ev', label: 'Event date', def: '2026-10-12' }
      ]
    }], [{
      title: 'Freight', fields: [
        { t: 'qty', id: 'w', label: 'Yield Weight or Quantity', p: 'dispatch.weight', link: 'dispatch', linkLabel: 'Storage', req: 1 },
        ...(sea ? [
          NUM('dist', 'Distance travelled', 'dispatch.distKm', { unit: 'km', tip: 'Sea route distance, for example Cat Lai to Hamburg 17,350 km.' }),
          NUM('teu', 'No. of TEU', 'dispatch.teu', { step: 1 }),
          NUM('dry', 'GW of Dry container', 'dispatch.dryMT', { unit: 'mt' }),
          NUM('reef', 'GW of Reefer container', 'dispatch.reeferMT', { unit: 'mt' })
        ] : [
          NUM('airkm', 'Distance travelled', 'dispatch.airKm', { unit: 'km' }),
          NUM('gw', 'Est GW of Aircraft', 'dispatch.aircraftMT', { unit: 'mt' })
        ])
      ]
    }], [{
      title: 'Result', fields: [
        CALC('em', sea ? 'Emissions of vessel' : 'Emissions of aircraft', sea ? 'disp.sea' : 'disp.air', {
          unit: 'kg CO₂e', tip: sea ? '(TEU × reefer GW × 0.9 × 0.01681 × distance) + (TEU × dry GW × 0.1 × 0.0129 × distance). Gross weights in tonnes.' : 'Aircraft GW (tonnes) × distance × 0.68.'
        })
      ]
    }]];
  }
});

/* computed outputs */
out('tow.yield', () => fmt(R.yieldKg / 1000, 2));
out('farm.gain', () => fmt(R.gainKg));
out('farm.feedMT', () => fmt(R.feedMT[S.feedType]));
out('farm.elec', () => fmt(R.stages.farming.elec));
out('farm.misc', () => fmt(R.stages.farming.misc));
out('feed.mt', () => fmt(R.feedMT[S.feedType], 4));
out('feed.prod', () => fmt(R.stages.feed.parts[0].value));
out('harv.qty', () => fmt(R.harvestKg));
out('harv.misc', () => fmt(R.stages.harvest.misc));
out('harv.refrig', () => fmt(R.stages.harvest.refrig));
out('harv.elec', () => fmt(R.stages.harvest.elec));
out('land.ef', () => String(SD.landing.ef));
out('agg.water', () => fmt(R.stages.agg.water));
out('agg.refrig', () => fmt(R.stages.agg.refrig));
out('agg.elec', () => fmt(R.stages.agg.elec));
const curTrans = () => R.stages.trans.events[UI.ev.trans] || { yieldKg: 0, elec: 0, cool: 0, water: 0, fuel: 0 };
out('trans.yieldKg', () => fmt(curTrans().yieldKg));
['elec', 'cool', 'water', 'fuel'].forEach((k) => out('trans.' + k, () => fmt(curTrans()[k])));
out('stor.elec', () => fmt((R.stages.storage.events[UI.ev.storage] || { total: 0 }).total));
out('disp.sea', () => fmt(R.stages.dispatch.sea));
out('disp.air', () => fmt(R.stages.dispatch.air));
/* Rendering: rail, stage card, bottom bar, badge, report, init */
const BASIS = {
  juvenile: 'juvenile weight', towing: 'juveniles towed', feed: 'feed', farming: 'net biomass gain', harvest: 'harvested fish',
  landing: 'landed fish', agg: 'aggregated fish', trans: 'raw weight', storage: 'stored fish', dispatch: 'shipped fish'
};
const PAL = ['--p0', '--p1', '--p2', '--p3', '--p4', '--p5', '--p6', '--p7', '--p8', '--p9'];
const stageOf = (id) => STAGES.find((s) => s.id === id);

const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Slide a glass highlight under the active button. `from` lets a re-rendered control animate from where it used to be. */
function slideThumb(thumb, active, from) {
  if (!thumb) return;
  if (!active) { thumb.style.opacity = '0'; return; }
  const x = active.offsetLeft, w = active.offsetWidth;
  const jump = (px, pw) => { thumb.style.transition = 'none'; thumb.style.setProperty('--x', px + 'px'); thumb.style.width = pw + 'px'; void thumb.offsetWidth; thumb.style.transition = ''; };
  if (!thumb.dataset.ready || prefersReduced()) { jump(x, w); }
  else {
    if (from) jump(from.x, from.w);
    const prevX = parseFloat(thumb.style.getPropertyValue('--x')) || 0;
    thumb.style.setProperty('--x', x + 'px'); thumb.style.width = w + 'px';
    if (Math.abs(prevX - x) > 2) {
      thumb.style.setProperty('--sx', '1.07'); thumb.style.setProperty('--sy', '.9');
      clearTimeout(thumb._sq); thumb._sq = setTimeout(() => { thumb.style.setProperty('--sx', '1'); thumb.style.setProperty('--sy', '1'); }, 170);
    }
  }
  thumb.dataset.ready = '1'; thumb.style.opacity = '1';
}
function captureThumbs() {
  const m = {};
  $$('.seg[data-key]').forEach((s) => { const on = $('button.on', s); if (on) m[s.dataset.key] = { x: on.offsetLeft, w: on.offsetWidth }; });
  return m;
}
function placeSegs(root, prev = {}) {
  $$('.seg[data-key]', root).forEach((s) => slideThumb($('.thumb', s), $('button.on', s), prev[s.dataset.key]));
}

function renderRail() {
  const rail = $('#rail');
  if (!rail.dataset.built) {
    rail.innerHTML = '<i class="gl-ind" aria-hidden="true"></i>' + STAGES.map((s) => `<button type="button" class="tab" role="tab" data-go="${s.id}"><span class="tl">${esc(s.tab)}</span><span class="share"><i data-share="${s.id}"></i></span></button>`).join('');
    rail.dataset.built = '1';
  }
  $$('.tab', rail).forEach((b) => b.setAttribute('aria-selected', String(UI.view === 'stage' && UI.stage === b.dataset.go)));
  const act = $('.tab[aria-selected="true"]', rail);
  slideThumb($('.gl-ind', rail), act);
  if (act) {
    const wrap = rail.parentElement, left = act.offsetLeft - (wrap.clientWidth - act.offsetWidth) / 2;
    wrap.scrollTo({ left: Math.max(0, left), behavior: prefersReduced() ? 'auto' : 'smooth' });
  }
  updateRail();
}
function refitRail() { const t = $('#rail .gl-ind'); if (t) { t.dataset.ready = ''; renderRail(); } }

/* ---- theme ---- */
const THEME_KEY = 'aq-theme';
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function syncThemeButton() {
  const b = $('#theme'); if (!b) return;
  const dark = currentTheme() === 'dark';
  b.setAttribute('aria-checked', String(dark)); b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}
function initTheme() {
  let t = null; try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* storage unavailable */ }
  const root = document.documentElement;
  root.dataset.theme = (t === 'dark' || t === 'light') ? t : (root.dataset.theme === 'dark' ? 'dark' : 'light');
  syncThemeButton();
}
function setTheme(next) {
  const root = document.documentElement;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable */ }
  if (!prefersReduced()) { root.classList.add('theming'); setTimeout(() => root.classList.remove('theming'), 560); }
  root.dataset.theme = next; syncThemeButton();
}
function updateRail() {
  const sum = R.sum || 1;
  $$('[data-share]').forEach((el) => { el.style.width = Math.max(2, R.stages[el.dataset.share].total / sum * 100).toFixed(1) + '%'; });
}
function updateBadge() { const el = $('#badge'); if (el) el.textContent = fmt(R.headline); }

function segHTML(items, cur, attr) {
  return `<div class="seg" role="group" data-key="${attr}"><i class="thumb" aria-hidden="true"></i>${items.map(([v, l]) => `<button type="button" class="${v === cur ? 'on' : ''}" aria-pressed="${v === cur}" data-mode="${attr}:${v}">${esc(l)}</button>`).join('')}</div>`;
}

function renderStage() {
  UI.view = 'stage';
  const prevThumbs = captureThumbs();
  const st = stageOf(UI.stage), host = $('#stage');
  const cur = st.modeKey === 'feedType' ? S.feedType : st.modeKey ? S[st.modeKey].mode : null;
  let sub = '';
  if (st.modes) sub = segHTML(st.modes, cur, st.modeKey);
  if (st.events) {
    const label = st.id === 'trans' ? 'Processing Event' : 'Storage Event';
    sub = `<div class="evtabs">${S[st.events].map((_, i) => `<button type="button" class="${i === UI.ev[st.id] ? 'on' : ''}" data-ev="${st.id}:${i}">${label} ${roman(i)}</button>`).join('')}<button type="button" class="evadd" data-addev="${st.id}" aria-label="Add event">${ic('plus')}</button>${S[st.events].length > 1 ? `<button type="button" class="evdel" data-delev="${st.id}">Remove this event</button>` : ''}</div>`;
  }
  const cols = st.cols();
  host.innerHTML = `
    <div class="stage-head"><div><h2>${esc(st.title)}</h2><p class="desc">${esc(st.desc)}</p></div>${sub}</div>
    <div class="barwrap">
<section class="bar" aria-label="Stage result">
      <div class="bk"><span class="bl">Total emission</span><div class="bv"><b data-bar="total">0</b><i>kg CO₂e</i></div></div>
      <div class="bmid"><div class="stack" data-bar="stack" role="img" aria-label="Breakdown of this stage"></div><div class="legend" data-bar="legend"></div></div>
      <div class="bk r"><span class="bl">Emission per 1KG <em data-bar="basis"></em></span><div class="bv"><b data-bar="perkg">0</b><i>kg CO₂e</i></div></div>
    </section>
    </div>
    <div class="cols c${cols.length}">${cols.map((c) => `<div class="col">${c.map((sec) => sectionHTML(st.id, sec)).join('')}</div>`).join('')}</div>
`;
  placeSegs(host, prevThumbs); renderRail(); updateBars();
}

function updateBars() {
  if (UI.view !== 'stage') return;
  const st = R.stages[UI.stage]; if (!st) return;
  $('[data-bar="total"]').textContent = fmt(st.total);
  $('[data-bar="perkg"]').textContent = fmt(st.perKg, st.perKg < 0.1 ? 4 : 2);
  $('[data-bar="basis"]').textContent = 'per kg of ' + BASIS[UI.stage];
  const parts = st.parts.filter((p) => p.value > 0), sum = parts.reduce((a, p) => a + p.value, 0) || 1;
  $('[data-bar="stack"]').innerHTML = parts.map((p, i) => `<i style="width:${(p.value / sum * 100).toFixed(2)}%;background:var(${PAL[i]})" title="${esc(p.label)}"></i>`).join('');
  $('[data-bar="legend"]').innerHTML = parts.map((p, i) => `<span><u style="background:var(${PAL[i]})"></u>${esc(p.label)} <b>${(p.value / sum * 100).toFixed(0)}%</b></span>`).join('');
}

function renderReport() {
  UI.view = 'report';
  const host = $('#stage'), sum = R.sum || 1;
  const rows = R.order.map((k, i) => ({ k, i, s: R.stages[k], name: stageOf(k).tab }));
  host.innerHTML = `
    <div class="rep">
      <div class="rep-top">
        <div><span class="eyebrow">Basis: one kg of harvested fish</span><h2>Carbon footprint</h2>
          <div class="rep-big"><b>${fmt(R.headline)}</b><i>kg CO₂e per kg</i></div>
          <p class="desc">Sum of all ten stages (${fmt(R.sum / 1000, 1)} t CO₂e) divided by ${fmt(R.harvestKg)} kg harvested.</p></div>
        <dl class="chain"><div><dt>Towing yield</dt><dd>${fmt(R.yieldKg)} kg</dd></div><div><dt>Harvest quantity</dt><dd>${fmt(R.harvestKg)} kg</dd></div>
          <div><dt>Net biomass gain</dt><dd>${fmt(R.gainKg)} kg</dd></div><div><dt>Feed (${S.feedType === 'bait' ? 'bait fish' : 'pellet'})</dt><dd>${fmt(R.feedMT[S.feedType])} MT</dd></div></dl>
      </div>
      <div class="stack big" role="img" aria-label="Share of each stage">${rows.map((r) => `<i style="width:${(r.s.total / sum * 100).toFixed(2)}%;background:var(${PAL[r.i]})" title="${esc(r.name)}"></i>`).join('')}</div>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Stage</th><th class="n">Total kg CO₂e</th><th class="n">Per kg harvested</th><th>Share</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><button type="button" class="lnk" data-go="${r.k}"><u style="background:var(${PAL[r.i]})"></u>${esc(r.name)}</button></td><td class="n">${fmt(r.s.total)}</td><td class="n">${fmt(r.s.perHarvestKg, 3)}</td><td><span class="mini"><i style="width:${(r.s.total / sum * 100).toFixed(1)}%;background:var(${PAL[r.i]})"></i></span><em>${(r.s.total / sum * 100).toFixed(1)}%</em></td></tr>`).join('')}
      </tbody><tfoot><tr><td>All stages</td><td class="n">${fmt(R.sum)}</td><td class="n">${fmt(R.headline, 3)}</td><td></td></tr></tfoot></table></div>
    </div>`;
  renderRail();
}

function go(id) { UI.stage = id; renderStage(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function init() {
  $('#app').innerHTML = `
    <header class="top">
      <button type="button" class="round" id="back" aria-label="Back">${ic('back')}</button>
      <div class="brand" id="brand"><img src="sc-blue-logo.png" alt="" width="40" height="34"><svg class="bm" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 11V6a2 2 0 0 1 2-2h5M21 4h5a2 2 0 0 1 2 2v5M28 21v5a2 2 0 0 1-2 2h-5M11 28H6a2 2 0 0 1-2-2v-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9 17c3-4 6-4 9 0-3 4-6 4-9 0Zm9 0 4-3v6z" fill="currentColor"/></svg><span class="bt"><b>SMARTUNA</b><i>CONCEPT</i></span></div>
      <div class="badge" aria-live="polite">
        <span class="bi">${ic('leaf')}</span>
        <div class="bg"><span class="bl">Total carbon footprint</span><div class="bv"><b id="badge">0</b><i>kgCO₂e</i></div></div>
        <span class="bdiv"></span>
        <div class="bg"><span class="bl">Basis</span><span class="bb">Emission per kg of harvested fish</span></div>
      </div>
      <div class="acts">
        <button type="button" class="themetoggle" id="theme" role="switch" aria-checked="false" aria-label="Dark mode"><span class="tt-sky"><i class="tt-stars"></i><i class="tt-cloud"></i></span><span class="tt-thumb"><svg class="tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="tt-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg></span></button>
        <button type="button" class="btn ghost" id="sd">${ic('db')}<span>Source Data</span></button>
        <button type="button" class="btn solid" id="save">${ic('save')}<span>Review &amp; Save</span></button>
        <button type="button" class="btn solid alt" id="rep"><span>Report</span>${ic('chart')}</button>
      </div>
    </header>
    <nav class="rail-wrap" aria-label="Stages"><div class="rail" id="rail" role="tablist"></div></nav>
    <main class="card" id="stage"></main>
    <p class="foot">Aquaculture production · GDST-aligned stages · Figures are estimates built from the factors in Source Data.</p>`;
  { const lg = $('#brand img'); if (lg) lg.addEventListener('error', () => $('#brand').classList.add('nologo')); }
  initTheme();
  $('#theme').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  window.addEventListener('resize', refitRail);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitRail);
  bindEvents($('#stage'));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
  });
  $('#rep').addEventListener('click', () => { UI.view === 'report' ? renderStage() : renderReport(); });
  $('#save').addEventListener('click', () => toast('Saving to the database is not connected in this build yet.'));
  $('#back').addEventListener('click', () => { window.location.href = 'carbon-calculator.html'; });
  $('#sd').addEventListener('click', openModal);
  renderStage(); refresh();
}
/* Source Data modal: every emission factor, editable, with live derived values */
const getSD = (p) => (p[0] === '@' ? p.slice(1) : p).split('.').reduce((o, k) => o[k], p[0] === '@' ? S : SD);
const setSD = (p, v) => {
  const ks = (p[0] === '@' ? p.slice(1) : p).split('.'); const last = ks.pop();
  ks.reduce((o, k) => o[k], p[0] === '@' ? S : SD)[last] = v;
};
const I = (label, path, unit, o = {}) => ({ k: 'in', label, path, unit, ...o });
const C = (label, fn, unit, o = {}) => ({ k: 'calc', label, fn, unit, ...o });
const sdn = (p) => +getSD(p);
const gwp = () => Calc.GWP[S.agg.refrigerant] || 0;

function transCards(p) {
  const b = 'trans.' + p + '.';
  const q = (n) => sdn(b + n);
  return [
    { head: 'Electricity', rows: [I('Electricity usage', b + 'kwh', 'kWh/kg'), I('Emission factor of electricity', b + 'efElec', 'kg CO₂e/kWh'), C('CF of Electricity', () => q('kwh') * q('efElec'), 'kg CO₂e/kg')] },
    { head: 'Refrigeration', rows: [I('Refrigeration energy', b + 'coolKwh', 'kWh/kg'), I('Emission factor', b + 'efCool', 'kg CO₂e/kWh'), C('CF of Refrigeration', () => q('coolKwh') * q('efCool'), 'kg CO₂e/kg')] },
    { head: 'Water', rows: [I('Water usage', b + 'waterL', 'L/kg'), I('Emission factor of water', b + 'efWater', 'kg CO₂e/L'), C('CF of Water', () => q('waterL') * q('efWater'), 'kg CO₂e/kg')] },
    { head: 'Fuel', rows: [I('Fuel usage', b + 'fuelL', 'L/kg'), I('Diesel EF', b + 'efDiesel', 'kg CO₂e/L'), C('CF of Fuel', () => q('fuelL') * q('efDiesel'), 'kg CO₂e/kg')] },
    { head: 'Total', wide: 1, rows: [C('Total Transformation', () => q('kwh') * q('efElec') + q('coolKwh') * q('efCool') + q('waterL') * q('efWater') + q('fuelL') * q('efDiesel'), 'kg CO₂e per kg raw', { strong: 1 })] }
  ];
}

const SDV = {
  juvenile: () => ({ cards: [{ head: 'Fishing Factor', rows: [I('PS emission factor', 'juvenile.psEF', 'kg CO₂e'), I('PS fuel conversion', 'juvenile.psFuel', 'L per L'), C('Diesel factor used', () => sdn('juvenile.psEF') * sdn('juvenile.psFuel'), 'kg CO₂e/L', { strong: 1 })] }] }),
  towing: () => ({ cards: [{ head: 'Transfer to cage', rows: [I('Towing / well boat intensity', 'towing.intensity', 'kg CO₂e per kg'), I('Truck factor', 'towing.truckEF', 'kg CO₂e/kg·km')] }], note: 'Intensity is a placeholder carried from the design (1.00). Replace it with the measured value when available.' }),
  feed: (sub) => {
    if (sub === 'pellet') {
      return {
        subs: [['bait', 'Bait fish'], ['pellet', 'Pellet']], cards: [{
          head: 'Feed Pellets · Raw material sourcing · Tuna', wide: 1,
          table: { cols: ['Components', '% Composition', 'Emission factor', 'CF (kg CO₂e/kg)'], rows: SD.feed.pellet.map((c, i) => [c.name, I('', `feed.pellet.${i}.pct`, '%'), I('', `feed.pellet.${i}.ef`, ''), C('', () => sdn(`feed.pellet.${i}.pct`) / 100 * sdn(`feed.pellet.${i}.ef`), '')]) },
          rows: [C('Total CF of Feed', () => SD.feed.pellet.reduce((a, c, i) => a + sdn(`feed.pellet.${i}.pct`) / 100 * sdn(`feed.pellet.${i}.ef`), 0), 'kg CO₂e/kg', { strong: 1 }),
            I('Feed conversion ratio', '@fcr.pellet', 'kg per kg fish'),
            C('CF of feed for 1 kg tuna', () => SD.feed.pellet.reduce((a, c, i) => a + sdn(`feed.pellet.${i}.pct`) / 100 * sdn(`feed.pellet.${i}.ef`), 0) * S.fcr.pellet, 'kg CO₂e', { strong: 1 })]
        }, { head: 'Energy and water', rows: [I('Grid emission factor', 'feed.efGrid', 'kg CO₂e/kWh'), I('Water emission factor', 'feed.efWater', 'kg CO₂e/L')] }]
      };
    }
    return {
      subs: [['bait', 'Bait fish'], ['pellet', 'Pellet']], cards: [{
        head: 'Feed Input · Freezing of Bait fish', rows: [
          I('FCR', '@fcr.bait', 'kg per kg fish'), I('EF of diesel generator', 'feed.efGen', 'kg CO₂e/kWh'),
          I('Refrigeration energy', 'feed.refrigKwh', 'kWh/kg'),
          C('CF for Refrigeration', () => sdn('feed.refrigKwh') * S.fcr.bait * sdn('feed.efGen'), 'kg CO₂e per kg tuna', { strong: 1 })]
      }, { head: 'Energy and water', rows: [I('Grid emission factor', 'feed.efGrid', 'kg CO₂e/kWh'), I('Water emission factor', 'feed.efWater', 'kg CO₂e/L')] }]
    };
  },
  farming: () => ({
    cards: [
      { head: 'CF of Electricity', sub: 'Monitoring and surveillance systems, lighting, handling equipment', rows: [I('Electricity consumption', 'farming.kwhPerKg', 'kWh/kg'), I('Emission factor', 'farming.efElec', 'kg CO₂e/kWh'), C('CF of Electricity', () => sdn('farming.kwhPerKg') * sdn('farming.efElec'), 'kg CO₂e/kg')] },
      { head: 'CF of Fuel', sub: 'Generator and backup power, cage and mooring inspection', rows: [I('Fuel usage', 'farming.fuelLPerKg', 'L/kg'), I('Diesel emission factor', 'farming.efDiesel', 'kg CO₂e/L'), C('CF of Fuel consumption', () => sdn('farming.fuelLPerKg') * sdn('farming.efDiesel'), 'kg CO₂e/kg')] },
      { head: 'Feed transport', rows: [I('CO₂e per tonne of fuel', 'farming.co2PerTFuel', 'kg CO₂e/t')] },
      { head: 'Total', rows: [C('Total emission in farming', () => sdn('farming.kwhPerKg') * sdn('farming.efElec') + sdn('farming.fuelLPerKg') * sdn('farming.efDiesel'), 'kg CO₂e per kg gain', { strong: 1 })] }
    ]
  }),
  harvest: () => ({
    cards: [
      { head: 'Fuel', rows: [I('Diesel', 'harvest.dieselEF', 'kg CO₂e/L')] },
      { head: 'CF of Fuel consumption', sub: 'Lifting harvested tuna from cages, harvest platform machinery, generator power', rows: [I('Fuel consumption', 'harvest.fuelLPerKg', 'L/kg'), I('EF of fuel', 'harvest.efDiesel', 'kg CO₂e/L'), C('CF of Fuel', () => sdn('harvest.fuelLPerKg') * sdn('harvest.efDiesel'), 'kg CO₂e/kg')] },
      { head: 'CF of Electricity', sub: 'Harvest lighting, sensors, control panels, chillers', rows: [I('Electricity usage', 'harvest.kwhPerKg', 'kWh/kg'), I('Emission factor', 'harvest.efElec', 'kg CO₂e/kWh'), C('Total', () => sdn('harvest.kwhPerKg') * sdn('harvest.efElec'), 'kg CO₂e/kg')] },
      { head: 'Refrigeration', rows: [I('CF of refrigeration', 'harvest.refrigPerKg', 'kg CO₂e/kg')] },
      { head: 'Total', rows: [C('Total emission in Harvesting', () => sdn('harvest.fuelLPerKg') * sdn('harvest.efDiesel') + sdn('harvest.kwhPerKg') * sdn('harvest.efElec') + sdn('harvest.refrigPerKg'), 'kg CO₂e/kg', { strong: 1 })] }
    ]
  }),
  landing: () => ({ cards: [{ head: 'Truck transport', rows: [I('Emission factor', 'landing.ef', 'kg CO₂e/kg·km'), I('Electricity emission factor', 'landing.efElec', 'kg CO₂e/kWh')] }] }),
  agg: () => ({
    cards: [
      { head: 'CF of Electricity', rows: [I('Electricity usage / kg', 'agg.kwhPerKg', 'kWh/kg'), I('EF of Electricity', 'agg.efElec', 'kg CO₂e/kWh'), C('TTL CO₂e for 1 kg', () => sdn('agg.kwhPerKg') * sdn('agg.efElec'), 'kg CO₂e')] },
      { head: 'CF of Water', rows: [I('Water usage for a kg', 'agg.lPerKg', 'L/kg'), I('EF of water', 'agg.efWater', 'kg CO₂e/L'), C('TTL CO₂e for 1 kg', () => sdn('agg.lPerKg') * sdn('agg.efWater'), 'kg CO₂e')] },
      { head: 'CF of Refrigerant', rows: [I('Avg refrigerant emission (per kg)', 'agg.leakPerKg', 'kg/kg'), C('GWP (selected refrigerant)', () => gwp(), S.agg.refrigerant), C('TTL CO₂e for 1 kg', () => sdn('agg.leakPerKg') * gwp(), 'kg CO₂e')] },
      { head: 'Total', rows: [C('Total emission in Cold Storage', () => sdn('agg.kwhPerKg') * sdn('agg.efElec') + sdn('agg.lPerKg') * sdn('agg.efWater') + sdn('agg.leakPerKg') * gwp(), 'kg CO₂e/kg', { strong: 1 })] }
    ]
  }),
  trans: (sub) => ({ subs: PRODUCTS, cards: transCards(sub || 'sashimi'), grid2: 1 }),
  storage: () => ({ cards: [{ head: 'CF of Electricity', rows: [I('Electricity usage', 'storage.kwhPerKg', 'kWh/kg'), I('EF of Electricity', 'storage.efElec', 'kg CO₂e/kWh'), C('CF of storage 1 kg', () => sdn('storage.kwhPerKg') * sdn('storage.efElec'), 'kg CO₂e', { strong: 1 })] }] }),
  dispatch: () => ({
    cards: [{ head: 'Sea freight', rows: [I('Reefer container factor', 'dispatch.reef', 'kg CO₂e/t·km'), I('Dry container factor', 'dispatch.dry', 'kg CO₂e/t·km'), I('Reefer share of TEU', 'dispatch.reefShare', 'fraction'), I('Dry share of TEU', 'dispatch.dryShare', 'fraction')] },
      { head: 'Air freight', rows: [I('Aircraft factor', 'dispatch.air', 'kg CO₂e/t·km')] }], note: 'Constants carried over from the Wild Capture Ship/Receive stage.'
  })
};

let CALCS = [];
function rowHTML(r) {
  if (r.k === 'in') {
    const id = 'sd_' + r.path.replace(/[^\w]/g, '_');
    return `<div class="sdr"><label for="${id}">${esc(r.label)}</label><div class="inp"><input class="in" id="${id}" type="number" step="any" data-sd="${r.path}" value="${getSD(r.path)}">${r.unit ? `<span class="unit">${esc(r.unit)}</span>` : ''}</div></div>`;
  }
  const i = CALCS.push(r.fn) - 1;
  return `<div class="sdr ${r.strong ? 'strong' : ''}"><span class="lb">${esc(r.label)}</span><div class="res"><b data-calc="${i}">${fmt(r.fn(), 4)}</b>${r.unit ? `<em>${esc(r.unit)}</em>` : ''}</div></div>`;
}
function cellHTML(c) {
  if (typeof c === 'string') return `<span class="nm">${esc(c)}</span>`;
  if (c.k === 'in') return `<div class="sdc"><div class="inp"><input class="in" type="number" step="any" data-sd="${c.path}" value="${getSD(c.path)}" aria-label="${esc(c.path)}">${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}</div></div>`;
  const i = CALCS.push(c.fn) - 1;
  return `<b class="sdc res" data-calc="${i}">${fmt(c.fn(), 4)}</b>`;
}

function renderModalBody() {
  CALCS = [];
  const prevSub = captureThumbs();
  const tab = UI.sdTab, sub = UI.sdSub[tab];
  const v = SDV[tab](sub);
  const subs = v.subs ? `<div class="seg sm" data-key="sdsub"><i class="thumb" aria-hidden="true"></i>${v.subs.map(([id, l]) => `<button type="button" class="${(sub || v.subs[0][0]) === id ? 'on' : ''}" data-sub="${id}">${esc(l)}</button>`).join('')}</div>` : '';
  const cards = v.cards.map((c) => `<section class="sdcard ${c.wide ? 'wide' : ''}"><h4>${esc(c.head)}</h4><div class="sdb">${c.sub ? `<p class="csub">${esc(c.sub)}</p>` : ''}
    ${c.table ? `<div class="sdt"><div class="sdth">${c.table.cols.map((x) => `<span>${esc(x)}</span>`).join('')}</div>${c.table.rows.map((r) => `<div class="sdtr">${r.map(cellHTML).join('')}</div>`).join('')}</div>` : ''}
    ${c.rows.map(rowHTML).join('')}</div></section>`).join('');
  $('#sdbody').innerHTML = `${subs}<div class="sdgrid">${cards}</div>${v.note ? `<p class="sdnote">${esc(v.note)}</p>` : ''}`;
  placeSegs($('#sdbody'), prevSub);
}

function updateModalComputed() {
  $$('#sdbody [data-calc]').forEach((el) => { el.textContent = fmt(CALCS[el.dataset.calc](), 4); });
}

function openModal() {
  UI.modal = true;
  let m = $('#modal');
  if (!m) { m = document.createElement('div'); m.id = 'modal'; document.body.appendChild(m); }
  m.innerHTML = `<div class="scrim" data-close="1"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sdt">
    <header><div><h3 id="sdt">Source Data</h3><p>The factors behind every figure in this view. Change a value and every stage recalculates.</p></div><button type="button" class="round" data-close="1" aria-label="Close">${ic('x')}</button></header>
    <div class="sdtabs" role="tablist"><i class="gl-ind" aria-hidden="true"></i>${STAGES.map((s) => `<button type="button" role="tab" class="${s.id === UI.sdTab ? 'on' : ''}" data-sdtab="${s.id}">${esc(s.tab.replace('Aggregation / Disaggregation', 'Aggr / Disaggr'))}</button>`).join('')}</div>
    <div class="sdbody" id="sdbody"></div>
    <footer><p>Values are shown without forcing two-decimal precision. Figures come from several third-party sources and the original values may use different decimal formats.</p><div><button type="button" class="btn ghost" id="sdreset">Reset all factors</button><button type="button" class="btn solid" data-close="1">Close</button></div></footer></div>`;
  m.hidden = false; renderModalBody();
  const tabsEl = $('.sdtabs', m);
  const sdPlace = (smooth) => { const on = $('button.on', tabsEl); slideThumb($('.gl-ind', tabsEl), on); if (on) tabsEl.scrollTo({ left: Math.max(0, on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2), behavior: smooth && !prefersReduced() ? 'smooth' : 'auto' }); };
  sdPlace(false);
  tabsEl.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tabsEl.scrollWidth > tabsEl.clientWidth) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  m.onclick = (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const t = e.target.closest('[data-sdtab]'); if (t) { UI.sdTab = t.dataset.sdtab; $$('[data-sdtab]', m).forEach((b) => b.classList.toggle('on', b === t)); sdPlace(true); renderModalBody(); }
    const s = e.target.closest('[data-sub]'); if (s) { UI.sdSub[UI.sdTab] = s.dataset.sub; renderModalBody(); }
    if (e.target.closest('#sdreset')) { const f = Calc.defaultSD(); Object.keys(f).forEach((k) => { SD[k] = f[k]; }); S.fcr.bait = 15; S.fcr.pellet = 5; renderModalBody(); refresh(); toast('Factors reset to their defaults.'); }
  };
  m.oninput = (e) => { const el = e.target; if (el.dataset.sd) { setSD(el.dataset.sd, el.value === '' ? 0 : +el.value); refresh(); if (el.dataset.sd[0] === '@') renderStageOutputsOnly(); } };
  setTimeout(() => $('.dlg .round', m)?.focus(), 30);
}
function renderStageOutputsOnly() { /* FCR edits change inputs on the stage behind the modal */ if (UI.view === 'stage') { const a = document.activeElement; renderStage(); a?.focus?.(); } }
function closeModal() { UI.modal = false; const m = $('#modal'); if (m) { m.hidden = true; m.innerHTML = ''; } if (UI.view === 'stage') renderStage(); $('#sd')?.focus(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.modal) closeModal(); });
/* Custom dropdown: enhances every <select> in place. The native select stays in the DOM (hidden) as the
   source of truth, so all existing change handlers (data-p / data-m / data-qu / chip-add) keep working. */
const DD = (() => {
  const CHK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHV = '<svg class="dd-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SRCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  let menu = null, cur = null, active = -1, typed = '', typedT = 0;

  const optsOf = (sel) => [...sel.options].map((o, i) => ({ i, v: o.value, t: o.textContent, ph: o.value === '' }));
  const labelOf = (sel) => { const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; };

  function sync(btn, sel) {
    const o = sel.options[sel.selectedIndex];
    const isPh = !o || o.value === '';
    btn.querySelector('.dd-val').textContent = btn.classList.contains('dd-add') ? '+ Add' : (labelOf(sel) || ' ');
    btn.classList.toggle('dd-ph', isPh && !btn.classList.contains('dd-add'));
    btn.disabled = sel.disabled || (btn.classList.contains('dd-add') && sel.options.length < 2);
  }

  function enhance(sel) {
    if (sel.dataset.dd) return; sel.dataset.dd = '1';
    const add = sel.classList.contains('chip-add');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dd-btn' + (add ? ' dd-add' : '');
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    const lbl = sel.getAttribute('aria-label'); if (lbl) btn.setAttribute('aria-label', lbl);
    if (sel.id) btn.dataset.for = sel.id;
    btn.innerHTML = '<span class="dd-val"></span>' + (add ? '' : CHV);
    sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    sel.insertAdjacentElement('afterend', btn);
    sync(btn, sel);
    sel.addEventListener('change', () => sync(btn, sel));
  }
  const scan = (root) => (root || document).querySelectorAll('select:not([data-dd])').forEach(enhance);

  /* ---- menu ---- */
  function build(sel, btn) {
    const list = optsOf(sel).filter((o) => !(btn.classList.contains('dd-add') && o.ph));
    const searchable = list.length > 9;
    const m = document.createElement('div');
    m.className = 'dd-menu'; m.setAttribute('role', 'presentation');
    m.innerHTML = (searchable ? `<div class="dd-search">${SRCH}<input type="text" placeholder="Search…" aria-label="Filter options" autocomplete="off" spellcheck="false"></div>` : '')
      + `<div class="dd-list" role="listbox" tabindex="-1">${list.map((o) => `<div class="dd-opt${o.ph ? ' ph' : ''}" role="option" data-i="${o.i}" aria-selected="${o.i === sel.selectedIndex && !btn.classList.contains('dd-add')}"><span>${esc(o.t || '—')}</span><i class="dd-chk">${CHK}</i></div>`).join('')}<div class="dd-empty" hidden>No matches</div></div>`;
    return m;
  }
  const visible = () => [...menu.querySelectorAll('.dd-opt')].filter((o) => !o.hidden);
  function setActive(el, scroll = true) {
    menu.querySelectorAll('.dd-opt.act').forEach((o) => o.classList.remove('act'));
    if (!el) { active = -1; return; }
    el.classList.add('act'); active = +el.dataset.i;
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }
  function place() {
    if (!menu || !cur) return;
    const r = cur.btn.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    const w = Math.min(Math.max(r.width, cur.btn.classList.contains('dd-add') ? 190 : 150), vw - 16);
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    menu.style.width = w + 'px'; menu.style.left = left + 'px';
    const list = menu.querySelector('.dd-list'); list.style.maxHeight = '';
    const need = Math.min(menu.scrollHeight, 340), below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < Math.min(need, 220) && above > below;
    const room = Math.max(120, (up ? above : below));
    list.style.maxHeight = Math.min(300, room - (menu.querySelector('.dd-search') ? 52 : 14)) + 'px';
    menu.classList.toggle('up', up);
    if (up) { menu.style.top = 'auto'; menu.style.bottom = (vh - r.top + 6) + 'px'; }
    else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 6) + 'px'; }
    menu.style.setProperty('--ox', Math.min(Math.max(r.left + 22 - left, 14), w - 14) + 'px');
  }
  function open(btn) {
    const sel = btn.previousElementSibling; if (!sel || sel.tagName !== 'SELECT' || btn.disabled) return;
    if (cur) close(false);
    cur = { sel, btn }; menu = build(sel, btn); document.body.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    place();
    requestAnimationFrame(() => menu && menu.classList.add('in-view'));
    const sOpt = menu.querySelector('.dd-opt[aria-selected="true"]') || visible()[0];
    setActive(sOpt);
    const inp = menu.querySelector('.dd-search input');
    if (inp) { inp.focus({ preventScroll: true }); inp.addEventListener('input', () => filter(inp.value)); } else menu.querySelector('.dd-list').focus({ preventScroll: true });
  }
  function filter(q) {
    q = q.trim().toLowerCase(); let n = 0;
    menu.querySelectorAll('.dd-opt').forEach((o) => { const hit = !q || o.textContent.toLowerCase().includes(q); o.hidden = !hit; if (hit) n++; });
    menu.querySelector('.dd-empty').hidden = n > 0;
    setActive(visible()[0] || null); place();
  }
  function close(refocus = true) {
    if (!menu) return;
    const m = menu, { btn } = cur; menu = null; cur = null; active = -1;
    btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open');
    m.classList.remove('in-view'); m.classList.add('out');
    setTimeout(() => m.remove(), 150);
    if (refocus) btn.focus({ preventScroll: true });
  }
  function choose(i) {
    if (!cur) return; const { sel } = cur;
    if (sel.selectedIndex !== +i || cur.btn.classList.contains('dd-add')) {
      sel.selectedIndex = +i; sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(true);
  }
  function move(dir) {
    const v = visible(); if (!v.length) return;
    const k = v.findIndex((o) => +o.dataset.i === active);
    setActive(v[dir === 'first' ? 0 : dir === 'last' ? v.length - 1 : Math.min(v.length - 1, Math.max(0, k + dir))]);
  }

  /* ---- events (delegated, one set for the whole page) ---- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.dd-btn');
    if (btn) { e.preventDefault(); (cur && cur.btn === btn) ? close(false) : open(btn); return; }
    const lab = e.target.closest && e.target.closest('label[for]');
    if (lab) { const b = document.querySelector(`.dd-btn[data-for="${CSS.escape(lab.getAttribute('for'))}"]`); if (b) { e.preventDefault(); b.focus(); return; } }
    const opt = e.target.closest && e.target.closest('.dd-opt');
    if (opt && menu && menu.contains(opt)) { choose(opt.dataset.i); return; }
    if (menu && !menu.contains(e.target)) close(false);
  });
  document.addEventListener('mousemove', (e) => { const o = e.target.closest && e.target.closest('.dd-opt'); if (o && menu && menu.contains(o) && +o.dataset.i !== active) setActive(o, false); });
  document.addEventListener('keydown', (e) => {
    const btn = e.target.closest && e.target.closest('.dd-btn');
    if (!menu) {
      if (btn && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(btn); }
      return;
    }
    const inSearch = e.target.matches && e.target.matches('.dd-search input');
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      case 'Tab': close(false); break;
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': if (!inSearch) { e.preventDefault(); move('first'); } break;
      case 'End': if (!inSearch) { e.preventDefault(); move('last'); } break;
      case 'Enter': e.preventDefault(); if (active >= 0) choose(active); break;
      case ' ': if (!inSearch) { e.preventDefault(); if (active >= 0) choose(active); } break;
      default:
        if (!inSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          clearTimeout(typedT); typed += e.key.toLowerCase(); typedT = setTimeout(() => (typed = ''), 600);
          const hit = visible().find((o) => o.textContent.trim().toLowerCase().startsWith(typed)); if (hit) setActive(hit);
        }
    }
  }, true);
  addEventListener('resize', () => close(false));
  addEventListener('scroll', (e) => { if (menu && !menu.contains(e.target)) place(); }, true);

  /* enhance anything rendered now or later (stages, modal) */
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
  return { scan, close };
})();
init();