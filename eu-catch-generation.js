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

  function cnFor(afsis, form, preservation) {
    const table = CN[(afsis || '').toUpperCase()];
    if (!table) return null;
    const want = presentationOf(form, preservation);
    const pick = table[want] || table.frozen || table.fresh || Object.values(table)[0];
    if (!pick) return null;
    const [code, label] = pick;
    return {
      hsCode: code,
      chapter: CHAPTERS[code.slice(0, 2)] || CHAPTERS['03'],
      heading: HEADINGS[code.slice(0, 4)] || '',
      sub: `${code.slice(0,4)} ${code.slice(4)} ${label}`,
      label, presentation: want
    };
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
    for (const d of docs) {
      d.url = null;
      if (!d.storage_path) continue;
      try {
        const { data: signed } = await sb.storage.from(DOC_BUCKET)
          .createSignedUrl(d.storage_path, 60 * 60 * 8);
        if (signed && signed.signedUrl) { d.url = signed.signedUrl; continue; }
      } catch (_) {}
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
    const [{ data: c }, { data: s }] = await Promise.all([
      sb.from('raw_material_catches').select('*').in('raw_material_id', ids).order('line_no'),
      sb.from('raw_material_species').select('*').in('raw_material_id', ids).order('line_no')
    ]);
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
    const { data: shipment, error } = await sb.from('shipments')
      .select('*').eq('id', shipmentId).maybeSingle();
    if (error) throw new Error('Could not read the shipment: ' + error.message);
    if (!shipment) throw new Error('That shipment could not be found, or it belongs to another organisation.');

    const [{ data: items }, { data: batches }, { data: legs }, { data: sv }] = await Promise.all([
      sb.from('shipment_items').select('*').eq('shipment_id', shipmentId).order('line_no'),
      sb.from('shipment_batches').select('*').eq('shipment_id', shipmentId).order('line_no'),
      sb.from('shipment_legs').select('*').eq('shipment_id', shipmentId).order('leg_no'),
      sb.from('shipment_vessels').select('*').eq('shipment_id', shipmentId).order('line_no')
    ]);

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
    await loadRawMaterials(rms);
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
      const list = sp.length ? sp : [{ species_name: rm && rm.species_name, quantity_kg: c.quantity_kg }];

      for (const one of list) {
        const rmSpecies = GEN.species.find(x =>
          x.raw_material_id === c.raw_material_id && x.species_name === one.species_name);
        const afsis = (rmSpecies && rmSpecies.afsis_3a_code) || (rm && rm.afsis_3a_code);
        const form  = (rmSpecies && rmSpecies.product_form) || (rm && rm.product_form);
        const cn    = cnFor(afsis, form, rm && rm.preservation);

        lines.push({
          vessel_name: clean(c.vessel_name), imo: c.imo, flag_state: c.flag_state,
          species: [clean(one.species_name)],
          scientific_name: (rmSpecies && rmSpecies.scientific_name) || (rm && rm.scientific_name),
          afsis_3a_code: afsis, product_form: form,
          cn_code: cn ? cn.hsCode : null, cn_label: cn ? cn.label : null,
          cn_chapter: cn ? cn.chapter : null, cn_heading: cn ? cn.heading : null,
          cn_sub: cn ? cn.sub : null, presentation: cn ? cn.presentation : null,
          fao_area: c.fao_area, catch_area_detail: c.catch_area_detail,
          gear_type: c.gear_type, latitude: c.latitude, longitude: c.longitude,
          catch_date_from: c.catch_date_from, catch_date_to: c.catch_date_to,
          estimated_live_weight_kg: num(one.quantity_kg),
          verified_weight_landed_kg: num(c.quantity_kg),
          landing_port: clean(c.landing_port_name), landing_date: c.landing_date,
          departure_port: clean(c.departure_port_name), departure_date: c.departure_date,
          trip_no: c.trip_no
        });
      }
    }

    const mother = GEN.shipVessels.find(v => /mother/i.test(v.role || ''));
    const motherVessel = mother && mother.vessel_id ? GEN.vessels[mother.vessel_id] : null;
    const motherFlagIso = motherVessel && motherVessel.vessel_flag
      ? await isoFor(motherVessel.vessel_flag) : null;

    const meansOfTransport = [];
    if (mother) {
      meansOfTransport.push({
        type: 'Vessel', role: mother.role,
        ship_name: clean(mother.vessel_name) || (motherVessel && motherVessel.current_name),
        flag_state: motherVessel ? motherVessel.vessel_flag : null,
        flag_iso: motherFlagIso ? motherFlagIso.alpha2 : null,
        imo: mother.imo || (motherVessel && motherVessel.imo) || null,
        voyage_no: mother.voyage_no || (s && s.voyage_no) || null,
        transport_document: s ? (s.bl_no || s.awb_no || s.cmr_no) : null,
        loading_port: clean(mother.loading_port), discharge_port: clean(mother.discharge_port)
      });
    }
    (GEN.legs || []).forEach(l => {
      meansOfTransport.push({
        type: { Sea:'Vessel', Air:'Airplane', Road:'Road vehicle', Rail:'Railway' }[l.transport_mode] || 'Other',
        leg_no: l.leg_no,
        ship_name: clean(l.vessel_name) || null,
        flag_state: null, imo: null,
        voyage_no: l.voyage_no || null, flight_no: l.flight_no || null,
        vehicle_plate: l.vehicle_plate || null,
        transport_document: l.document_no || null, document_type: l.document_type || null,
        origin: clean(l.origin_name), destination: clean(l.destination_name),
        departure_date: l.departure_date, arrival_date: l.arrival_date,
        carrier: clean(l.carrier_name)
      });
    });

    const firstEvent = catchEvents[0] || {};
    const departure = clean(firstEvent.departure_port_name)
                   || clean(firstEvent.landing_port_name)
                   || (s ? clean(s.origin_name) : null);

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

  async function buildPS(item, batches, ccRefs, gate) {
    const s = GEN.shipment;
    const plantIso = s && s.processing_country ? await isoFor(s.processing_country) : null;
    const expIso   = s && s.country_of_export  ? await isoFor(s.country_of_export)  : null;

    const batchOut = [];
    for (const b of batches) {
      const rm = rmFor(b);
      const cn = cnFor(rm && rm.afsis_3a_code, item.product_form, rm && rm.preservation);
      batchOut.push({
        batch_lot: b.batch_lot, packages: b.packages, quantity_kg: num(b.quantity_kg),
        processing_date: b.processing_date, expiry_date: b.expiry_date,
        raw_material_ref: b.raw_material_ref || (rm && rm.rm_ref),
        supplier_catch_certificate_no: (rm && rm.catch_certificate_no) || null,
        afsis_3a_code: rm && rm.afsis_3a_code, species_name: clean(rm && rm.species_name),
        cn_code: cn ? cn.hsCode : null, cn_label: cn ? cn.label : null,
        cn_chapter: cn ? cn.chapter : null, cn_heading: cn ? cn.heading : null,
        cn_sub: cn ? cn.sub : null
      });
    }

    return {
      doc_type: 'PS',
      processing_plant: {
        name: clean(s && s.processor_name), org_id: s && s.processor_org_id,
        country: s && s.processing_country, iso: plantIso ? plantIso.alpha2 : null,
        approval_number: null
      },
      exporter: {
        name: clean(s && s.exporter_name), org_id: s && s.exporter_org_id,
        country: s && s.country_of_export, iso: expIso ? expIso.alpha2 : null
      },
      endorsing_authority: null,
      product: {
        product_id: item.product_id, name: clean(item.product_name),
        species_name: clean(item.species_name), product_form: item.product_form,
        gtin: item.gtin, packages: item.number_of_packages, package_type: item.package_type,
        gross_weight_kg: num(item.gross_weight_kg), net_weight_kg: num(item.net_weight_kg),
        processed_quantity_kg: num(item.processed_quantity_kg)
      },
      batches: batchOut,
      linked_catch_certificates: ccRefs,
      supporting_documents: GEN.docs.map(d => ({
        doc_type: d.doc_type, file_name: d.file_name, url: d.url, storage_path: d.storage_path
      })),
      transport: {
        country_of_export: s && s.country_of_export,
        country_of_export_iso: expIso ? expIso.alpha2 : null,
        point_of_departure: clean(s && s.origin_name),
        point_of_destination: clean(s && s.destination_name),
        container_no: s && s.container_no, seal_number: s && s.seal_number
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

  async function ensureBundle() {
    if (GEN.bundle) return GEN.bundle;
    const s = GEN.shipment;
    if (!s) return null;

    const { data: existing } = await sb.from('document_bundles')
      .select('*').eq('shipment_id', s.id).limit(1);
    if (existing && existing[0]) { GEN.bundle = existing[0]; return GEN.bundle; }

    const { data: ref, error: e1 } = await sb.rpc('next_bundle_ref', {
      p_org: s.organisation_id, p_destination: s.destination_country
    });
    if (e1) throw new Error('Could not generate a bundle reference: ' + e1.message);

    const { data, error } = await sb.from('document_bundles').insert({
      organisation_id: s.organisation_id, shipment_id: s.id, bundle_ref: ref, status: 'draft'
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

  function askSpecies(totals) {
    const keys = Object.keys(totals);
    if (keys.length <= 1) return Promise.resolve(keys);
    return new Promise(resolve => {
      const rows = keys.map(k => `
        <label style="display:flex;gap:10px;padding:11px;border:1px solid #e2e5ec;
          border-radius:6px;margin-bottom:6px;cursor:pointer;">
          <input type="checkbox" class="eucgSp" value="${esc(k)}" checked style="margin-top:3px;">
          <span><b>${esc(totals[k].species || k)}</b> <span style="color:#6b7280;">(${esc(k)})</span><br>
          <span style="color:#6b7280;font-size:12px;">
          ${Number(totals[k].landed).toLocaleString()} kg landed ·
          ${Number(totals[k].live).toLocaleString()} kg live weight</span></span></label>`).join('');
      box(head('Which species belong on this certificate?') +
          body(`<p style="margin-bottom:14px;">This raw material covers ${keys.length} species.
            The quantity declared is the total of whichever you keep.</p>${rows}`) +
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
        ? list.map((a, i) => `
            <label style="display:flex;gap:10px;padding:11px;border:1px solid #e2e5ec;
              border-radius:6px;margin-bottom:6px;cursor:pointer;">
              <input type="radio" name="eucgAuth" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-top:3px;">
              <span><b>${esc(a.name)}</b><br><span style="color:#6b7280;font-size:12px;">
              ${esc(a.address || '')}${a.un_locode ? ' · ' + esc(a.un_locode) : ''}</span></span></label>`).join('')
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
      window.EUCatchGen._pickAuth = () => {
        const free = (document.getElementById('eucgAuthFree').value || '').trim();
        if (free) { resolve({ name: free, source: 'typed', country: countryName,
                              iso_alpha2: iso ? iso.alpha2 : null }); return; }
        const sel = document.querySelector('input[name="eucgAuth"]:checked');
        if (!sel) { alert('Pick an authority from the list, or type a name.'); return; }
        const a = list[Number(sel.value)];
        resolve({ id: a.id, name: a.name, country: a.country, iso_alpha2: a.iso_alpha2,
                  code: a.code, un_locode: a.un_locode, address: a.address, source: 'register' });
      };
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

      const made = [];
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        const label = flags.length > 1
          ? `Generating catch certificate ${i + 1} of ${flags.length}`
          : 'Generating catch certificate';
        showStage(label, flag);

        const payload = await buildCC(flag, wild, gate);

        const keep = await askSpecies(payload.totals.by_species);
        if (keep.length !== Object.keys(payload.totals.by_species).length) {
          payload.lines = payload.lines.filter(l =>
            keep.indexOf(l.afsis_3a_code || (l.species && l.species[0]) || '—') !== -1);
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
      name: v.name, flag: v.flag_state, imo: v.imo,
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
        speciesOptions: [{ code: f.afsis_3a_code || '', name: f.scientific_name || '' }],
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

    ((p.transport && p.transport.means_of_transport) || []).forEach(m => {
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

    const certs = p.linked_catch_certificates || [];
    FORM().psCommodities = (p.batches || []).map((b, i) => {
      const cert = certs[i] || certs[0];
      return {
        chapter: b.cn_chapter || 'Commodity code not yet assigned',
        heading: b.cn_heading || `Species ${b.afsis_3a_code || ''}`,
        sub: b.cn_sub || b.species_name || '',
        cnCode: b.cn_code ? b.cn_code + '00' : '',
        cnLabel: b.batch_lot ? `Lot ${b.batch_lot}` : (b.cn_label || ''),
        species: { code: b.afsis_3a_code || '', name: b.species_name || '' },
        vessel: { name: b.raw_material_ref || '', flag: '' },
        totalLandedWeight: b.quantity_kg == null ? '' : b.quantity_kg,
        linkedCert: b.supplier_catch_certificate_no || (cert && cert.serial_number) || '',
        certDate: '',
        catchProcessed: b.quantity_kg == null ? '' : b.quantity_kg,
        processedProduct: (p.product && p.product.processed_quantity_kg) == null
          ? '' : p.product.processed_quantity_kg
      };
    });
    if (typeof renderPSCommodities === 'function') renderPSCommodities();

    const links = document.getElementById('psLinksBox');
    if (links && certs.length) {
      links.innerHTML = certs.map(c =>
        `🔗 Related to: <strong style="color:#1a6fdb;">${esc(c.serial_number)}</strong>` +
        (c.flag_state ? ` <span style="color:#6b7280;">${esc(c.flag_state)}</span>` : '')).join('<br>');
    }

    setVal('psCountryExport', p.transport && p.transport.country_of_export);
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

  /* ================================================================= init */

  function init(cfg) {
    if (cfg.client) sb = cfg.client;
    else if (window.supabase && cfg.url && cfg.key) sb = window.supabase.createClient(cfg.url, cfg.key);
    else { console.error('[EUCatchGen] No Supabase client available.'); return; }
    if (cfg.docBucket) DOC_BUCKET = cfg.docBucket;

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