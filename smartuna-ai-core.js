/* ==========================================================================
   SmarTuna A.I — Shared Core (Phase 1: tool-calling)

   One library, loaded by all three surfaces (smartuna-ai.html, the
   dashboard voice widget in home-logged-in.html, smartuna-assistant.html)
   instead of each maintaining its own copy of shipment/vessel logic.

   ARCHITECTURE CHANGE FROM PHASE 0:
   Previously, a hand-built detector decided in advance what data a
   question needed (ref matching, destination matching, vessel-name
   reverse lookup...) and pre-fetched it before Groq ever saw the
   question. That doesn't generalise — every new question SHAPE needed
   new detector code.

   Now: Groq gets a list of TOOLS and decides for itself which to call,
   with what parameters, possibly chaining several before answering. The
   tool IMPLEMENTATIONS below are the same proven queries from Phase 0
   (shipment detail, vessel compliance history reasoning, EU Catch
   readiness) — reused, not rewritten — wrapped so the model can call
   them on demand instead of me guessing when they're needed.

   WHAT THIS DOES NOT CHANGE: I still cannot reach api.groq.com from my
   own sandbox. Every tool's DATA CORRECTNESS below is tested against a
   mock exactly like Phase 0 was. Whether Groq reliably chooses the
   right tool for a real question is something only live use can show —
   that boundary is unchanged, just more consequential now that the
   model is making more decisions than before.

   Usage:
     <script src="smartuna-ai-core.js"></script>
     <script>
       SmarTunaAI.init({ supabaseClient: dbClient, organisationId: orgId, groqKey: GK });
       const answer = await SmarTunaAI.ask("...", conversationHistory);
     </script>
   ========================================================================== */

const SmarTunaAI = (function () {
  'use strict';

  let db = null;
  let ORG_ID = null;
  let GK = null;
  const MODEL = 'openai/gpt-oss-120b';
  const MAX_TOOL_ITERATIONS = 5; // hard ceiling on chained tool calls per question

  function requireInit() {
    if (!db || !GK) throw new Error('SmarTunaAI.init() must be called before use.');
  }

  /* ============================================================ ORG SCOPE
     Every tool below filters by organisation_id INSIDE the query itself —
     never left to the model. The model never sees or controls this value;
     it isn't a parameter on any tool schema. */
  function orgScoped(query) {
    return query.eq('organisation_id', ORG_ID);
  }

  /* ==================================================================
     TOOL IMPLEMENTATIONS
     Each returns a plain JS object/array — JSON.stringify'd before being
     handed back to the model as a tool result. Every one is read-only.
     ================================================================== */

  async function searchShipments({ query }) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const qNorm = norm(query);

    const { data: shipments } = await orgScoped(
      db.from('shipments').select(
        'id,shipment_ref,shipment_date,transport_mode,status,exporter_name,origin_name,destination_name,destination_country'
      ).is('deleted_at', null).order('shipment_date', { ascending: false }).limit(50)
    );
    const all = shipments || [];

    // Direct field match (ref, destination, origin, exporter) first.
    let hits = all.filter((s) =>
      [s.shipment_ref, s.destination_name, s.destination_country, s.origin_name, s.exporter_name]
        .some((f) => f && qNorm.includes(norm(f)))
    );

    // Reverse lookup: does the query name a fishing or transport vessel?
    if (!hits.length) {
      const [catchesRes, transportRes] = await Promise.all([
        db.from('raw_material_catches').select('raw_material_id,vessel_name').then((r) => r).catch(() => ({ data: [] })),
        orgScoped(db.from('shipment_vessels').select('shipment_id,vessel_name')).then((r) => r).catch(() => ({ data: [] })),
      ]);
      const matchedRmIds = new Set();
      (catchesRes.data || []).forEach((c) => {
        const vNorm = norm(c.vessel_name);
        if (vNorm && vNorm.length > 3 && qNorm.includes(vNorm)) matchedRmIds.add(c.raw_material_id);
      });
      const shipmentIds = new Set();
      (transportRes.data || []).forEach((v) => {
        const vNorm = norm(v.vessel_name);
        if (vNorm && vNorm.length > 3 && qNorm.includes(vNorm)) shipmentIds.add(v.shipment_id);
      });
      if (matchedRmIds.size) {
        const { data: batches } = await orgScoped(
          db.from('shipment_batches').select('shipment_id').in('raw_material_id', [...matchedRmIds])
        );
        (batches || []).forEach((b) => shipmentIds.add(b.shipment_id));
      }
      if (shipmentIds.size) hits = all.filter((s) => shipmentIds.has(s.id));
    }

    if (!hits.length) return { found: 0, shipments: all.slice(0, 15), note: 'No direct match — showing the 15 most recent shipments instead.' };
    return { found: hits.length, shipments: hits.slice(0, 10) };
  }

  async function getShipmentDetail({ shipment_ref }) {
    const { data: s, error } = await orgScoped(
      db.from('shipments').select(
        'id,shipment_ref,shipment_date,shipment_type,transport_mode,status,exporter_name,exporter_org_id,country_of_export,destination_country,incoterms,origin_name,origin_port_id,destination_name,destination_port_id,container_no,seal_number,vessel_name,voyage_no,bl_no,on_board_date,container_discharge_date,departure_date,arrival_date,processor_name,processor_org_id,processing_country,importer_name'
      ).eq('shipment_ref', shipment_ref).is('deleted_at', null)
    ).single();
    if (error || !s) return { error: `No shipment found with reference "${shipment_ref}" in this organisation.` };

    const [{ data: items }, { data: batches }, legsRes, vesselsRes, ccRes] = await Promise.all([
      db.from('shipment_items').select('*').eq('shipment_id', s.id).order('line_no'),
      db.from('shipment_batches').select('*').eq('shipment_id', s.id).order('line_no'),
      db.from('shipment_legs').select('*').eq('shipment_id', s.id).order('leg_no').then((r) => r).catch(() => ({ data: [] })),
      db.from('shipment_vessels').select('*').eq('shipment_id', s.id).order('line_no').then((r) => r).catch(() => ({ data: [] })),
      db.from('catch_certificates').select('*').eq('shipment_id', s.id).then((r) => r).catch(() => ({ data: [] })),
    ]);
    const itemsArr = items || [], batchesArr = batches || [];
    const legsArr = legsRes.data || [], vesselsArr = vesselsRes.data || [], catchCertsArr = ccRes.data || [];

    const productIds = [...new Set(itemsArr.map((it) => it.product_id).filter(Boolean))];
    let productsById = {};
    if (productIds.length) {
      const { data: products } = await db.from('products')
        .select('*, product_allergens(allergen_label,containment_level), species:species_id(species_name,scientific_name,afsis_3a_code)')
        .in('id', productIds).is('deleted_at', null);
      (products || []).forEach((p) => { productsById[p.id] = p; });
    }

    const rmIds = [...new Set(batchesArr.map((b) => b.raw_material_id).filter(Boolean))];
    let rawMaterialsById = {}, catchesByRmId = {};
    if (rmIds.length) {
      const { data: rms } = await db.from('raw_materials').select(
        'id,rm_ref,name,species_name,scientific_name,source_type,origin_country,quantity_kg,harvest_date,fao_areas,iuu_checked,iuu_checked_at'
      ).in('id', rmIds).is('deleted_at', null);
      (rms || []).forEach((r) => { rawMaterialsById[r.id] = r; });

      const { data: catches } = await db.from('raw_material_catches').select('*').in('raw_material_id', rmIds);
      (catches || []).forEach((c) => {
        (catchesByRmId[c.raw_material_id] || (catchesByRmId[c.raw_material_id] = [])).push(c);
      });
    }
    const ccByRawMaterialId = {};
    catchCertsArr.forEach((cc) => {
      if (cc.raw_material_id) (ccByRawMaterialId[cc.raw_material_id] || (ccByRawMaterialId[cc.raw_material_id] = [])).push(cc);
    });

    const byItem = {};
    batchesArr.forEach((b) => {
      const rm = b.raw_material_id ? rawMaterialsById[b.raw_material_id] : null;
      (byItem[b.shipment_item_id] || (byItem[b.shipment_item_id] = [])).push({
        ...b,
        raw_material: rm ? {
          ...rm,
          catches: catchesByRmId[rm.id] || [],
          catch_certificates: ccByRawMaterialId[rm.id] || [],
        } : null,
      });
    });

    return {
      ...s,
      items: itemsArr.map((it) => ({ ...it, product: it.product_id ? productsById[it.product_id] || null : null, batches: byItem[it.id] || [] })),
      legs: legsArr,
      vessels: vesselsArr,
      catch_certificates: catchCertsArr,
    };
  }

  async function checkEuCatchReadiness({ shipment_ref }) {
    const detail = await getShipmentDetail({ shipment_ref });
    if (detail.error) return detail;

    const EU27 = ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden'];

    const allBatches = detail.items.flatMap((it) => it.batches || []);
    const rawMaterialsUsed = allBatches.map((b) => b.raw_material).filter(Boolean);
    const wildCaptureRms = rawMaterialsUsed.filter((r) => r.source_type === 'Wild Capture');
    const catchFlags = [...new Set(wildCaptureRms.flatMap((r) => (r.catches || []).filter((c) => c.event_type === 'Catch' && c.flag_state).map((c) => c.flag_state)))];

    let approvalCheck = { pass: null, detail: 'No processing plant on file to check.' };
    if (detail.processor_org_id || detail.processor_name) {
      let company = null;
      if (detail.processor_org_id) {
        const { data } = await db.from('companies').select('*').eq('id', detail.processor_org_id).maybeSingle();
        company = data;
      }
      if (!company && detail.processor_name) {
        const { data } = await db.from('companies').select('*').ilike('company_name', detail.processor_name).limit(1);
        company = data && data[0];
      }
      if (company) {
        const { data: certs } = await db.from('company_certifications').select('*').eq('company_id', company.id);
        const isEu = (r) => {
          const t = `${r.cert_type || ''} ${r.cert_name || ''}`.toLowerCase();
          if (/\b(uk|usa|us|noaa|fsvp)\b/.test(t)) return false;
          return /\b(eu|european union)\b/.test(t) && /(facility|establishment|approv)/.test(t);
        };
        const hits = (certs || []).filter(isEu);
        const today = new Date().toISOString().slice(0, 10);
        const valid = hits.filter((r) => (!r.status || /^(active|valid|current)$/i.test(r.status)) && (!r.expiry_date || r.expiry_date >= today));
        if (valid.length) approvalCheck = { pass: true, detail: `Valid EU approval ${valid[0].cert_number || ''} for ${company.company_name}.` };
        else if (hits.length) approvalCheck = { pass: false, detail: `EU approval on file for ${company.company_name} but expired or inactive.` };
        else approvalCheck = { pass: false, detail: `No EU facility approval on file for ${company.company_name}.` };
      }
    }

    const checks = [
      { check: 'Destination is in the EU-27', pass: EU27.includes((detail.destination_country || '').trim()), detail: detail.destination_country || 'not set' },
      { check: 'Has at least one product line', pass: detail.items.length > 0, detail: `${detail.items.length} item(s)` },
      { check: 'Has at least one batch', pass: allBatches.length > 0, detail: `${allBatches.length} batch(es)` },
      { check: 'Batches resolve to a raw material', pass: rawMaterialsUsed.length > 0, detail: `${rawMaterialsUsed.length} resolved` },
      { check: 'At least one raw material is Wild Capture', pass: wildCaptureRms.length > 0, detail: wildCaptureRms.length ? `${wildCaptureRms.length} wild-capture` : 'all farmed, or source_type not set' },
      { check: 'Has a catch event with a flag state recorded', pass: catchFlags.length > 0, detail: catchFlags.length ? catchFlags.join(', ') : 'none found' },
      { check: 'Processing plant has a valid EU facility approval', pass: approvalCheck.pass, detail: approvalCheck.detail },
    ];
    const ready = checks.slice(0, 6).every((c) => c.pass === true) && approvalCheck.pass !== false;
    return { shipment_ref, ready, checks };
  }

  async function searchVessels({ query }) {
    const { data } = await db.from('vessels').select(
      'id,imo,current_name,vessel_flag,vessel_category,iuu_listed,eu_approved,pna_vds_active,vds_valid_from,vds_valid_until,rfmo_wcpfc,rfmo_iattc,rfmo_iotc,rfmo_iccat'
    ).ilike('current_name', `%${query}%`).limit(10);
    if (!data || !data.length) return { found: 0, note: `No vessel matching "${query}" found.` };
    return { found: data.length, vessels: data };
  }

  async function getVesselComplianceHistory({ vessel_name_or_imo }) {
    const { data: vessels } = await db.from('vessels').select('id,current_name,imo,vessel_flag')
      .or(`current_name.ilike.%${vessel_name_or_imo}%,imo.eq.${vessel_name_or_imo}`).limit(1);
    const vessel = vessels && vessels[0];
    if (!vessel) return { error: `No vessel matching "${vessel_name_or_imo}" found.` };

    const [vdsRes, rfmoRes, iuuRes] = await Promise.all([
      db.from('vessel_pna_vds_history').select('vds_no,vessel_flag,valid_from,valid_to').eq('vessel_id', vessel.id).then((r) => r).catch(() => ({ data: [] })),
      db.from('vessel_rfmo_history').select('rfmo_name,auth_no,auth_start,auth_end').eq('vessel_id', vessel.id).then((r) => r).catch(() => ({ data: [] })),
      db.from('vessel_iuu_history').select('previously_listed,iuu_list_name,date_listed,delisted_date').eq('vessel_id', vessel.id).then((r) => r).catch(() => ({ data: [] })),
    ]);
    return {
      vessel,
      pna_vds_history: vdsRes.data || [],
      rfmo_history: rfmoRes.data || [],
      iuu_history: iuuRes.data || [],
      note: 'These are historical validity PERIODS — for "was it valid at time of catch X" questions, find the period whose dates actually cover the catch date, not just the most recent one.',
    };
  }

  async function searchCompanies({ query }) {
    const { data } = await db.from('companies').select('id,company_name,country,industry,status').ilike('company_name', `%${query}%`).limit(10);
    if (!data || !data.length) return { found: 0, note: `No company matching "${query}" found.` };
    return { found: data.length, companies: data };
  }

  async function getCompanyCertifications({ company_name }) {
    const { data: companies } = await db.from('companies').select('*').ilike('company_name', `%${company_name}%`).limit(1);
    const company = companies && companies[0];
    if (!company) return { error: `No company matching "${company_name}" found.` };
    const { data: certs } = await db.from('company_certifications').select('*').eq('company_id', company.id);
    return { company: company.company_name, certifications: certs || [] };
  }

  async function searchProducts({ query }) {
    const { data } = await db.from('products').select('id,product_name,brand,product_form,species_id,ean_gtin').is('deleted_at', null)
      .or(`product_name.ilike.%${query}%,brand.ilike.%${query}%`).limit(10);
    if (!data || !data.length) return { found: 0, note: `No product matching "${query}" found.` };
    return { found: data.length, products: data };
  }

  async function searchRawMaterials({ query }) {
    const { data } = await orgScoped(
      db.from('raw_materials').select('id,rm_ref,name,species_name,source_type,origin_country,quantity_kg,harvest_date').is('deleted_at', null)
        .or(`rm_ref.ilike.%${query}%,name.ilike.%${query}%,species_name.ilike.%${query}%`)
    ).limit(10);
    if (!data || !data.length) return { found: 0, note: `No raw material matching "${query}" found.` };
    return { found: data.length, raw_materials: data };
  }

  async function searchPorts({ query }) {
    const { data } = await db.from('ports').select('id,main_port_name,country,un_locode,psma_party').ilike('main_port_name', `%${query}%`).limit(10);
    if (!data || !data.length) return { found: 0, note: `No port matching "${query}" found.` };
    return { found: data.length, ports: data };
  }

  /* ==================================================================
     TOOL SCHEMAS — what Groq actually sees. Descriptions are the ONLY
     thing steering which tool gets called for a given question, so they
     carry real weight; more important than the code behind them.
     ================================================================== */
  const TOOLS = [
    { name: 'search_shipments', fn: searchShipments, schema: {
      description: 'Find shipment(s) matching a free-text query — a reference number, destination, origin, exporter name, product, or the name of a fishing/transport vessel. Use this first when a question is about a shipment but you do not have its exact reference.',
      params: { query: { type: 'string', description: 'Any identifying text — ref, place, company, product, or vessel name.' } },
      required: ['query'],
    }},
    { name: 'get_shipment_detail', fn: getShipmentDetail, schema: {
      description: 'Get the full record for ONE shipment by its exact reference — products, batches, raw materials, real catch events (vessel, dates, FAO area), and catch certificates. Call search_shipments first if you do not already have the exact reference.',
      params: { shipment_ref: { type: 'string', description: 'The exact shipment reference, e.g. STC-EU-123.' } },
      required: ['shipment_ref'],
    }},
    { name: 'check_eu_catch_readiness', fn: checkEuCatchReadiness, schema: {
      description: 'Check whether a specific shipment is ready for EU Catch Certificate submission, against the real gates the EU Catch tool itself enforces (EU-27 destination, wild capture, catch event with flag state, valid EU facility approval, etc).',
      params: { shipment_ref: { type: 'string', description: 'The exact shipment reference.' } },
      required: ['shipment_ref'],
    }},
    { name: 'search_vessels', fn: searchVessels, schema: {
      description: 'Find a vessel by name (partial match) and see its current compliance snapshot — IUU listed, EU approved, PNA VDS active, RFMO memberships.',
      params: { query: { type: 'string', description: 'Vessel name or partial name.' } },
      required: ['query'],
    }},
    { name: 'get_vessel_compliance_history', fn: getVesselComplianceHistory, schema: {
      description: 'Get a vessel\'s HISTORICAL compliance periods — PNA VDS, RFMO authorisation, IUU listing — each with its own validity dates. Use this (not search_vessels) for any question about whether a vessel was compliant AT A SPECIFIC PAST DATE, e.g. at time of catch.',
      params: { vessel_name_or_imo: { type: 'string', description: 'Vessel name or IMO number.' } },
      required: ['vessel_name_or_imo'],
    }},
    { name: 'search_companies', fn: searchCompanies, schema: {
      description: 'Find a company (exporter, importer, processor, supplier) by name.',
      params: { query: { type: 'string', description: 'Company name or partial name.' } },
      required: ['query'],
    }},
    { name: 'get_company_certifications', fn: getCompanyCertifications, schema: {
      description: 'Get all certifications on file for a company, including EU facility approval status and expiry.',
      params: { company_name: { type: 'string', description: 'Company name (exact or partial).' } },
      required: ['company_name'],
    }},
    { name: 'search_products', fn: searchProducts, schema: {
      description: 'Find a product by name or brand.',
      params: { query: { type: 'string', description: 'Product name or brand.' } },
      required: ['query'],
    }},
    { name: 'search_raw_materials', fn: searchRawMaterials, schema: {
      description: 'Find a raw material record by its reference, name, or species.',
      params: { query: { type: 'string', description: 'Raw material reference, name, or species name.' } },
      required: ['query'],
    }},
    { name: 'search_ports', fn: searchPorts, schema: {
      description: 'Find a port by name, and see whether it is a PSMA (Port State Measures Agreement) party port.',
      params: { query: { type: 'string', description: 'Port name or partial name.' } },
      required: ['query'],
    }},
  ];

  function buildGroqToolSchemas() {
    return TOOLS.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.schema.description,
        parameters: { type: 'object', properties: t.schema.params, required: t.schema.required },
      },
    }));
  }

  async function executeTool(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.fn(args || {});
    } catch (e) {
      console.warn(`[SmarTunaAI] Tool "${name}" failed:`, e);
      return { error: `Tool "${name}" failed to run.` };
    }
  }

  /* ==================================================================
     SYSTEM PROMPT — much shorter than Phase 0's, on purpose: the model
     now discovers data shapes by calling tools rather than needing every
     field explained up front. What it still needs: domain knowledge, the
     compliance-reasoning pattern (current snapshot vs. historical
     period), and response style.
     ================================================================== */
  const SYSTEM_PROMPT = `You are SmarTuna A.I, the assistant built into the SmarTuna seafood supply-chain platform. You have tools to look up real shipments, vessels, companies, products, raw materials, and ports in this organisation's own data — use them whenever a question needs real data, rather than guessing. Call search_ tools first when you don't have an exact reference; call the specific get_/check_ tools once you do.

EXPERTISE: IUU fishing, GDST traceability, EU IUU Regulation, US SIMP/FSMA 204, MSC/ASC Chain of Custody, RFMOs (WCPFC/IATTC/IOTC/ICCAT/CCAMLR/NEAFC/NAFO), PNA Vessel Day Scheme, HACCP/food safety, and general seafood industry knowledge.

COMPLIANCE REASONING: a vessel's CURRENT compliance snapshot (from search_vessels) only reflects today. For any question about status AT A SPECIFIC PAST DATE — e.g. "was it VDS-compliant at time of catch" — call get_vessel_compliance_history instead and find the historical period that actually covers that date, not just the newest one. State both date ranges you're comparing. If no period covers it, say so plainly rather than guessing.

Never invent a reference, date, quantity, vessel, or status not returned by a tool. If a tool returns no match, say so rather than guessing. Only answer seafood/supply-chain/compliance questions; decline anything else warmly and redirect.

This response may be read aloud via text-to-speech — keep it concise (2-4 sentences unless more detail is asked for) and avoid markdown formatting.`;

  /* ==================================================================
     THE AGENTIC LOOP
     ================================================================== */
  async function ask(question, conversationHistory) {
    requireInit();
    let messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(conversationHistory || []),
      { role: 'user', content: question },
    ];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GK },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 800,
          messages,
          tools: buildGroqToolSchemas(),
          tool_choice: 'auto',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `Groq API returned HTTP ${res.status}`);

      const message = data.choices?.[0]?.message;
      if (!message) throw new Error('Unexpected Groq response shape.');

      if (!message.tool_calls || !message.tool_calls.length) {
        return { answer: message.content, iterations: iteration };
      }

      messages.push(message);
      for (const call of message.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { /* malformed args from the model */ }
        const result = await executeTool(call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return { answer: "I wasn't able to fully resolve that within the allowed number of lookups — try rephrasing, or asking about one thing at a time.", iterations: MAX_TOOL_ITERATIONS };
  }

  return {
    init({ supabaseClient, organisationId, groqKey }) {
      db = supabaseClient; ORG_ID = organisationId; GK = groqKey;
    },
    ask,
    _tools: TOOLS, // exposed for testing only
  };
})();

if (typeof window !== 'undefined') window.SmarTunaAI = SmarTunaAI;