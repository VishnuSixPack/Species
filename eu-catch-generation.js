/* ==========================================================================
   EU Catch Support — Generation Module
   Project Manhattan

   Entry points (all optional — without them the form behaves as before):
     ?shipment=<uuid>   generate CC(s) + PS from a shipment
     ?rm=<uuid>         generate CC(s) from a raw material
     ?doc=<uuid>        open a saved document in the real form

   Wiring:
       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
       <script src="eu-catch-generation.js"></script>
       <script>EUCatchGen.init({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });</script>

   Design notes:
   - One catch certificate per flag state. Only event_type='Catch' rows drive
     the split; transhipment rows carry nulls and would create phantom certs.
   - Validating / endorsing authority is ALWAYS a manual pick.
   - Everything saved is a SNAPSHOT — later edits to the source don't change it.
   - Generating from a raw material yields a PARTIAL certificate: exporter and
     transport live on the shipment and don't exist yet.
   ========================================================================== */

const EUCatchGen = (function () {
  'use strict';

  let sb = null;

  /* Supabase Storage bucket holding raw-material attachments.
     Override at init: EUCatchGen.init({ ..., docBucket: 'your-bucket' }) */
  let DOC_BUCKET = 'raw-material-documents';

  const EU27 = (typeof EU27_COUNTRIES !== 'undefined' && EU27_COUNTRIES.length === 27)
    ? EU27_COUNTRIES
    : ['Austria','Belgium','Bulgaria','Croatia','Cyprus','Czechia','Denmark','Estonia',
       'Finland','France','Germany','Greece','Hungary','Ireland','Italy','Latvia',
       'Lithuania','Luxembourg','Malta','Netherlands','Poland','Portugal','Romania',
       'Slovakia','Slovenia','Spain','Sweden'];

  const GEN = { shipment: null, items: [], batches: [], batchesForItem: [], rms: [],
                  catches: [], species: [], catchSpecies: [], legs: [], shipVessels: [],
                  vessels: {}, docs: [], item: null, bundle: null, mode: null };

  const log = (...a) => { try { console.log('[EUCatchGen]', ...a); } catch (_) {} };

  /* Never let one slow or misconfigured call stall the whole run. */
  function withTimeout(promise, ms, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms))
    ]);
  }

  const clean = v => (typeof v === 'string' ? v.trim() : v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const qs = k => new URLSearchParams(location.search).get(k);
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);

  /* ================================================================== ISO */

  const isoCache = new Map();

  async function isoFor(countryName) {
    if (!countryName) return null;
    const key = String(countryName).trim().toLowerCase();
    if (isoCache.has(key)) return isoCache.get(key);
    const { data } = await sb.from('countries')
      .select('country, alpha2, alpha3')
      .or(`country.ilike.${countryName},alpha2.ilike.${countryName},alpha3.ilike.${countryName}`)
      .limit(1);
    const row = (data && data[0]) || null;
    isoCache.set(key, row);
    return row;
  }

  /* Resolve a species name to its FAO 3-alpha code via the species register. */
  const afsisCache = new Map();

  async function afsisFor(speciesName) {
    if (!speciesName) return null;
    const key = String(speciesName).trim().toLowerCase();
    if (afsisCache.has(key)) return afsisCache.get(key);
    const { data } = await sb.from('species')
      .select('species_name, scientific_name, afsis_3a_code')
      .ilike('species_name', speciesName).limit(1);
    const row = (data && data[0]) || null;
    afsisCache.set(key, row);
    return row;
  }

  /* ---------------------------------------------------------------------
     Resolve a CN code against the form's own HS_TREE, so a generated
     commodity is indistinguishable from one picked by hand: same chapter,
     heading and subheading strings, same species options, and the checkbox
     for it is already ticked when "Modify commodities" is opened.
     If a code isn't in the tree yet, it's inserted — the picker then shows
     it in the right place instead of the commodity reading "not assigned".
     --------------------------------------------------------------------- */

  function hsFind(code) {
    if (typeof HS_TREE === 'undefined' || !code) return null;
    for (const ch of HS_TREE)
      for (const hd of ch.children || [])
        for (const sub of hd.children || [])
          if (sub.code === code)
            return { chapter: `${ch.code} ${ch.label}`, heading: `${hd.code} ${hd.label}`,
                     sub: `${sub.code} ${sub.label}`, hsCode: sub.code,
                     speciesOptions: sub.species || [] };
    return null;
  }

  function hsEnsure(code, label, speciesEntry) {
    if (typeof HS_TREE === 'undefined' || !code) return null;
    const found = hsFind(code);
    if (found) {
      /* Make sure the species is offered on that code */
      if (speciesEntry && speciesEntry.code &&
          !found.speciesOptions.some(s => s.code === speciesEntry.code)) {
        found.speciesOptions.push(speciesEntry);
      }
      return found;
    }

    const chCode = code.slice(0, 2), hdCode = code.slice(0, 4);
    let ch = HS_TREE.find(c => c.code === chCode);
    if (!ch) {
      ch = { code: chCode, label: (CHAPTERS[chCode] || '').slice(3) || 'Other', children: [] };
      HS_TREE.push(ch);
    }
    let hd = (ch.children = ch.children || []).find(h => h.code === hdCode);
    if (!hd) {
      hd = { code: hdCode, label: (HEADINGS[hdCode] || '').slice(5) || 'Other', children: [] };
      ch.children.push(hd);
      ch.children.sort((a, b) => a.code.localeCompare(b.code));
    }
    const sub = { code, label, species: speciesEntry ? [speciesEntry] : [] };
    (hd.children = hd.children || []).push(sub);
    hd.children.sort((a, b) => a.code.localeCompare(b.code));

    return hsFind(code);
  }

  /* =========================================================== CN MAPPING
     Species FAO 3-alpha + presentation → Combined Nomenclature heading. */

  const CN = {
    ALB: { fresh:['030231','Albacore or longfinned tuna (Thunnus alalunga), fresh or chilled'],
           frozen:['030341','Albacore or longfinned tuna (Thunnus alalunga), frozen'] },
    YFT: { fresh:['030232','Yellowfin tuna (Thunnus albacares), fresh or chilled'],
           frozen:['030342','Yellowfin tuna (Thunnus albacares), frozen'],
           fillet:['030487','Tuna fillets, frozen'],
           prepared:['160414','Tunas, skipjack and bonito, prepared or preserved'] },
    SKJ: { fresh:['030233','Skipjack or stripe-bellied bonito, fresh or chilled'],
           frozen:['030343','Skipjack or stripe-bellied bonito, frozen'],
           fillet:['030487','Tuna fillets, frozen'],
           prepared:['160414','Tunas, skipjack and bonito, prepared or preserved'] },
    BET: { fresh:['030234','Bigeye tuna (Thunnus obesus), fresh or chilled'],
           frozen:['030344','Bigeye tuna (Thunnus obesus), frozen'],
           prepared:['160414','Tunas, skipjack and bonito, prepared or preserved'] },
    BFT: { fresh:['030235','Atlantic and Pacific bluefin tuna, fresh or chilled'],
           frozen:['030345','Atlantic and Pacific bluefin tuna, frozen'] },
    PBF: { fresh:['030235','Atlantic and Pacific bluefin tuna, fresh or chilled'],
           frozen:['030345','Atlantic and Pacific bluefin tuna, frozen'] },
    SBF: { fresh:['030236','Southern bluefin tuna (Thunnus maccoyii), fresh or chilled'],
           frozen:['030346','Southern bluefin tuna (Thunnus maccoyii), frozen'] },
    SCD: { fresh:['030633','Crabs, live, fresh or chilled'],
           frozen:['030614','Crabs, frozen'],
           prepared:['160510','Crab, prepared or preserved'] },
    SAL: { fresh:['030214','Atlantic salmon and Danube salmon, fresh or chilled'],
           frozen:['030313','Atlantic salmon and Danube salmon, frozen'] }
  };

  const CHAPTERS = {
    '03': '03 FISH AND CRUSTACEANS, MOLLUSCS AND OTHER AQUATIC INVERTEBRATES',
    '16': '16 PREPARATIONS OF MEAT, OF FISH OR OF CRUSTACEANS, MOLLUSCS OR OTHER AQUATIC INVERTEBRATES'
  };
  const HEADINGS = {
    '0302': '0302 Fish, fresh or chilled, excluding fish fillets and other fish meat of heading 0304',
    '0303': '0303 Fish, frozen, excluding fish fillets and other fish meat of heading 0304',
    '0304': '0304 Fish fillets and other fish meat, fresh, chilled or frozen',
    '0306': '0306 Crustaceans, whether in shell or not',
    '1604': '1604 Prepared or preserved fish; caviar and caviar substitutes',
    '1605': '1605 Crustaceans, molluscs and other aquatic invertebrates, prepared or preserved'
  };

  function presentationOf(form, preservation) {
    const t = `${form || ''} ${preservation || ''}`.toLowerCase();
    if (/fillet|loin/.test(t)) return 'fillet';
    if (/canned|pouch|cooked|prepared|preserved|brine/.test(t)) return 'prepared';
    if (/frozen|froz|iqf|block/.test(t)) return 'frozen';
    if (/fresh|chilled|whole round|round/.test(t)) return 'fresh';
    return 'frozen';
  }

  /* CN codes come from ref_cn_codes when it's populated — the built-in map
     below is the fallback so the module still works before the table is
     seeded, or for a species not yet in it. */
  let CN_DB = null;

  async function loadCnCodes() {
    if (CN_DB) return CN_DB;
    log('loading CN codes');
    try {
      const { data } = await sb.from('ref_cn_codes')
        .select('cn_code, cn_display, description, afsis_3a_code, scientific_name, presentation, for_industry, heading, chapter')
        .eq('is_active', true)
        .order('cn_code');
      CN_DB = data || [];
      log('CN codes:', CN_DB.length);
    } catch (e) { log('CN table unavailable, using built-in map:', e.message); CN_DB = []; }
    return CN_DB;
  }

  /* Prefer the 'for industry' line when the catch is destined for processing,
     otherwise the plain one. Falls back to whatever matches the species and
     presentation. */
  function cnFromDb(afsis, presentation, forIndustry) {
    if (!CN_DB || !CN_DB.length || !afsis) return null;
    const hits = CN_DB.filter(r =>
      r.afsis_3a_code === afsis.toUpperCase() && r.presentation === presentation);
    if (!hits.length) return null;
    const exact = hits.find(r => r.for_industry === forIndustry);
    const row = exact || hits.find(r => r.for_industry === null) || hits[0];
    return {
      hsCode: row.cn_code.slice(0, 6),
      cnCode: row.cn_code,
      cnDisplay: row.cn_display,
      label: row.description,
      heading: row.heading,
      chapter: row.chapter
    };
  }

  function cnFor(afsis, form, preservation, scientificName) {
    const table = CN[(afsis || '').toUpperCase()];
    if (!table) return null;
    const want = presentationOf(form, preservation);

    /* Database first */
    const fromDb = cnFromDb(afsis, want, true);
    if (fromDb) {
      const nodeDb = hsEnsure(fromDb.hsCode, fromDb.label,
        afsis ? { code: afsis.toUpperCase(), name: scientificName || '' } : null);
      return {
        hsCode: fromDb.hsCode, cnCode: fromDb.cnCode, cnDisplay: fromDb.cnDisplay,
        chapter: nodeDb ? nodeDb.chapter : (CHAPTERS[fromDb.chapter] || ''),
        heading: nodeDb ? nodeDb.heading : (HEADINGS[fromDb.heading] || ''),
        sub: nodeDb ? nodeDb.sub : `${fromDb.cnDisplay} ${fromDb.label}`,
        label: fromDb.label, presentation: want,
        speciesOptions: nodeDb ? nodeDb.speciesOptions : []
      };
    }

    const pick = table[want] || table.frozen || table.fresh || Object.values(table)[0];
    if (!pick) return null;
    const [code, label] = pick;

    /* Take the chapter/heading/sub strings from HS_TREE so they match a
       manual selection exactly, adding the node if it isn't there yet. */
    const node = hsEnsure(code, label,
      afsis ? { code: afsis.toUpperCase(), name: scientificName || '' } : null);

    return node
      ? { hsCode: node.hsCode, chapter: node.chapter, heading: node.heading,
          sub: node.sub, label, presentation: want,
          speciesOptions: node.speciesOptions }
      : { hsCode: code,
          chapter: CHAPTERS[code.slice(0, 2)] || CHAPTERS['03'],
          heading: HEADINGS[code.slice(0, 4)] || '',
          sub: `${code.slice(0,4)} ${code.slice(4)} ${label}`,
          label, presentation: want, speciesOptions: [] };
  }

  /* ================================================================= data */

  async function fetchVessels(ids) {
    const missing = [...new Set(ids.filter(Boolean))].filter(id => !GEN.vessels[id]);
    if (!missing.length) return;
    const { data } = await sb.from('vessels')
      .select('id, current_name, imo, mmsi, ircs, vessel_flag, port_of_registry, ' +
              'registration_number, uvi_number, gear_type, vessel_category, vessel_subtype')
      .in('id', missing);
    (data || []).forEach(v => { GEN.vessels[v.id] = v; });
  }

  async function fetchRMDocuments(rmIds) {
    if (!rmIds.length) return [];
    const { data } = await sb.from('raw_material_documents')
      .select('*').in('raw_material_id', rmIds).order('created_at');
    const docs = data || [];
    log('raw material documents:', docs.length);

    for (const d of docs) {
      d.url = null;
      if (!d.storage_path) continue;
      try {
        const { data: signed } = await withTimeout(
          sb.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 60 * 60 * 8),
          5000, 'storage signed URL');
        if (signed && signed.signedUrl) { d.url = signed.signedUrl; continue; }
      } catch (e) { log('signed URL unavailable:', e.message); }
      try {
        const { data: pub } = sb.storage.from(DOC_BUCKET).getPublicUrl(d.storage_path);
        if (pub && pub.publicUrl) d.url = pub.publicUrl;
      } catch (_) {}
    }
    return docs;
  }

  async function loadRawMaterials(rms) {
    const ids = rms.map(r => r.id);
    if (!ids.length) return;
    const [{ data: c }, { data: s }] = await withTimeout(Promise.all([
      sb.from('raw_material_catches').select('*').in('raw_material_id', ids).order('line_no'),
      sb.from('raw_material_species').select('*').in('raw_material_id', ids).order('line_no')
    ]), 15000, 'raw material query');
    log('catch events', (c||[]).length, 'species lines', (s||[]).length);
    GEN.catches = c || [];
    GEN.species = s || [];
    if (GEN.catches.length) {
      const { data: cs } = await sb.from('raw_material_catch_species')
        .select('*').in('catch_event_id', GEN.catches.map(x => x.id));
      GEN.catchSpecies = cs || [];
    }
    await fetchVessels(GEN.catches.map(x => x.vessel_id));
    await fetchVessels(GEN.catches.map(x => x.carrier_vessel_id));
    GEN.docs = await fetchRMDocuments(ids);
  }

  async function loadFromShipment(shipmentId) {
    log('loading shipment', shipmentId);
    const { data: shipment, error } = await withTimeout(
      sb.from('shipments').select('*').eq('id', shipmentId).maybeSingle(),
      15000, 'shipment query');
    if (error) throw new Error('Could not read the shipment: ' + error.message);
    if (!shipment) throw new Error('That shipment could not be found, or it belongs to another organisation.');

    log('shipment ok:', shipment.shipment_ref);
    const [{ data: items }, { data: batches }, { data: legs }, { data: sv }] = await withTimeout(Promise.all([
      sb.from('shipment_items').select('*').eq('shipment_id', shipmentId).order('line_no'),
      sb.from('shipment_batches').select('*').eq('shipment_id', shipmentId).order('line_no'),
      sb.from('shipment_legs').select('*').eq('shipment_id', shipmentId).order('leg_no'),
      sb.from('shipment_vessels').select('*').eq('shipment_id', shipmentId).order('line_no')
    ]), 15000, 'shipment children query');
    log('items', (items||[]).length, 'batches', (batches||[]).length,
        'legs', (legs||[]).length, 'vessels', (sv||[]).length);

    Object.assign(GEN, { shipment, items: items || [], batches: batches || [],
                           legs: legs || [], shipVessels: sv || [], mode: 'shipment' });
    await fetchVessels((sv || []).map(v => v.vessel_id));

    const ids  = [...new Set((batches || []).map(b => b.raw_material_id).filter(Boolean))];
    const refs = [...new Set((batches || []).map(b => b.raw_material_ref).filter(Boolean))];

    let rms = [];
    if (ids.length) {
      const { data } = await sb.from('raw_materials').select('*').in('id', ids);
      rms = data || [];
    }
    if (refs.length) {
      const known = new Set(rms.map(r => r.rm_ref));
      const gaps = refs.filter(r => !known.has(r));
      if (gaps.length) {
        const { data } = await sb.from('raw_materials').select('*').in('rm_ref', gaps);
        rms = rms.concat(data || []);
      }
    }
    GEN.rms = rms;
    log('raw materials', rms.length);
    await loadRawMaterials(rms);
    log('load complete');
  }

  async function loadFromRawMaterial(rmId) {
    const { data: rm, error } = await sb.from('raw_materials')
      .select('*').eq('id', rmId).maybeSingle();
    if (error) throw new Error('Could not read the raw material: ' + error.message);
    if (!rm) throw new Error('That raw material could not be found, or it belongs to another organisation.');
    Object.assign(GEN, { shipment: null, items: [], batches: [], legs: [],
                           shipVessels: [], rms: [rm], mode: 'rm' });
    await loadRawMaterials([rm]);
  }

  const rmFor = batch => GEN.rms.find(r =>
    (batch.raw_material_id && r.id === batch.raw_material_id) ||
    (batch.raw_material_ref && r.rm_ref === batch.raw_material_ref)) || null;

  /* ================================================================ gates */

  async function checkEU27(destination) {
    if (!destination) return { ok: false, reason: 'This shipment has no destination country set.' };
    const row = await isoFor(destination);
    if (!row) return { ok: false,
      reason: `"${destination}" isn't a recognised country, so EU eligibility can't be confirmed.` };
    if (!EU27.includes(row.country)) return { ok: false,
      reason: `${row.country} is outside the EU-27. Catch documentation under Regulation 1005/2008 applies to EU imports only.` };
    return { ok: true, country: row.country, alpha2: row.alpha2, alpha3: row.alpha3 };
  }

  /* ============================================================== payload */


  /* ------------------------------------------------------------------
     Means of transport.

     A shipment describes the same voyage in two places: shipment_vessels
     (the mother vessel, with flag and IMO) and shipment_legs (the routing,
     with the bill of lading). Emitting both produced two cards — one with
     the vessel, one holding nothing but the BL number.

     So: legs merge into the vessel entry they belong to. A leg only becomes
     its own entry when it names a different vessel, or is a different mode.
     Nothing is emitted that carries a document number and no transport.
     ------------------------------------------------------------------ */
  async function buildMeans(s) {
    const MODE = { Sea:'Vessel', Air:'Airplane', Road:'Road vehicle', Rail:'Railway' };
    const out = [];

    const mother = GEN.shipVessels.find(v => /mother/i.test(v.role || ''))
                || GEN.shipVessels[0];
    const mv = mother && mother.vessel_id ? GEN.vessels[mother.vessel_id] : null;
    const mvIso = mv && mv.vessel_flag ? await isoFor(mv.vessel_flag) : null;

    if (mother) {
      out.push({
        type: 'Vessel', role: mother.role || null,
        ship_name: clean(mother.vessel_name) || (mv && mv.current_name) || null,
        flag_state: (mv && mv.vessel_flag) || null,
        flag_iso: mvIso ? mvIso.alpha2 : null,
        imo: mother.imo || (mv && mv.imo) || null,
        voyage_no: mother.voyage_no || (s && s.voyage_no) || null,
        transport_document: (s && (s.bl_no || s.awb_no || s.cmr_no)) || null,
        loading_port: clean(mother.loading_port) || null,
        discharge_port: clean(mother.discharge_port) || null
      });
    }

    const same = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

    (GEN.legs || []).forEach(l => {
      const type = MODE[l.transport_mode] || 'Other';
      const legName = clean(l.vessel_name) || clean(l.flight_no) || clean(l.vehicle_plate);

      /* Does this leg belong to an entry we already have? */
      let host = null;
      if (!legName) {
        host = out.find(e => e.type === type) || out[0] || null;
      } else {
        host = out.find(e => e.type === type &&
          (same(e.ship_name, l.vessel_name) || same(e.voyage_no, l.voyage_no))) || null;
      }

      if (host) {
        /* Fill the gaps rather than duplicating the card */
        if (!host.transport_document && l.document_no) host.transport_document = l.document_no;
        if (!host.document_type && l.document_type)    host.document_type = l.document_type;
        if (!host.voyage_no && l.voyage_no)            host.voyage_no = l.voyage_no;
        if (!host.ship_name && l.vessel_name)          host.ship_name = clean(l.vessel_name);
        if (!host.carrier && l.carrier_name)           host.carrier = clean(l.carrier_name);
        if (!host.origin && l.origin_name)             host.origin = clean(l.origin_name);
        if (!host.destination && l.destination_name)   host.destination = clean(l.destination_name);
        if (!host.departure_date && l.departure_date)  host.departure_date = l.departure_date;
        if (!host.arrival_date && l.arrival_date)      host.arrival_date = l.arrival_date;
        return;
      }

      out.push({
        type, leg_no: l.leg_no,
        ship_name: clean(l.vessel_name) || null,
        flag_state: null, imo: null,
        voyage_no: l.voyage_no || null,
        flight_no: l.flight_no || null,
        vehicle_plate: l.vehicle_plate || null,
        transport_document: l.document_no || null,
        document_type: l.document_type || null,
        origin: clean(l.origin_name), destination: clean(l.destination_name),
        departure_date: l.departure_date, arrival_date: l.arrival_date,
        carrier: clean(l.carrier_name)
      });
    });

    /* Drop anything that ended up with no means of transport at all —
       a bare document number is not a vessel. */
    return out.filter(e => e.ship_name || e.flight_no || e.vehicle_plate ||
                           e.imo || e.voyage_no);
  }

  async function buildCC(flagState, rmList, gate) {
    const s = GEN.shipment;
    const rmIds = new Set(rmList.map(r => r.id));

    const catchEvents = GEN.catches.filter(c =>
      rmIds.has(c.raw_material_id) && c.event_type === 'Catch' && c.flag_state === flagState);
    const transships = GEN.catches.filter(c =>
      rmIds.has(c.raw_material_id) && c.event_type === 'Transshipment');

    const flagIso = await isoFor(flagState);

    const vessels = [];
    const seen = new Set();
    for (const c of catchEvents) {
      const key = c.vessel_id || c.vessel_name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const v = c.vessel_id ? GEN.vessels[c.vessel_id] : null;
      vessels.push({
        vessel_id: c.vessel_id,
        name: clean(c.vessel_name) || (v && v.current_name),
        imo: c.imo || (v && v.imo),
        mmsi: v ? v.mmsi : null,
        ircs: v ? v.ircs : null,
        registration_number: v ? v.registration_number : null,
        home_port: v ? v.port_of_registry : null,
        uvi_number: v ? v.uvi_number : null,
        gear_type: c.gear_type || (v && v.gear_type) || null,
        flag_state: c.flag_state || (v && v.vessel_flag),
        flag_iso: flagIso ? flagIso.alpha2 : null,
        licence_no: c.license_no,
        licence_valid_until: null,
        master: clean(c.captain)
      });
    }

    const lines = [];
    for (const c of catchEvents) {
      const sp = GEN.catchSpecies.filter(x => x.catch_event_id === c.id);
      const rm = rmList.find(r => r.id === c.raw_material_id);

      /* If the catch event has no per-species breakdown, fall back to the raw
         material's species LINES — every species on it — rather than the
         single header field, which names only one and would silently drop the
         others from the certificate. */
      let list;
      if (sp.length) {
        list = sp;
      } else {
        const rmLines = GEN.species.filter(x => x.raw_material_id === c.raw_material_id);
        list = rmLines.length
          ? rmLines.map(x => ({ species_name: x.species_name, quantity_kg: x.quantity_kg }))
          : [{ species_name: rm && rm.species_name, quantity_kg: c.quantity_kg }];
      }

      for (const one of list) {
        const rmSpecies = GEN.species.find(x =>
          x.raw_material_id === c.raw_material_id &&
          (x.species_name || '').toLowerCase() === (one.species_name || '').toLowerCase());
        const afsis = (rmSpecies && rmSpecies.afsis_3a_code) || (rm && rm.afsis_3a_code);
        const form  = (rmSpecies && rmSpecies.product_form) || (rm && rm.product_form);
        const sci   = (rmSpecies && rmSpecies.scientific_name) || (rm && rm.scientific_name);
        const cn    = cnFor(afsis, form, rm && rm.preservation, sci);

        lines.push({
          vessel_name: clean(c.vessel_name), imo: c.imo, flag_state: c.flag_state,
          species: [clean(one.species_name)],
          scientific_name: (rmSpecies && rmSpecies.scientific_name) || (rm && rm.scientific_name),
          afsis_3a_code: afsis, product_form: form,
          cn_code: cn ? cn.hsCode : null, cn_label: cn ? cn.label : null,
          cn_code_full: cn ? (cn.cnCode || null) : null,
          cn_display: cn ? (cn.cnDisplay || null) : null,
          cn_chapter: cn ? cn.chapter : null, cn_heading: cn ? cn.heading : null,
          cn_sub: cn ? cn.sub : null, presentation: cn ? cn.presentation : null,
          cn_species_options: cn ? cn.speciesOptions : null,
          fao_area: c.fao_area, catch_area_detail: c.catch_area_detail,
          gear_type: c.gear_type, latitude: c.latitude, longitude: c.longitude,
          catch_date_from: c.catch_date_from, catch_date_to: c.catch_date_to,
          /* The two weight columns carry the same figure: the species line's
             own quantity. Using the event total for one and the species split
             for the other made them disagree. */
          estimated_live_weight_kg: num(one.quantity_kg),
          verified_weight_landed_kg: num(one.quantity_kg),
          landing_port: clean(c.landing_port_name), landing_date: c.landing_date,
          departure_port: clean(c.departure_port_name), departure_date: c.departure_date,
          trip_no: c.trip_no
        });
      }
    }

    const meansOfTransport = await buildMeans(s);

    const firstEvent = catchEvents[0] || {};
    const departure = (s ? clean(s.origin_name) : null)
                   || clean(firstEvent.departure_port_name)
                   || clean(firstEvent.landing_port_name);

    const exporterIso = s && s.country_of_export ? await isoFor(s.country_of_export) : null;

    const totalsBySpecies = {};
    lines.forEach(l => {
      const k = l.afsis_3a_code || (l.species && l.species[0]) || '—';
      if (!totalsBySpecies[k]) totalsBySpecies[k] = { species: l.species[0], live: 0, landed: 0 };
      totalsBySpecies[k].live   += l.estimated_live_weight_kg || 0;
      totalsBySpecies[k].landed += l.verified_weight_landed_kg || 0;
    });

    return {
      doc_type: 'CC',
      flag_state: flagState,
      flag_state_iso: flagIso ? flagIso.alpha2 : null,
      validating_authority: null,
      vessels, lines,
      transshipments: transships.map(t => {
        const cv = t.carrier_vessel_id ? GEN.vessels[t.carrier_vessel_id] : null;
        /* 'At sea' → Box 6, 'In port' → Box 7. If the RM row didn't set
           transship_where, infer it: a named port means it happened in port. */
        const where = t.transship_where ||
          ((t.transfer_location || t.landing_port_name) ? 'In port' : 'At sea');
        return {
          where,
          transfer_date: t.transfer_date, transfer_date_to: t.transfer_date_to,
          location: clean(t.transfer_location) || clean(t.landing_port_name),
          port_name: clean(t.landing_port_name),
          landing_date: t.landing_date,
          transfer_to: t.transfer_to,
          carrier_vessel: clean(t.carrier_vessel_name) || (cv && cv.current_name),
          carrier_imo: t.carrier_imo || (cv && cv.imo),
          carrier_flag: t.carrier_flag_state || (cv && cv.vessel_flag),
          carrier_ircs: cv ? cv.ircs : null,
          carrier_registration: cv ? cv.registration_number : null,
          authorisation_no: t.authorisation_no, declaration_no: t.declaration_no,
          observer_present: t.observer_present, observer_name: clean(t.observer_name),
          master: clean(t.captain),
          bl_no: t.bl_no, container_no: t.container_no,
          latitude: t.latitude, longitude: t.longitude,
          quantity_kg: num(t.quantity_kg)
        };
      }),
      exporter: {
        name: s ? clean(s.exporter_name) : null,
        org_id: s ? s.exporter_org_id : null,
        country: s ? s.country_of_export : null,
        iso: exporterIso ? exporterIso.alpha2 : null
      },
      supporting_documents: GEN.docs.map(d => ({
        doc_type: d.doc_type, file_name: d.file_name, mime_type: d.mime_type,
        issued_by: d.issued_by, issued_date: d.issued_date, expiry_date: d.expiry_date,
        storage_path: d.storage_path, url: d.url, notes: d.notes
      })),
      transport: {
        country_of_export: s ? s.country_of_export : null,
        country_of_export_iso: exporterIso ? exporterIso.alpha2 : null,
        point_of_departure: departure,
        point_of_destination: s ? clean(s.destination_name) : null,
        container_no: s ? s.container_no : null,
        seal_number: s ? s.seal_number : null,
        means_of_transport: meansOfTransport,
        legs: (GEN.legs || []).map(l => ({
          leg_no: l.leg_no, mode: l.transport_mode,
          origin: clean(l.origin_name), destination: clean(l.destination_name),
          departure_date: l.departure_date, arrival_date: l.arrival_date,
          carrier: clean(l.carrier_name), document_type: l.document_type,
          document_no: l.document_no, vessel_name: clean(l.vessel_name),
          voyage_no: l.voyage_no, flight_no: l.flight_no, vehicle_plate: l.vehicle_plate
        }))
      },
      destination: gate.ok && gate.country
        ? { country: gate.country, alpha2: gate.alpha2, alpha3: gate.alpha3 } : null,
      totals: {
        by_species: totalsBySpecies,
        verified_weight_landed_kg: lines.reduce((a, l) => a + (l.verified_weight_landed_kg || 0), 0),
        estimated_live_weight_kg: lines.reduce((a, l) => a + (l.estimated_live_weight_kg || 0), 0)
      },
      partial: GEN.mode === 'rm',
      snapshot_at: new Date().toISOString()
    };
  }


  /* ------------------------------------------------------------------
     EU facility approval.

     The approval number on a Processing Statement is the plant's EU
     establishment approval — held in company_certifications against the
     processing company. Without a valid one the consignment cannot enter
     the EU, so an expired or missing approval is surfaced rather than left
     as an empty box.
     ------------------------------------------------------------------ */
  async function companyFor(orgId, name) {
    try {
      if (orgId) {
        const { data } = await sb.from('companies').select('*').eq('id', orgId).maybeSingle();
        if (data) return data;
      }
      if (name) {
        const { data } = await sb.from('companies').select('*')
          .ilike('company_name', name).limit(1);
        if (data && data[0]) { log('processor matched by name:', name); return data[0]; }
      }
    } catch (e) { log('company lookup failed:', e.message); }
    return null;
  }

  async function euApprovalFor(company) {
    if (!company) return null;
    try {
      const { data } = await sb.from('company_certifications')
        .select('*').eq('company_id', company.id);
      const rows = data || [];

      /* Match 'EU' as a word, not as letters inside another one, and require
         it to be an approval rather than any other EU-related certificate.
         Also exclude the UK / US equivalents that sit next to it in the list. */
      const isEu = r => {
        const t = `${r.cert_type || ''} ${r.cert_name || ''}`.toLowerCase();
        if (/\b(uk|usa|us|noaa|fsvp)\b/.test(t)) return false;
        return /\b(eu|european union)\b/.test(t) &&
               /(facility|establishment|approv)/.test(t);
      };
      const hits = rows.filter(isEu);
      if (!hits.length) return null;

      const today = new Date().toISOString().slice(0, 10);
      const live = r => !r.status || /^(active|valid|current)$/i.test(String(r.status));
      const valid = hits.filter(r => live(r) && (!r.expiry_date || r.expiry_date >= today));
      const row = valid[0] || hits.filter(live)[0] || hits[0];

      return {
        number: row.cert_number || null,
        cert_name: row.cert_name || row.cert_type || null,
        issuing_body: row.cert_body || null,
        valid_from: row.issued_date || null,
        valid_until: row.expiry_date || null,
        scope: row.scope || null,
        url: row.url || null,
        status: row.status || null,
        expired: !!(row.expiry_date && row.expiry_date < today),
        inactive: !!(row.status && !/^(active|valid|current)$/i.test(String(row.status))),
        no_expiry: !row.expiry_date
      };
    } catch (e) { log('certification lookup failed:', e.message); return null; }
  }

  async function buildPS(item, batches, ccRefs, gate) {
    const s = GEN.shipment;
    const plantIso = s && s.processing_country ? await isoFor(s.processing_country) : null;

    const plantCompany = await companyFor(s && s.processor_org_id, s && s.processor_name);
    const approval = await euApprovalFor(plantCompany);
    const expIso   = s && s.country_of_export  ? await isoFor(s.country_of_export)  : null;

    /* The CN code on the statement describes the catch as certified — the raw
       material's own presentation (Whole Round / Frozen → 0303 43), not the
       finished retail pack. Take the form from the selected species line. */
    const productSpecies = await afsisFor(item.species_name);
    const pickedOpt = (GEN.speciesOptions || []).find(o => productSpecies
      ? o.afsis === productSpecies.afsis_3a_code
      : (o.name || '').toLowerCase() === (item.species_name || '').toLowerCase());

    const sourceRm = GEN.rms[0] || {};
    const productCn = cnFor(
      productSpecies && productSpecies.afsis_3a_code,
      (pickedOpt && pickedOpt.form) || sourceRm.product_form || item.product_form,
      sourceRm.preservation,
      productSpecies && productSpecies.scientific_name
    );

    const psMeans = await buildMeans(s);

    /* Vessels that caught the certified species, for the commodity table */
    const catchVessels = [...new Set(GEN.catches
      .filter(c => c.event_type === 'Catch' && c.vessel_name)
      .map(c => clean(c.vessel_name)))];

    /* Batches stay in the payload for traceability, but they are inputs —
       they do not each become a commodity line on the statement. */
    const batchOut = [];
    let batchTotal = 0;
    for (const b of batches) {
      const rm = rmFor(b);
      batchTotal += Number(b.quantity_kg || 0);
      batchOut.push({
        batch_lot: b.batch_lot, packages: b.packages, quantity_kg: num(b.quantity_kg),
        processing_date: b.processing_date, expiry_date: b.expiry_date,
        raw_material_ref: b.raw_material_ref || (rm && rm.rm_ref),
        supplier_catch_certificate_no: (rm && rm.catch_certificate_no) || null
      });
    }

    /* Quantity of catch processed: the selected species' own line on the raw
       material. Batch quantities are often blank, and even when present they
       don't say which species they drew from. */
    const picked = GEN.speciesPick || [];
    const opts = (GEN.speciesOptions || []).filter(o =>
      picked.indexOf(o.afsis || o.name) !== -1);

    const productAfsis = productSpecies && productSpecies.afsis_3a_code;
    const forProduct = opts.filter(o => productAfsis
      ? o.afsis === productAfsis
      : (o.name || '').toLowerCase() === (item.species_name || '').toLowerCase());

    const speciesTotal = (forProduct.length ? forProduct : opts)
      .reduce((a, o) => a + Number(o.qty || 0), 0);

    const inputTotal = speciesTotal || batchTotal || null;

    /* Only a genuine problem: the product's species isn't on the raw material
       at all. Two species on one raw material is normal. */
    const known = (GEN.speciesOptions || []).map(o => (o.name || '').toLowerCase());
    const productName = clean(item.species_name);
    const speciesMismatch = !!(productName && known.length &&
      known.indexOf(productName.toLowerCase()) === -1);

    return {
      doc_type: 'PS',
      processing_plant: {
        name: clean(s && s.processor_name), org_id: s && s.processor_org_id,
        country: s && s.processing_country, iso: plantIso ? plantIso.alpha2 : null,
        address: plantCompany ? plantCompany.address : null,
        gln: plantCompany ? plantCompany.gln : null,
        approval_number: approval ? approval.number : null,
        approval: approval
      },
      exporter: {
        name: clean(s && s.exporter_name), org_id: s && s.exporter_org_id,
        country: s && s.country_of_export, iso: expIso ? expIso.alpha2 : null
      },
      endorsing_authority: null,
      product: {
        product_id: item.product_id, name: clean(item.product_name),
        species_name: productName,
        afsis_3a_code: productSpecies ? productSpecies.afsis_3a_code : null,
        scientific_name: productSpecies ? productSpecies.scientific_name : null,
        product_form: item.product_form,
        cn_code: productCn ? productCn.hsCode : null,
        cn_label: productCn ? productCn.label : null,
        cn_chapter: productCn ? productCn.chapter : null,
        cn_heading: productCn ? productCn.heading : null,
        cn_sub: productCn ? productCn.sub : null,
        gtin: item.gtin, packages: item.number_of_packages, package_type: item.package_type,
        gross_weight_kg: num(item.gross_weight_kg), net_weight_kg: num(item.net_weight_kg),
        processed_quantity_kg: num(item.processed_quantity_kg)
      },
      inputs: {
        raw_material_total_kg: inputTotal,
        species_selected: opts.map(o => ({ afsis: o.afsis, name: o.name, quantity_kg: o.qty })),
        species: opts.map(o => o.name),
        vessels: catchVessels,
        species_mismatch: speciesMismatch
      },
      batches: batchOut,
      linked_catch_certificates: ccRefs,
      supporting_documents: GEN.docs.map(d => ({
        doc_type: d.doc_type, file_name: d.file_name, url: d.url, storage_path: d.storage_path
      })),
      transport: {
        country_of_export: s && s.country_of_export,
        country_of_export_iso: expIso ? expIso.alpha2 : null,
        point_of_departure: clean(s && s.origin_name),      /* Port of Loading */
        point_of_destination: clean(s && s.destination_name), /* Port of Discharge */
        container_no: s && s.container_no, seal_number: s && s.seal_number,
        means_of_transport: psMeans,
        legs: (GEN.legs || []).map(l => ({
          leg_no: l.leg_no, mode: l.transport_mode,
          origin: clean(l.origin_name), destination: clean(l.destination_name),
          departure_date: l.departure_date, arrival_date: l.arrival_date,
          carrier: clean(l.carrier_name), document_type: l.document_type,
          document_no: l.document_no, vessel_name: clean(l.vessel_name),
          voyage_no: l.voyage_no, flight_no: l.flight_no, vehicle_plate: l.vehicle_plate
        }))
      },
      destination: gate.ok && gate.country ? { country: gate.country, alpha3: gate.alpha3 } : null,
      snapshot_at: new Date().toISOString()
    };
  }

  /* ============================================================== persist */

  async function nextSerial(docType) {
    const year = new Date().getFullYear();
    const prefix = `DRAFT.CATCH.${docType}.${year}.`;
    const { data } = await sb.from('catch_documents')
      .select('serial_number').like('serial_number', prefix + '%')
      .order('serial_number', { ascending: false }).limit(1);
    const last = data && data[0]
      ? parseInt(String(data[0].serial_number).slice(prefix.length), 10) : 0;
    return prefix + String(last + 1).padStart(7, '0');
  }

  /* Each generation run produces a version. The first is V1; regenerating the
     same shipment creates V2 alongside it rather than overwriting, so an
     earlier submission stays exactly as it was issued. */
  async function ensureBundle() {
    if (GEN.bundle) return GEN.bundle;
    const s = GEN.shipment;
    if (!s) return null;

    const { data: prior } = await sb.from('document_bundles')
      .select('*').eq('shipment_id', s.id).order('version', { ascending: false });

    let baseRef, version;
    if (prior && prior.length) {
      baseRef = prior[0].base_ref || String(prior[0].bundle_ref).replace(/ V\d+$/, '');
      version = Math.max.apply(null, prior.map(b => b.version || 1)) + 1;
      log('regenerating', baseRef, '→ V' + version);
    } else {
      const { data: ref, error: e1 } = await sb.rpc('next_bundle_ref', {
        p_org: s.organisation_id, p_destination: s.destination_country
      });
      if (e1) throw new Error('Could not generate a bundle reference: ' + e1.message);
      baseRef = ref;
      version = 1;
    }

    const { data, error } = await sb.from('document_bundles').insert({
      organisation_id: s.organisation_id, shipment_id: s.id,
      base_ref: baseRef, version, bundle_ref: `${baseRef} V${version}`,
      status: 'draft'
    }).select().single();
    if (error) throw new Error('Could not create the bundle: ' + error.message);

    GEN.bundle = data;
    return data;
  }

  async function saveDoc(docType, payload, extra) {
    const s = GEN.shipment;
    const org = (s && s.organisation_id) || (GEN.rms[0] && GEN.rms[0].organisation_id);
    const bundle = await ensureBundle();
    const serial = await nextSerial(docType);

    const { data, error } = await sb.from('catch_documents').insert({
      organisation_id: org, doc_type: docType, serial_number: serial,
      status: payload.partial ? 'partial' : 'draft',
      source_type: GEN.mode === 'rm' ? 'raw_material' : 'shipment',
      raw_material_id: GEN.mode === 'rm' ? (GEN.rms[0] && GEN.rms[0].id) : null,
      shipment_id: s ? s.id : null,
      shipment_item_id: GEN.item ? GEN.item.id : null,
      flag_state: extra ? extra.flag_state : null,
      bundle_id: bundle ? bundle.id : null,
      payload
    }).select().single();
    if (error) throw new Error(`Could not save the ${docType}: ` + error.message);
    return data;
  }

  /* =================================================================== UI */

  function shell() {
    let el = document.getElementById('eucgOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'eucgOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(15,15,15,.45);' +
                       'display:flex;align-items:center;justify-content:center;padding:24px;' +
                       "font-family:'Poppins','DM Sans',sans-serif;";
    el.innerHTML = '<div id="eucgBox" style="background:#fff;border-radius:10px;width:100%;' +
      'max-width:640px;max-height:88vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.12);"></div>';
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

  const showBlocked = reason => box(head('EU CATCH not available') +
    body(`<p>${esc(reason)}</p>`) + foot(btn('Back to the form', 'EUCatchGen.close()', true)));
  const showError = msg => box(head('Generation stopped') +
    body(`<p>${esc(msg)}</p>`) + foot(btn('Close', 'EUCatchGen.close()', true)));
  const showStage = (text, detail) => box(head('Generating documents') +
    body(`<div style="display:flex;align-items:center;gap:12px;">
      <div style="width:18px;height:18px;border:2px solid #e2e5ec;border-top-color:#1a6fdb;
        border-radius:50%;animation:eucgspin .8s linear infinite;"></div>
      <div><div style="font-weight:600;">${esc(text)}</div>
      <div style="color:#6b7280;font-size:12px;">${esc(detail || '')}</div></div></div>
      <style>@keyframes eucgspin{to{transform:rotate(360deg)}}</style>`));

  /* Warn before generating a second set for the same shipment or raw
     material. Regenerating is legitimate — a snapshot can be superseded —
     but it should be a decision, not an accident. */
  function askDuplicate(existing, bundleRef) {
    return new Promise(resolve => {
      const rows = existing.slice(0, 8).map(d => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;
          border-bottom:1px solid #f5f5f5;font-size:12px;">
          <span><b>${esc(d.doc_type)}</b>${d.flag_state ? ' · ' + esc(d.flag_state) : ''}</span>
          <span style="color:#6b7280;">${esc(d.serial_number)}</span></div>`).join('');
      box(head('Documents already exist') +
          body(`<p style="margin-bottom:12px;">${existing.length} document${existing.length === 1 ? ' has' : 's have'}
            already been generated from this source${bundleRef
              ? `, filed under <b style="color:#1a6fdb;">${esc(bundleRef)}</b>` : ''}.</p>
            ${rows}
            <p style="margin-top:14px;color:#6b7280;font-size:12px;">Generating again creates the
            next version${bundleRef ? ' of ' + esc(String(bundleRef).replace(/ V\d+$/, '')) : ''}.
            The existing documents stay exactly as they are — an issued version is never
            altered.</p>`) +
          foot(btn('Open the existing ones', "location.href='eu-catch-documents.html'") +
               btn('Generate next version', 'EUCatchGen._dupYes()', true)));
      window.EUCatchGen._dupYes = () => resolve(true);
    });
  }

  async function existingDocsFor() {
    const q = sb.from('catch_documents').select('id, doc_type, serial_number, flag_state, bundle_id');
    const { data } = GEN.mode === 'rm'
      ? await q.eq('raw_material_id', GEN.rms[0] && GEN.rms[0].id)
      : await q.eq('shipment_id', GEN.shipment.id);
    return data || [];
  }

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
          foot(btn('Cancel', 'EUCatchGen.close()') + btn('Continue', 'EUCatchGen._pickItem()', true)));
      window.EUCatchGen._pickItem = () =>
        resolve(items[Number(document.querySelector('input[name="eucgItem"]:checked').value)]);
    });
  }

  /* Species options come from raw_material_species — the authoritative
     per-species lines with their own quantities — not the single header
     field on raw_materials, which only names one. */
  function speciesOptions(rmList) {
    const ids = new Set(rmList.map(r => r.id));
    const out = new Map();
    GEN.species.filter(s => ids.has(s.raw_material_id)).forEach(s => {
      const key = s.afsis_3a_code || s.species_name;
      if (!key) return;
      if (!out.has(key)) out.set(key, {
        afsis: s.afsis_3a_code, name: clean(s.species_name),
        scientific: s.scientific_name, form: s.product_form, qty: 0
      });
      out.get(key).qty += Number(s.quantity_kg || 0);
    });
    return [...out.values()];
  }

  function askSpecies(options) {
    if (options.length <= 1) return Promise.resolve(options.map(o => o.afsis || o.name));
    return new Promise(resolve => {
      const rows = options.map((o, i) => `
        <label style="display:flex;gap:10px;padding:11px;border:1px solid #e2e5ec;
          border-radius:6px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="eucgSp" value="${esc(o.afsis || o.name)}" checked style="margin-top:3px;">
          <span><b>${esc(o.name)}</b> <span style="color:#6b7280;">(${esc(o.afsis || '—')})</span><br>
          <span style="color:#6b7280;font-size:12px;">
          ${o.scientific ? `<i>${esc(o.scientific)}</i> · ` : ''}${esc(o.form || '')} ·
          ${Number(o.qty).toLocaleString()} kg</span></span></label>`).join('');
      const total = options.reduce((a, o) => a + o.qty, 0);
      box(head('Which species belong on this certificate?') +
          body(`<p style="margin-bottom:14px;">This raw material covers ${options.length} species,
            ${Number(total).toLocaleString()} kg in total. The quantity declared is the
            total of whichever you keep.</p>${rows}`) +
          foot(btn('Cancel', 'EUCatchGen.close()') + btn('Continue', 'EUCatchGen._pickSpecies()', true)));
      window.EUCatchGen._pickSpecies = () => {
        const picked = [...document.querySelectorAll('.eucgSp:checked')].map(c => c.value);
        if (!picked.length) { alert('Keep at least one species.'); return; }
        resolve(picked);
      };
    });
  }

  async function askAuthority(kind, countryName) {
    const iso = await isoFor(countryName);
    let list = [];
    if (iso && iso.alpha2) {
      const col = kind === 'CC' ? 'can_validate_cc' : 'can_endorse_ps';
      const { data } = await sb.from('ref_competent_authorities')
        .select('*').eq('iso_alpha2', iso.alpha2).eq(col, true).eq('is_active', true).order('name');
      list = data || [];
    }
    return new Promise(resolve => {
      const title = kind === 'CC' ? 'Select the validating authority' : 'Select the endorsing authority';
      const lead = kind === 'CC'
        ? `The catch certificate is validated by the flag state of the fishing vessel — <b>${esc(countryName)}</b>${iso ? ` (${esc(iso.alpha2)})` : ''}.`
        : `The processing statement is endorsed by the authority controlling the plant — <b>${esc(countryName)}</b>${iso ? ` (${esc(iso.alpha2)})` : ''}.`;
      const options = list.length
        ? `<label style="font-size:11px;font-weight:600;color:#5a5a5a;">Authority</label>
           <select id="eucgAuthSel" style="width:100%;padding:9px 10px;border:1px solid #e2e5ec;
             border-radius:4px;font-family:inherit;font-size:13px;margin-top:5px;background:#fff;">
             ${list.map((a, i) => `<option value="${i}">${esc(a.name)}${
               a.un_locode ? ' — ' + esc(a.un_locode) : ''}</option>`).join('')}
           </select>
           <div id="eucgAuthMeta" style="font-size:11px;color:#6b7280;margin-top:6px;"></div>`
        : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;
             padding:12px;color:#92400e;font-size:12px;margin-bottom:12px;">
             No authority is on file for ${esc(countryName)}. Type the name exactly as it
             appears on the original document.</div>`;
      box(head(title) +
          body(`<p style="margin-bottom:14px;">${lead}</p>${options}
            <div style="margin-top:14px;">
              <label style="font-size:11px;font-weight:600;color:#5a5a5a;">Or type the authority name</label>
              <input id="eucgAuthFree" type="text" placeholder="Name as printed on the document"
                style="width:100%;padding:8px 10px;border:1px solid #e2e5ec;border-radius:4px;
                font-family:inherit;font-size:13px;margin-top:5px;"></div>`) +
          foot(btn('Cancel', 'EUCatchGen.close()') + btn('Use this authority', 'EUCatchGen._pickAuth()', true)));
      /* Show the selected authority's address under the dropdown */
      const sel0 = document.getElementById('eucgAuthSel');
      const meta = document.getElementById('eucgAuthMeta');
      const paint = () => {
        if (!sel0 || !meta) return;
        const a = list[Number(sel0.value)];
        meta.textContent = a ? [a.address, a.code].filter(Boolean).join(' · ') : '';
      };
      if (sel0) { sel0.addEventListener('change', paint); paint(); }

      window.EUCatchGen._pickAuth = () => {
        const free = (document.getElementById('eucgAuthFree').value || '').trim();
        if (free) { resolve({ name: free, source: 'typed', country: countryName,
                              iso_alpha2: iso ? iso.alpha2 : null }); return; }
        const sel = document.getElementById('eucgAuthSel');
        if (!sel) { alert('Pick an authority from the list, or type a name.'); return; }
        const a = list[Number(sel.value)];
        resolve({ id: a.id, name: a.name, country: a.country, iso_alpha2: a.iso_alpha2,
                  code: a.code, un_locode: a.un_locode, address: a.address, source: 'register' });
      };
    });
  }


  /* An EU establishment approval is a precondition for placing the product on
     the EU market. Missing or lapsed, the processing statement cannot be
     endorsed — so stop and say so plainly rather than saving a document that
     will be refused. A draft is still allowed, deliberately marked as such. */
  function askApproval(plantName, approval) {
    const expired = approval && approval.expired;
    return new Promise(resolve => {
      const detail = expired
        ? `<p style="margin-bottom:12px;">The EU facility approval held by
             <b>${esc(plantName || 'the processing plant')}</b>
             (<b>${esc(approval.number || '—')}</b>) expired on
             <b>${esc(approval.valid_until)}</b>.</p>`
        : `<p style="margin-bottom:12px;">No EU facility approval is recorded for
             <b>${esc(plantName || 'the processing plant')}</b>.</p>`;

      box(head(expired ? 'EU approval has expired' : 'No EU facility approval') +
          body(`<div style="background:#fff5f5;border:1px solid #fecaca;border-radius:6px;
                  padding:14px;margin-bottom:14px;color:#991b1b;">
                  <b>This consignment cannot enter the EU market.</b><br>
                  Under EU food law, fishery products may only be imported from
                  establishments holding a valid EU approval number. Without one, the
                  processing statement will not be endorsed and the consignment will be
                  refused at the border.
                </div>
                ${detail}
                <p style="color:#6b7280;font-size:12px;">Add or renew it on the organisation
                  under <b>Regulatory → EU Facility Approval</b>, then generate again.
                  You can still save a draft to continue working, but it will be incomplete.</p>`) +
          foot(btn('Save as draft anyway', 'EUCatchGen._approvalGo()') +
               btn('Stop and fix this', 'EUCatchGen._approvalStop()', true)));

      window.EUCatchGen._approvalGo   = () => resolve(true);
      window.EUCatchGen._approvalStop = () => resolve(false);
    });
  }

  function showDone(docs, bundle) {
    const rows = docs.map(d => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f5f5f5;">
        <span><b>${esc(d.doc_type)}</b>${d.flag_state ? ' · ' + esc(d.flag_state) : ''}</span>
        <span style="color:#6b7280;font-size:12px;">${esc(d.serial_number)}</span></div>`).join('');
    box(head('Documents generated') +
        body(`<p style="margin-bottom:14px;">${bundle
            ? `Filed under <b style="color:#1a6fdb;">${esc(bundle.bundle_ref)}</b>. `
            : 'Saved as a partial draft — it will join a shipment bundle when one is created. '
          }Each document is a snapshot.</p>${rows}`) +
        foot(btn('Open in My Documents', "location.href='eu-catch-documents.html'") +
             btn('Close', 'EUCatchGen.close()', true)));
  }

  /* ================================================================= flow */

  async function run(opts) {
    try {
      showStage('Reading your records', opts.shipmentId
        ? 'Shipment, products, batches and catch history'
        : 'Raw material and catch history');

      await loadCnCodes();
      if (opts.shipmentId) await loadFromShipment(opts.shipmentId);
      else await loadFromRawMaterial(opts.rmId);

      let gate = { ok: true };
      if (GEN.mode === 'shipment') {
        gate = await checkEU27(GEN.shipment.destination_country);
        if (!gate.ok) { showBlocked(gate.reason); return; }
        if (!GEN.items.length) {
          showBlocked('This shipment has no product lines, so there is nothing to certify.'); return; }

        GEN.item = GEN.items.length === 1 ? GEN.items[0] : await askProduct(GEN.items);

        const batches = GEN.batches.filter(b => b.shipment_item_id === GEN.item.id);
        if (!batches.length) {
          showBlocked("This product line has no batches, so it can't be traced to a raw material."); return; }

        GEN.rms = [...new Set(batches.map(rmFor).filter(Boolean))];
        if (!GEN.rms.length) {
          showBlocked('None of the batches resolve to a raw material. Check that each batch has one selected.'); return; }
        GEN.batchesForItem = batches;
      }

      const wild = GEN.rms.filter(r => r.source_type === 'Wild Capture');
      if (!wild.length) {
        showBlocked('This product is farmed. Catch certificates apply to wild-capture fisheries only.'); return; }

      const rmIds = new Set(wild.map(r => r.id));
      const flags = [...new Set(GEN.catches
        .filter(c => rmIds.has(c.raw_material_id) && c.event_type === 'Catch' && c.flag_state)
        .map(c => c.flag_state))];

      if (!flags.length) {
        showBlocked("No catch events with a flag state were found. A catch certificate is validated by the vessel's flag state."); return; }

      /* Nothing has been written yet — check for an earlier run first */
      const already = await existingDocsFor();
      if (already.length) {
        let ref = null;
        if (already[0].bundle_id) {
          const { data: b } = await sb.from('document_bundles')
            .select('bundle_ref').eq('id', already[0].bundle_id).maybeSingle();
          ref = b && b.bundle_ref;
        }
        await askDuplicate(already, ref);
      }

      /* Ask once, before any certificate is built — the answer applies to
         every flag state and to the processing statement. */
      const options = speciesOptions(wild);
      const keep = await askSpecies(options);
      GEN.speciesPick = keep;
      GEN.speciesOptions = options;

      const made = [];
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        const label = flags.length > 1
          ? `Generating catch certificate ${i + 1} of ${flags.length}`
          : 'Generating catch certificate';
        showStage(label, flag);

        const payload = await buildCC(flag, wild, gate);

        if (keep.length !== options.length) {
          payload.lines = payload.lines.filter(l =>
            keep.indexOf(l.afsis_3a_code) !== -1 ||
            keep.indexOf(l.species && l.species[0]) !== -1);
          payload.totals.verified_weight_landed_kg =
            payload.lines.reduce((a, l) => a + (l.verified_weight_landed_kg || 0), 0);
          payload.totals.estimated_live_weight_kg =
            payload.lines.reduce((a, l) => a + (l.estimated_live_weight_kg || 0), 0);
        }
        showStage(label, flag);

        payload.validating_authority = await askAuthority('CC', flag);
        showStage(label, flag);
        made.push(await saveDoc('CC', payload, { flag_state: flag }));
      }

      if (GEN.mode === 'shipment') {
        showStage('Generating processing statement', GEN.shipment.processing_country || '');
        const endorsing = await askAuthority('PS', GEN.shipment.processing_country);
        showStage('Generating processing statement', GEN.shipment.processing_country || '');

        const ps = await buildPS(GEN.item, GEN.batchesForItem,
          made.map(d => ({ id: d.id, serial_number: d.serial_number, flag_state: d.flag_state })), gate);
        ps.endorsing_authority = endorsing;

        const ap = ps.processing_plant && ps.processing_plant.approval;
        if (!ap || ap.expired) {
          const go = await askApproval(ps.processing_plant && ps.processing_plant.name, ap);
          if (!go) {
            showDone(made, GEN.bundle);   /* the catch certificates still stand */
            return;
          }
        }

        made.push(await saveDoc('PS', ps, null));
      }

      showDone(made, GEN.bundle);
    } catch (err) {
      console.error('[EUCatchGen]', err);
      showError(err.message || String(err));
    }
  }

  const start   = id => run({ shipmentId: id });
  const startRM = id => run({ rmId: id });

  /* ========================================== OPEN A SAVED DOC IN THE FORM */

  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v == null ? '' : v; };
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v == null ? '—' : v; };
  const show   = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  /* The form declares `const STATE = {...}` at top level. A top-level const is
     a global lexical binding, NOT a property of window — so window.STATE is
     undefined. Both scripts share the global scope, so referencing STATE
     directly resolves it now that this module's own state is called GEN. */
  const FORM = () => (typeof STATE !== 'undefined') ? STATE : {};


  /* Documents saved before the transport fix hold two entries: the vessel,
     and a second carrying nothing but the bill of lading. Merge them at
     render time so an old snapshot still displays correctly — the stored
     payload is left untouched, as a snapshot should be. */
  function mergeMeans(list) {
    const out = [];
    (list || []).forEach(m => {
      const hasTransport = m.ship_name || m.flight_no || m.vehicle_plate || m.imo || m.voyage_no;
      if (!hasTransport) {
        const host = out.find(e => e.type === m.type) || out[0];
        if (host) {
          if (!host.transport_document && m.transport_document)
            host.transport_document = m.transport_document;
          if (!host.document_type && m.document_type) host.document_type = m.document_type;
          return;                      /* folded in, no extra card */
        }
        if (!m.transport_document) return;   /* nothing at all to show */
      }
      out.push(Object.assign({}, m));
    });
    return out;
  }

  function hydrateCC(doc) {
    const p = doc.payload || {};
    showView('viewCC');

    setVal('ccSerialNumber', doc.serial_number);
    setVal('ccLocalRef', doc.local_ref);

    const a = p.validating_authority;
    if (a) {
      setVal('ccAuthorityName', a.name);
      setVal('ccAuthorityIso', a.iso_alpha2 || p.flag_state_iso);
      setVal('ccAuthorityCountry', a.country || p.flag_state);
      setTxt('ccAuthorityAddress', a.address);
      setTxt('ccAuthorityLocode', a.un_locode);
      if (a.address || a.un_locode) show('ccAuthorityDetails');
    }

    FORM().ccVessels = (p.vessels || []).map(v => ({
      vessel_id: v.vessel_id, name: v.name, flag: v.flag_state, imo: v.imo,
      reg: v.registration_number || '', callsign: v.ircs || '',
      port: v.home_port || '', mobileSat: v.mmsi || '', procType: v.gear_type || '',
      licence: v.licence_no
        ? { reference: v.licence_no, expiration: v.licence_valid_until || 'Not on file' } : null
    }));
    if (typeof renderCCVesselTable === 'function') renderCCVesselTable();

    const byCn = new Map();
    (p.lines || []).forEach(l => {
      const key = l.cn_code || l.afsis_3a_code || '—';
      if (!byCn.has(key)) byCn.set(key, []);
      byCn.get(key).push(l);
    });

    FORM().ccCommodities = [...byCn.values()].map(lines => {
      const f = lines[0];
      return {
        chapter: f.cn_chapter || 'Commodity code not yet assigned',
        heading: f.cn_heading || `Species ${f.afsis_3a_code || ''}`,
        sub: f.cn_sub || f.scientific_name || '',
        hsCode: f.cn_code || '000000',
        speciesOptions: (f.cn_species_options && f.cn_species_options.length)
          ? f.cn_species_options
          : [{ code: f.afsis_3a_code || '', name: f.scientific_name || '' }],
        rows: lines.map(l => ({
          species: [{ code: l.afsis_3a_code || '', name: l.scientific_name || '' }],
          vessel: l.vessel_name || '',
          catchArea: [l.fao_area, l.catch_area_detail].filter(Boolean).join(' — '),
          highSeas: '', eez: '', rfmo: '',
          catchFrom: l.catch_date_from || '', catchTo: l.catch_date_to || '',
          estWeight: '', estUnit: 'kg',
          netWeight: l.estimated_live_weight_kg == null ? '' : l.estimated_live_weight_kg, netUnit: 'kg',
          verifiedWeight: l.verified_weight_landed_kg == null ? '' : l.verified_weight_landed_kg,
          verifiedUnit: 'kg'
        }))
      };
    });
    if (typeof renderCommodities === 'function') renderCommodities('cc');

    setVal('ccExporterName', p.exporter && p.exporter.name);
    setVal('ccExporterCountry', p.exporter && p.exporter.country);
    setVal('ccExporterIso', p.exporter && p.exporter.iso);

    const docsHost = document.getElementById('ccAccompanyingDocs');
    if (docsHost && (p.supporting_documents || []).length) {
      docsHost.innerHTML = p.supporting_documents.map(d => `
        <div class="eu-section" style="background:#fff;border:1px solid #e2e5ec;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
            <div style="font-size:12px;line-height:1.8;">
              <div style="font-weight:700;font-size:13px;">📄 ${esc(d.doc_type || 'Document')}</div>
              <div style="color:#6b7280;">${esc(d.file_name || '')}</div>
              ${d.issued_by ? `<div>Issued by ${esc(d.issued_by)}</div>` : ''}
              ${d.issued_date ? `<div>Issued ${esc(d.issued_date)}</div>` : ''}
              ${d.expiry_date ? `<div>Expires ${esc(d.expiry_date)}</div>` : ''}
            </div>
            ${d.url
              ? `<a class="btn btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open file</a>`
              : `<span style="font-size:11px;color:#a0a0a0;white-space:nowrap;">File not reachable</span>`}
          </div>
        </div>`).join('');
    }

    /* ── Movement of products ──────────────────────────────────────────
       These sections have no element ids, so reach them via the anchor on
       each heading and fill the inputs in document order. */
    const sectionFor = anchorId => {
      const anchor = document.getElementById(anchorId);
      return anchor ? anchor.closest('.eu-section') : null;
    };
    const fillInputs = (section, values) => {
      if (!section) return;
      const inputs = section.querySelectorAll('.eu-grid input');
      values.forEach((v, i) => { if (inputs[i] && v != null && v !== '') inputs[i].value = v; });
    };

    const firstLine = (p.lines || [])[0] || {};
    const firstVessel = (p.vessels || [])[0] || {};

    /* 5. Master of Fishing Vessel — vessel name, flag state, master.
         Flag state is the vessel's, never the captain's nationality. */
    fillInputs(sectionFor('anchor-cc-master'), [
      firstVessel.name || firstLine.vessel_name,
      firstVessel.flag_state || p.flag_state,
      firstVessel.master
    ]);

    const transships = p.transshipments || [];
    const atSea  = transships.filter(t => /sea/i.test(t.where || ''));
    const inPort = transships.filter(t => /port/i.test(t.where || ''));

    /* 6. Declaration of Transhipment at Sea */
    if (atSea.length) {
      const t = atSea[0];
      const sec = sectionFor('anchor-cc-seatranship');
      fillInputs(sec, [
        firstVessel.master || t.master,   // master of the fishing vessel
        t.transfer_date,                  // signature date
        t.quantity_kg,                    // estimated weight
        t.master,                         // master of the receiving vessel
        t.carrier_vessel,                 // receiving vessel
        t.transfer_date                   // transhipment date
      ]);
      /* Position grid sits outside .eu-grid.cols-3 — fill it separately */
      if (sec && (t.latitude != null || t.longitude != null)) {
        const pos = sec.querySelectorAll('.eu-grid.cols-4 input');
        if (pos.length >= 4) {
          pos[0].value = t.latitude != null ? String(t.latitude) : '';
          pos[2].value = t.longitude != null ? String(t.longitude) : '';
        }
      }
    }

    /* 7. Transhipment and/or Landing Authorisation Within a Port Area */
    if (inPort.length) {
      const t = inPort[0];
      fillInputs(sectionFor('anchor-cc-porttranship'), [
        t.authorisation_no,                        // authority
        t.port_name || t.location,                 // port of transhipment
        t.landing_date || t.transfer_date,         // date of landing
        t.carrier_vessel,                          // receiving vessel
        t.master                                   // name
      ]);
    }

    /* Open the collapsible when there is anything to see inside it */
    if (transships.length) {
      const header = document.querySelector('.eu-collapsible-header');
      if (header && !header.classList.contains('open') && typeof toggleCollapse === 'function') {
        toggleCollapse(header);
      }
    }

    setVal('ccCountryExport', p.transport && p.transport.country_of_export);
    const dep = document.querySelector('#ccDLPort input');
    if (dep) dep.value = (p.transport && p.transport.point_of_departure) || '';
    document.querySelectorAll('#ccTabTransport .eu-section').forEach(sec => {
      const t = sec.querySelector('.eu-section-title');
      if (t && /Point of Destination/i.test(t.textContent)) {
        const inp = sec.querySelector('input');
        if (inp) inp.value = (p.transport && p.transport.point_of_destination) || '';
      }
    });

    mergeMeans(p.transport && p.transport.means_of_transport).forEach(m => {
      if (typeof addTransportLeg !== 'function') return;
      addTransportLeg('cc', m.type || 'Vessel');
      const cards = document.querySelectorAll('#ccTransportLegs .transport-leg');
      const card = cards[cards.length - 1];
      if (!card) return;
      const inputs = card.querySelectorAll('input');
      const fill = (m.type === 'Vessel')
        ? [m.ship_name, m.flag_state, m.imo, m.voyage_no, m.transport_document]
        : (m.type === 'Airplane') ? [m.flight_no, m.transport_document]
        : (m.type === 'Road vehicle') ? [m.vehicle_plate]
        : [m.transport_document];
      inputs.forEach((inp, i) => { if (fill[i]) inp.value = fill[i]; });
    });

    if (p.transport && p.transport.container_no && typeof CONTAINER_ROWS !== 'undefined') {
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
    setVal('psPlantName', p.processing_plant && p.processing_plant.name);
    setVal('psPlantCountry', p.processing_plant && p.processing_plant.country);
    setVal('psPlantIsoDisplay', p.processing_plant && p.processing_plant.iso);
    setVal('psApprovalNumberBox', p.processing_plant && p.processing_plant.approval_number);
    setVal('psPlantAddress', p.processing_plant && p.processing_plant.address);

    /* Detail and status for the approval box */
    (function () {
      const ap = (p.processing_plant || {}).approval;
      const boxEl = document.getElementById('psApprovalNumberBox');
      if (!boxEl) return;
      const host = boxEl.closest('.eu-section');
      if (!host || host.querySelector('.eucg-approval')) return;

      const note = document.createElement('div');
      note.className = 'eucg-approval';
      note.style.cssText = 'margin-top:10px;font-size:12px;';

      if (!ap) {
        note.innerHTML = `<div class="hint-banner" style="margin:0;">
          ⚠️ No EU facility approval is recorded for
          <b>${esc((p.processing_plant || {}).name || 'this plant')}</b>.
          A processing plant must hold a valid EU establishment approval for the
          consignment to enter the EU. Add it under the organisation's
          <b>Regulatory → EU Facility Approval</b> certification, then regenerate.</div>`;
      } else {
        const bits = [];
        if (ap.issuing_body) bits.push(`Issued by ${esc(ap.issuing_body)}`);
        if (ap.valid_from)   bits.push(`Valid from ${esc(ap.valid_from)}`);
        bits.push(ap.valid_until ? `Valid until ${esc(ap.valid_until)}` : 'No expiry recorded');
        if (ap.scope)        bits.push(esc(ap.scope));

        note.innerHTML =
          `<div style="color:#6b7280;">${bits.join(' · ')}
             ${ap.url ? ` · <a href="${esc(ap.url)}" target="_blank" rel="noopener"
               style="color:#1a6fdb;">certificate</a>` : ''}</div>` +
          (ap.expired ? `<div class="hint-banner" style="margin-top:8px;margin-bottom:0;">
             ⚠️ This approval expired on ${esc(ap.valid_until)}. It cannot support an export
             to the EU until renewed.</div>` : '') +
          (ap.no_expiry ? `<div class="hint-banner" style="margin-top:8px;margin-bottom:0;">
             No expiry date is recorded against this approval. Endorsing authorities
             normally expect one — check the certificate.</div>` : '');
      }
      host.appendChild(note);
    })();
    setVal('psExpName', p.exporter && p.exporter.name);
    setVal('psExpCountry', p.exporter && p.exporter.country);
    setVal('psExpIsoDisplay', p.exporter && p.exporter.iso);

    const ea = p.endorsing_authority;
    if (ea) {
      setVal('psEndorsingAuthorityName', ea.name);
      setVal('psEndorsingAuthorityIso', ea.iso_alpha2);
      setVal('psEndorsingAuthorityCountry', ea.country);
      setTxt('psEndorsingAuthorityAddress', ea.address);
      setTxt('psEndorsingAuthorityLocode', ea.un_locode);
      if (ea.address || ea.un_locode) show('psEndorsingAuthorityDetails');
    }

    /* One commodity line: the processed product itself. Batches are inputs,
       recorded in the payload but not listed as separate commodities. */
    const certs = p.linked_catch_certificates || [];
    const prod = p.product || {};
    const inputTotal = (p.inputs && p.inputs.raw_material_total_kg) || null;

    FORM().psCommodities = prod.species_name ? [{
      chapter: prod.cn_chapter || 'Commodity code not yet assigned',
      heading: prod.cn_heading || `Species ${prod.afsis_3a_code || ''}`,
      sub: prod.cn_sub || prod.species_name || '',
      cnCode: prod.cn_code ? prod.cn_code + '00' : '',
      cnLabel: prod.cn_label || '',
      species: { code: prod.afsis_3a_code || '', name: prod.scientific_name || prod.species_name || '' },
      vessel: (p.inputs && p.inputs.vessels && p.inputs.vessels.length)
        ? { name: p.inputs.vessels.join(', '), flag: '' } : null,
      totalLandedWeight: inputTotal == null ? '' : inputTotal,
      linkedCert: certs.length ? certs[0].serial_number : '',
      certDate: '',
      catchProcessed: inputTotal == null ? '' : inputTotal,
      processedProduct: prod.processed_quantity_kg == null
        ? (prod.net_weight_kg == null ? '' : prod.net_weight_kg)
        : prod.processed_quantity_kg
    }] : [];
    if (typeof renderPSCommodities === 'function') renderPSCommodities();

    /* Flag a species chain that doesn't reconcile */
    if (p.inputs && p.inputs.species_mismatch) {
      const host = document.getElementById('psCommodityList');
      if (host) {
        const warn = document.createElement('div');
        warn.className = 'hint-banner';
        warn.style.marginTop = '10px';
        warn.innerHTML = `⚠️ The processed product is <b>${esc(prod.species_name)}</b>, but the ` +
          `raw material feeding this line is <b>${esc((p.inputs.species || []).join(', '))}</b>. ` +
          `Check the batch is linked to the right raw material before submitting.`;
        host.appendChild(warn);
      }
    }

    const links = document.getElementById('psLinksBox');
    if (links && certs.length) {
      links.innerHTML = certs.map(c =>
        `🔗 Related to: <strong style="color:#1a6fdb;">${esc(c.serial_number)}</strong>` +
        (c.flag_state ? ` <span style="color:#6b7280;">${esc(c.flag_state)}</span>` : '')).join('<br>');
    }

    setVal('psCountryExport', p.transport && p.transport.country_of_export);

    /* Port of Loading → Point of Departure, Port of Discharge → Destination */
    document.querySelectorAll('#psTabTransport .eu-section').forEach(sec => {
      const t = sec.querySelector('.eu-section-title');
      if (!t) return;
      const inp = sec.querySelector('input');
      if (!inp) return;
      if (/Point of Departure/i.test(t.textContent))
        inp.value = (p.transport && p.transport.point_of_departure) || '';
      if (/Point of Destination/i.test(t.textContent))
        inp.value = (p.transport && p.transport.point_of_destination) || '';
    });

    mergeMeans(p.transport && p.transport.means_of_transport).forEach(m => {
      if (typeof addTransportLeg !== 'function') return;
      addTransportLeg('ps', m.type || 'Vessel');
      const cards = document.querySelectorAll('#psTransportLegs .transport-leg');
      const card = cards[cards.length - 1];
      if (!card) return;
      const inputs = card.querySelectorAll('input');
      const fill = (m.type === 'Vessel')
        ? [m.ship_name, m.flag_state, m.imo, m.voyage_no, m.transport_document]
        : (m.type === 'Airplane') ? [m.flight_no, m.transport_document]
        : (m.type === 'Road vehicle') ? [m.vehicle_plate]
        : [m.transport_document];
      inputs.forEach((inp, i) => { if (fill[i]) inp.value = fill[i]; });
    });
    if (p.transport && p.transport.container_no && typeof CONTAINER_ROWS !== 'undefined') {
      CONTAINER_ROWS.ps[0].num = p.transport.container_no;
      CONTAINER_ROWS.ps[0].seal = p.transport.seal_number || '';
      if (typeof renderContainerRows === 'function') renderContainerRows('ps');
    }
  }

  function banner(doc) {
    const bar = document.querySelector('#view' + (doc.doc_type === 'PS' ? 'PS' : 'CC') + ' .doc-topbar');
    if (!bar) return;
    const note = document.createElement('div');
    note.style.cssText = 'background:#eef4fd;border:1px solid #c8ddf8;border-radius:6px;padding:10px 14px;' +
      'font-size:12px;color:#1e3a5f;margin-bottom:16px;display:flex;justify-content:space-between;' +
      'align-items:center;gap:12px;';
    note.innerHTML = `<span>Opened from <b>My Documents</b> — saved ${esc(doc.status)}. ` +
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
      if (data.doc_type === 'PS') hydratePS(data); else hydrateCC(data);
      banner(data);
      close();
    } catch (err) {
      console.error('[EUCatchGen]', err);
      showError(err.message || String(err));
    }
  }

  /* When the commodity picker opens, tick whatever is already on the
     document — so a generated commodity behaves exactly like a manual one
     and "Modify commodities" shows the current selection rather than a
     blank tree. */
  function hookCommodityPicker() {
    if (typeof openCommodityModal !== 'function' || openCommodityModal.__eucg) return;
    const original = openCommodityModal;
    const wrapped = function (target) {
      original.apply(this, arguments);
      const form = FORM();
      const arr = target === 'cc' ? form.ccCommodities
                : target === 'sc' ? form.scCommodities
                : target === 'ps' ? form.psCommodities
                : form.idCommodities;
      const codes = new Set((arr || []).map(c =>
        (c.hsCode || String(c.cnCode || '').slice(0, 6))).filter(Boolean));
      if (!codes.size) return;

      document.querySelectorAll('#commodityTree .commodity-checkbox').forEach(cb => {
        if (!codes.has(cb.dataset.hscode)) return;
        cb.checked = true;
        /* Open the branches so the ticked box is visible, not buried */
        let node = cb.closest('.tree-children');
        while (node) {
          node.classList.remove('hidden');
          const header = node.previousElementSibling;
          const chev = header && header.querySelector('.tree-chevron');
          if (chev) chev.textContent = '－';
          node = node.parentElement ? node.parentElement.closest('.tree-children') : null;
        }
      });
      if (typeof updateCommodityCount === 'function') updateCommodityCount();
    };
    wrapped.__eucg = true;
    window.openCommodityModal = wrapped;
  }


  /* ------------------------------------------------------------------
     Fishing licence picker.

     The page ships with a sample lookup and a native prompt() for adding
     one. Both are replaced here: the list reads vessel_other_licenses, and
     adding a licence uses a proper form that captures the authority and the
     validity dates the certificate actually needs.
     ------------------------------------------------------------------ */
  function hookFishingLicence() {
    if (typeof openFishingLicenceModal !== 'function' || openFishingLicenceModal.__eucg) return;

    const fmt = d => d ? new Date(d).toLocaleDateString('en-GB',
      { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    /* A vessel's authorisations live in several tables — the fishing licence
       proper, RFMO authorisations, FFA registration, PNA vessel day scheme
       and FSMA. All of them are "licences" as far as Box 2 is concerned, so
       list them together and let the user pick the right one. */
    const SOURCES = [
      { table:'vessel_other_licenses', kind:'Fishing licence',
        ref:r => r.license_number, by:r => r.licensing_authority,
        from:r => r.start_date, to:r => r.end_date,
        note:r => r.agreement_note },
      { table:'vessel_rfmo_history', kind:'RFMO authorisation',
        ref:r => r.auth_no || r.registration_no, by:r => r.rfmo_name,
        from:r => r.auth_start, to:r => r.auth_end,
        note:r => [r.auth_form, r.auth_species, r.auth_areas].filter(Boolean).join(' · ') },
      { table:'vessel_ffa_history', kind:'FFA registration',
        ref:r => r.ffa_id, by:() => 'Forum Fisheries Agency',
        from:r => r.valid_from, to:r => r.valid_to, note:r => r.notes },
      { table:'vessel_pna_vds_history', kind:'PNA vessel day scheme',
        ref:r => r.vds_no, by:r => r.vessel_flag || 'PNA',
        from:r => r.valid_from, to:r => r.valid_to, note:r => r.notes },
      { table:'vessel_pna_fsma_history', kind:'PNA FSMA',
        ref:r => r.ral_no, by:() => 'PNA FSMA',
        from:r => r.valid_from, to:r => r.valid_to, note:r => r.notes }
    ];

    const openReal = async function (vesselIdx) {
      const form = FORM();
      const vessel = (form.ccVessels || [])[vesselIdx];
      if (!vessel) return;
      form.licenceVesselIdx = vesselIdx;

      const title = document.getElementById('licenceModalTitle');
      if (title) title.textContent = `${vessel.name || 'Vessel'} — licences and authorisations`;

      /* The page's table has four columns; this list needs a type as well */
      const thead = document.querySelector('#licencePickerModal thead tr');
      if (thead) thead.innerHTML =
        '<th>Type</th><th>Reference</th><th>Issued by</th><th>Valid from</th><th>Valid until</th><th></th>';

      const bodyEl = document.getElementById('licenceResultsBody');
      if (bodyEl) bodyEl.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:14px;">Loading…</td></tr>';
      document.getElementById('licencePickerModal').classList.add('open');

      /* Older documents were saved without the vessel's id. Recover it from
         the register by IMO, then by name, so the licence list still works. */
      if (!vessel.vessel_id && (vessel.imo || vessel.name)) {
        try {
          let q = sb.from('vessels').select('id, current_name, imo');
          q = vessel.imo ? q.eq('imo', vessel.imo) : q.ilike('current_name', vessel.name);
          const { data } = await q.limit(1);
          if (data && data[0]) {
            vessel.vessel_id = data[0].id;
            log('recovered vessel id for', vessel.name);
          }
        } catch (e) { log('vessel lookup failed:', e.message); }
      }

      let rows = [];
      if (vessel.vessel_id) {
        const results = await Promise.all(SOURCES.map(async src => {
          try {
            const { data } = await sb.from(src.table).select('*').eq('vessel_id', vessel.vessel_id);
            return (data || []).map(r => ({
              kind: src.kind, reference: src.ref(r), issued_by: src.by(r),
              from: src.from(r), to: src.to(r), note: src.note(r)
            }));
          } catch (e) { log(src.table, 'unavailable:', e.message); return []; }
        }));
        rows = [].concat.apply([], results).filter(r => r.reference);
        /* Current authorisations first, expired last */
        rows.sort((a, b) => String(b.to || '').localeCompare(String(a.to || '')));
      }

      GEN.licences = rows;
      if (!bodyEl) return;

      /* Flag anything that had already lapsed by the time of the catch — an
         authority will query a certificate covered by an expired licence. */
      const catchTo = (((FORM().ccCommodities || [])[0] || {}).rows || [])
        .map(r => r.catchTo).filter(Boolean).sort().pop();

      bodyEl.innerHTML = rows.length ? rows.map((l, i) => {
        const lapsed = l.to && catchTo && String(l.to) < String(catchTo);
        return `<tr${lapsed ? ' style="background:#fff5f5;"' : ''}>
          <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;
            background:#eef4fd;color:#1a6fdb;white-space:nowrap;">${esc(l.kind)}</span></td>
          <td><b>${esc(l.reference)}</b>${l.note
            ? `<br><small style="color:#6b7280;">${esc(l.note)}</small>` : ''}</td>
          <td style="font-size:11px;">${esc(l.issued_by || '—')}</td>
          <td>${fmt(l.from)}</td>
          <td>${fmt(l.to)}${lapsed
            ? '<br><small style="color:#c0392b;font-weight:600;">expired before the catch</small>' : ''}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-sm" onclick="EUCatchGen._useLicence(${i})">✓ Select</button>
          </td></tr>`;
      }).join('')
        : `<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:14px;">
             No licences or authorisations on file for ${esc(vessel.name || 'this vessel')}.
             ${vessel.vessel_id ? '' :
               '<br><small>This vessel could not be matched in the vessel register, so nothing could be looked up.</small>'}
             </td></tr>`;
    };
    openReal.__eucg = true;
    window.openFishingLicenceModal = openReal;

    window.EUCatchGen._useLicence = idx => {
      const form = FORM();
      const l = (GEN.licences || [])[idx];
      if (!l) return;
      const v = form.ccVessels[form.licenceVesselIdx];
      v.licence = {
        reference: l.reference,
        expiration: l.to ? new Date(l.to).toLocaleDateString('en-GB') : 'Not stated',
        authority: l.issued_by || null, kind: l.kind,
        start_date: l.from, end_date: l.to
      };
      if (typeof renderCCVesselTable === 'function') renderCCVesselTable();
      if (typeof closeModal === 'function') closeModal('licencePickerModal');
    };

    /* Replace the native prompt with a form matching the rest of the page */
    const createReal = function () {
      const form = FORM();
      const v = (form.ccVessels || [])[form.licenceVesselIdx];
      if (!v) return;
      if (typeof closeModal === 'function') closeModal('licencePickerModal');

      const field = (id, label, type, ph) => `
        <div style="margin-bottom:12px;">
          <label style="font-size:11px;font-weight:600;color:#5a5a5a;display:block;">${esc(label)}</label>
          <input id="${id}" type="${type}" ${ph ? `placeholder="${esc(ph)}"` : ''}
            style="width:100%;padding:8px 10px;border:1px solid #e2e5ec;border-radius:4px;
            font-family:inherit;font-size:13px;margin-top:5px;">
        </div>`;

      box(head(`Add a fishing licence — ${v.name || 'vessel'}`) +
          body(`<p style="margin-bottom:14px;color:#6b7280;font-size:12px;">
              Box 2 of the catch certificate requires the licence number and the date it is
              valid until. Enter them exactly as they appear on the licence.</p>
            ${field('eucgLicNo', 'Licence number', 'text', 'e.g. PNG-FL-2026-0881')}
            ${field('eucgLicAuth', 'Licensing authority', 'text', 'e.g. National Fisheries Authority')}
            <div style="display:flex;gap:12px;">
              <div style="flex:1;">${field('eucgLicFrom', 'Valid from', 'date', '')}</div>
              <div style="flex:1;">${field('eucgLicTo', 'Valid until', 'date', '')}</div>
            </div>`) +
          foot(btn('Cancel', 'EUCatchGen.close()') +
               btn('Add licence', 'EUCatchGen._saveLicence()', true)));
    };
    createReal.__eucg = true;
    window.createNewFishingLicence = createReal;

    window.EUCatchGen._saveLicence = () => {
      const ref = (document.getElementById('eucgLicNo').value || '').trim();
      if (!ref) { alert('The licence number is required.'); return; }
      const to = document.getElementById('eucgLicTo').value;
      const form = FORM();
      const v = form.ccVessels[form.licenceVesselIdx];
      v.licence = {
        reference: ref,
        expiration: to ? new Date(to).toLocaleDateString('en-GB') : 'Not stated',
        authority: (document.getElementById('eucgLicAuth').value || '').trim() || null,
        start_date: document.getElementById('eucgLicFrom').value || null,
        end_date: to || null
      };
      if (typeof renderCCVesselTable === 'function') renderCCVesselTable();
      close();
    };
  }


  /* ------------------------------------------------------------------
     The page's addTransportLeg() resolves its container with
        target === 'cc' ? ccTransportLegs : scTransportLegs
     so a 'ps' or 'id' leg lands in the Simplified CC section instead of its
     own, and transportLegCounter has no key for them (giving NaN ids).
     Patch both here rather than editing the form.
     ------------------------------------------------------------------ */
  function hookTransportLegs() {
    if (typeof addTransportLeg !== 'function' || addTransportLeg.__eucg) return;
    const original = addTransportLeg;

    const patched = function (target, type) {
      const form = FORM();
      if (form.transportLegCounter && form.transportLegCounter[target] === undefined) {
        form.transportLegCounter[target] = 0;
      }

      const host = document.getElementById(target + 'TransportLegs');
      if (!host || target === 'cc' || target === 'sc') {
        return original.apply(this, arguments);   /* already correct */
      }

      /* Run the original, then move what it produced into the right place */
      const wrong = document.getElementById(
        target === 'cc' ? 'ccTransportLegs' : 'scTransportLegs');
      const before = wrong ? wrong.children.length : 0;
      original.apply(this, arguments);
      if (wrong && wrong.children.length > before) {
        host.appendChild(wrong.lastElementChild);
      }
    };
    patched.__eucg = true;
    window.addTransportLeg = patched;
  }

  /* ================================================================= init */

  function init(cfg) {
    if (cfg.client) sb = cfg.client;
    else if (window.supabase && cfg.url && cfg.key) sb = window.supabase.createClient(cfg.url, cfg.key);
    else { console.error('[EUCatchGen] No Supabase client available.'); return; }
    if (cfg.docBucket) DOC_BUCKET = cfg.docBucket;
    hookCommodityPicker();
    hookFishingLicence();
    hookTransportLegs();

    const docId = qs('doc');
    if (docId) { openInForm(docId); return; }

    const shipmentId = qs('shipment');
    if (shipmentId) { start(shipmentId); return; }

    const rmId = qs('rm') || qs('raw_material');
    if (rmId) { startRM(rmId); return; }
  }

  return { init, close, start, startRM, openInForm, _state: GEN };
})();

window.EUCatchGen = EUCatchGen;