/* ==========================================================================
   EU Catch Support — Generation Module
   Project Manhattan

   Reads ?shipment=<uuid>, pulls the real Species → Raw Material → Product →
   Shipment chain, and builds Catch Certificate + Processing Statement drafts.

   Usage in eu-catch-support.html, after the existing <script> block:
       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
       <script src="eu-catch-generation.js"></script>
       <script>EUCatchGen.init({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });</script>

   If the page already has a Supabase client, pass it instead:
       EUCatchGen.init({ client: existingSupabaseClient });

   Design notes:
   - Catch certificates split by flag state. One CC per flag state.
   - Only event_type='Catch' rows drive the split. Transshipment rows carry
     nulls and would otherwise create a phantom certificate.
   - Validating / endorsing authority is ALWAYS a manual pick (never silent).
   - Everything written is a SNAPSHOT. Editing the source record later does
     not change an already-generated document.
   ========================================================================== */

const EUCatchGen = (function () {
  'use strict';

  let sb = null;

  /* EU-27. Reuses the list from eu-catch-support.html when present. */
  const EU27 = (typeof EU27_COUNTRIES !== 'undefined' && EU27_COUNTRIES.length === 27)
    ? EU27_COUNTRIES
    : ['Austria','Belgium','Bulgaria','Croatia','Cyprus','Czechia','Denmark','Estonia',
       'Finland','France','Germany','Greece','Hungary','Ireland','Italy','Latvia',
       'Lithuania','Luxembourg','Malta','Netherlands','Poland','Portugal','Romania',
       'Slovakia','Slovenia','Spain','Sweden'];

  const STATE = { shipment: null, items: [], batches: [], rms: [], catches: [],
                  legs: [], item: null, generated: [], bundle: null };

  const clean = v => (typeof v === 'string' ? v.trim() : v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const qs = k => new URLSearchParams(location.search).get(k);

  /* ---------------------------------------------------------------- init */

  function init(cfg) {
    if (cfg.client) sb = cfg.client;
    else if (window.supabase && cfg.url && cfg.key) sb = window.supabase.createClient(cfg.url, cfg.key);
    else { console.error('[EUCatchGen] No Supabase client available.'); return; }

    const docId = qs('doc');
    if (docId) { openInForm(docId); return; }

    const shipmentId = qs('shipment');
    if (!shipmentId) return;              // normal manual use of the form
    start(shipmentId);
  }

  /* ---------------------------------------------------------------- data */

  async function loadChain(shipmentId) {
    const { data: shipment, error: e1 } = await sb
      .from('shipments').select('*').eq('id', shipmentId).maybeSingle();
    if (e1) throw new Error('Could not read the shipment: ' + e1.message);
    if (!shipment) throw new Error('That shipment could not be found, or it belongs to another organisation.');

    const { data: items } = await sb.from('shipment_items')
      .select('*').eq('shipment_id', shipmentId).order('line_no');

    const { data: batches } = await sb.from('shipment_batches')
      .select('*').eq('shipment_id', shipmentId).order('line_no');

    const { data: legs } = await sb.from('shipment_legs')
      .select('*').eq('shipment_id', shipmentId).order('leg_no');

    /* Batches link by id; some were written with only the text ref. Try both. */
    const rmIds  = [...new Set((batches || []).map(b => b.raw_material_id).filter(Boolean))];
    const rmRefs = [...new Set((batches || []).map(b => b.raw_material_ref).filter(Boolean))];

    let rms = [];
    if (rmIds.length) {
      const { data } = await sb.from('raw_materials').select('*').in('id', rmIds);
      rms = data || [];
    }
    if (rmRefs.length) {
      const known = new Set(rms.map(r => r.rm_ref));
      const missing = rmRefs.filter(r => !known.has(r));
      if (missing.length) {
        const { data } = await sb.from('raw_materials').select('*').in('rm_ref', missing);
        rms = rms.concat(data || []);
      }
    }

    let catches = [], species = [];
    if (rms.length) {
      const ids = rms.map(r => r.id);
      const { data: c } = await sb.from('raw_material_catches')
        .select('*').in('raw_material_id', ids).order('line_no');
      catches = c || [];
      const { data: s } = await sb.from('raw_material_species')
        .select('*').in('raw_material_id', ids).order('line_no');
      species = s || [];
    }

    let catchSpecies = [];
    if (catches.length) {
      const { data } = await sb.from('raw_material_catch_species')
        .select('*').in('catch_event_id', catches.map(c => c.id));
      catchSpecies = data || [];
    }

    Object.assign(STATE, { shipment, items: items || [], batches: batches || [],
                           legs: legs || [], rms, catches, species, catchSpecies });
    return STATE;
  }

  /* Resolve a batch to its raw material by id, falling back to the text ref. */
  const rmFor = batch => STATE.rms.find(r =>
    (batch.raw_material_id && r.id === batch.raw_material_id) ||
    (batch.raw_material_ref && r.rm_ref === batch.raw_material_ref)) || null;

  /* --------------------------------------------------------------- gates */

  async function checkEU27(destination) {
    if (!destination) return { ok: false, reason: 'This shipment has no destination country set.' };

    const { data } = await sb.from('countries')
      .select('country, alpha2, alpha3')
      .or(`country.ilike.${destination},alpha2.ilike.${destination},alpha3.ilike.${destination}`)
      .limit(1);

    const row = data && data[0];
    if (!row) return { ok: false, reason: `"${destination}" isn't a recognised country, so EU eligibility can't be confirmed.` };
    if (!EU27.includes(row.country))
      return { ok: false, reason: `${row.country} is outside the EU-27. Catch documentation under Regulation 1005/2008 applies to EU imports only.` };

    return { ok: true, country: row.country, alpha2: row.alpha2, alpha3: row.alpha3 };
  }

  /* ------------------------------------------------------------- payload */

  /* One CC per flag state. Transshipment rows are carried inside the
     certificate they belong to, not used to create new ones. */
  function buildCC(flagState, rmList, gate) {
    const s = STATE.shipment;
    const rmIds = new Set(rmList.map(r => r.id));

    const catchEvents = STATE.catches.filter(c =>
      rmIds.has(c.raw_material_id) && c.event_type === 'Catch' && c.flag_state === flagState);

    const transships = STATE.catches.filter(c =>
      rmIds.has(c.raw_material_id) && c.event_type === 'Transshipment');

    const vessels = [];
    const seen = new Set();
    catchEvents.forEach(c => {
      const key = c.vessel_id || c.vessel_name;
      if (!key || seen.has(key)) return;
      seen.add(key);
      vessels.push({
        vessel_id: c.vessel_id, name: clean(c.vessel_name), imo: c.imo,
        flag_state: c.flag_state, licence_no: c.license_no,
        licence_valid_until: null,          // resolved at the licence pause
        master: clean(c.captain)
      });
    });

    const lines = catchEvents.map(c => {
      const sp = STATE.catchSpecies.filter(x => x.catch_event_id === c.id);
      const rm = rmList.find(r => r.id === c.raw_material_id);
      return {
        vessel_name: clean(c.vessel_name), imo: c.imo, flag_state: c.flag_state,
        species: sp.length ? sp.map(x => clean(x.species_name)) : [clean(rm?.species_name)],
        scientific_name: rm?.scientific_name, afsis_3a_code: rm?.afsis_3a_code,
        product_form: rm?.product_form,
        fao_area: c.fao_area, catch_area_detail: c.catch_area_detail,
        gear_type: c.gear_type, latitude: c.latitude, longitude: c.longitude,
        catch_date_from: c.catch_date_from, catch_date_to: c.catch_date_to,
        estimated_live_weight_kg: sp.length ? sp.reduce((a, x) => a + Number(x.quantity_kg || 0), 0) : null,
        verified_weight_landed_kg: Number(c.quantity_kg || 0),
        landing_port: clean(c.landing_port_name), landing_date: c.landing_date
      };
    });

    return {
      doc_type: 'CC',
      flag_state: flagState,
      validating_authority: null,           // manual pick — never inferred
      vessels, lines,
      transshipments: transships.map(t => ({
        where: t.transship_where, transfer_date: t.transfer_date,
        location: t.transfer_location, carrier_vessel: clean(t.carrier_vessel_name),
        carrier_imo: t.carrier_imo, carrier_flag: t.carrier_flag_state,
        authorisation_no: t.authorisation_no, declaration_no: t.declaration_no,
        observer_present: t.observer_present, observer_name: clean(t.observer_name),
        master: clean(t.captain), quantity_kg: Number(t.quantity_kg || 0)
      })),
      exporter: { name: clean(s.exporter_name), org_id: s.exporter_org_id,
                  country: s.country_of_export },
      transport: {
        country_of_export: s.country_of_export,
        point_of_departure: clean(s.origin_name),
        point_of_destination: clean(s.destination_name),
        container_no: s.container_no, seal_number: s.seal_number,
        legs: STATE.legs.map(l => ({
          leg_no: l.leg_no, mode: l.transport_mode,
          origin: clean(l.origin_name), destination: clean(l.destination_name),
          departure_date: l.departure_date, arrival_date: l.arrival_date,
          carrier: clean(l.carrier_name), document_type: l.document_type,
          document_no: l.document_no, vessel_name: clean(l.vessel_name),
          voyage_no: l.voyage_no, flight_no: l.flight_no, vehicle_plate: l.vehicle_plate
        }))
      },
      destination: { country: gate.country, alpha2: gate.alpha2, alpha3: gate.alpha3 },
      totals: {
        verified_weight_landed_kg: lines.reduce((a, l) => a + (l.verified_weight_landed_kg || 0), 0),
        estimated_live_weight_kg: lines.reduce((a, l) => a + (l.estimated_live_weight_kg || 0), 0)
      },
      snapshot_at: new Date().toISOString()
    };
  }

  function buildPS(item, batches, ccRefs, gate) {
    const s = STATE.shipment;
    return {
      doc_type: 'PS',
      processing_plant: { name: clean(s.processor_name), org_id: s.processor_org_id,
                          country: s.processing_country, approval_number: null },
      exporter: { name: clean(s.exporter_name), org_id: s.exporter_org_id,
                  country: s.country_of_export },
      endorsing_authority: null,            // manual pick
      product: {
        product_id: item.product_id, name: clean(item.product_name),
        species_name: clean(item.species_name), product_form: item.product_form,
        gtin: item.gtin, packages: item.number_of_packages,
        package_type: item.package_type,
        gross_weight_kg: Number(item.gross_weight_kg || 0),
        net_weight_kg: Number(item.net_weight_kg || 0),
        processed_quantity_kg: item.processed_quantity_kg == null
          ? null : Number(item.processed_quantity_kg)
      },
      batches: batches.map(b => {
        const rm = rmFor(b);
        return {
          batch_lot: b.batch_lot, packages: b.packages,
          quantity_kg: b.quantity_kg == null ? null : Number(b.quantity_kg),
          processing_date: b.processing_date, expiry_date: b.expiry_date,
          raw_material_ref: b.raw_material_ref || rm?.rm_ref,
          supplier_catch_certificate_no: rm?.catch_certificate_no || null,
          afsis_3a_code: rm?.afsis_3a_code, species_name: clean(rm?.species_name)
        };
      }),
      linked_catch_certificates: ccRefs,
      transport: {
        country_of_export: s.country_of_export,
        point_of_departure: clean(s.origin_name),
        point_of_destination: clean(s.destination_name),
        container_no: s.container_no, seal_number: s.seal_number
      },
      destination: { country: gate.country, alpha3: gate.alpha3 },
      snapshot_at: new Date().toISOString()
    };
  }

  /* ------------------------------------------------------------ persist */

  async function nextSerial(docType, iso) {
    const year = new Date().getFullYear();
    const prefix = `DRAFT.CATCH.${docType}.${year}.`;
    const { data } = await sb.from('catch_documents')
      .select('serial_number').like('serial_number', prefix + '%')
      .order('serial_number', { ascending: false }).limit(1);
    const last = data && data[0]
      ? parseInt(String(data[0].serial_number).slice(prefix.length), 10) : 0;
    return prefix + String(last + 1).padStart(7, '0');
  }

  async function ensureBundle(gate) {
    if (STATE.bundle) return STATE.bundle;
    const s = STATE.shipment;

    const { data: existing } = await sb.from('document_bundles')
      .select('*').eq('shipment_id', s.id).limit(1);
    if (existing && existing[0]) { STATE.bundle = existing[0]; return STATE.bundle; }

    const { data: ref, error: e1 } = await sb.rpc('next_bundle_ref', {
      p_org: s.organisation_id, p_destination: s.destination_country
    });
    if (e1) throw new Error('Could not generate a bundle reference: ' + e1.message);

    const { data, error } = await sb.from('document_bundles').insert({
      organisation_id: s.organisation_id, shipment_id: s.id,
      bundle_ref: ref, status: 'draft'
    }).select().single();
    if (error) throw new Error('Could not create the bundle: ' + error.message);

    STATE.bundle = data;
    return data;
  }

  async function saveDoc(docType, payload, gate, extra) {
    const s = STATE.shipment;
    const bundle = await ensureBundle(gate);
    const serial = await nextSerial(docType, gate.alpha2);

    const row = {
      organisation_id: s.organisation_id, doc_type: docType,
      serial_number: serial, status: 'draft', source_type: 'shipment',
      shipment_id: s.id, shipment_item_id: STATE.item ? STATE.item.id : null,
      flag_state: extra?.flag_state || null, bundle_id: bundle.id,
      payload
    };

    const { data, error } = await sb.from('catch_documents').insert(row).select().single();
    if (error) throw new Error(`Could not save the ${docType}: ` + error.message);
    return data;
  }

  /* ------------------------------------------------------------------ UI */

  function shell() {
    let el = document.getElementById('eucgOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'eucgOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(15,15,15,.45);' +
                       'display:flex;align-items:center;justify-content:center;padding:24px;' +
                       "font-family:'Poppins','DM Sans',sans-serif;";
    el.innerHTML = '<div id="eucgBox" style="background:#fff;border-radius:10px;width:100%;' +
      'max-width:620px;max-height:88vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.12);"></div>';
    document.body.appendChild(el);
    return el;
  }

  const box = html => { shell().querySelector('#eucgBox').innerHTML = html; };
  const close = () => { const e = document.getElementById('eucgOverlay'); if (e) e.remove(); };

  const head = t => `<div style="padding:18px 22px;border-bottom:1px solid #e2e5ec;
    font-size:15px;font-weight:700;color:#1a1a2e;">${esc(t)}</div>`;
  const body = h => `<div style="padding:20px 22px;font-size:13px;color:#1a1a2e;line-height:1.6;">${h}</div>`;
  const foot = h => `<div style="padding:14px 22px;border-top:1px solid #e2e5ec;
    display:flex;justify-content:flex-end;gap:10px;">${h}</div>`;
  const btn = (label, onclick, primary) => `<button onclick="${onclick}" style="padding:8px 16px;
    font-family:inherit;font-size:12px;font-weight:${primary ? 600 : 500};border-radius:4px;
    cursor:pointer;border:1px solid ${primary ? '#1a6fdb' : '#e2e5ec'};
    background:${primary ? '#1a6fdb' : '#fff'};color:${primary ? '#fff' : '#1a1a2e'};">${esc(label)}</button>`;

  function showBlocked(reason) {
    box(head('EU CATCH not available for this shipment') +
        body(`<p>${esc(reason)}</p>`) +
        foot(btn('Back to the form', 'EUCatchGen.close()', true)));
  }

  function showError(msg) {
    box(head('Generation stopped') +
        body(`<p>${esc(msg)}</p>`) +
        foot(btn('Close', 'EUCatchGen.close()', true)));
  }

  function showStage(text, detail) {
    box(head('Generating documents') +
        body(`<div style="display:flex;align-items:center;gap:12px;">
          <div style="width:18px;height:18px;border:2px solid #e2e5ec;border-top-color:#1a6fdb;
            border-radius:50%;animation:eucgspin .8s linear infinite;"></div>
          <div><div style="font-weight:600;">${esc(text)}</div>
          <div style="color:#6b7280;font-size:12px;">${esc(detail || '')}</div></div></div>
          <style>@keyframes eucgspin{to{transform:rotate(360deg)}}</style>`));
  }

  /* Product picker — only when the shipment carries more than one line. */
  function askProduct(items) {
    return new Promise(resolve => {
      const rows = items.map((it, i) => `
        <label style="display:flex;gap:10px;padding:12px;border:1px solid #e2e5ec;
          border-radius:6px;margin-bottom:8px;cursor:pointer;">
          <input type="radio" name="eucgItem" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-top:3px;">
          <span><b>${esc(it.product_name || 'Line ' + it.line_no)}</b><br>
          <span style="color:#6b7280;font-size:12px;">${esc(it.species_name || '')} ·
          ${esc(it.number_of_packages || 0)} ${esc(it.package_type || 'packages')} ·
          ${esc(it.net_weight_kg || 0)} kg net</span></span></label>`).join('');

      box(head('Which product?') +
          body(`<p style="margin-bottom:14px;">This shipment carries ${items.length} product lines.
            Catch documentation is generated per product.</p>${rows}`) +
          foot(btn('Cancel', 'EUCatchGen.close()') +
               btn('Continue', 'EUCatchGen._pickItem()', true)));

      window.EUCatchGen._pickItem = () => {
        const sel = document.querySelector('input[name="eucgItem"]:checked');
        resolve(items[Number(sel.value)]);
      };
    });
  }

  /* Authority pause. Always shown — the user picks, we never infer. */
  async function askAuthority(kind, countryName) {
    const { data: country } = await sb.from('countries')
      .select('alpha2').or(`country.ilike.${countryName},alpha2.ilike.${countryName},alpha3.ilike.${countryName}`)
      .limit(1);
    const alpha2 = country && country[0] ? country[0].alpha2 : null;

    let list = [];
    if (alpha2) {
      const col = kind === 'CC' ? 'can_validate_cc' : 'can_endorse_ps';
      const { data } = await sb.from('ref_competent_authorities')
        .select('*').eq('iso_alpha2', alpha2).eq(col, true).eq('is_active', true).order('name');
      list = data || [];
    }

    return new Promise(resolve => {
      const title = kind === 'CC' ? 'Select the validating authority' : 'Select the endorsing authority';
      const lead = kind === 'CC'
        ? `The catch certificate is validated by the flag state of the fishing vessel — <b>${esc(countryName)}</b>.`
        : `The processing statement is endorsed by the authority controlling the plant — <b>${esc(countryName)}</b>.`;

      const options = list.length
        ? list.map((a, i) => `
            <label style="display:flex;gap:10px;padding:11px;border:1px solid #e2e5ec;
              border-radius:6px;margin-bottom:6px;cursor:pointer;">
              <input type="radio" name="eucgAuth" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-top:3px;">
              <span><b>${esc(a.name)}</b><br><span style="color:#6b7280;font-size:12px;">
              ${esc(a.address || '')} ${a.code ? '· ' + esc(a.code) : ''}</span></span></label>`).join('')
        : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;
             padding:12px;color:#92400e;font-size:12px;margin-bottom:12px;">
             No authority is on file for ${esc(countryName)}. Countries outside the EU aren't
             obliged to notify the Commission, so many won't be listed. Type the name exactly
             as it appears on the original document.</div>`;

      box(head(title) +
          body(`<p style="margin-bottom:14px;">${lead}</p>${options}
            <div style="margin-top:14px;">
              <label style="font-size:11px;font-weight:600;color:#5a5a5a;">
                Or type the authority name</label>
              <input id="eucgAuthFree" type="text" placeholder="Name as printed on the document"
                style="width:100%;padding:8px 10px;border:1px solid #e2e5ec;border-radius:4px;
                font-family:inherit;font-size:13px;margin-top:5px;">
            </div>`) +
          foot(btn('Cancel', 'EUCatchGen.close()') +
               btn('Use this authority', 'EUCatchGen._pickAuth()', true)));

      window.EUCatchGen._pickAuth = () => {
        const free = (document.getElementById('eucgAuthFree').value || '').trim();
        if (free) return resolve({ name: free, source: 'typed', country: countryName });
        const sel = document.querySelector('input[name="eucgAuth"]:checked');
        if (!sel) return alert('Pick an authority from the list, or type a name.');
        const a = list[Number(sel.value)];
        resolve({ id: a.id, name: a.name, country: a.country, iso_alpha2: a.iso_alpha2,
                  code: a.code, un_locode: a.un_locode, address: a.address, source: 'register' });
      };
    });
  }

  function showDone(docs, bundle) {
    const rows = docs.map(d => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;
        border-bottom:1px solid #f5f5f5;">
        <span><b>${esc(d.doc_type)}</b> ${d.flag_state ? '· ' + esc(d.flag_state) : ''}</span>
        <span style="color:#6b7280;font-size:12px;">${esc(d.serial_number)}</span></div>`).join('');

    box(head('Documents generated') +
        body(`<p style="margin-bottom:14px;">Filed under
          <b style="color:#1a6fdb;">${esc(bundle.bundle_ref)}</b>. Each document is a snapshot —
          editing the shipment or raw material later won't change what's here.</p>${rows}
          <p style="margin-top:14px;color:#6b7280;font-size:12px;">
          Saved as drafts. Open each one to complete the fields that couldn't be filled
          from your records.</p>`) +
        foot(btn('Close', 'EUCatchGen.close()', true)));
  }

  /* -------------------------------------------------------------- flow */

  async function start(shipmentId) {
    try {
      showStage('Reading the shipment', 'Loading products, batches and catch history');
      await loadChain(shipmentId);

      const gate = await checkEU27(STATE.shipment.destination_country);
      if (!gate.ok) return showBlocked(gate.reason);

      if (!STATE.items.length)
        return showBlocked('This shipment has no product lines, so there is nothing to certify.');

      STATE.item = STATE.items.length === 1 ? STATE.items[0] : await askProduct(STATE.items);

      const batches = STATE.batches.filter(b => b.shipment_item_id === STATE.item.id);
      if (!batches.length)
        return showBlocked('This product line has no batches, so it can\'t be traced back to a raw material.');

      const rms = [...new Set(batches.map(rmFor).filter(Boolean))];
      if (!rms.length)
        return showBlocked('None of the batches on this product line resolve to a raw material. ' +
                           'Check that each batch has a raw material selected.');

      /* Farmed product carries no catch certificate. */
      const wild = rms.filter(r => r.source_type === 'Wild Capture');
      if (!wild.length)
        return showBlocked('This product is farmed. Catch certificates apply to wild-capture fisheries only.');

      /* Split by flag state, ignoring transshipment rows. */
      const rmIds = new Set(wild.map(r => r.id));
      const flags = [...new Set(STATE.catches
        .filter(c => rmIds.has(c.raw_material_id) && c.event_type === 'Catch' && c.flag_state)
        .map(c => c.flag_state))];

      if (!flags.length)
        return showBlocked('No catch events with a flag state were found for this raw material. ' +
                           'A catch certificate is validated by the vessel\'s flag state.');

      const made = [];
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        showStage(`Generating catch certificate ${i + 1} of ${flags.length}`, flag);

        const authority = await askAuthority('CC', flag);
        showStage(`Generating catch certificate ${i + 1} of ${flags.length}`, flag);

        const payload = buildCC(flag, wild, gate);
        payload.validating_authority = authority;

        const doc = await saveDoc('CC', payload, gate, { flag_state: flag });
        made.push(doc);
      }

      /* Processing statement, linked to every certificate just made. */
      showStage('Generating processing statement', STATE.shipment.processing_country || '');
      const endorsing = await askAuthority('PS', STATE.shipment.processing_country);
      showStage('Generating processing statement', STATE.shipment.processing_country || '');

      const psPayload = buildPS(STATE.item, batches,
        made.map(d => ({ id: d.id, serial_number: d.serial_number, flag_state: d.flag_state })), gate);
      psPayload.endorsing_authority = endorsing;

      const ps = await saveDoc('PS', psPayload, gate, null);
      made.push(ps);

      /* Importer declaration is deliberately NOT generated. It is the
         importer's own legal declaration and must be created by them. */

      showDone(made, STATE.bundle);
    } catch (err) {
      console.error('[EUCatchGen]', err);
      showError(err.message || String(err));
    }
  }

  /* ================================================================
     OPEN A SAVED DOCUMENT IN THE REAL FORM

     Fills the existing CC / SC / PS / ID template from a stored
     catch_documents row, rather than showing a separate viewer.
     ================================================================ */

  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };
  const show   = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };

  /* The form's commodity rows are keyed by HS code. Payloads carry the FAO
     3-alpha code instead, so find the subheading that lists that species. */
  function hsForSpecies(afsis) {
    if (typeof HS_TREE === 'undefined' || !afsis) return null;
    for (const ch of HS_TREE)
      for (const hd of ch.children || [])
        for (const sub of hd.children || [])
          if ((sub.species || []).some(s => s.code === afsis))
            return { chapter: `${ch.code} ${ch.label}`, heading: `${hd.code} ${hd.label}`,
                     sub: `${sub.code} ${sub.label}`, hsCode: sub.code,
                     speciesOptions: sub.species || [] };
    return null;
  }

  function hydrateCC(doc) {
    const p = doc.payload || {};
    showView('viewCC');

    setVal('ccSerialNumber', doc.serial_number);
    setVal('ccLocalRef', doc.local_ref);

    const a = p.validating_authority;
    if (a) {
      setVal('ccAuthorityName', a.name);
      setVal('ccAuthorityIso', a.iso_alpha2);
      setVal('ccAuthorityCountry', a.country || p.flag_state);
      setTxt('ccAuthorityAddress', a.address);
      setTxt('ccAuthorityLocode', a.un_locode);
      if (a.address || a.un_locode) show('ccAuthorityDetails');
    }

    /* Section 2 — fishing vessels */
    STATE_FORM().ccVessels = (p.vessels || []).map(v => ({
      name: v.name, flag: v.flag_state, imo: v.imo, reg: v.registration_number || '',
      callsign: v.ircs || '', port: v.home_port || '',
      licence: v.licence_no ? { reference: v.licence_no,
                                expiration: v.licence_valid_until || 'Not on file' } : null
    }));
    if (typeof renderCCVesselTable === 'function') renderCCVesselTable();

    /* Section 3 — one commodity per species, one row per catch event */
    const byCode = new Map();
    (p.lines || []).forEach(l => {
      const code = l.afsis_3a_code || (Array.isArray(l.species) ? l.species[0] : l.species) || '—';
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(l);
    });

    STATE_FORM().ccCommodities = [...byCode.entries()].map(([code, lines]) => {
      const hs = hsForSpecies(code);
      const first = lines[0];
      return {
        chapter: hs?.chapter || 'Commodity code not yet assigned',
        heading: hs?.heading || `Species ${code}`,
        sub: hs?.sub || (first.scientific_name || ''),
        hsCode: hs?.hsCode || '000000',
        speciesOptions: hs?.speciesOptions || [],
        rows: lines.map(l => ({
          species: [{ code: l.afsis_3a_code || code, name: l.scientific_name || '' }],
          vessel: l.vessel_name || '',
          catchArea: [l.fao_area, l.catch_area_detail].filter(Boolean).join(' — '),
          highSeas: '', eez: '', rfmo: '',
          catchFrom: l.catch_date_from || '', catchTo: l.catch_date_to || '',
          estWeight: '', estUnit: 'kg',
          netWeight: l.estimated_live_weight_kg ?? '', netUnit: 'kg',
          verifiedWeight: l.verified_weight_landed_kg ?? '', verifiedUnit: 'kg'
        }))
      };
    });
    if (typeof renderCommodities === 'function') renderCommodities('cc');

    /* Section 8 — exporter */
    setVal('ccExporterName', p.exporter?.name);
    setVal('ccExporterCountry', p.exporter?.country);

    /* Transport tab */
    setVal('ccCountryExport', p.transport?.country_of_export);
    const legs = p.transport?.legs || [];
    if (legs.length && typeof addTransportLeg === 'function') {
      legs.forEach(l => {
        const type = { Sea:'Vessel', Air:'Airplane', Road:'Road vehicle', Rail:'Railway' }[l.mode] || 'Other';
        addTransportLeg('cc', type);
        const cards = document.querySelectorAll('#ccTransportLegs .transport-leg');
        const card = cards[cards.length - 1];
        const inputs = card ? card.querySelectorAll('input') : [];
        const fill = [l.vessel_name || l.flight_no || l.vehicle_plate, '', l.document_no, l.voyage_no];
        inputs.forEach((inp, i) => { if (fill[i]) inp.value = fill[i]; });
      });
    }
    if (p.transport?.container_no && typeof CONTAINER_ROWS !== 'undefined') {
      CONTAINER_ROWS.cc[0].num = p.transport.container_no;
      CONTAINER_ROWS.cc[0].seal = p.transport.seal_number || '';
      if (typeof renderContainerRows === 'function') renderContainerRows('cc');
    }
  }

  function hydratePS(doc) {
    const p = doc.payload || {};
    showView('viewPS');

    setVal('psSerialNumber', doc.serial_number);
    setVal('psDocNumber', doc.local_ref);

    setVal('psPlantName', p.processing_plant?.name);
    setVal('psPlantCountry', p.processing_plant?.country);
    setVal('psApprovalNumberBox', p.processing_plant?.approval_number);

    setVal('psExpName', p.exporter?.name);
    setVal('psExpCountry', p.exporter?.country);

    const ea = p.endorsing_authority;
    if (ea) {
      setVal('psEndorsingAuthorityName', ea.name);
      setVal('psEndorsingAuthorityIso', ea.iso_alpha2);
      setVal('psEndorsingAuthorityCountry', ea.country);
      setTxt('psEndorsingAuthorityAddress', ea.address);
      setTxt('psEndorsingAuthorityLocode', ea.un_locode);
      if (ea.address || ea.un_locode) show('psEndorsingAuthorityDetails');
    }

    /* One commodity row per batch, each carrying its linked certificate */
    const certs = p.linked_catch_certificates || [];
    STATE_FORM().psCommodities = (p.batches || []).map((b, i) => {
      const hs = hsForSpecies(b.afsis_3a_code);
      const cert = certs[i] || certs[0];
      return {
        chapter: hs?.chapter || 'Commodity code not yet assigned',
        heading: hs?.heading || `Species ${b.afsis_3a_code || ''}`,
        sub: hs?.sub || (b.species_name || ''),
        cnCode: hs ? hs.hsCode + '00' : '',
        cnLabel: b.batch_lot ? `Lot ${b.batch_lot}` : '',
        species: { code: b.afsis_3a_code || '', name: b.species_name || '' },
        vessel: { name: b.raw_material_ref || '', flag: '' },
        totalLandedWeight: b.quantity_kg ?? '',
        linkedCert: b.supplier_catch_certificate_no || cert?.serial_number || '',
        certDate: '',
        catchProcessed: b.quantity_kg ?? '',
        processedProduct: p.product?.processed_quantity_kg ?? ''
      };
    });
    if (typeof renderPSCommodities === 'function') renderPSCommodities();

    const links = document.getElementById('psLinksBox');
    if (links && certs.length) {
      links.innerHTML = certs.map(c =>
        `🔗 Related to: <strong style="color:var(--primary);">${esc(c.serial_number)}</strong>` +
        (c.flag_state ? ` <span style="color:var(--muted);">${esc(c.flag_state)}</span>` : '')
      ).join('<br>');
    }

    setVal('psCountryExport', p.transport?.country_of_export);
    if (p.transport?.container_no && typeof CONTAINER_ROWS !== 'undefined') {
      CONTAINER_ROWS.ps[0].num = p.transport.container_no;
      CONTAINER_ROWS.ps[0].seal = p.transport.seal_number || '';
      if (typeof renderContainerRows === 'function') renderContainerRows('ps');
    }
  }

  /* The form's own STATE object, not this module's. */
  function STATE_FORM() {
    return (typeof window.STATE !== 'undefined') ? window.STATE : {};
  }

  function banner(doc) {
    const bar = document.querySelector('#view' + (doc.doc_type === 'PS' ? 'PS' : 'CC') + ' .doc-topbar');
    if (!bar) return;
    const note = document.createElement('div');
    note.style.cssText = 'background:#eef4fd;border:1px solid #c8ddf8;border-radius:6px;padding:10px 14px;' +
      'font-size:12px;color:#1e3a5f;margin-bottom:16px;display:flex;justify-content:space-between;' +
      'align-items:center;gap:12px;';
    note.innerHTML =
      `<span>Opened from <b>My Documents</b> — saved ${doc.status}. ` +
      `Empty fields couldn't be filled from your records.</span>` +
      `<a href="eu-catch-documents.html" style="color:#1a6fdb;font-weight:600;text-decoration:none;` +
      `white-space:nowrap;">← Back to documents</a>`;
    bar.parentNode.insertBefore(note, bar.nextSibling);
  }

  async function openInForm(docId) {
    try {
      const { data, error } = await sb.from('catch_documents')
        .select('*').eq('id', docId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('That document could not be found, or it belongs to another organisation.');

      if (data.doc_type === 'PS') hydratePS(data);
      else hydrateCC(data);          // CC and SC both use the catch-certificate layout

      banner(data);
      close();
    } catch (err) {
      console.error('[EUCatchGen]', err);
      showError(err.message || String(err));
    }
  }

  return { init, close, start, openInForm, _state: STATE };
})();

window.EUCatchGen = EUCatchGen;