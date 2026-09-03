/* =============================================================
   PROJECT MANHATTAN — Carbon Calculator Module
   carbon-calculator.js

   STATUS: local/static mockup. No dbClient calls yet — every spot
   that will eventually read from or write to Supabase is marked
   with a `// TODO(supabase):` comment so wiring it up later is a
   find-and-replace job, not a rebuild.
   ============================================================= */

/* ---------- DATA LAYER ----------
   Same idea as the standalone version: every field on screen comes
   from CTE_DATA. Edit a value/type/unit here, it updates on screen.
   type: text | number | select | date | daterange | datetime | tags
--------------------------------------------------------------- */

// TODO(supabase): same project as the rest of Project Manhattan.
// Uses the publishable/anon key — safe to ship client-side, RLS on the
// server enforces access. Not tested against a live database from here;
// verify against a dev/staging branch before trusting it in production.
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

/* ---------- LAUNCH-FROM-SHIPMENT: real data fetch + field mapping ----------
   Triggered only when the URL carries ?shipment=<uuid> (set by
   shipment-detail.html's existing goCarbon() button — nothing on that
   side needs to change). Fetches the real chain: shipments ->
   shipment_items -> shipment_batches -> products -> raw_materials ->
   raw_material_species (per-species breakdown for mixed lots) ->
   raw_material_catches (Catch + Transshipment events). Everything here
   is additive: with no ?shipment= param, none of this runs and the
   existing demo is completely unaffected. */
let shipmentOverrides = null;   // built once the fetch resolves; null until then / if absent
let shipmentFetchError = null;  // set if the fetch fails, so we can surface it rather than silently show the demo
let ovpShipmentApplied = false; // OVP has no per-instance state to flag against — it's a single static fields array
let shipReceiveShipmentApplied = false; // same reason — Ship/Receive's fields are static shared arrays too

// Placeholder species reference list — stand-in for a real Species
// module/table, which I don't have access to. Used to populate the
// multi-select Species fields with a reasonable option pool.
const SPECIES_OPTIONS = ['Skipjack','Yellowfin','Albacore','Bigeye','Bluefin','Bonito'];

async function loadShipmentContext(shipmentId){
  if(!dbClient) throw new Error('Supabase client not available.');

  const { data: shipment, error: shipErr } = await dbClient
    .from('shipments').select('*').eq('id', shipmentId).single();
  if(shipErr || !shipment) throw shipErr || new Error('Shipment not found.');

  const { data: items } = await dbClient
    .from('shipment_items').select('*').eq('shipment_id', shipmentId).order('line_no');
  const item = (items || [])[0] || null;

  const { data: batches } = item ? await dbClient
    .from('shipment_batches').select('*').eq('shipment_id', shipmentId).order('line_no') : { data: [] };
  const batch = (batches || []).find(b => b.raw_material_id) || null;

  const { data: vessels } = await dbClient
    .from('shipment_vessels').select('*').eq('shipment_id', shipmentId);
  const shipVessel = (vessels || [])[0] || null;

  let product = null;
  if(item?.product_id){
    const { data } = await dbClient.from('products').select('*').eq('id', item.product_id).single();
    product = data || null;
  }

  let rawMaterial = null, speciesRows = [], catchRows = [];
  if(batch?.raw_material_id){
    const [rm, sp, ev] = await Promise.all([
      dbClient.from('raw_materials').select('*').eq('id', batch.raw_material_id).single(),
      dbClient.from('raw_material_species').select('*').eq('raw_material_id', batch.raw_material_id),
      dbClient.from('raw_material_catches').select('*').eq('raw_material_id', batch.raw_material_id).order('line_no'),
    ]);
    rawMaterial = rm.data || null;
    speciesRows = sp.data || [];
    catchRows = ev.data || [];
  }

  return { shipment, item, batch, product, rawMaterial, speciesRows, catchRows, shipVessel };
}

// The shipment item's own species_name tells us which row in a mixed
// raw-material lot's species breakdown is the one actually being shipped
// (confirmed against real data: FMC2500526 is a mixed Skipjack/Yellowfin
// lot, and only the Skipjack portion is relevant to this shipment).
function pickTargetSpecies(ctx){
  const targetName = (ctx.item?.species_name || ctx.rawMaterial?.species_name || '').toLowerCase();
  if(ctx.speciesRows.length){
    const match = ctx.speciesRows.find(s => (s.species_name||'').toLowerCase() === targetName);
    return match || ctx.speciesRows[0];
  }
  return ctx.rawMaterial ? { species_name: ctx.rawMaterial.species_name, quantity_kg: ctx.rawMaterial.quantity_kg } : null;
}

function buildShipmentOverrides(ctx){
  const missing = [];
  const need = (label, val) => { if(val===undefined || val===null || val==='') missing.push(label); return val; };

  const target = pickTargetSpecies(ctx);
  const catchEvent = ctx.catchRows.find(e => e.event_type === 'Catch') || null;
  const transshipEvent = ctx.catchRows.find(e => e.event_type === 'Transshipment') || null;

  // Harvesting / On Vessel Processing / Landing all handle the WHOLE
  // mixed catch (every species in the lot), not one species-specific
  // slice — so their Species list and Weight both use lot-wide figures.
  // Transformation and Ship/Receive represent the finished, single-species
  // product, so those use the target species' own weight specifically.
  const allSpeciesNames = ctx.speciesRows.length
    ? ctx.speciesRows.map(s=>s.species_name).filter(Boolean)
    : (ctx.rawMaterial?.species_name ? [ctx.rawMaterial.species_name] : []);
  const lotTotalKg = ctx.rawMaterial?.quantity_kg ?? null;
  const targetKg = target?.quantity_kg ?? null;
  const lotWeight = lotTotalKg ? { value: fmtNum(lotTotalKg), unit:'kg' } : null;
  const targetWeight = targetKg ? { value: fmtNum(targetKg), unit:'kg' } : null;

  const supplierName = ctx.rawMaterial?.supplier_name || null;   // Landing / Aggr-Disaggr "Product Ownership"
  const processorName = ctx.shipment.processor_name || null;      // Transformation "Product Ownership"
  const rmRef = ctx.rawMaterial?.rm_ref || null;
  const rawPortName = catchEvent?.landing_port_name || transshipEvent?.transfer_location || null;
  const portName = rawPortName ? (PORTS.find(p=>p.startsWith(rawPortName)) || rawPortName) : null;

  // Packaging: pull Product Type from the real product record when it
  // matches a known rule; ask actual input questions (not just an
  // informational note) for whatever numbers genuinely don't exist
  // anywhere in the product/shipment/raw-material data.
  const packagingQuestions = [];
  if(ctx.product?.primary_packaging && PACKAGING_RULES[ctx.product.primary_packaging]){
    packagingContext.productType = ctx.product.primary_packaging;
  }
  if(ctx.product?.net_weight_g){
    packagingContext.netWeightG = ctx.product.net_weight_g;
  } else {
    packagingQuestions.push({ key:'pkg-q-net-weight', label:'Net Weight (per unit)', unit:'g',
      apply:(v)=>{ packagingContext.netWeightG = v; } });
  }
  // Best-effort column names for the two new Product fields — not yet
  // confirmed against the real schema, so this falls back to asking
  // when either column comes back undefined.
  const pmQty = ctx.product?.packaging_material_quantity_g ?? ctx.product?.packaging_material_quantity;
  if(pmQty){
    packagingContext.packagingMaterialQuantity = pmQty;
  } else {
    packagingQuestions.push({ key:'pkg-q-material-qty', label:'Packaging Material Quantity', unit:'g',
      apply:(v)=>{ packagingContext.packagingMaterialQuantity = v; } });
  }
  const pmCode = ctx.product?.packaging_material_type_code;
  if(pmCode){
    const normalized = /metal/i.test(pmCode) ? 'Metal-Others' : /plastic/i.test(pmCode) ? 'Plastic' : /paper/i.test(pmCode) ? 'Paper' : pmCode;
    packagingOverrides.primary[0] = { ...(packagingOverrides.primary[0]||{}), material: normalized };
  }
  packagingQuestions.push(
    { key:'pkg-q-inner-unit', label:'Inner Unit (units per carton)', unit:'',
      apply:(v)=>{ packagingContext.innerUnit = v; } },
    { key:'pkg-q-pallet-weight', label:'Empty Wooden Pallet Weight', unit:'kg',
      apply:(v)=>{ packagingContext.palletWeight = v; } },
    { key:'pkg-q-pallet-units', label:'Pallet Stacking Configuration (total units, e.g. 10×12=120)', unit:'',
      apply:(v)=>{ packagingContext.palletUnits = v; } },
  );

  return {
    modal: {
      product: ctx.shipment.product_name || ctx.item?.product_name || null,
      destinationCountry: ctx.shipment.destination_country || null,
      destinationPort: ctx.shipment.destination_name || null,
      dri: rmRef,
    },

    harvesting: {
      'Vessel Name': need('Harvesting: Vessel Name', catchEvent?.vessel_name),
      'Unique Vessel Identification': need('Harvesting: Vessel IMO', catchEvent?.imo),
      'Vessel Flag': catchEvent?.flag_state || null,
      'Gear type': need('Harvesting: Gear type', catchEvent?.gear_type),
      'FAO Area': need('Harvesting: FAO Area', catchEvent?.fao_area),
      'Linking KDE': rmRef,
      'Satellite Vessel Tracking Authority': 'Available',
      'Product Ownership': supplierName,
    },
    harvestingSpecies: allSpeciesNames,
    harvestingDates: (catchEvent?.catch_date_from && catchEvent?.catch_date_to)
      ? `${catchEvent.catch_date_from} – ${catchEvent.catch_date_to}` : null,
    harvestingWeight: lotWeight,

    ovp: {
      'Chain of Custody Certification': rmRef,
      'Linking KDE (batch, lot or serial number)': rmRef,
      // Same fishing vessel that did the catch — On Vessel Processing
      // happens aboard it, not a separate carrier.
      'Vessel Name': catchEvent?.vessel_name || null,
      'Unique Vessel ID (IMO)': catchEvent?.imo || null, // NB: OVP's actual label differs from Harvesting's "Unique Vessel Identification" — this was the bug
      'Vessel Flag': catchEvent?.flag_state || null,
      'Event Date & Time': catchEvent?.catch_date_from || null,
      'Product Ownership': supplierName,
    },
    ovpSpecies: allSpeciesNames,
    ovpWeight: lotWeight,

    transshipment: transshipEvent ? {
      'Chain of Custody Certification': rmRef,
      'Transshipment Vessel Name': transshipEvent.carrier_vessel_name || null,
      'Transshipment Vessel Flag': transshipEvent.carrier_flag_state || null,
      'Transshipment Vessel Unique Vessel ID (IMO)': transshipEvent.carrier_imo || null,
      'Linking KDE': rmRef,
      'Port': portName,
      'Event Date & Time': transshipEvent.transfer_date || null,
      'Date(s) of Transshipment': (transshipEvent.transfer_date && transshipEvent.transfer_date_to)
        ? `${transshipEvent.transfer_date} – ${transshipEvent.transfer_date_to}` : null,
    } : null,
    transshipmentSpecies: allSpeciesNames,

    landing: {
      'Linking KDE': rmRef,
      'Product Ownership': supplierName,
      'Event Date & Time': '2026-08-04',
    },
    landingSpecies: allSpeciesNames,
    landingWeight: lotWeight,

    aggr: {
      species: allSpeciesNames.join(' + '),
      weight: lotWeight,
      driSpecies: target?.species_name || null,
      driWeight: targetWeight,
      productOwnership: supplierName,
      eventDate: '2026-08-06',
    },

    transformation: {
      'Product Ownership': processorName,
    },
    transformationWeight: targetWeight,
    packagingFacility: processorName,

    shipReceive: {
      'Transaction No. (s)': ctx.shipment.shipment_ref || null,
      'Vessel Name': ctx.shipVessel?.vessel_name || null,
    },
    shipReceiveWeight: targetWeight,
    shipReceiveDistanceSea: '17350',

    missing,
    packagingQuestions,
  };
}

// Converts a CTE's Species field from plain text to a multi-select (tags)
// field and pre-seeds it with the given species list, without touching
// tagsState if it's already been seeded once (so user edits stick).
function applySpeciesTagsOverride(cteCtx, mainFields, selectedSpecies){
  if(!selectedSpecies || !selectedSpecies.length) return;
  const idx = mainFields.findIndex(f => f.label.toLowerCase().includes('species'));
  if(idx===-1) return;
  mainFields[idx].type = 'tags';
  mainFields[idx].options = SPECIES_OPTIONS.slice();
  const id = `${cteCtx}::${idx}::${mainFields[idx].label}`;
  if(!(id in tagsState)) tagsState[id] = { selected: [...selectedSpecies], options: SPECIES_OPTIONS.slice(), open:false };
}

// Applies label-matched string overrides onto a main-style fields array
// (the F() objects used across every CTE's `main`/`fields` list) — matches
// by case-insensitive substring so slightly different label phrasing
// across CTEs (e.g. "Linking KDE" vs "Linking KDE (batch, lot or serial
// number)") still resolves, and silently skips anything that doesn't
// exist on a given CTE rather than erroring.
function applyLabelOverrides(fields, overrides){
  if(!fields || !overrides) return;
  const keys = Object.keys(overrides);
  fields.forEach(f=>{
    const key = keys.find(k => f.label.toLowerCase().includes(k.toLowerCase()));
    if(key && overrides[key] !== null && overrides[key] !== undefined) f.value = overrides[key];
  });
}

const F = (label, value, type='text', extra={}) => ({label, value, type, ...extra});
const SCOPE_OPTS = ['Scope I','Scope II','Scope III','Mixed'];

// TODO(supabase): swap for a live query against the Country / Port Atlas
// modules once this is wired in — these are placeholder reference lists.
const COUNTRIES = ['Republic of Korea','United States','China','Japan','Thailand','Spain','Norway','Ecuador','Indonesia','Vietnam','Philippines','India','Taiwan','France','Italy','United Kingdom','Chile','Peru','Mexico','Papua New Guinea','Germany'];

// ISO 3166-1 numeric codes for the GS1 GDSN Carbon Footprint modal's
// cfpCountryCode — a representative subset, not the full ISO list.
const GDSN_COUNTRIES = [
  {code:'764', name:'Thailand'}, {code:'410', name:'South Korea'}, {code:'392', name:'Japan'},
  {code:'840', name:'United States'}, {code:'156', name:'China'}, {code:'704', name:'Vietnam'},
  {code:'360', name:'Indonesia'}, {code:'608', name:'Philippines'}, {code:'724', name:'Spain'},
  {code:'578', name:'Norway'}, {code:'218', name:'Ecuador'}, {code:'484', name:'Mexico'},
];

// Real GS1 GDSN code lists + descriptions, as given — replaces the earlier
// guessed/incomplete option lists for these 5 fields.
const GDSN_VERIFICATION_DESC = {
  EXTERNAL_VERIFICATION:'The values have been verified by an external party.',
  NOT_VERIFIED:'The values have been calculated according to the reported calculation method, but have not been verified.',
  PEER_REVIEWED:'The values and methodology have been reviewed internally or by 3rd party.',
};
const GDSN_BOUNDARIES_DESC = {
  CRADLE_TO_CONSUMPTION:'Total amount of CO2 emission from a life cycle assessment (LCA) model that assesses a product\u2019s environmental footprint from raw materials extraction until it is consumed. (PEF guidance, the European Commission 2021b)',
  CRADLE_TO_GATE:'Total amount of CO2 emission from a life cycle assessment (LCA) model that assesses a product\u2019s environmental footprint from raw materials extraction until it leaves the factory gate.',
  CRADLE_TO_GRAVE:'Total amount of CO2 emission from a life cycle assessment (LCA) model that assesses a product\u2019s environmental footprint from raw materials extraction until its disposal, including manufacturing, transportation, product use.',
  END_OF_LIFE:'The emission of the product when it is disposed, recycled, recovered after use.',
  MANUFACTURING:'The emissions resulting from the manufacturing/production of the product.',
  RAW_MATERIALS:'The emissions resulting from the production/extraction, packaging, storage, warehousing and transportation of raw materials.',
  TRANSPORT_FINAL_PRODUCT:'The emissions resulting from the distribution of the product to the retail network or to downstream stakeholders. This stage includes transport of the final product and its packaging, storage and warehousing.',
  USE:'The emissions of the product when used by the consumer.',
};
const GDSN_UOM_DESC = {
  EUR_CO2_EQ_PER_KG:'Euro CO2 equivalent per kilogram.',
  KG_CO2_EQ_PER_100G:'Kilogram CO2 equivalent per 100 grams.',
  KG_CO2_EQ_PER_100ML:'Kilogram CO2 equivalent per 100 milliliters.',
  KG_CO2_EQ_PER_FU:'Kilogram CO2 equivalent per functional unit.',
  KG_CO2_EQ_PER_KG:'Kilogram CO2 equivalent per kilogram.',
};
const GDSN_METHODOLOGY_DESC = {
  CARBON_FOOTPRINT_STANDARD:'Product-specific value, based on carbon footprint standard (ISO 14067).',
  ENVIMAT:'Value for the product-group from an input-output study, based on ENVIMAT in Finland (Nissinen et al. 2019, SYKEra 15/2019).',
  EPD:'Environmental Product Declaration (EPD).',
  GHG_PROTOCOL:'The Product Life Cycle Accounting and Reporting Standard can be used to understand the full life cycle emissions of a product and focus efforts on the greatest Greenhouse Gas (GHG) reduction opportunities.',
  ISO_14064:'ISO 14064 specifies requirements for selecting Greenhouse Gas (GHG) validators/verifiers, establishing the level of assurance, objectives, criteria and scope, determining the validation/verification approach, assessing GHG data, information, information systems and controls, evaluating GHG assertions and preparing validation/verification statements.',
  OTHER:'A standard calculation method, not classified in the codelist.',
  PCR:'Product Category Rules.',
  PCR_EDF:'Product-specific value, based on Product Category Rule (PCR) of an Environmental Product Declaration (EPD) system.',
  PEF:'The Product Environmental Footprint (PEF) methodology is performed following the PEF guidelines published by the European Commission and, if available, specific category rules (PEFCRs).',
  RECIPE:'Based on National Institute for Public Health and the Environment (RIVM), Institute of Environmental Sciences (CML), Product Category Rule (PCR).',
};
const GDSN_ACCOUNTING_DESC = {
  ATTRIBUTIONAL:'An attributional life cycle assessment (ALCA) is focusing on describing, assessing and quantifying environmentally relevant physical flows of specific life cycle(s) and its subsystems. An ALCA gives an estimate of what part of the global environmental burdens belongs to the study object. An ALCA does not include environmental benefits or other indirect consequences that arise outside the life cycle of the investigated product.',
  CONSEQUENTIAL:'A consequential life cycle assessment (CLCA) is focusing on describing, assessing and quantifying environmentally relevant flows and how they will change in response to possible decisions. A CLCA gives an estimate of how the production and use of the study object affect the global environmental burdens. For example, an increased use of a material in the studied system can lead to less material being used in other systems.',
};

const gdsnData = {
  countryCode:'764',
  date:'',
  verificationCode:'PEER_REVIEWED',
  boundariesCode:'CRADLE_TO_CONSUMPTION',
  valueUom:'KG_CO2_EQ_PER_KG',
  functionalUnit:'',
  methodologyCode:'GHG_PROTOCOL',
  accountingCode:'ATTRIBUTIONAL',
};
function onGDSNChange(field, el){ gdsnData[field] = el.value; }

// Rotating quote over the Wild Capture modal's video, matching the dark
// scrim + white italic quote treatment already built for it.
const HERO_QUOTES = [
  { text:'We do not inherit the Earth from our ancestors; we borrow it from our children.', author:'Wendell Berry' },
  { text:'The sea, once it casts its spell, holds one in its net of wonder forever.', author:'Jacques Cousteau' },
  { text:'The Earth has music for those who listen.', author:'William Shakespeare' },
  { text:'Look deep into nature, and then you will understand everything better.', author:'Albert Einstein' },
];
let quoteIndex = Math.floor(Math.random()*HERO_QUOTES.length);
let quoteTimer = null;

function quoteHTML(q){
  return `\u201C${q.text}\u201D<span class="modal-quote-author">\u2014 ${q.author}</span>`;
}
function rotateQuote(){
  const el = document.getElementById('modal-quote');
  if(!el) return;
  el.style.opacity = '0';
  setTimeout(()=>{
    quoteIndex = (quoteIndex+1) % HERO_QUOTES.length;
    el.innerHTML = quoteHTML(HERO_QUOTES[quoteIndex]);
    el.style.opacity = '1';
  }, 350);
}
function startQuoteRotation(){
  if(quoteTimer) return;
  quoteTimer = setInterval(rotateQuote, 6000);
}
function stopQuoteRotation(){
  clearInterval(quoteTimer);
  quoteTimer = null;
}
const PORTS = ['Busan, South Korea','Kaohsiung, Taiwan','Bangkok, Thailand','General Santos, Philippines','Manta, Ecuador','Vigo, Spain','Bergen, Norway','Singapore','Jakarta, Indonesia','Cochin, India','Hamburg, Germany','Rabaul, Papua New Guinea'];

// TODO(supabase): replace with a live query against the Raw Material
// module, e.g. `dbClient.from('raw_materials').select('id,label')`.
// Placeholder entries below are illustrative only — species + lot code,
// matching how Raw Material records were described (not real data).
const RAW_MATERIALS = [
  'Skipjack Tuna — Lot MIN56KCCDC3ZF1',
  'Yellowfin Tuna — Lot RM-2026-0142',
  'Skipjack Tuna — Lot RM-2026-0089',
  'Albacore Tuna — Lot RM-2026-0201',
  'Bigeye Tuna — Lot RM-2026-0117',
];

// Small "i" bubble used next to a label to explain a constant or formula.
function tooltip(text, link){
  return `<span class="info-tip" tabindex="0">
    <span class="info-tip-icon">i</span>
    <span class="info-tip-bubble">${text}${link?` <a href="${link}" target="_blank" rel="noopener">Read more</a>`:''}</span>
  </span>`;
}

/* ---------- FIELD INFO REGISTRY ----------
   One "Field guide" button per CTE instead of an "i" icon on every field —
   opens a panel listing that CTE's explanations in one place. */
const FIELD_INFO = {
  harvesting:[
    {label:'Fuel Consumption', text:'368L is a constant value. Using purse seine gear, vessels were found to burn, on average, 368 litres of fuel per live-weight tonne of landing.', link:'https://www.iss-foundation.org/about-issf/what-we-publish/issf-documents/issf-technical-report-2012-03-fuel-consumption-and-greenhouse-gas-emissions-from-global-tuna-fisheries-a-preliminary-assessment/'},
    {label:'Total Fuel (L to KG)', text:'Weight or Quantity × Fuel Consumption × PS Fuel Conversion (0.85). 0.85 kg/L is the density of diesel used for the conversion.'},
    {label:'Total Emission', text:'Total Fuel (L to KG) × PS Emission Factor (3.026). 3.026 is a constant.', link:'https://www.researchgate.net/figure/Conversion-factor-between-fuel-consumption-and-CO2-emission-MEPC-2018_tbl7_347794254'},
    {label:'Emission per 1KG', text:'Total Emission ÷ (Weight or Quantity × 1000). The ×1000 only applies when Weight is in MT — if Weight is already in KG, no conversion is needed.'},
  ],
  onVesselProcessing:[
    {label:'Weight or Quantity', text:'Pulled from the Weight or Quantity entered on the Harvesting tab when this tab first opens. Editing it here doesn\u2019t change Harvesting.'},
    {label:'Yield %', text:'Percentage of the harvested weight that remains after onboard processing. Lower this and the Yield of Weight or Quantity — and every emission figure below — recalculates.'},
    {label:'Refrigeration Energy', text:'The amount of energy used to keep products cold or frozen using refrigeration systems. 0.023 kg refrigerant per tonne of fish.', link:'https://www.sintef.no/globalassets/sintef-ocean/coolfish/publications/2020_r_gabrielli.pdf'},
    {label:'Electricity Consumption', text:'E ≈ 0.07–0.13 kWh per kg tuna. Converted from kg to MT (×1000). Emission = Electricity Consumption × Yield of Weight or Quantity × 0.7 kg CO₂e/kWh (IMO Fourth GHG Study 2020).', link:'https://www.researchgate.net/publication/327538449_Analysis_of_fish_refrigeration_electricity_consumption'},
    {label:'Water Usage', text:'The amount of water used by equipment, facilities, or processes during this event — a negligible amount is only used. Emission = Water Usage × Yield of Weight or Quantity × 0.0035.'},
    {label:'Waste Water', text:'Water used in processing, cleaning, or operational activities that contains contaminants such as organic matter, oils, blood, or chemicals — generated while washing fish, processing, and cleaning the facility. A negligible amount is only used. Emission = Waste Water × Yield of Weight or Quantity × 0.001 kg CO₂e/L.'},
    {label:'Fuel Consumption', text:'0.01–0.04 liters diesel per kg tuna. Converted from kg to MT (×1000). Emission = Fuel Consumption × Yield of Weight or Quantity × 3.2.', link:'https://www.depco.com/faq/diesel-generator-efficiency'},
    {label:'Total Emissions', text:'Refrigeration + Water + Waste Water + Fuel Consumption emissions. Electricity Consumption emission is deliberately excluded — fuel is used to generate the vessel\u2019s electricity, so that emission is already embedded in Fuel Consumption. Adding both would double-count it.'},
    {label:'Emissions per 1KG', text:'Total Emissions ÷ (Yield of Weight or Quantity × 1000). The ×1000 applies because the weight is in MT.'},
  ],
  transshipment:[
    {label:'Weight or Quantity (RCS off)', text:'Reefer carrier fish hold capacity: 5,500MT avg. A reefer carrier may contain fish from other vessels too, so we can\u2019t know the exact total weight — 5,500MT is a referenced average from our carrier CRM.'},
    {label:'Distance Travelled (RCS off)', text:'An average of 7,600KM considered. Port-to-port distance calculation (AIS / sea-route presets) is a good candidate for a future enhancement.'},
    {label:'Distance Travelled (RCS on)', text:'An average of 4,200KM considered — port-to-port distance, ideally sourced from AIS or a precalculated sea-route preset.'},
    {label:'Water usage', text:'The amount of water used by equipment, facilities, or processes during this event. Not treated separately — the reefer carrier emission factor already indirectly accounts for it.'},
  ],
  landing:[
    {label:'Emissions', text:'Weight or Quantity (kg) × Distance to Facility (km) × 0.0000542 kg CO₂e/kg·km.', link:'https://www.climatiq.io/data/explorer?search=refrigerated+truck&data_version=%5E32&page=1'},
    {label:'Emissions of 1KG', text:'Emissions ÷ Weight or Quantity (kg).'},
  ],
  aggrDisaggr:[
    {label:'DRI Species Weight or Quantity', text:'Total aggregate weight refers to the combined total weight of all products or batches that are grouped together during the aggregation event.'},
    {label:'Fuel Consumption', text:'Fuel consumption refers to the amount of fuel used by equipment or machinery during product handling, storage, or movement at the facility.'},
    {label:'Water Usage', text:'The amount of water used during handling, cleaning, sorting, or maintaining hygiene conditions at the facility where products are grouped or separated. Total water usage = Water usage for a kg × Weight or Quantity; Total CO₂e = EF of water × Total water usage.'},
    {label:'Refrigeration Energy', text:'The electricity or energy used by cooling or freezing systems to maintain the required temperature for fish products during handling. Refrigerant leakage = Weight × Avg Refrigerant emission per kg; Total CO₂e = Refrigerant leakage × GWP.', link:'https://9pdf.net/article/carbon-footprint-of-fisheries-previous-studies.zx5njvkn'},
    {label:'Electricity Consumption', text:'Weight or Quantity × Electricity usage per kg/day × EF of Electricity.'},
    {label:'Electricity usage per kg/day', text:'0.159. Source: "Energy efficiency and ISO 50001:2018 implementation in seafood processing industries: A comprehensive analysis and strategic framework".'},
    {label:'EF of Electricity', text:'0.4999 kg CO₂e/kWh — Grid Mix Electricity System (2016–2018), LCIA method IPCC 2013 GWP 100a V1.03, as reported by the Thailand Greenhouse Gas Management Organization (TGO).', link:'http://thaicarbonlabel.tgo.or.th/products_emission/products_emission.pnc'},
    {label:'Water usage for a kg (L/kg)', text:'1.0L — Benchmark: 1.0 Liter of water per 1.0 Kilogram of fish. Source: FAO Fisheries Technical Paper — "Small-scale fish landing and marketing facilities" (No. 291).'},
    {label:'Avg Refrigerant emission (per kg)', text:'0.00007 — the refrigerant leakage value used to estimate refrigerant-related emissions in the seafood supply chain.', link:'https://9pdf.net/article/carbon-footprint-of-fisheries-previous-studies.zx5njvkn'},
  ],
  transformation:[
    {label:'Weight or Quantity', text:'Weight or quantity refers to the amount of product being processed, expressed in a defined unit of measure.'},
    {label:'Yield of Weight or Quantity', text:'Yield weight refers to the final weight of usable product obtained after processing, compared to the initial input weight.'},
    {label:'Electricity Consumption', text:[
      'a.k.a Power transmission System. Electricity consumption refers to the amount of electrical energy used during processing activities, such as operating machinery, equipment, lighting, refrigeration, and other facility operations.',
      'Electricity consumption was calculated by adding all the sources corresponding to the species processing to get the LCI value. The corresponding value was multiplied with 0.4999 for each of the sources to get the carbon emission for that source. Then the total carbon emission of all sources was summed up.',
      '0.084406 is the calculated value per 1KG from processor.',
    ]},
    {label:'Purchased Raw Material and Services', text:[
      '(Main ingredients, Chemicals, Consumables) Total of factors: Main Ingredients (2.949943) + Chemicals (0.003359) + Consumables (0.000610).',
      'The raw materials and external services procured from suppliers that are used during the processing stage. Here it includes the main ingredients, chemicals and consumables.',
      'Main ingredient — the LCI value was calculated for the quantity of species. The emission of species quantity was calculated by multiplying the total quantity of the species with 2.95 kgCO₂e/unit to get the total kgCO₂e for that species. The same calculation was applied for the chemicals and the consumables. The emission factor of different chemicals and consumables vary.',
    ]},
    {label:'Ingredients', text:[
      'Materials added during processing that contribute to the final product and its associated carbon footprint.',
      'Ingredients will be considered later.',
    ]},
    {label:'Equipment & Machinery', text:[
      '(Capital goods) Machines used during processing, including their energy use and associated emissions in the carbon footprint calculation.',
      'Emissions associated with capital goods (e.g., infrastructure, machinery, and equipment) are excluded from the system boundary in alignment with ISO 14067 and GHG Protocol Product Standard guidelines, as their contribution per functional unit is considered negligible and subject to significant allocation uncertainty.',
    ]},
    {label:'Water Usage', text:[
      'Water used during processing, including the associated emissions from supply and wastewater treatment. Here the water usage includes the emission from the water supply system.',
      'The emission from liquid chlorine and other water supply system components is calculated under the water supply system. 10% liquid chlorine, Ferric Chloride, Polymer Cat for sludge dewatering, and Polymer An for flocculant were considered in the emission.',
    ]},
    {label:'Waste Disposal', text:[
      '(Waste Management) Waste refers to the materials generated during processing that do not become part of the final product. The category includes recyclable waste, organic waste, hazardous waste, general waste and infectious waste.',
      'The LCI value of waste is calculated by multiplying the waste quantity with a constant factor of 0.919 (taken from EF TGO). This LCI value was multiplied with the emission factor of waste, i.e. 2.64 (TGO CFP FY25-287-2103), to get the total emission.',
    ]},
    {label:'On-Site Fuel Combustion', text:'(Stationary combustion) Specific type of fuel used in fixed equipment at the processing facility, such as diesel, natural gas, LPG, coal, or other fuels, that are burned in boilers, furnaces, or generators.'},
    {label:'Fuel Consumption', text:[
      '(Mobile Combustion) Fuel burned in fixed equipment (e.g., boilers or generators) at the processing facility, generating associated emissions.',
      'The different stationary combustion sources were multiplied with Net Calorific Value (NCV) / Energy Correction (0.93) and Fuel Efficiency / Oxidation / Density-related Factor (0.919) to get the LCI value. The emission factor for stationary combustion is 2.70, taken from EF TGO AR5. The total emission was calculated by multiplying it with the LCI value.',
    ]},
    {label:'Upstream Energy', text:[
      '(Fuel & Energy Activities) Energy used to produce and supply the electricity or fuel consumed during the processing stage, including emissions from energy generation, extraction, and distribution.',
      'The different upstream energy sources were multiplied with Net Calorific Value (NCV) / Energy Correction (0.93) and Fuel Efficiency / Oxidation / Density-related Factor (0.919) to get the LCI value. The emission factor for upstream energy of different fuels varies (taken from EF TGO AR5). The total emission was calculated by multiplying it with the LCI value.',
    ]},
    {label:'Leased assets', text:'(Leasing of Organisational assets) Equipment, facilities, or machinery used during processing that are leased rather than owned by the company.'},
    {label:'Fugitive Emission', text:[
      '(Leakage) Unintended release of gases or materials during processing operations, such as refrigerant leaks from cooling systems or gas emissions from equipment.',
      'The different leakage sources were multiplied with Fuel Efficiency / Oxidation / Density-related Factor (0.919) to get the LCI value. The emission factor for different leakage sources vary. The total emission was calculated by multiplying the emission factor with the LCI value.',
    ]},
    {label:'Emissions', text:'Weight or Quantity × (Electricity Consumption + Purchased Raw Material and Services + Ingredients + Equipment & Machinery + Water Usage + Waste Disposal + On-Site Fuel Combustion + Fuel Consumption + Upstream Energy + Leased assets + Fugitive Emission). This is the total embodied emissions across ALL the raw material processed, before splitting into Yield vs Other Product.'},
    {label:'Emissions of 1KG', text:'Emissions ÷ Weight or Quantity. This rate is shared by Yield and Other Product too — algebraically, dividing either one\u2019s own emission by its own weight always gives back the same number.'},
    {label:'Yield Emission', text:'Emissions × Yield %  the portion of the total attributable to the usable Yield.'},
    {label:'Other Product Emission', text:'Emissions × (100% \u2212 Yield %)  the portion attributable to the remainder that isn\u2019t counted as Yield.'},
  ],
  storage:[
    {label:'Yield of Weight', text:'Pulled from Transformation\u2019s Yield of Weight or Quantity when this tab first opens. Editing it here doesn\u2019t change Transformation.'},
    {label:'Electricity consumption', text:'Yield of Weight × Electricity usage per kg × EF of Electricity.'},
    {label:'Refrigeration Energy', text:'Yield of Weight × Average Refrigerant emission (per kg) × GWP. Only added to the total when "Enable" is switched on.'},
    {label:'Emission TTL', text:'Electricity consumption, plus Refrigeration Energy if Enable is switched on — Refrigeration Energy is excluded by default.'},
    {label:'Emission of 1KG', text:'Emission TTL ÷ Yield of Weight.'},
  ],
  shipReceive:[
    {label:'Emissions of Vessel (s)', text:'(No. of TEU × GW of Reefer container × 0.9 × 0.01681 × Distance travelled) + (No. of TEU × GW of Dry container × 0.1 × 0.0129 × Distance travelled). Both GWs are used in metric tonnes.'},
    {label:'Emissions of Aircraft (s)', text:'Est GW of Aircraft (metric tonnes) × Distance travelled × 0.68.'},
    {label:'Emissions of 1 KG (Vessel)', text:'((Yield Weight or Quantity ÷ 1000) × Distance travelled × (0.01681 + 0.0129)) ÷ Yield Weight or Quantity.'},
    {label:'Emissions of 1 KG (Aircraft)', text:'((Yield Weight or Quantity ÷ 1000) × Distance travelled × 0.68) ÷ Yield Weight or Quantity.'},
  ],
};

// Pulls "Product Form" and "Species" from a CTE's own field list (or an
// explicit override for CTEs like Aggr/Disaggr where Species lives outside
// the main fieldGrid) and formats them as a subtitle next to the CTE title.
// Returns '' when there's nothing to show, so CTEs without these fields
// (Storage) or with them still blank (Ship/Receive by default) show nothing.
function cteProductTag(fields, speciesOverride){
  const pf = (fields.find(f=>f.label==='Product Form')||{}).value;
  const sp = speciesOverride !== undefined ? speciesOverride : (fields.find(f=>f.label==='Species')||{}).value;
  if(!pf && !sp) return '';
  return `<span class="cte-product-tag">${pf||'–'} <i>(Product Form)</i> of ${sp||'–'} <i>(Species)</i></span>`;
}

function renderInfoButton(cteKey){
  if(!FIELD_INFO[cteKey] || !FIELD_INFO[cteKey].length) return '';
  return `<button type="button" class="info-btn" data-action="info-open" data-cte="${cteKey}">
    <span class="info-btn-icon">i</span> Field guide
  </button>`;
}

const CTE_TITLES = {
  harvesting:'Harvesting', onVesselProcessing:'On Vessel Processing', transshipment:'Transshipment',
  landing:'Landing', aggrDisaggr:'Aggregation/ Disaggregation', transformation:'Transformation', storage:'Storage',
  shipReceive:'Logistics',
};

function renderInfoPanel(){
  const cteKey = state.infoPanelOpen;
  if(!cteKey) return '';
  const entries = FIELD_INFO[cteKey] || [];
  return `
  <div class="modal-overlay">
    <div class="info-panel">
      <div class="info-panel-head">
        <h3>${CTE_TITLES[cteKey]||cteKey} — Field Guide</h3>
        <button type="button" class="info-panel-close" data-action="info-close">✕</button>
      </div>
      <div class="info-panel-body">
        ${entries.map(e=>{
          const paras = Array.isArray(e.text) ? e.text : [e.text];
          return `
          <div class="info-entry">
            <div class="info-entry-label">${e.label}</div>
            ${paras.map(p=>`<div class="info-entry-text">${p}</div>`).join('')}
            ${e.link?`<div class="info-entry-text"><a href="${e.link}" target="_blank" rel="noopener">Read more →</a></div>`:''}
          </div>
        `;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function renderGDSNModal(){
  if(!state.gdsnModalOpen) return '';
  if(!gdsnData.date) gdsnData.date = new Date().toISOString().slice(0,10);
  const cfpValue = fmtNum(Object.values(grandTotalParts).reduce((a,b)=>a+b, 0), 3);

  return `
  <div class="modal-overlay">
    <div class="gdsn-card">
      <div class="gdsn-head">
        <div>
          <span class="gdsn-badge">gdsnview</span>
          <h3>GDSN GS1</h3>
          <p>A global system that allows companies to share standardized product data (like product descriptions, barcodes, dimensions, ingredients, etc.) with their trading partners (retailers, distributors, marketplaces).</p>
        </div>
        <button type="button" class="gdsn-close-x" data-action="gdsn-close">✕</button>
      </div>

      <div class="gdsn-group">
        <div class="gdsn-row"><label>cfpCountryCode</label><div class="control">${buildSelect('gdsn-country', GDSN_COUNTRIES.map(c=>c.code), {value:gdsnData.countryCode})}</div></div>
        <div class="gdsn-row"><label>cfpDate</label><div class="control"><div class="date-field">${CALENDAR_ICON_SVG}<input type="date" id="gdsn-date" value="${gdsnData.date}" oninput="onGDSNChange('date',this)"></div></div></div>
        <div class="gdsn-row"><label>cfpValueVerificationCode</label><div class="control">${buildSelect('gdsn-verification', Object.keys(GDSN_VERIFICATION_DESC), {value:gdsnData.verificationCode, descriptions:GDSN_VERIFICATION_DESC})}</div></div>
      </div>

      <div class="gdsn-group">
        <div class="gdsn-row"><label>cfpBoundariesCode</label><div class="control">${buildSelect('gdsn-boundaries', Object.keys(GDSN_BOUNDARIES_DESC), {value:gdsnData.boundariesCode, descriptions:GDSN_BOUNDARIES_DESC})}</div></div>
        <div class="gdsn-row"><label>cfpValue</label><div class="control"><input type="text" id="gdsn-value" class="is-computed" readonly value="${cfpValue}"></div></div>
        <div class="gdsn-row"><label>cfpValueUom</label><div class="control">${buildSelect('gdsn-uom', Object.keys(GDSN_UOM_DESC), {value:gdsnData.valueUom, descriptions:GDSN_UOM_DESC})}</div></div>
        <div class="gdsn-row"><label>cfpFunctionalUnit</label><div class="control"><input type="text" id="gdsn-functional-unit" value="${gdsnData.functionalUnit}" placeholder="e.g. 1 kg finished product" oninput="onGDSNChange('functionalUnit',this)"></div></div>
        <div class="gdsn-row"><label>cfpMethodologyCode</label><div class="control">${buildSelect('gdsn-methodology', Object.keys(GDSN_METHODOLOGY_DESC), {value:gdsnData.methodologyCode, descriptions:GDSN_METHODOLOGY_DESC})}</div></div>
        <div class="gdsn-row"><label>cfpAccountingCode</label><div class="control">${buildSelect('gdsn-accounting', Object.keys(GDSN_ACCOUNTING_DESC), {value:gdsnData.accountingCode, descriptions:GDSN_ACCOUNTING_DESC})}</div></div>
      </div>

      <div class="gdsn-footer">
        <button type="button" class="btn btn-primary" style="padding:12px 44px;" data-action="gdsn-close">Close</button>
      </div>
    </div>
  </div>`;
}

const CTE_DATA = {

  harvesting: {
    title:'Harvesting',
    desc:'Emissions generated during the raw material harvesting phase, primarily originating from vessel operations involved in the capture process.',
    instanceBase:'Harvesting',
    fields:[
      F('Vessel Name','SHILLA EXPLORER'),
      F('Unique Vessel Identification','9699567'),
      F('Date(s) of Capture','Apr 1, 2023 – Apr 5, 2023','daterange'),
      F('Gear type','Purse Seine','select',{options:['Purse Seine','Longline','Trawl','Gillnet']}),
      F('Linking KDE (batch, lot or serial number)','MI9094-FS-19090-FC-MMP-1S'),
      F('FAO Area','71/77'),
      F('Event Date & Time','Nov 21, 2025  12:00 AM','datetime'),
      F('Species','Multiple*'),
      F('Satellite Vessel Tracking Authority','FIMS/PNA'),
      F('Linking KDE','MI9094'),
      F('Item / SKU / UPC / GTIN','','text',{placeholder:'–'}),
      F('Product Form','Fresh Whole Round','select',{options:['Fresh Whole Round','Frozen Whole Round','Fresh Loins','Frozen Loins','Canned']}),
      F('Vessel Registration','1808002-6261106'),
      F('Product Ownership','FCF Co. Ltd'),
      F('Production Method','','text',{placeholder:'–'}),
      F('Public Vessel Registry Hyperlink','https://vessels.wcpfc.int/vessel/11163','url'),
      F('Vessel Flag','Republic of Korea','select',{options:COUNTRIES}),
      F('Fishery Improvement Project','Yes/No','select',{options:['Yes','No']}),
      F('Fishing Authorization','2023-02'),
      F('Harvest Certification','MSC'),
      F('Event ID','','text',{placeholder:'–'}),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
    ],
    emissionHead:'Emission details',
    emissionFields:[
      F('Weight or Quantity',{value:'663.00',unit:'mt'},'weightUnit',{required:true, id:'hv-weight-input'}),
      F('Availability of Catch Coordinates','Yes','select',{options:['Yes','No']}),
      F('Fuel Type','Marine Diesel Oil (MDO)','select',{options:[
        'Marine Diesel Oil (MDO)','Heavy Fuel Oil (HFO)','Very Low Sulphur Fuel Oil (VLSFO)','Liquefied Natural Gas (LNG)','Marine Gas Oil (MGO)'
      ]}),
      F('Fuel Consumption','368.00','number',{
        unit:'Ltr', id:'hv-fuel-consumption', oninput:'recalcHarvesting()',
        tip:{
          text:'368L is a constant value. Using purse seine gear, vessels were found to burn, on average, 368 litres of fuel per live-weight tonne of landing.',
          link:'https://www.iss-foundation.org/about-issf/what-we-publish/issf-documents/issf-technical-report-2012-03-fuel-consumption-and-greenhouse-gas-emissions-from-global-tuna-fisheries-a-preliminary-assessment/'
        }
      }),
      F('Total Fuel (L to KG)','207,386.40','number',{
        unit:'kg', id:'hv-total-fuel', readonly:true,
        tip:{ text:'Weight or Quantity × Fuel Consumption × PS Fuel Conversion (0.85). 0.85 kg/L is the density of diesel used for the conversion.' }
      }),
      F('Select the scope level','Scope III','select',{options:SCOPE_OPTS,required:true}),
    ],
    metrics:[
      {v:'627,551.25 kg CO₂e', l:'Total Emission', id:'hv-metric-total', tip:{text:'Total Fuel (L to KG) × PS Emission Factor (3.026). 3.026 is a constant.', link:'https://www.researchgate.net/figure/Conversion-factor-between-fuel-consumption-and-CO2-emission-MEPC-2018_tbl7_347794254'}},
      {v:'0.95 kg CO₂e', l:'Emission per 1KG', id:'hv-metric-perkg', tip:{text:'Total Emission ÷ (Weight or Quantity × 1000). The ×1000 only applies when Weight is in MT — if Weight is already in KG, no conversion is needed.'}},
    ],
    checkbox:'Multiple Harvesting Present'
  },

  onVesselProcessing:{
    title:'On Vessel Processing',
    desc:'Emissions produced within the fishing vessel during onboard processing activities, including any stage where the catch undergoes transformation.',
    headerToggle:'Enable',
    fields:[
      F('Event Date & Time','Nov 21, 2025  12:00 AM','datetime'),
      F('Chain of Custody Certification','MI9094'),
      F('Item/SKU/UPC/GTIN','','text',{placeholder:'–'}),
      F('Species','Multiple*'),
      F('Linking KDE (batch, lot or serial number)','MI9094-FS-19090-FC-MMP-1S'),
      F('Select the scope level','Scope III','select',{options:SCOPE_OPTS}),
      F('Vessel Name','SHILLA EXPLORER'),
      F('Product Ownership','FCF Co. Ltd'),
      F('Fuel Type','Marine Diesel Oil (MDO)','select',{options:[
        'Marine Diesel Oil (MDO)','Heavy Fuel Oil (HFO)','Very Low Sulphur Fuel Oil (VLSFO)','Liquefied Natural Gas (LNG)','Marine Gas Oil (MGO)'
      ]}),
      F('Public Vessel Registry Hyperlink','https://vessels.wcpfc.int/vessel/11163','url'),
      F('Unique Vessel ID (IMO)','9699567'),
      F('Vessel Flag','Republic of Korea','select',{options:COUNTRIES}),
      F('Product Form','Frozen Whole Round','select',{options:['Frozen Whole Round','Fresh Whole Round','Frozen Loins','Fresh Loins','Canned']}),
      F('Processing Type',['Brine Freezing'],'tags',{options:['Brine Freezing','Air Blast Freezing','Plate Freezing','CO2 Refrigeration','Ice Storage','Chilled Seawater (RSW)','Super-Chilling']}),
      F('Product Origin','','text',{placeholder:'–'}),
      F('Expiry/ Production date','Aug 7, 2026','date'),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Event ID','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
    ],
    // Refrigerant GWP-style constants used by the Refrigeration Energy row's
    // "of" dropdown. R717/NACL/Not Available are zero-rated per the note:
    // ammonia and salt refrigerant systems carry no CO2e for this line.
    refrigerants:[
      {label:'R717 (NH3)', gwp:0},
      {label:'NACL', gwp:0},
      {label:'Not Available', gwp:0},
      {label:'R12', gwp:10900},
      {label:'R22', gwp:1810},
      {label:'R404A', gwp:3900},
      {label:'R407C', gwp:1770},
      {label:'R410A', gwp:1900},
      {label:'R513A', gwp:630},
    ],
    metrics:[
      {v:'63,648.00 kg CO₂e', l:'Total Emissions', id:'ovp-metric-total', readonly:true,
        tip:{text:'Refrigeration + Water + Waste Water + Fuel Consumption emissions. Electricity Consumption emission is deliberately excluded — fuel is used to generate the vessel\u2019s electricity, so that emission is already embedded in Fuel Consumption. Adding both would double-count it.'}},
      {v:'0.10 kg CO₂e', l:'Emissions per 1KG', id:'ovp-metric-perkg', readonly:true,
        tip:{text:'Total Emissions ÷ (Yield of Weight or Quantity × 1000). The ×1000 applies because the weight is in MT — if it were already in KG, no conversion is needed.'}},
    ],
  },

  transshipment:{
    title:'Transshipment',
    desc:'Emissions generated by secondary transport vessels responsible for carrying raw materials from the primary harvesting vessel. This primarily includes dedicated reefer carriers or container ships operating from the point of transshipment to the final destination.',
    instanceBase:'Transshipment',
    fields:[
      F('Event Date & Time','Dec 16, 2025  12:00 AM','datetime'),
      F('Date(s) of Transshipment','Dec 16, 2025 – Dec 18, 2025','daterange'),
      F('Select the scope level','Scope III','select',{options:SCOPE_OPTS,required:true}),
      F('Fuel Type','Marine Diesel Oil (MDO)','select',{options:[
        'Marine Diesel Oil (MDO)','Heavy Fuel Oil (HFO)','Very Low Sulphur Fuel Oil (VLSFO)','Liquefied Natural Gas (LNG)','Marine Gas Oil (MGO)'
      ]}),
      F('Linking KDE (batch, lot or serial no...)','MI9094-FS-19090-FC-MMP-'),
      F('Chain of Custody Certification','MI9090'),
      F('Transshipment Location','Port','select',{options:['Port','At Sea']}),
      F('Transshipment Vessel Registration','','text',{placeholder:'–'}),
      F('Species','Multiple*'),
      F('Item/SKU/UPC/GTIN','','text',{placeholder:'–'}),
      F('Port','Select an option','select',{options:PORTS}),
      F('Transshipment Vessel Flag','Republic of Korea','select',{options:COUNTRIES}),
      F('Transshipment Vessel Name','ANGARA','text',{required:true}),
      F('Fuel Consumption','0.00','number',{unit:'Ltr'}),
      F('Location (GLN)','','text',{placeholder:'–'}),
      F('Transshipment Authorization','','text',{placeholder:'–'}),
      F('Transshipment Vessel Unique Vessel ID (IMO)','9136890','text',{required:true}),
      F('Product Form','Frozen Whole Round','select',{options:['Frozen Whole Round','Fresh Whole Round','Frozen Loins','Fresh Loins','Canned']}),
      F('Product Ownership','FCF Co. Ltd'),
      F('Event ID','','text',{placeholder:'–'}),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
    ],
    gwOptions:['20.4','30','34','41'],
    metrics:[
      {v:'0.00 kg CO₂e', l:'Emissions', id:'ts-metric-total', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions per 1KG', id:'ts-metric-perkg', readonly:true},
    ],
    checkbox:'Multiple Transshipment Present',
  },

  landing:{
    title:'Landing',
    desc:'Emissions generated during the landing phase, particularly from road transport operations where trucks collect raw materials from reefer or container carriers and deliver them to the final destination.',
    headerToggle:'Direct Landing',
    instanceBase:'Landing',
    checkbox:'Multiple Landing Present',
    fields:[
      F('Event Date & Time','Nov 21, 2025  12:00 AM','datetime'),
      F('Dates of Landing','Aug 5, 2026 – Aug 7, 2026','daterange'),
      F('Item/SKU/UPC/GTIN','','text',{placeholder:'–'}),
      F('Species','Multiple*'),
      F('Select the scope level','Scope III','select',{options:SCOPE_OPTS,required:true}),
      F('Landing Authorization','','text',{placeholder:'–'}),
      F('Transport Mode','Truck','select',{options:['Truck','Rail','Sea'],required:true}),
      F('Fuel Consumption','0.00','number',{unit:'Ltr'}),
      F('Fuel Type','Diesel','select',{options:['Diesel','Petrol','Compressed Natural Gas (CNG)','Biodiesel (B7)','Electric']}),
      F('Product Form','Frozen Whole Round','select',{options:['Frozen Whole Round','Fresh Whole Round','Frozen Loins','Fresh Loins','Canned']}),
      F('Product Ownership','MMP International Ltd'),
      F('Linking KDE (batch, lot or serial number)','M19094-FS-19090-FC-MMP-1S'),
      F('Water Usage','0.00','number',{unit:'Ltr'}),
      F('Electricity Consumption','0.00','number',{unit:'kwh'}),
      F('Location (GLN)','','text',{placeholder:'–'}),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Landing Location','','text',{placeholder:'–'}),
      F('Event ID','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
    ],
    metrics:[
      {v:'0.00 kg CO₂e', l:'Emissions', id:'ld-metric-total', readonly:true,
        tip:{text:'Weight or Quantity (kg) × Distance to Facility (km) × 0.0000542 kg CO₂e/kg·km.', link:'https://www.climatiq.io/data/explorer?search=refrigerated+truck&data_version=%5E32&page=1'}},
      {v:'0.00 kg CO₂e', l:'Emissions of 1KG', id:'ld-metric-perkg', readonly:true,
        tip:{text:'Emissions ÷ Weight or Quantity (kg).'}},
    ],
  },

  aggrDisaggr:{
    title:'Aggregation/ Disaggregation',
    desc:'Emissions occurring during the aggregation and disaggregation of raw materials or products, primarily within cold storage facilities, warehouses, and distribution centers.',
    instanceBase:'Receiver',
    headerToggle:'Direct Landing',
    fields:[
      F('Event Date & Time','Jan 22, 2026  12:00 AM','datetime'),
      F('Chain of Custody Certification','Centre(s) CoC No.'),
      F('Item/SKU/UPC/GTIN','','text',{placeholder:'–'}),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Select the scope level','Scope III','select',{options:SCOPE_OPTS,required:true}),
      F('Linking KDE (batch, lot or serial nu...)','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
      F('Product Form','Frozen Whole Round','select',{options:['Frozen Whole Round','Fresh Whole Round','Frozen Loins','Fresh Loins','Canned']}),
      F('Product Ownership','MMP International Co. Ltd'),
      F('Fuel Consumption','0.00','number',{tip:{text:'Fuel consumption refers to the amount of fuel used by equipment or machinery during product handling, storage, or movement at the facility.'}}),
      F('Fuel Type','Diesel','select',{options:['Diesel','Petrol','Compressed Natural Gas (CNG)','Biodiesel (B7)','Electric']}),
      F('Location (GLN)','','text',{placeholder:'–'}),
      F('Sorting Facility','COLD STORAGE NAME(S)'),
      F('Event ID','','text',{placeholder:'–'}),
    ],
    refrigerants:[
      {label:'R-134a', gwp:1430},
      {label:'R-404A', gwp:3922},
      {label:'R-410A', gwp:2088},
      {label:'R-407C', gwp:1774},
      {label:'R-22', gwp:1810},
    ],
    metrics:[
      {v:'0.00 kg CO₂e', l:'Emissions (TTL)', id:'aggr-metric-ttl', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions of 1KG (TTL)', id:'aggr-metric-ttl-perkg', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions (DRI Species)', id:'aggr-metric-dri', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions of 1KG (DRI Species)', id:'aggr-metric-dri-perkg', readonly:true},
    ],
    checkbox:'Multiple Receiver'
  },

  processing:{
    title:'Processing',
    subtabs:['Transformation','Storage'],
    transformation:{
      desc:'Emissions generated at the processing plant during the conversion of raw materials into finished or semi-finished products. This includes energy consumption from machinery and equipment, thermal processes such as heating, cooling, and freezing, fuel for onsite operations, and indirect emissions from electricity usage.',
      instanceBase:'Transformation',
      fields:[
        F('Event Date and Time','Aug 7, 2026   2:49 PM','datetime'),
        F('Event ID','','text',{placeholder:'–'}),
        F('Product Form','Canned Tuna','select',{options:['Canned Tuna','Frozen Loin','Fresh Loin','Pouch','Frozen Whole Round']}),
        F('Chain of Custody Certification','MSC-C-52839'),
        F('Item / SKU / UPC / GTIN','(ST Product-GTIN)'),
        F('Product Ownership','MMP International Ltd'),
        F('Species','Skipjack'),
        F('Linking KDE (batch, lot or serial number)','(DTI/DTPP/Transaction/GTIN)'),
        F('Product Origin','(Country of origin)'),
        F('Location (GLN)','(GLN of MMP)'),
        F('Select the Scope Level','Mixed','select',{options:SCOPE_OPTS,required:true}),
        F('Event read point (geo location)','','text',{placeholder:'–'}),
        F('Information provider','','text',{placeholder:'–'}),
      ],
      factorsHead:'Emission Factors & Values',
      factorFields:[
        F('Electricity Consumption','0.084406','number',{unit:'Kg Co2e', id:'tf-electricity', oninput:'recalcTransform()'}),
        F('Purchased Raw Material and Services','2.953912','number',{unit:'Kg Co2e', id:'tf-purchased', oninput:'recalcTransform()'}),
        F('Ingredients','0.000000','number',{unit:'Kg Co2e', id:'tf-ingredients', oninput:'recalcTransform()'}),
        F('Equipment & Machinery','0.000000','number',{unit:'Kg Co2e', id:'tf-equipment', oninput:'recalcTransform()'}),
        F('Water Usage','0.001139','number',{unit:'Kg Co2e', id:'tf-water', oninput:'recalcTransform()'}),
        F('Waste Disposal','0.000008','number',{unit:'Kg Co2e', id:'tf-waste', oninput:'recalcTransform()'}),
        F('On-Site Fuel Combustion','0.353564','number',{unit:'Kg Co2e', id:'tf-onsite', oninput:'recalcTransform()'}),
        F('Fuel Consumption','0.005917','number',{unit:'Kg Co2e', id:'tf-fuel', oninput:'recalcTransform()'}),
        F('Upstream Energy','0.055552','number',{unit:'Kg Co2e', id:'tf-upstream', oninput:'recalcTransform()'}),
      ],
      tagFields:[
        F('Stationary Fuel Combustion Type',['Natural Gas','Liquefied Petroleum Gas (LPG)','Fuel Oil (Light / Heavy)'],'tags',{options:['Natural Gas','Liquefied Petroleum Gas (LPG)','Fuel Oil (Light / Heavy)','Coal','Biomass (wood, pellets, agricultural residues)','Biogas','Kerosene']}),
        F('Combustion Fuel Type',['Diesel B7'],'tags',{options:['Diesel B7','Diesel B10','Gasohol 91/95','Gasohol E20','LPG','NGV']}),
        F('Leased assets','0.000436','number',{unit:'Kg Co2e', id:'tf-leased', oninput:'recalcTransform()'}),
        F('Fugitive Emission','0.010900','number',{unit:'Kg Co2e', id:'tf-fugitive', oninput:'recalcTransform()'}),
      ],
      metrics:[
        {v:'0.00 kg CO₂e', l:'Emissions', id:'tf-metric-total', readonly:true},
        {v:'0.00 kg CO₂e', l:'Emissions of 1KG', id:'tf-metric-perkg', readonly:true},
        {v:'0.00 kg CO₂e', l:'Yield Emission', id:'tf-metric-yield', readonly:true},
        {v:'0.00 kg CO₂e', l:'Other Product Emission', id:'tf-metric-other', readonly:true},
      ],
      checkbox:'Multiple Transformation Present'
    },
    storage:{
      desc:'Emissions generated during the storage of finished or semi-finished products, whether at the processor’s own facilities or at dedicated third-party storage locations. This includes energy consumption for refrigeration, freezing, climate control, and lighting.',
      instanceBase:'Storage',
      fields:[
        F('Facility ID','(where the FG is stored : ID)'),
        F('Facility name','(where the FG is stored)'),
        F('Select the Scope Level','Scope III','select',{options:SCOPE_OPTS,required:true}),
        F('Storage Type','Ambient Storage','select',{options:['Ambient Storage','Cold Storage','Frozen Storage']}),
        F('Storage Start/End Date','Start date – End date','daterange'),
        F('Lot ID','(Production code or Product code)'),
        F('Storage duration','0','number'),
        F('type','Days','select',{options:['Days','Months','Years']}),
      ],
      electricityConstants:[['Electricity usage per kg','0.159'],['EF of Electricity','0.4999']],
      refrigerantConstants:[['Average Refrigerant emission (per kg)','0.00007'],['GWP','3,922']],
      metrics:[
        {v:'0.00 kg CO₂e', l:'Emission TTL', id:'st-metric-total', readonly:true},
        {v:'0.00 kg CO₂e', l:'Emission of 1KG', id:'st-metric-perkg', readonly:true},
      ],
      checkbox:'Multiple Storage Present'
    }
  },

  packaging:{
    title:'Packaging',
    subtabs:['Packaging Emission','Circularity'],
    scope:'Scope 3',
    productInfo:{
      facility:'AT Seafood Global Limited',
      lotCode:'MIN56KCCDC3ZFI',
      gtin:'9123658622044',
      product:'Canned Tuna in Olive Oil', // TODO: fetch from Product module
    },
    circularity:{
      cols:['Can','Food-grade','Printed Carton','Carton','Shrink Wrap','Pallet'],
      rows:[
        {label:'Packaging GTIN', span:'(ST Product-GTIN)'},
        {label:'Packaging material element', vals:['Can','Food-grade','Printed Carton','Carton','Shrink Wrap','Pallet']},
        {label:'Packaging material quantity', vals:['28','0.08','0.25','27.08','1','8.68']},
        {label:'Recycled Content (%)', vals:['30%','0%','10%','80%','35%','50%']},
        {label:'Recycling rate (%)', vals:['85%','5%','30%','85%','20%','95%']},
        {label:'Circular Input', vals:['8.4','0','0.03','21.67','0.35','4.34']},
        {label:'Recoverable materials', vals:['23.8','0.004','0.08','23.02','0.2','8.25']},
        {label:'Input Circularity (%)', span:'53%'},
        {label:'Output Circularity (%)', span:'85%'},
        {label:'Virgin material Input (kg)', span:'30.30'},
        {label:'Unrecoverable material', span:'9.74'},
        {label:'Linear Flow Index (LFI)', span:'0.31'},
        {label:'Material Circularity Indicator (MCI)', span:'0.69'},
      ]
    }
  },

  shipReceive:{
    title:'Logistics',
    desc:'Emissions generated during the shipping stage, when products are exported or transported to their final destination. This includes fuel consumption from ocean freight, air cargo, or multimodal transport, as well as emissions from refrigeration and associated logistics operations.',
    commonFields:[
      F('Select the Scope Level','Scope III','select',{options:SCOPE_OPTS,required:true}),
      F('Fuel Consumption','0.00','number',{unit:'Ltr'}),
      F('Fuel Type','Select an option','select',{options:['Marine Diesel Oil (MDO)','Heavy Fuel Oil (HFO)','Very Low Sulphur Fuel Oil (VLSFO)','Jet Fuel (Jet A-1)','Sustainable Aviation Fuel (SAF)']}),
      F('Transaction No. (s)','34564mmp'),
      F('Storage duration','0','number'),
      F('Type','Days','select',{options:['Days','Months','Years']}),
      F('Item / SKU / UPC / GTIN','','text',{placeholder:'–'}),
      F('Species','','text',{placeholder:'–'}),
      F('Product Form','','text',{placeholder:'–'}),
      F('Event ID','','text',{placeholder:'–'}),
      F('Event read point (geo location)','','text',{placeholder:'–'}),
      F('Event date, time & time zone','Aug 7, 2026  2:49 PM','datetime'),
      F('Product Ownership','','text',{placeholder:'–'}),
      F('Information provider','','text',{placeholder:'–'}),
    ],
    seaFields:[
      F('Vessel Name','OOCL YOKOHAMA'),
      F('Vessel Unique Vessel ID (IMO)','(IMO of the vessel)'),
      F('Linking KDE (batch, lot or serial number)','','text',{placeholder:'–'}),
    ],
    airFields:[
      F('Air Carrier Name','AIR CARGO'),
    ],
    innerRow:{inner:'24', gross:'95', drain:'62'},
    metricsSea:[
      {v:'0.00 kg CO₂e', l:'Emissions of Vessel (s)', id:'sr-metric-sea-total', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions of 1 KG in Vessel (s)', id:'sr-metric-sea-perkg', readonly:true},
    ],
    metricsAir:[
      {v:'0.00 kg CO₂e', l:'Emissions of Aircraft (s)', id:'sr-metric-air-total', readonly:true},
      {v:'0.00 kg CO₂e', l:'Emissions of 1 KG in Aircraft (s)', id:'sr-metric-air-perkg', readonly:true},
    ],
  }
};

const TAB_ICONS = {
  harvesting: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12C3 12 7 6 13 6C17 6 21 9 21 9C21 9 17 12 21 15C21 15 17 18 13 18C7 18 3 12 3 12Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 10.5C7 10.5 8 12 7 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  onVesselProcessing: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="6" r="1.8" stroke="currentColor" stroke-width="1.6"/><path d="M12 8V14M12 14C12 14 6 14.5 6 19M12 14C12 14 18 14.5 18 19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 14H8M16 14H20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  transshipment: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 9H16M16 9L13 6M16 9L13 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 15H8M8 15L11 12M8 15L11 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  landing: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="5" r="1.6" stroke="currentColor" stroke-width="1.6"/><path d="M12 7V19M6 12H4C4 15.5 7 18 12 19C17 18 20 15.5 20 12H18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  aggrDisaggr: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3L21 8.5L12 14L3 8.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 15.5L12 21L21 15.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  processing: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 3V5.5M12 18.5V21M21 12H18.5M5.5 12H3M18.4 5.6L16.6 7.4M7.4 16.6L5.6 18.4M18.4 18.4L16.6 16.6M7.4 7.4L5.6 5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  packaging: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 8L12 12M12 12L20 8M12 12V20" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  shipReceive: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 16V7H14V16" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 10H18L21 13V16H14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.6" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="18" r="1.6" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

const TABS = [
  {id:'harvesting', label:'Harvesting'},
  {id:'onVesselProcessing', label:'On Vessel Processing'},
  {id:'transshipment', label:'Transshipment'},
  {id:'landing', label:'Landing'},
  {id:'aggrDisaggr', label:'Aggr/Disaggr'},
  {id:'processing', label:'Processing'},
  {id:'packaging', label:'Packaging'},
  {id:'shipReceive', label:'Ship/Receive'},
];

/* ---------- GHG SCOPE CLASSIFICATION (for the Report pages) ----------
   Splits each CTE's live per-kg contribution into Scope I (direct/owned
   operations), Scope II (purchased energy), and Scope III (everything
   else in the value chain — third-party transport, purchased materials,
   purchased water). These are illustrative proportional assumptions,
   NOT a rigorous re-derivation of every sub-factor in every formula —
   flagged clearly since this report presents itself as "illustrative
   estimates" throughout, same framing as the reference design. */
const SCOPE_SPLIT = {
  harvesting:     {s1:1.00, s2:0.00, s3:0.00, note:'Vessel fuel combustion — owned/controlled operations.'},
  ovp:            {s1:0.70, s2:0.00, s3:0.30, note:'Refrigerant + onboard fuel (direct); water/wastewater treated as a purchased service.'},
  transshipment:  {s1:0.00, s2:0.00, s3:1.00, note:'Third-party reefer carrier transport.'},
  landing:        {s1:0.00, s2:0.00, s3:1.00, note:'Hired trucking/logistics.'},
  aggrDisaggr:    {s1:0.15, s2:0.55, s3:0.30, note:'Refrigerant leakage (direct), purchased electricity, purchased water supply.'},
  transformation: {s1:0.12, s2:0.03, s3:0.85, note:'On-site fuel + fugitive emissions (direct), purchased electricity, purchased materials/packaging inputs/waste/upstream energy/leased assets.'},
  storage:        {s1:0.00, s2:1.00, s3:0.00, note:'Purchased electricity; enabling refrigeration shifts a portion to direct emissions.'},
  packaging:      {s1:0.00, s2:0.00, s3:1.00, note:'Purchased packaging materials.'},
  shipReceive:    {s1:0.00, s2:0.00, s3:1.00, note:'Third-party sea/air freight.'},
};

// Packaging isn't part of grandTotalParts (excluded from the running total
// per earlier instruction not to wire it into the DB/overall figure yet),
// but it does have a real, live-computed total via its own interactive
// table — pulled here just for this report, not for the topbar total.
// Comprehensive option lists derived from the rules engine, so the
// Type/Material dropdowns offer every known value across all product
// types (not just the current one) — needed since overriding a slot
// might mean picking a type that belongs to a different product type's
// rules than the one currently selected.
function pkgFactorForType(typeName){
  for(const rules of Object.values(PACKAGING_RULES)){
    const hit = [...rules.primary, ...rules.secondary, ...rules.tertiary].find(e=>e.type===typeName);
    if(hit) return hit.factor;
  }
  return 0;
}

// Per-slot overrides — null means "use the rules-engine default for this
// slot"; an object means the user has typed/selected something for that
// specific cell. Padded to 3 slots per layer to match the grid's fixed
// 3-row-per-column layout. Reset whenever Product Type changes (a fresh
// product type should start from its own clean defaults).
const packagingOverrides = {
  primary: [null,null,null], secondary: [null,null,null], tertiary: [null,null,null],
  _lastProductType: null,
};

function computePackagingBreakdown(){
  const rules = PACKAGING_RULES[packagingContext.productType] || PACKAGING_RULES['Can'];
  const ctx = packagingCtx();
  const layer = (entries, overrides) => [0,1,2].map(slotIdx=>{
    const rule = entries[slotIdx];
    const ov = overrides[slotIdx];
    const defaultType = rule ? rule.type : 'Not Applicable';
    const defaultMaterial = rule ? rule.material : 'Not Applicable';
    const defaultQty = rule ? (rule.qty(ctx) || 0) : 0;
    const type = ov?.type ?? defaultType;
    const material = ov?.material ?? defaultMaterial;
    const qty = (ov?.qty !== undefined && ov?.qty !== null) ? ov.qty : defaultQty;
    const factor = pkgFactorForType(type);
    // Emission = Quantity x Factor directly — NO /1000 conversion.
    // Confirmed against 6 independent values in the authoritative
    // reference table (Can: 37x2.85=105.45, Carton: 54.17x0.80=43.33,
    // Wooden Pallet: 17.36x5.00=86.81, Shrink wrap: 0.10x3.14=0.31,
    // Printed labels: 0.48x1.56=0.75, Lacquer: 0.08x0.19=0.02 — every
    // one matches exactly with no division). An earlier /1000 "fix" was
    // correct for the OLD free-form grid's different illustrative
    // factors, but was carried over incorrectly into this rules engine.
    const emission = qty * factor;
    return { type, material, factor, qty, emission };
  });
  const primary = layer(rules.primary, packagingOverrides.primary);
  const secondary = layer(rules.secondary, packagingOverrides.secondary);
  const tertiary = layer(rules.tertiary, packagingOverrides.tertiary);
  const total = [...primary, ...secondary, ...tertiary].reduce((a,r)=>a+r.emission, 0);
  return { primary, secondary, tertiary, total };
}

function packagingLiveTotal(){
  return computePackagingBreakdown().total;
}

function weightedSplit(...parts){
  // parts: [[value, splitObj], ...] -> combined {s1,s2,s3} weighted by value
  const total = parts.reduce((a,[v])=>a+v, 0);
  if(total<=0) return {s1:0,s2:0,s3:1};
  return {
    s1: parts.reduce((a,[v,sp])=>a+v*sp.s1,0)/total,
    s2: parts.reduce((a,[v,sp])=>a+v*sp.s2,0)/total,
    s3: parts.reduce((a,[v,sp])=>a+v*sp.s3,0)/total,
  };
}

const REPORT_STAGES = [
  {key:'harvesting', label:'Harvesting'},
  {key:'onVesselProcessing', label:'On Vessel Processing'},
  {key:'transshipment', label:'Transshipment'},
  {key:'landing', label:'Landing'},
  {key:'aggrDisaggr', label:'Aggr/Disaggr'},
  {key:'processing', label:'Processing'},
  {key:'packaging', label:'Packaging'},
  {key:'shipReceive', label:'Ship/Receive'},
];

function computeScopeReport(){
  const stageValues = {
    harvesting: grandTotalParts.harvesting,
    onVesselProcessing: grandTotalParts.ovp,
    transshipment: grandTotalParts.transshipment,
    landing: grandTotalParts.landing,
    aggrDisaggr: grandTotalParts.aggrDisaggr,
    processing: grandTotalParts.transformation + grandTotalParts.storage,
    packaging: packagingLiveTotal(),
    shipReceive: grandTotalParts.shipReceive,
  };
  const stageSplit = {
    harvesting: SCOPE_SPLIT.harvesting,
    onVesselProcessing: SCOPE_SPLIT.ovp,
    transshipment: SCOPE_SPLIT.transshipment,
    landing: SCOPE_SPLIT.landing,
    aggrDisaggr: SCOPE_SPLIT.aggrDisaggr,
    processing: weightedSplit([grandTotalParts.transformation, SCOPE_SPLIT.transformation], [grandTotalParts.storage, SCOPE_SPLIT.storage]),
    packaging: SCOPE_SPLIT.packaging,
    shipReceive: SCOPE_SPLIT.shipReceive,
  };
  let s1=0, s2=0, s3=0;
  const perStage = {};
  REPORT_STAGES.forEach(({key})=>{
    const val = stageValues[key] || 0;
    const split = stageSplit[key];
    const v1 = val*split.s1, v2 = val*split.s2, v3 = val*split.s3;
    perStage[key] = { total:val, s1:v1, s2:v2, s3:v3 };
    // Packaging is shown as a stage (matching the reference design) but
    // deliberately excluded from the summed total — it isn't part of
    // grandTotalParts / the calculator's own running total either, per
    // the earlier "don't wire Packaging into the total yet" instruction.
    // Excluding it here keeps this report's total exactly matching the
    // calculator's own displayed total.
    if(key !== 'packaging'){ s1+=v1; s2+=v2; s3+=v3; }
  });
  const total = s1+s2+s3;
  return { s1, s2, s3, total, perStage };
}

function renderEmissionBadge(staticValue){
  const valueHTML = staticValue !== undefined
    ? staticValue
    : `<span id="grand-total-perkg">0.00</span>`;
  return `
    <div class="pm-emission-badge">
      <div class="peb-section">
        <div class="peb-icon peb-icon-green">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 20C6 20 4 14 8 9C11 5.5 17 5 17 5C17 5 17.5 11 14 15C11 18.5 6 20 6 20Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.5 18.5C9.5 15.5 11.5 12.5 15 7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </div>
        <div class="peb-text">
          <div class="peb-label">Total Carbon Footprint</div>
          <div class="peb-value">${valueHTML}<span class="peb-unit">kgCO₂e</span></div>
        </div>
      </div>
      <div class="peb-divider"></div>
      <div class="peb-section">
        <div class="peb-icon peb-icon-blue">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4V2M17.66 6.34L19.07 4.93M4.93 19.07L6.34 17.66M20 12H22M2 12H4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 10.4 19.53 8.91 18.72 7.66" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17 3.3L18.1 7.1L14.3 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="peb-text">
          <div class="peb-label">Basis</div>
          <div class="peb-basis">1 KG Tuna in Final Product</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------- APP STATE ---------- */
/* ---------- TOP-BAR GRAND TOTAL (per-kg, summed across CTEs) ----------
   7 CTEs contribute: Harvesting, On Vessel Processing, Transshipment,
   Landing, Aggregation/Disaggregation, Processing (Transformation +
   Storage combined into one "Processing" figure), and Ship/Receive.
   Packaging isn't included yet — it has no live formula built for it.
   Ship/Receive contributes from whichever of Sea/Air is the active pill;
   Transshipment contributes from whichever RCS state is active — both
   already resolve to a single stored number, no extra logic needed here.
   NOTE: a tab that has never been opened hasn't run its recalc yet, so
   its contribution stays 0 until visited at least once — the total will
   read low on a fresh page load until every tab's been clicked through. */
const grandTotalParts = {
  harvesting:0.9465328, ovp:0.096, transshipment:0.099256, landing:0.0026016,
  aggrDisaggr:0.8950241, transformation:3.4658340, storage:0.0794841, shipReceive:0.2716385,
};
function updateGrandTotal(){
  const sum = Object.values(grandTotalParts).reduce((a,b)=>a+b, 0);
  const el = document.getElementById('grand-total-perkg');
  if(el) el.textContent = fmtNum(sum, 2);
}

/* ---------- SUBMIT-TO-CONFIRM + DATABASE SAVE ----------
   Clicking "Submit" on a CTE is a mini-confirm: it captures a snapshot
   of that CTE's current values (reading live DOM for whichever
   instance is on-screen, falling back to stored state for any other
   instance of the same CTE) and marks it confirmed. The Overview page
   only lets you Save once every CTE is confirmed; Save writes all the
   captured snapshots to Supabase in one pass.
   KNOWN LIMITATION: a few "constant/factor" fields (e.g. Harvesting's
   Fuel Consumption, OVP's emission-factor inputs, Transformation's 11
   factors, Aggr/Disaggr's and Storage's constants) only ever live in
   the DOM while their tab is open — editing one, switching away
   without hitting Submit, then coming back resets it to its last
   confirmed/default value. This predates this feature; Submit-to-
   confirm sidesteps it for the common flow (edit → Submit before
   leaving) but doesn't fully solve it. Flagging rather than hiding it. */
const confirmedData = { harvesting:null, ovp:null, transshipment:null, landing:null, aggrDisaggr:null, transformation:null, storage:null, shipReceive:null };
const CONFIRM_LABELS = {
  harvesting:'Harvesting', ovp:'On Vessel Processing', transshipment:'Transshipment', landing:'Landing',
  aggrDisaggr:'Aggregation/Disaggregation', transformation:'Transformation', storage:'Storage', shipReceive:'Ship/Receive',
};

function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n){ return Math.round((n + Number.EPSILON) * 10000) / 10000; }

// Flattens a fields array (main/emission/etc.) into a plain {label: value}
// object for the raw_fields JSONB column — handles plain values, tags
// (arrays), and weightUnit-shaped {value,unit} fields uniformly.
function serializeFields(fields){
  const out = {};
  (fields||[]).forEach(f=>{
    let v = f.value;
    if(v && typeof v==='object' && 'value' in v && 'unit' in v) v = `${v.value} ${v.unit}`;
    out[f.label] = v;
  });
  return out;
}

function captureHarvesting(){
  const st = instanceState.harvesting;
  if(!st) return [];
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const wField = findWeightField(sec);
    const weightRaw = get('hv-weight-input', wField.value.value);
    const unit = wField.value.unit;
    const weightMT = unit==='mt' ? parseNum(weightRaw) : parseNum(weightRaw)/1000;
    const fuelField = sec.emission.find(f=>f.label==='Fuel Consumption');
    const fuelConsumption = parseNum(get('hv-fuel-consumption', fuelField ? fuelField.value : '0'));
    const totalFuelKg = weightMT*fuelConsumption*0.85;
    const totalEmission = totalFuelKg*3.026;
    const perKg = weightMT>0 ? totalEmission/(weightMT*1000) : 0;
    return {
      instance_label:label, instance_order:i+1,
      weight_value:parseNum(weightRaw), weight_unit:unit, fuel_consumption_l:fuelConsumption,
      total_fuel_kg:round2(totalFuelKg), total_emission_kg:round2(totalEmission), emission_per_kg:round4(perKg),
      raw_fields:{ ...serializeFields(sec.main), ...serializeFields(sec.emission) },
    };
  });
}

function captureOVP(){
  if(!state.ovpEnabled) return { enabled:false, raw_fields:{} };
  const get = (id, fb) => document.getElementById(id)?.value ?? fb;
  const weightRaw = get('ovp-weight-input', ovpCalc.weight.value);
  const unit = ovpCalc.weight.unit;
  const weightMT = unit==='mt' ? parseNum(weightRaw) : parseNum(weightRaw)/1000;
  const yieldPct = parseNum(get('ovp-yield-pct', ovpCalc.yieldPct));
  const yieldWeightMT = weightMT*(yieldPct/100);
  const refrigEnergy = parseNum(get('ovp-refrig-energy','0.023'));
  const refrigLabel = selVal('ovp-refrigerant', CTE_DATA.onVesselProcessing.refrigerants[0].label).value;
  const refrig = CTE_DATA.onVesselProcessing.refrigerants.find(r=>r.label===refrigLabel);
  const gwp = refrig ? refrig.gwp : 0;
  const electricity = parseNum(get('ovp-electricity','100.00'));
  const water = parseNum(get('ovp-water','0.00'));
  const wasteWater = parseNum(get('ovp-wastewater','0.00'));
  const fuel = parseNum(get('ovp-fuel','30.00'));
  const emRefrig = refrigEnergy*gwp*yieldWeightMT;
  const emElectricity = electricity*yieldWeightMT*0.7;
  const emWater = water*yieldWeightMT*0.0035;
  const emWasteWater = wasteWater*yieldWeightMT*0.001;
  const emFuel = fuel*yieldWeightMT*3.2;
  const total = emRefrig+emWater+emWasteWater+emFuel;
  const perKg = yieldWeightMT>0 ? total/(yieldWeightMT*1000) : 0;
  return {
    enabled:true, weight_value:parseNum(weightRaw), weight_unit:unit,
    yield_pct:yieldPct, yield_weight_kg:round2(yieldWeightMT*1000),
    refrigeration_energy:refrigEnergy, refrigerant_type:refrigLabel,
    electricity_consumption:electricity, water_usage:water, waste_water:wasteWater, fuel_consumption:fuel,
    emission_refrigeration:round2(emRefrig), emission_electricity:round2(emElectricity),
    emission_water:round2(emWater), emission_wastewater:round2(emWasteWater), emission_fuel:round2(emFuel),
    total_emission_kg:round2(total), emission_per_kg:round4(perKg),
    raw_fields:serializeFields(getOVPFields()),
  };
}

function captureTransshipment(){
  const st = instanceState.transshipment;
  if(!st) return [];
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const row = {
      instance_label:label, instance_order:i+1,
      mode: sec.mode==='atPort' ? 'at_port' : 'at_sea', rcs_enabled: !!sec.rcs,
      total_emission_kg:0, emission_per_kg:0,
    };
    if(sec.mode==='atPort'){
      let emission=0, denomKg=0;
      if(sec.rcs){
        const containers = parseNum(get('ts-containers', sec.containers));
        const gw = parseNum(selVal('ts-gw::'+label, sec.gw).value);
        const distance = parseNum(get('ts-distance-on', sec.distanceOn));
        const fclGwTeu = containers*gw;
        emission = fclGwTeu*distance*0.0129;
        denomKg = fclGwTeu*1000;
        Object.assign(row, { containers, gw, container_type:selVal('ts-type::'+label, sec.type).value, distance_on_km:distance, fcl_gw_teu:round2(fclGwTeu) });
      } else {
        const weightRaw = get('ts-weight-input', sec.weightOff.value);
        const unit = sec.weightOff.unit;
        const weightMT = unit==='mt' ? parseNum(weightRaw) : parseNum(weightRaw)/1000;
        const distance = parseNum(get('ts-distance-off', sec.distanceOff));
        emission = weightMT*distance*0.01306;
        denomKg = weightMT*1000;
        Object.assign(row, { weight_value:parseNum(weightRaw), weight_unit:unit, distance_off_km:distance });
      }
      row.total_emission_kg = round2(emission);
      row.emission_per_kg = denomKg>0 ? round4(emission/denomKg) : 0;
    }
    row.raw_fields = serializeFields(sec.main);
    return row;
  });
}

function captureLanding(){
  const st = instanceState.landing;
  if(!st) return [];
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const weightRaw = get('ld-weight-input', sec.weight.value);
    const wUnit = sec.weight.unit;
    const weightKG = wUnit==='kg' ? parseNum(weightRaw) : parseNum(weightRaw)*1000;
    const distanceRaw = get('ld-distance-input', sec.distance.value);
    const dUnit = sec.distance.unit;
    const distanceKM = dUnit==='km' ? parseNum(distanceRaw) : parseNum(distanceRaw)*KM_PER_MILE;
    const emission = weightKG*distanceKM*0.0000542;
    const perKg = weightKG>0 ? emission/weightKG : 0;
    return {
      instance_label:label, instance_order:i+1,
      weight_value:parseNum(weightRaw), weight_unit:wUnit, distance_value:parseNum(distanceRaw), distance_unit:dUnit,
      total_emission_kg:round2(emission), emission_per_kg:round4(perKg),
      raw_fields:serializeFields(sec.main),
    };
  });
}

function captureAggrDisaggr(){
  const st = instanceState.aggr;
  if(!st) return [];
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const wRaw = get('aggr-weight-input', sec.weight.value);
    const wUnit = sec.weight.unit;
    const ttlWeightKG = wUnit==='kg' ? parseNum(wRaw) : parseNum(wRaw)*1000;
    const driRaw = get('aggr-dri-weight-input', sec.driWeight.value);
    const driUnit = sec.driWeight.unit;
    const driWeightKG = driUnit==='kg' ? parseNum(driRaw) : parseNum(driRaw)*1000;
    const elecPerKgDay = parseNum(get('aggr-elec-perkg', aggrConstants.elecPerKgDay));
    const efElectricity = parseNum(get('aggr-ef-elec', aggrConstants.efElectricity));
    const waterPerKg = parseNum(get('aggr-water-perkg', aggrConstants.waterPerKg));
    const efWater = parseNum(get('aggr-ef-water', aggrConstants.efWater));
    const avgRefrigPerKg = parseNum(get('aggr-avg-refrig', aggrConstants.avgRefrigPerKg));
    const refrigLabel = selVal('aggr-refrigerant', CTE_DATA.aggrDisaggr.refrigerants[1].label).value;
    const refrig = CTE_DATA.aggrDisaggr.refrigerants.find(r=>r.label===refrigLabel);
    const gwp = refrig ? refrig.gwp : 0;
    const calcFor = (w)=>{
      const water = w*waterPerKg*efWater;
      const refrigEnergy = w*avgRefrigPerKg*gwp;
      const electricity = w*elecPerKgDay*efElectricity;
      return { water, refrigEnergy, electricity, total: water+refrigEnergy+electricity };
    };
    const ttl = calcFor(ttlWeightKG);
    const dri = calcFor(driWeightKG);
    return {
      instance_label:label, instance_order:i+1,
      species:sec.species, weight_value:parseNum(wRaw), weight_unit:wUnit,
      dri_species:sec.driSpecies, dri_weight_value:parseNum(driRaw), dri_weight_unit:driUnit,
      electricity_usage_per_kg_day:elecPerKgDay, ef_electricity:efElectricity,
      water_usage_per_kg:waterPerKg, ef_water:efWater,
      avg_refrigerant_emission_per_kg:avgRefrigPerKg, refrigerant_type:refrigLabel, gwp,
      water_usage_emission_kg:round2(ttl.water), refrigeration_energy_emission_kg:round2(ttl.refrigEnergy),
      electricity_consumption_emission_kg:round2(ttl.electricity),
      total_emission_ttl:round2(ttl.total), emission_per_kg_ttl: ttlWeightKG>0 ? round4(ttl.total/ttlWeightKG) : 0,
      total_emission_dri:round2(dri.total), emission_per_kg_dri: driWeightKG>0 ? round4(dri.total/driWeightKG) : 0,
      raw_fields:serializeFields(sec.main),
    };
  });
}

function captureTransformation(){
  const st = instanceState.transformation;
  if(!st) return [];
  const factorIds = {
    factor_electricity:'tf-electricity', factor_purchased_materials:'tf-purchased', factor_ingredients:'tf-ingredients',
    factor_equipment_machinery:'tf-equipment', factor_water_usage:'tf-water', factor_waste_disposal:'tf-waste',
    factor_onsite_fuel_combustion:'tf-onsite', factor_fuel_consumption:'tf-fuel', factor_upstream_energy:'tf-upstream',
    factor_leased_assets:'tf-leased', factor_fugitive_emission:'tf-fugitive',
  };
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const wRaw = get('tf-weight-input', sec.weight.value);
    const wUnit = sec.weight.unit;
    const weightKG = wUnit==='kg' ? parseNum(wRaw) : parseNum(wRaw)*1000;
    const yieldPct = parseNum(get('tf-yield-pct', sec.yieldPct));
    const yieldWeightKG = weightKG*(yieldPct/100);
    const allFactorFields = [...sec.factorFields, ...sec.tagFields];
    const factors = {};
    let sum = 0;
    for(const [col, id] of Object.entries(factorIds)){
      const fieldDef = allFactorFields.find(f=>f.id===id);
      const fallback = fieldDef ? fieldDef.value : '0';
      const val = parseNum(get(id, fallback));
      factors[col] = val;
      sum += val;
    }
    const emission = weightKG*sum;
    const perKg = weightKG>0 ? emission/weightKG : 0;
    const yieldEmission = emission * (yieldPct/100);
    const otherEmission = emission - yieldEmission;
    const stationaryField = sec.tagFields.find(f=>f.label==='Stationary Fuel Combustion Type');
    const combustionField = sec.tagFields.find(f=>f.label==='Combustion Fuel Type');
    const stationaryId = `transform-tags::${label}::0::Stationary Fuel Combustion Type`;
    const combustionId = `transform-tags::${label}::1::Combustion Fuel Type`;
    return {
      instance_label:label, instance_order:i+1,
      weight_value:parseNum(wRaw), weight_unit:wUnit,
      yield_pct:yieldPct, yield_weight_value: round2(sec.yieldUnit==='kg' ? yieldWeightKG : yieldWeightKG/1000), yield_weight_unit:sec.yieldUnit,
      production_date: sec.productionDate || null, expiry_date: sec.expiryDate || null,
      ...factors,
      total_emission_kg:round2(emission), emission_per_kg:round4(perKg),
      yield_emission_kg:round2(yieldEmission), other_product_emission_kg:round2(otherEmission),
      raw_fields:{
        ...serializeFields(sec.main),
        stationaryFuelCombustionType: tagsVal(stationaryId, stationaryField?stationaryField.value:[], stationaryField?stationaryField.options:[]).selected,
        combustionFuelType: tagsVal(combustionId, combustionField?combustionField.value:[], combustionField?combustionField.options:[]).selected,
      },
    };
  });
}

function captureStorage(){
  const st = instanceState.storage;
  if(!st) return [];
  return st.labels.map((label,i)=>{
    const sec = st.data[label];
    const isActive = label===st.active;
    const get = (id, fb) => isActive ? (document.getElementById(id)?.value ?? fb) : fb;
    const weightKG = parseNum(get('st-weight-input', sec.weight));
    const elecPerKg = parseNum(get('st-elec-perkg', sec.electricPerKg));
    const efElec = parseNum(get('st-ef-elec', sec.efElectricity));
    const refrigPerKg = parseNum(get('st-refrig-perkg', sec.refrigPerKg));
    const gwp = parseNum(get('st-gwp', sec.gwp));
    const electricity = weightKG*elecPerKg*efElec;
    const refrig = weightKG*refrigPerKg*gwp;
    const total = electricity + (sec.refrigEnabled ? refrig : 0);
    const perKg = weightKG>0 ? total/weightKG : 0;
    return {
      instance_label:label, instance_order:i+1,
      yield_weight_kg:round2(weightKG),
      electricity_usage_per_kg:elecPerKg, ef_electricity:efElec, electricity_consumption_kg:round2(electricity),
      refrigeration_enabled: !!sec.refrigEnabled, avg_refrigerant_emission_per_kg:refrigPerKg, refrigerant_gwp:gwp,
      refrigeration_energy_kg:round2(refrig),
      total_emission_kg:round2(total), emission_per_kg:round4(perKg),
      raw_fields:serializeFields(sec.main),
    };
  });
}

function captureShipReceive(){
  const get = (id, fb) => document.getElementById(id)?.value ?? fb;
  const dryRaw = get('sr-dry-gw', shipCalc.dryGW.value);
  const reeferRaw = get('sr-reefer-gw', shipCalc.reeferGW.value);
  const aircraftRaw = get('sr-aircraft-gw', shipCalc.aircraftGW.value);
  const dryMT = shipToMT(dryRaw, shipCalc.dryGW.unit);
  const reeferMT = shipToMT(reeferRaw, shipCalc.reeferGW.unit);
  const aircraftMT = shipToMT(aircraftRaw, shipCalc.aircraftGW.unit);
  const teu = parseNum(get('sr-teu', shipCalc.teu));
  const distanceSea = parseNum(get('sr-distance-sea', shipCalc.distanceSea));
  const distanceAir = parseNum(get('sr-distance-air', shipCalc.distanceAir));
  const yieldRaw = get('sr-yield-weight', shipCalc.yieldWeight.value);
  const yieldWeightKG = shipToKG(yieldRaw, shipCalc.yieldWeight.unit);
  const emissionSea = (teu*reeferMT*0.9*0.01681*distanceSea) + (teu*dryMT*0.1*0.0129*distanceSea);
  const emissionAir = aircraftMT*distanceAir*0.68;
  const perKgSea = yieldWeightKG>0 ? ((yieldWeightKG/1000)*distanceSea*(0.01681+0.0129))/yieldWeightKG : 0;
  const perKgAir = yieldWeightKG>0 ? ((yieldWeightKG/1000)*distanceAir*0.68)/yieldWeightKG : 0;
  return {
    active_mode: state.shipSub==='Sea' ? 'sea' : 'air',
    teu_count:teu, gw_dry_value:parseNum(dryRaw), gw_dry_unit:shipCalc.dryGW.unit,
    gw_reefer_value:parseNum(reeferRaw), gw_reefer_unit:shipCalc.reeferGW.unit,
    distance_sea_km:distanceSea, emission_sea_total:round2(emissionSea), emission_sea_per_kg:round4(perKgSea),
    aircraft_gw_value:parseNum(aircraftRaw), aircraft_gw_unit:shipCalc.aircraftGW.unit,
    distance_air_km:distanceAir, emission_air_total:round2(emissionAir), emission_air_per_kg:round4(perKgAir),
    yield_weight_value:parseNum(yieldRaw), yield_weight_unit:shipCalc.yieldWeight.unit,
    raw_fields:{
      ...serializeFields(getShipReceiveFields().common),
      ...serializeFields(state.shipSub==='Sea' ? getShipReceiveFields().sea : getShipReceiveFields().air),
    },
  };
}

/* ---------- PACKAGING CALC ENGINE (Packaging Emission sub-tab) ----------
   Not wired to the database yet — this table's real shape is still
   being worked out, per explicit instruction. Purely client-side.
   Emission = (Quantity in g x material factor in kgCO2e/kg) / 1000,
   so changing either the Material dropdown or the Quantity recomputes
   that cell live, matching the "value below should change" ask. */
/* ---------- PACKAGING RULES ENGINE (per Directions.docx) ----------
   Product Type selects the whole Primary/Secondary/Tertiary cascade.
   Each entry's `factor` is specific to that packaging TYPE (not a
   generic per-material lookup like the old free-form grid used) —
   confirmed against the doc's real numbers. `qty(ctx)` computes the
   Packaging Quantity from whatever inputs that formula needs; ctx is
   { netWeightG, innerUnit, packagingMaterialQuantity, packagingMaterial,
     cartonAvgWeight, palletWeight, palletUnits }.

   Resolved inconsistencies in the source doc (stated before writing
   this, never contested):
   - Pouch's Primary Material is "Plastic" (the specific rule, not the
     contradicting general statement at the top of that section).
   - Plastic Cup/Bowl/Shelf Ready Tray's formulas substitute their own
     product name in place of the doc's "pouch"/"Can" copy-paste leftovers.
   - Slip Sheet has no given formula/factor anywhere, so it's left out
     as a Tertiary option — Wooden Pallet is the only working path.
   - Type 2 (lacquer) quantity is only given for 28g/70g/100g cans in the
     doc. Confirmed with the user: 37g -> 0.08. The 40/85 bracket
     boundaries below are MY OWN interpolation from that one confirmed
     point, not something stated in the doc — flagged clearly since it's
     a judgment call, not sourced fact.
   - Tertiary Type 2 and Secondary Type 2's quantities are given as a
     "dropdown" of discrete options in the doc (multiple valid values per
     primary type), not a strict formula — the default below is just the
     first listed option; the grid's Quantity cell stays freely editable
     so any of the doc's other listed values can be typed in directly. */

// Carton size tier lookup — replaces the earlier (incorrect) "Avg WT =
// average of user-given Min/Max carton weight" approach. Confirmed
// against the doc's own worked example: Net Weight(95) x Inner Unit(24)
// = 2280g total capacity needed -> falls in the Medium tier (1,500-3,000)
// -> Avg Wt = 650g, exactly matching the doc's stated result.
const CARTON_SIZE_TIERS = [
  { tier:'Small',  capMin:800,  capMax:1500,     avgWtG:325  },
  { tier:'Medium', capMin:1500, capMax:3000,     avgWtG:650  },
  { tier:'Large',  capMin:3000, capMax:Infinity, avgWtG:1250 },
];
function cartonAvgWtForCapacity(capacityG){
  const tier = CARTON_SIZE_TIERS.find(t => capacityG >= t.capMin && capacityG <= t.capMax)
    || (capacityG < CARTON_SIZE_TIERS[0].capMin ? CARTON_SIZE_TIERS[0] : CARTON_SIZE_TIERS[CARTON_SIZE_TIERS.length-1]);
  return tier.avgWtG;
}

// Type 2 (lacquer coating) quantity bracket — see note above.
function pkgLacquerQtyForCanWeight(canQtyG){
  if(canQtyG <= 40) return 0.08;
  if(canQtyG <= 85) return 0.10;
  return 0.12;
}

const PACKAGING_RULES = {
  'Can': {
    primary: [
      { type:'Can', material:'Metal-Others', factor:2.85,
        qty:(ctx)=> ctx.packagingMaterialQuantity },
      { type:'Food grade lacquer coating', material:'Polymer', factor:0.19,
        qty:(ctx)=> pkgLacquerQtyForCanWeight(ctx.packagingMaterialQuantity) },
      { type:'Printed labels', material:'Paper', factor:1.56,
        qty:(ctx)=> ctx.netWeightG * 0.00267 },
    ],
    secondary: [
      { type:'Carton', material:'Paperboard', factor:0.80,
        qty:(ctx)=> ctx.innerUnit>0 ? ctx.cartonAvgWeight/ctx.innerUnit : 0 },
      { type:'Shrink wrap', material:'Plastic film', factor:3.14, qty:()=> 0.10 },
    ],
    tertiary: [
      { type:'Wooden pallet', material:'Wood', factor:5.00,
        qty:(ctx)=> (ctx.innerUnit>0 && ctx.palletUnits>0) ? ctx.palletWeight/(ctx.innerUnit*ctx.palletUnits) : 0 },
    ],
  },
  'Pouch': {
    primary: [
      { type:'Pouch', material:'Plastic', factor:1.8,
        qty:(ctx)=> ctx.packagingMaterialQuantity },
      { type:'Printed labels', material:'Paper', factor:1.56,
        qty:(ctx)=> ctx.netWeightG * 0.00267 },
    ],
    secondary: [
      { type:'Carton', material:'Paperboard', factor:0.80,
        qty:(ctx)=> ctx.innerUnit>0 ? ctx.cartonAvgWeight/ctx.innerUnit : 0 },
      { type:'Shrink wrap', material:'Plastic film', factor:3.14, qty:()=> 0.61 },
    ],
    tertiary: [
      { type:'Wooden pallet', material:'Wood', factor:5.00,
        qty:(ctx)=> (ctx.innerUnit>0 && ctx.palletUnits>0) ? ctx.palletWeight/(ctx.innerUnit*ctx.palletUnits) : 0 },
    ],
  },
  'Plastic Cup': {
    primary: [
      { type:'Plastic cup', material:'Plastic', factor:2.70,
        qty:(ctx)=> ctx.packagingMaterialQuantity },
      { type:'Printed labels', material:'Paper', factor:1.56,
        qty:(ctx)=> ctx.netWeightG * 0.00267 },
    ],
    secondary: [
      { type:'Carton', material:'Paperboard', factor:0.80,
        qty:(ctx)=> ctx.innerUnit>0 ? ctx.cartonAvgWeight/ctx.innerUnit : 0 },
      { type:'Shrink wrap', material:'Plastic film', factor:3.14, qty:()=> 0.20 },
    ],
    tertiary: [
      { type:'Wooden pallet', material:'Wood', factor:5.00,
        qty:(ctx)=> (ctx.innerUnit>0 && ctx.palletUnits>0) ? ctx.palletWeight/(ctx.innerUnit*ctx.palletUnits) : 0 },
    ],
  },
  'Plastic Bowl': {
    primary: [
      { type:'Plastic bowl', material:'Plastic', factor:2.70,
        qty:(ctx)=> ctx.packagingMaterialQuantity },
      { type:'Printed labels', material:'Paper', factor:1.56,
        qty:(ctx)=> ctx.netWeightG * 0.00267 },
    ],
    secondary: [
      { type:'Carton', material:'Paperboard', factor:0.80,
        qty:(ctx)=> ctx.innerUnit>0 ? ctx.cartonAvgWeight/ctx.innerUnit : 0 },
      { type:'Shrink wrap', material:'Plastic film', factor:3.14, qty:()=> 0.22 },
    ],
    tertiary: [
      { type:'Wooden pallet', material:'Wood', factor:5.00,
        qty:(ctx)=> (ctx.innerUnit>0 && ctx.palletUnits>0) ? ctx.palletWeight/(ctx.innerUnit*ctx.palletUnits) : 0 },
    ],
  },
  'Shelf Ready Tray': {
    primary: [
      { type:'Shelf ready trays', material:'Plastic', factor:2.50,
        qty:(ctx)=> ctx.packagingMaterialQuantity },
      { type:'Printed labels', material:'Paper', factor:1.56,
        qty:(ctx)=> ctx.netWeightG * 0.00267 },
    ],
    secondary: [
      { type:'Carton', material:'Paperboard', factor:0.80,
        qty:(ctx)=> ctx.innerUnit>0 ? ctx.cartonAvgWeight/ctx.innerUnit : 0 },
      { type:'Shrink wrap', material:'Plastic film', factor:3.14, qty:()=> 0.21 },
    ],
    tertiary: [
      { type:'Wooden pallet', material:'Wood', factor:5.00,
        qty:(ctx)=> (ctx.innerUnit>0 && ctx.palletUnits>0) ? ctx.palletWeight/(ctx.innerUnit*ctx.palletUnits) : 0 },
    ],
  },
};

// Holds both fetched (productType, netWeightG when available) and
// user-answered (via the missing-fields modal) inputs. Stays at these
// defaults for the plain demo (no ?shipment=) — matches the app's usual
// "illustrative until told otherwise" convention.
const PKG_TYPE_OPTIONS = ['Not Applicable', ...new Set(
  Object.values(PACKAGING_RULES).flatMap(r => [...r.primary, ...r.secondary, ...r.tertiary]).map(e=>e.type)
)];
const PKG_MATERIAL_OPTIONS = ['Not Applicable', ...new Set(
  Object.values(PACKAGING_RULES).flatMap(r => [...r.primary, ...r.secondary, ...r.tertiary]).map(e=>e.material)
)];

const packagingContext = {
  productType: 'Can',
  netWeightG: 180,  // solved from reference table: 0.48 / 0.00267 = 179.78 ≈ 180
  packagingMaterialQuantity: 37, // confirmed real value for Century Tuna Flakes
  innerUnit: 12,    // solved from reference: 54.17 = 650(Medium tier avg) / 12
  palletWeight: 25, palletUnits: 120, // 25kg matches the doc's stated pallet weight; 120 = 10x12
  answered: false, // true once real/user-supplied values are in (vs. demo defaults)
};
function packagingCtx(){
  const netWeightG = parseNum(packagingContext.netWeightG);
  const innerUnit = parseNum(packagingContext.innerUnit);
  return {
    netWeightG,
    innerUnit,
    packagingMaterialQuantity: parseNum(packagingContext.packagingMaterialQuantity),
    cartonAvgWeight: cartonAvgWtForCapacity(netWeightG * innerUnit),
    palletWeight: parseNum(packagingContext.palletWeight) * 1000, // kg -> g, matching the gram convention of every other quantity
    palletUnits: parseNum(packagingContext.palletUnits),
  };
}


let pkgRecalcGuard = false;
function recalcPackaging(){
  if(pkgRecalcGuard) return; // re-entrancy guard: render() below re-triggers this via the recalc-gate
  pkgRecalcGuard = true;

  const newType = selVal('pkg-product-type', packagingContext.productType).value;
  packagingContext.productType = PACKAGING_RULES[newType] ? newType : packagingContext.productType;

  const num = (id, fallback) => parseNum(document.getElementById(id)?.value ?? fallback);
  packagingContext.netWeightG = num('pkg-net-weight', packagingContext.netWeightG);
  packagingContext.packagingMaterialQuantity = num('pkg-material-qty', packagingContext.packagingMaterialQuantity);
  packagingContext.innerUnit = num('pkg-inner-unit', packagingContext.innerUnit);
  packagingContext.palletWeight = num('pkg-pallet-weight', packagingContext.palletWeight);
  packagingContext.palletUnits = num('pkg-pallet-units', packagingContext.palletUnits);

  // A fresh Product Type should start from its own clean rules-driven
  // defaults, not carry over overrides typed in for a different product.
  if(packagingOverrides._lastProductType !== packagingContext.productType){
    packagingOverrides.primary = [null,null,null];
    packagingOverrides.secondary = [null,null,null];
    packagingOverrides.tertiary = [null,null,null];
    packagingOverrides._lastProductType = packagingContext.productType;
  } else {
    // Snapshot whatever's currently in each grid cell's dropdowns/input
    // as that slot's override — harmless when it just echoes the rules
    // default, meaningful when the user has actually changed something.
    ['primary','secondary','tertiary'].forEach(layerKey=>{
      [0,1,2].forEach(slotIdx=>{
        const cellId = `pkg-${layerKey}::${slotIdx}`;
        const typeEl = selectState[cellId+'::type'];
        const materialEl = selectState[cellId+'::material'];
        const qtyEl = document.getElementById(cellId+'::qty');
        if(!typeEl && !materialEl && !qtyEl) return;
        packagingOverrides[layerKey][slotIdx] = {
          type: typeEl?.value, material: materialEl?.value,
          qty: qtyEl ? parseNum(qtyEl.value) : undefined,
        };
      });
    });
  }

  render();
  pkgRecalcGuard = false;
}

function captureCTESnapshot(cteKey){
  switch(cteKey){
    case 'harvesting': return captureHarvesting();
    case 'ovp': return captureOVP();
    case 'transshipment': return captureTransshipment();
    case 'landing': return captureLanding();
    case 'aggrDisaggr': return captureAggrDisaggr();
    case 'transformation': return captureTransformation();
    case 'storage': return captureStorage();
    case 'shipReceive': return captureShipReceive();
    default: return null;
  }
}

// Writes the root carbon_calculations row, then every confirmed CTE's
// snapshot into its own table, tagged with the new calculation_id.
// NOTE: not run against a live database from this environment — the
// only Supabase project I can reach is a different, unrelated one.
// Verify against a dev/staging branch of the real project before
// relying on this in production.
async function saveCalculation(){
  const saveBtn = document.querySelector('[data-action="overview-save"]');
  if(!dbClient){
    showToast('Database not connected — cannot save.');
    return;
  }
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try{
    const productionTypeRaw = selVal('landing-production', 'Wild Capture').value || 'Wild Capture';
    const production_type = productionTypeRaw === 'Aquaculture' ? 'aquaculture' : 'wild_capture';
    const calculation_mode = state.calcMode === 'manual' ? 'manual' : 'system_generated';
    const dri_code = selVal('modal-dri', '').value || null;
    const product_name = selVal('modal-product', '').value || null;
    const destination_type = state.destinationMode === 'port' ? 'port' : 'country';
    const destination_value = selVal('modal-destination', '').value || null;
    const total_emission_per_kg = round4(Object.values(grandTotalParts).reduce((a,b)=>a+b, 0));

    const { data: calc, error: calcErr } = await dbClient
      .from('carbon_calculations')
      .insert({ production_type, calculation_mode, dri_code, product_name, destination_type, destination_value, status:'submitted', total_emission_per_kg })
      .select()
      .single();
    if(calcErr) throw calcErr;
    const calculationId = calc.id;

    const multiInserts = [
      ['cte_harvesting', confirmedData.harvesting],
      ['cte_transshipment', confirmedData.transshipment],
      ['cte_landing', confirmedData.landing],
      ['cte_aggr_disaggr', confirmedData.aggrDisaggr],
      ['cte_processing_transformation', confirmedData.transformation],
      ['cte_processing_storage', confirmedData.storage],
    ];
    for(const [table, rows] of multiInserts){
      if(Array.isArray(rows) && rows.length){
        const { error } = await dbClient.from(table).insert(rows.map(r=>({ ...r, calculation_id: calculationId })));
        if(error) throw error;
      }
    }

    const singleInserts = [
      ['cte_on_vessel_processing', confirmedData.ovp],
      ['cte_ship_receive', confirmedData.shipReceive],
    ];
    for(const [table, row] of singleInserts){
      if(row){
        const { error } = await dbClient.from(table).insert({ ...row, calculation_id: calculationId });
        if(error) throw error;
      }
    }

    showToast('Calculation saved successfully.');
    Object.keys(state.confirmed).forEach(k => state.confirmed[k] = false);
    Object.keys(confirmedData).forEach(k => confirmedData[k] = null);
    state.page = 'landing';
    render();
  }catch(err){
    console.error('[saveCalculation]', err);
    showToast('Save failed — check the browser console for details.');
    if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
}

const CALENDAR_ICON_SVG = `<svg class="date-field-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.25" y="5" width="17.5" height="15.5" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M3.25 9.5H20.75" stroke="currentColor" stroke-width="1.6"/><path d="M8 3V6.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16 3V6.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const state = {
  page:'landing',              // landing | modal | calculator
  activeTab:'harvesting',
  processingSub:'Transformation',   // fixed 2-option: Transformation | Storage
  packagingSub:'Packaging Emission',// fixed 2-option
  shipSub:'Sea',                    // fixed 2-option: Sea | Air
  calcMode:'system',
  destinationMode:'country',
  ovpEnabled:true,
  aggrFactorsOpen:false,
  infoPanelOpen:null,
  gdsnModalOpen:false,
  showMissingModal:false,
  confirmed:{ harvesting:false, ovp:false, transshipment:false, landing:false, aggrDisaggr:false, transformation:false, storage:false, shipReceive:false },
};

/* Instance state for CTEs where one form = one vessel/batch/facility and
   the user can add more (Harvesting, Transformation, Storage, Receiver).
   Instance 1 keeps the sample data; every instance added after that starts
   fully blank — see ensureInstance()/addInstance()/blankSections() below. */
const instanceState = {};

// Persisted premium-select values, keyed by a stable "context::label" id.
// TODO(supabase): once wired, seed this from the product/species record
// instead of the CTE_DATA defaults, and push changes to dbClient on submit.
const selectState = {};
function selVal(id, fallback){
  if(!(id in selectState)) selectState[id] = {open:false, value:fallback};
  return selectState[id];
}
function closeAllSelects(){ Object.values(selectState).forEach(s=>s.open=false); }

/* ---------- INSTANCE SUBTABS (Harvesting 1/2/3..., etc.) ---------- */
function ensureInstance(cteKey, baseLabel, initialSections){
  if(!instanceState[cteKey]){
    const first = `${baseLabel} 1`;
    instanceState[cteKey] = { labels:[first], active:first, data:{ [first]: initialSections } };
  }
  return instanceState[cteKey];
}

function blankField(f){
  if(f.type==='tags') return {...f, value:[]};
  if(f.type==='weightUnit') return {...f, value:{value:'', unit:(f.value&&f.value.unit)||'mt'}};
  return {...f, value:''};
}

// Generic blanker: works across main/emission/factorFields/tagFields (arrays
// of field objects), electricity/refrigerationRows (arrays of [label,value]
// pairs), and yieldRow-style plain objects — covers every instance CTE shape
// without needing a bespoke blanker per stage.
function blankSections(sections){
  const out = {};
  for(const key in sections){
    const v = sections[key];
    if(Array.isArray(v)){
      if(v.length===0){ out[key]=[]; }
      else if(Array.isArray(v[0])){ out[key]=v.map(([l])=>[l,'']); }
      else if(v[0] && typeof v[0]==='object' && 'type' in v[0]){ out[key]=v.map(blankField); }
      else { out[key]=v; }
    } else if(v && typeof v==='object'){
      const o={}; for(const k in v) o[k]=''; out[key]=o;
    } else { out[key]=v; }
  }
  return out;
}

function fieldValueIsEmpty(v){
  if(Array.isArray(v)) return v.length===0;
  if(v && typeof v==='object') return !v.value; // weightUnit-style {value, unit}
  return !v;
}

function isSectionsEmpty(sections){
  return Object.values(sections).every(v=>{
    if(Array.isArray(v)){
      return v.every(item=> Array.isArray(item) ? !item[1] : fieldValueIsEmpty(item.value));
    }
    if(v && typeof v==='object'){
      // {value, unit}-shaped (e.g. weightOff) — only the value counts, unit
      // is a companion setting and shouldn't make a blank weight look "full".
      if('value' in v) return !v.value;
      // Generic key-map shape (e.g. Transformation's yield:{weight,pct}) —
      // every key must be empty.
      return Object.values(v).every(x=>!x);
    }
    return true;
  });
}

// ---------- FRESH (MANUAL) CALCULATION RESET ----------
// Blanks shipment-specific VALUE fields (weight, dates, vessel/species/
// company identifiers, distances) while preserving emission-FACTOR
// fields (Transformation's 11 factors, Storage's electricity/refrigerant
// rate constants) since those are standardized multipliers that don't
// vary per shipment, not data specific to any one calculation.
let freshCalcMode = false;

function applyFreshReset(sec, preserveKeys = []){
  const saved = {};
  preserveKeys.forEach(k => { saved[k] = sec[k]; });
  const blanked = blankSections(sec);
  Object.assign(sec, blanked);
  preserveKeys.forEach(k => { sec[k] = saved[k]; });
}

function startFreshCalculation(){
  Object.keys(instanceState).forEach(k => delete instanceState[k]);
  ovpFieldsWorking = JSON.parse(JSON.stringify(CTE_DATA.onVesselProcessing.fields)).map(blankField);
  shipReceiveFieldsWorking = {
    common: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.commonFields)).map(blankField),
    sea: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.seaFields)).map(blankField),
    air: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.airFields)).map(blankField),
  };
  ovpCalc.weight = {value:'', unit:'mt'}; ovpCalc.yieldPct = ''; ovpCalc.initialized = false;
  shipCalc.distanceSea = ''; shipCalc.distanceAir = ''; shipCalc.teu = '';
  shipCalc.dryGW = {value:'', unit:'mt'}; shipCalc.reeferGW = {value:'', unit:'mt'};
  shipCalc.aircraftGW = {value:'', unit:'mt'}; shipCalc.yieldWeight = {value:'', unit:'kg'};
  packagingContext.netWeightG = ''; packagingContext.packagingMaterialQuantity = '';
  packagingContext.innerUnit = ''; packagingContext.palletWeight = ''; packagingContext.palletUnits = '';
  packagingContext.answered = false;
  packagingOverrides.primary = [null,null,null];
  packagingOverrides.secondary = [null,null,null];
  packagingOverrides.tertiary = [null,null,null];
  packagingOverrides._lastProductType = null;
  shipmentOverrides = null;
  ovpShipmentApplied = false;
  shipReceiveShipmentApplied = false;
  freshCalcMode = true;
  state.page = 'modal';
}

function addInstance(cteKey, baseLabel){
  const st = instanceState[cteKey];
  const template = st.data[st.labels[0]];
  const label = `${baseLabel} ${st.labels.length+1}`;
  st.labels.push(label);
  const blanked = blankSections(template);
  if('mode' in blanked) blanked.mode = 'atPort';
  if('rcs' in blanked) blanked.rcs = false;
  if(blanked.weightOff) blanked.weightOff = { value:'', unit:'mt' };
  if(blanked.weight && typeof blanked.weight==='object') blanked.weight = { value:'', unit:'kg' };
  if(blanked.distance && typeof blanked.distance==='object') blanked.distance = { value:'', unit:'km' };
  if(blanked.driWeight) blanked.driWeight = { value:'', unit:'kg' };
  ['distanceOff','waterOff','containers','distanceOn','waterOn'].forEach(k=>{
    if(k in blanked) blanked[k] = '';
  });
  if('gw' in blanked) blanked.gw = CTE_DATA.transshipment.gwOptions[2] || '34';
  if('type' in blanked) blanked.type = 'FCL';
  ['species','driSpecies'].forEach(k=>{ if(k in blanked) blanked[k] = ''; });
  if('yieldPct' in blanked) blanked.yieldPct = '';
  if('yieldUnit' in blanked) blanked.yieldUnit = 'kg';
  if('datesOpen' in blanked) blanked.datesOpen = false;
  if('productionDate' in blanked) blanked.productionDate = '';
  if('expiryDate' in blanked) blanked.expiryDate = '';
  if('weightPulled' in blanked) blanked.weightPulled = false;
  if('refrigEnabled' in blanked) blanked.refrigEnabled = false;
  st.data[label] = blanked;
  st.active = label;
}

function removeInstance(cteKey, label){
  const st = instanceState[cteKey];
  if(!st) return;
  const idx = st.labels.indexOf(label);
  if(idx <= 0) return; // instance 1 is the base record and can't be removed
  st.labels.splice(idx, 1);
  delete st.data[label];
  if(st.active === label){
    st.active = st.labels[idx-1] || st.labels[0];
  }
}

/* ---------- HARVESTING CALC ENGINE ----------
   Fuel Consumption typing recalculates via direct DOM writes (no full
   render) so the input never loses focus mid-keystroke. The MT/KG
   toggle rewrites instanceState and goes through the normal render()
   cycle since it needs the segmented toggle's active class to update. */
function fmtNum(n, dec=2){
  const num = typeof n === 'number' ? n : parseFloat(String(n).replace(/,/g,''));
  return isFinite(num) ? num.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}) : (0).toFixed(dec);
}
function parseNum(v){ return parseFloat(String(v).replace(/,/g,'')) || 0; }
function toISODate(str){
  const d = new Date(str);
  return isNaN(d) ? '' : d.toISOString().slice(0,10);
}
function toISODateTime(str){
  const d = new Date(str);
  if(isNaN(d)) return '';
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function showToast(msg){
  let el = document.getElementById('sc-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'sc-toast';
    el.className = 'sc-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(()=> el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 3200);
}

function currentHarvestSection(){
  const st = instanceState.harvesting;
  return st ? st.data[st.active] : null;
}

function findWeightField(sec){
  return sec && sec.emission ? sec.emission.find(f=>f.type==='weightUnit') : null;
}

function setHarvestUnit(unit){
  const wField = findWeightField(currentHarvestSection());
  if(!wField) return;
  const w = wField.value;
  const currentMT = w.unit==='mt' ? parseNum(w.value) : parseNum(w.value)/1000;
  w.unit = unit;
  w.value = unit==='mt' ? fmtNum(currentMT) : fmtNum(currentMT*1000);
}

function onHarvestWeightChange(inputEl){
  const wField = findWeightField(currentHarvestSection());
  if(wField) wField.value.value = inputEl.value;
  recalcHarvesting();
}

function recalcHarvesting(){
  const sec = currentHarvestSection();
  const wField = findWeightField(sec);
  if(!wField) return;
  const weightMT = wField.value.unit==='mt' ? parseNum(wField.value.value) : parseNum(wField.value.value)/1000;

  const fcInput = document.getElementById('hv-fuel-consumption');
  const fuelConsumption = fcInput ? parseNum(fcInput.value) : 0;

  const totalFuelKg = weightMT * fuelConsumption * 0.85;
  const totalEmission = totalFuelKg * 3.026;
  const emissionPer1kg = weightMT > 0 ? totalEmission / (weightMT * 1000) : 0;

  const totalFuelEl = document.getElementById('hv-total-fuel');
  if(totalFuelEl) totalFuelEl.value = fmtNum(totalFuelKg);
  const totalEmissionEl = document.getElementById('hv-metric-total');
  if(totalEmissionEl) totalEmissionEl.value = fmtNum(totalEmission);
  const perKgEl = document.getElementById('hv-metric-perkg');
  if(perKgEl) perKgEl.value = fmtNum(emissionPer1kg);

  grandTotalParts.harvesting = emissionPer1kg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = wField.value.value;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = wField.value.unit.toUpperCase();
}

/* ---------- ON VESSEL PROCESSING CALC ENGINE ----------
   Weight defaults to whatever Harvesting's current weight is the first
   time this tab is opened (a one-time pull, not a live link — editing it
   here doesn't write back to Harvesting). Yield % scales that weight down
   before every downstream formula uses it. */
const ovpCalc = { weight:{value:'', unit:'mt'}, yieldPct:'100', initialized:false };

function ensureOVPWeight(){
  if(ovpCalc.initialized) return;
  const hvField = findWeightField(currentHarvestSection());
  if(hvField && hvField.value.value){
    ovpCalc.weight = { value: hvField.value.value, unit: hvField.value.unit };
  }
  ovpCalc.initialized = true;
}

function setOVPUnit(unit){
  const w = ovpCalc.weight;
  const currentMT = w.unit==='mt' ? parseNum(w.value) : parseNum(w.value)/1000;
  w.unit = unit;
  w.value = unit==='mt' ? fmtNum(currentMT) : fmtNum(currentMT*1000);
}

function onOVPWeightChange(el){ ovpCalc.weight.value = el.value; recalcOVP(); }
function onOVPYieldChange(el){ ovpCalc.yieldPct = el.value; recalcOVP(); }

function ovpYieldWeightMT(){
  const weightMT = ovpCalc.weight.unit==='mt' ? parseNum(ovpCalc.weight.value) : parseNum(ovpCalc.weight.value)/1000;
  const yieldPct = parseNum(document.getElementById('ovp-yield-pct')?.value ?? ovpCalc.yieldPct);
  return weightMT * (yieldPct/100);
}

function recalcOVP(){
  ensureOVPWeight();
  const yieldWeightMT = ovpYieldWeightMT();
  const yieldDisplayUnit = ovpCalc.weight.unit;
  const yieldWeightDisplay = yieldDisplayUnit==='kg' ? yieldWeightMT*1000 : yieldWeightMT;
  const yieldEl = document.getElementById('ovp-yield-weight');
  if(yieldEl) yieldEl.value = fmtNum(yieldWeightDisplay);
  const yieldUnitEl = document.getElementById('ovp-yield-unit-label');
  if(yieldUnitEl) yieldUnitEl.textContent = yieldDisplayUnit;

  const refrigEnergy = parseNum(document.getElementById('ovp-refrig-energy')?.value);
  const refrigLabel = selVal('ovp-refrigerant', CTE_DATA.onVesselProcessing.refrigerants[0].label).value;
  const refrig = CTE_DATA.onVesselProcessing.refrigerants.find(r=>r.label===refrigLabel);
  const gwp = refrig ? refrig.gwp : 0;

  const electricity = parseNum(document.getElementById('ovp-electricity')?.value);
  const water = parseNum(document.getElementById('ovp-water')?.value);
  const wasteWater = parseNum(document.getElementById('ovp-wastewater')?.value);
  const fuel = parseNum(document.getElementById('ovp-fuel')?.value);

  const emRefrig = refrigEnergy * gwp * yieldWeightMT;
  const emElectricity = electricity * yieldWeightMT * 0.7;
  const emWater = water * yieldWeightMT * 0.0035;
  const emWasteWater = wasteWater * yieldWeightMT * 0.001;
  const emFuel = fuel * yieldWeightMT * 3.2;

  // Electricity is deliberately excluded — see the Total Emissions tooltip.
  const totalEmissions = emRefrig + emWater + emWasteWater + emFuel;
  const perKg = yieldWeightMT > 0 ? totalEmissions / (yieldWeightMT * 1000) : 0;

  const setVal = (id, v)=>{ const el = document.getElementById(id); if(el) el.value = fmtNum(v); };
  setVal('ovp-em-refrig', emRefrig);
  setVal('ovp-em-electricity', emElectricity);
  setVal('ovp-em-water', emWater);
  setVal('ovp-em-wastewater', emWasteWater);
  setVal('ovp-em-fuel', emFuel);
  setVal('ovp-metric-total', totalEmissions);
  setVal('ovp-metric-perkg', perKg);

  grandTotalParts.ovp = perKg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = ovpCalc.weight.value;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = ovpCalc.weight.unit.toUpperCase();
}

/* ---------- TRANSSHIPMENT CALC ENGINE ----------
   Each instance carries its own mode ('atPort'|'atSea') and its own RCS
   on/off state, plus independent field sets for both RCS states so
   toggling RCS never loses what you already typed in the other mode. */
function tsFindActive(){
  const st = instanceState.transshipment;
  return st ? { st, sec: st.data[st.active] } : null;
}

function setTSMode(mode){
  const f = tsFindActive();
  if(f) f.sec.mode = mode;
}

function toggleTSRCS(){
  const f = tsFindActive();
  if(f) f.sec.rcs = !f.sec.rcs;
}

function setTSUnit(unit){
  const f = tsFindActive();
  if(!f) return;
  const w = f.sec.weightOff;
  const currentMT = w.unit==='mt' ? parseNum(w.value) : parseNum(w.value)/1000;
  w.unit = unit;
  w.value = unit==='mt' ? fmtNum(currentMT) : fmtNum(currentMT*1000);
}

function onTSWeightChange(el){
  const f = tsFindActive();
  if(f) f.sec.weightOff.value = el.value;
  recalcTransshipment();
}

function recalcTransshipment(){
  const found = tsFindActive();
  if(!found || found.sec.mode !== 'atPort'){
    grandTotalParts.transshipment = 0;
    updateGrandTotal();
    return;
  }
  const { st, sec } = found;
  const setVal = (id, v)=>{ const el = document.getElementById(id); if(el) el.value = fmtNum(v); };

  let emission = 0, denomKg = 0;
  if(sec.rcs){
    const containers = parseNum(document.getElementById('ts-containers')?.value ?? sec.containers);
    const gw = parseNum(selVal('ts-gw::'+st.active, sec.gw).value);
    const distance = parseNum(document.getElementById('ts-distance-on')?.value ?? sec.distanceOn);
    const fclGwTeu = containers * gw;
    setVal('ts-fclgwteu', fclGwTeu);
    emission = fclGwTeu * distance * 0.0129;
    denomKg = fclGwTeu * 1000;
  } else {
    const weightMT = sec.weightOff.unit==='mt'
      ? parseNum(document.getElementById('ts-weight-input')?.value ?? sec.weightOff.value)
      : parseNum(document.getElementById('ts-weight-input')?.value ?? sec.weightOff.value) / 1000;
    const distance = parseNum(document.getElementById('ts-distance-off')?.value ?? sec.distanceOff);
    emission = weightMT * distance * 0.01306;
    denomKg = weightMT * 1000;
  }
  const perKg = denomKg > 0 ? emission / denomKg : 0;
  setVal('ts-metric-total', emission);
  setVal('ts-metric-perkg', perKg);

  grandTotalParts.transshipment = perKg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(sec.rcs){
    if(bbWeightEl) bbWeightEl.value = '–';
    if(bbUnitEl) bbUnitEl.textContent = '';
  } else {
    if(bbWeightEl) bbWeightEl.value = document.getElementById('ts-weight-input')?.value ?? sec.weightOff.value;
    if(bbUnitEl) bbUnitEl.textContent = sec.weightOff.unit.toUpperCase();
  }
}

/* ---------- LANDING CALC ENGINE ----------
   Note: the request said "KM & MPH switch" for Distance to Facility — MPH
   is a speed unit, not a distance one, so it can't be what a distance
   field toggles between. Implemented as KM/MI (miles) instead, which is
   the sensible read of that instruction; flag if MPH meant something else. */
const KM_PER_MILE = 1.60934;
function landingFindActive(){
  const st = instanceState.landing;
  return st ? { st, sec: st.data[st.active] } : null;
}

function setLandingWeightUnit(unit){
  const f = landingFindActive();
  if(!f) return;
  const w = f.sec.weight;
  const currentKG = w.unit==='kg' ? parseNum(w.value) : parseNum(w.value)*1000;
  w.unit = unit;
  w.value = unit==='kg' ? fmtNum(currentKG) : fmtNum(currentKG/1000);
}
function onLandingWeightChange(el){
  const f = landingFindActive();
  if(f) f.sec.weight.value = el.value;
  recalcLanding();
}

function setLandingDistanceUnit(unit){
  const f = landingFindActive();
  if(!f) return;
  const d = f.sec.distance;
  const currentKM = d.unit==='km' ? parseNum(d.value) : parseNum(d.value)*KM_PER_MILE;
  d.unit = unit;
  d.value = unit==='km' ? fmtNum(currentKM) : fmtNum(currentKM/KM_PER_MILE);
}
function onLandingDistanceChange(el){
  const f = landingFindActive();
  if(f) f.sec.distance.value = el.value;
  recalcLanding();
}

function recalcLanding(){
  const found = landingFindActive();
  if(!found) return;
  const { sec } = found;
  const weightKG = sec.weight.unit==='kg' ? parseNum(document.getElementById('ld-weight-input')?.value ?? sec.weight.value) : parseNum(document.getElementById('ld-weight-input')?.value ?? sec.weight.value)*1000;
  const distanceKM = sec.distance.unit==='km' ? parseNum(document.getElementById('ld-distance-input')?.value ?? sec.distance.value) : parseNum(document.getElementById('ld-distance-input')?.value ?? sec.distance.value)*KM_PER_MILE;
  const emission = weightKG * distanceKM * 0.0000542;
  const perKg = weightKG > 0 ? emission / weightKG : 0;
  const setVal = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=fmtNum(v); };
  setVal('ld-metric-total', emission);
  const perKgEl = document.getElementById('ld-metric-perkg');
  if(perKgEl) perKgEl.value = fmtNum(perKg, 3);

  grandTotalParts.landing = perKg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = document.getElementById('ld-weight-input')?.value ?? sec.weight.value;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = sec.weight.unit.toUpperCase();
}

/* ---------- AGGREGATION/DISAGGREGATION CALC ENGINE ----------
   Weight or Quantity (TTL) and DRI Species Weight or Quantity are
   per-instance (one Receiver = one weight pair). The three "Emission
   Factors" boxes are genuinely constant/shared settings — not per
   instance — matching how the original mockup labeled them
   "constant fields". Refrigerant GWP is now a dropdown instead of a
   fixed number, per the reference table supplied. */
const aggrConstants = {
  elecPerKgDay:'0.159', efElectricity:'0.4999',
  waterPerKg:'1.0000', efWater:'0.541',
  avgRefrigPerKg:'0.00007',
};

function aggrFindActive(){
  const st = instanceState.aggr;
  return st ? { st, sec: st.data[st.active] } : null;
}

function setAggrWeightUnit(field, unit){
  const f = aggrFindActive();
  if(!f) return;
  const w = f.sec[field];
  const currentKG = w.unit==='kg' ? parseNum(w.value) : parseNum(w.value)*1000;
  w.unit = unit;
  w.value = unit==='kg' ? fmtNum(currentKG) : fmtNum(currentKG/1000);
}

function onAggrWeightChange(field, el){
  const f = aggrFindActive();
  if(f) f.sec[field].value = el.value;
  recalcAggr();
}

function onAggrTextChange(field, el){
  const f = aggrFindActive();
  if(f) f.sec[field] = el.value;
}

function toggleAggrFactors(){ state.aggrFactorsOpen = !state.aggrFactorsOpen; }

/* ---------- TRANSFORMATION CALC ENGINE ---------- */
function findTransformInstance(){
  const st = instanceState.transformation;
  return st ? { st, sec: st.data[st.active] } : null;
}

function setTransformWeightUnit(unit){
  const f = findTransformInstance();
  if(!f) return;
  const w = f.sec.weight;
  const currentKG = w.unit==='kg' ? parseNum(w.value) : parseNum(w.value)*1000;
  w.unit = unit;
  w.value = unit==='kg' ? fmtNum(currentKG) : fmtNum(currentKG/1000);
}
function onTransformWeightChange(el){
  const f = findTransformInstance();
  if(f) f.sec.weight.value = el.value;
  recalcTransform();
}
function onTransformYieldPctChange(el){
  const f = findTransformInstance();
  if(f) f.sec.yieldPct = el.value;
  recalcTransform();
}
function setTransformYieldUnit(unit){
  const f = findTransformInstance();
  if(f) f.sec.yieldUnit = unit;
}
function toggleTransformDates(){
  const f = findTransformInstance();
  if(f) f.sec.datesOpen = !f.sec.datesOpen;
}
function onTransformDateChange(field, el){
  const f = findTransformInstance();
  if(f) f.sec[field] = el.value;
}

function recalcTransform(){
  const found = findTransformInstance();
  if(!found) return;
  const { sec } = found;
  const weightKG = sec.weight.unit==='kg'
    ? parseNum(document.getElementById('tf-weight-input')?.value ?? sec.weight.value)
    : parseNum(document.getElementById('tf-weight-input')?.value ?? sec.weight.value)*1000;
  const yieldPct = parseNum(document.getElementById('tf-yield-pct')?.value ?? sec.yieldPct);
  const yieldWeightKG = weightKG * (yieldPct/100);

  const yieldEl = document.getElementById('tf-yield-weight');
  if(yieldEl) yieldEl.value = sec.yieldUnit==='kg' ? fmtNum(yieldWeightKG) : fmtNum(yieldWeightKG/1000);

  // Sum all 11 factors — On-Site Fuel Combustion is included despite not
  // appearing in the originally-given formula list: verified numerically
  // against the reference totals (358,041.45 / 3.47), which only reproduce
  // exactly when it's part of the sum.
  const ids = ['tf-electricity','tf-purchased','tf-ingredients','tf-equipment','tf-water','tf-waste','tf-onsite','tf-fuel','tf-upstream','tf-leased','tf-fugitive'];
  const sum = ids.reduce((acc,id)=>{
    const el = document.getElementById(id);
    return acc + (el ? parseNum(el.value) : 0);
  }, 0);

  // TTL Emission now uses the RAW Weight or Quantity, not the yield-adjusted
  // weight — this represents the total embodied emissions across ALL the
  // raw material processed, before splitting into Yield vs Other Product.
  const emission = weightKG * sum;
  const perKg = weightKG > 0 ? emission / weightKG : 0;

  // Yield Emission = the portion of TTL attributable to the Yield % (this
  // is exactly what "Emissions" used to mean before this change — same
  // formula, same number, just relabeled as one of three metrics now).
  // Other Product Emission = the remaining portion (100% - Yield %).
  // Per-kg is deliberately NOT split into separate Yield/Other figures:
  // algebraically, Emission ÷ its own weight always reduces to Sum
  // regardless of which weight subset you use, so a separate "Yield per
  // kg" / "Other per kg" would just repeat the same number as "Emissions
  // of 1KG" — verified numerically before implementing this.
  const yieldEmission = emission * (yieldPct/100);
  const otherEmission = emission - yieldEmission;

  const setVal = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=fmtNum(v); };
  setVal('tf-metric-total', emission);
  setVal('tf-metric-perkg', perKg);
  setVal('tf-metric-yield', yieldEmission);
  setVal('tf-metric-other', otherEmission);

  grandTotalParts.transformation = perKg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = document.getElementById('tf-weight-input')?.value ?? sec.weight.value;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = sec.weight.unit.toUpperCase();
}

/* ---------- STORAGE CALC ENGINE ---------- */
function findStorageInstance(){
  const st = instanceState.storage;
  return st ? { st, sec: st.data[st.active] } : null;
}

function ensureStorageWeight(sec){
  if(sec.weightPulled) return;
  const tf = findTransformInstance();
  if(tf){
    const w = tf.sec.weight;
    const weightKG = w.unit==='kg' ? parseNum(w.value) : parseNum(w.value)*1000;
    const yieldPct = parseNum(tf.sec.yieldPct);
    sec.weight = fmtNum(weightKG * (yieldPct/100));
  }
  sec.weightPulled = true;
}

function onStorageWeightChange(el){
  const f = findStorageInstance();
  if(f) f.sec.weight = el.value;
  recalcStorage();
}
function toggleStorageRefrig(){
  const f = findStorageInstance();
  if(f) f.sec.refrigEnabled = !f.sec.refrigEnabled;
}
function storageRefrigToggleHTML(sec){
  return `<label class="pill-toggle">Enable<span class="switch"><input type="checkbox" ${sec.refrigEnabled?'checked':''} data-action="st-refrig-toggle"><span class="track"></span></span></label>`;
}

function recalcStorage(){
  const found = findStorageInstance();
  if(!found) return;
  const { sec } = found;
  const weightKG = parseNum(document.getElementById('st-weight-input')?.value ?? sec.weight);
  const elecPerKg = parseNum(document.getElementById('st-elec-perkg')?.value ?? sec.electricPerKg);
  const efElec = parseNum(document.getElementById('st-ef-elec')?.value ?? sec.efElectricity);
  const refrigPerKg = parseNum(document.getElementById('st-refrig-perkg')?.value ?? sec.refrigPerKg);
  const gwp = parseNum(document.getElementById('st-gwp')?.value ?? sec.gwp);

  const electricity = weightKG * elecPerKg * efElec;
  const refrig = weightKG * refrigPerKg * gwp;
  const totalEmission = electricity + (sec.refrigEnabled ? refrig : 0);
  const perKg = weightKG > 0 ? totalEmission / weightKG : 0;

  const setVal = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=fmtNum(v); };
  setVal('st-electricity', electricity);
  setVal('st-refrig', refrig);
  setVal('st-metric-total', totalEmission);
  setVal('st-metric-perkg', perKg);

  grandTotalParts.storage = perKg;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = document.getElementById('st-weight-input')?.value ?? sec.weight;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = 'KG';
}

/* ---------- SHIP/RECEIVE (LOGISTICS) CALC ENGINE ----------
   Not instance-based — one Logistics record per product. Sea and Air are
   two genuinely separate field sets now (the top pill actually drives
   which one shows, instead of a disconnected internal "Transport Mode"
   select), each with its own Distance Travelled per the "don't share that
   field" note. Est GW of Aircraft also got the same linked KG/MT control
   as the two container GWs, since it feeds a formula too and the old
   value+separate-unit-dropdown pattern is the same bug fixed everywhere
   else in this build. */
const shipCalc = {
  distanceSea:'9,143.00',
  distanceAir:'7,000.00',
  teu:'4,578',
  dryGW:{value:'34', unit:'mt'},
  reeferGW:{value:'30.4', unit:'mt'},
  aircraftGW:{value:'250', unit:'mt'},
  yieldWeight:{value:'258,265.00', unit:'kg'},
};

function shipToMT(v, unit){ return unit==='mt' ? parseNum(v) : parseNum(v)/1000; }
function shipToKG(v, unit){ return unit==='kg' ? parseNum(v) : parseNum(v)*1000; }

function setShipGWUnit(field, unit){
  const w = shipCalc[field];
  const currentMT = shipToMT(w.value, w.unit);
  w.unit = unit;
  w.value = unit==='mt' ? fmtNum(currentMT) : fmtNum(currentMT*1000);
}
function setShipWeightUnit(unit){
  const w = shipCalc.yieldWeight;
  const currentKG = shipToKG(w.value, w.unit);
  w.unit = unit;
  w.value = unit==='kg' ? fmtNum(currentKG) : fmtNum(currentKG/1000);
}
function onShipInputChange(field, el){
  const target = shipCalc[field];
  if(target && typeof target==='object') target.value = el.value;
  else shipCalc[field] = el.value;
  recalcShip();
}

function recalcShip(){
  const dryMT = shipToMT(document.getElementById('sr-dry-gw')?.value ?? shipCalc.dryGW.value, shipCalc.dryGW.unit);
  const reeferMT = shipToMT(document.getElementById('sr-reefer-gw')?.value ?? shipCalc.reeferGW.value, shipCalc.reeferGW.unit);
  const aircraftMT = shipToMT(document.getElementById('sr-aircraft-gw')?.value ?? shipCalc.aircraftGW.value, shipCalc.aircraftGW.unit);
  const teu = parseNum(document.getElementById('sr-teu')?.value ?? shipCalc.teu);
  const distanceSea = parseNum(document.getElementById('sr-distance-sea')?.value ?? shipCalc.distanceSea);
  const distanceAir = parseNum(document.getElementById('sr-distance-air')?.value ?? shipCalc.distanceAir);
  const yieldWeightKG = shipToKG(document.getElementById('sr-yield-weight')?.value ?? shipCalc.yieldWeight.value, shipCalc.yieldWeight.unit);

  const emissionSea = (teu * reeferMT * 0.9 * 0.01681 * distanceSea) + (teu * dryMT * 0.1 * 0.0129 * distanceSea);
  const emissionAir = aircraftMT * distanceAir * 0.68;
  // Confirmed: TTL and per-kg both use 0.68 for Air. The earlier 0.068 in
  // the TTL formula was a typo, now corrected.
  const perKgSea = yieldWeightKG > 0 ? ((yieldWeightKG/1000) * distanceSea * (0.01681+0.0129)) / yieldWeightKG : 0;
  const perKgAir = yieldWeightKG > 0 ? ((yieldWeightKG/1000) * distanceAir * 0.68) / yieldWeightKG : 0;

  const setVal = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=fmtNum(v); };
  setVal('sr-metric-sea-total', emissionSea);
  setVal('sr-metric-sea-perkg', perKgSea);
  setVal('sr-metric-air-total', emissionAir);
  setVal('sr-metric-air-perkg', perKgAir);

  grandTotalParts.shipReceive = state.shipSub==='Sea' ? perKgSea : perKgAir;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = `${fmtNum(teu,0)} (${fmtNum(distanceSea,0)} km)`;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = 'containers';
}

function recalcAggr(){
  const found = aggrFindActive();
  if(!found) return;
  const { sec } = found;

  const weightKGOf = (field, inputId)=>{
    const w = sec[field];
    const raw = parseNum(document.getElementById(inputId)?.value ?? w.value);
    return w.unit==='kg' ? raw : raw*1000;
  };
  const ttlWeightKG = weightKGOf('weight','aggr-weight-input');
  const driWeightKG = weightKGOf('driWeight','aggr-dri-weight-input');

  const elecPerKgDay = parseNum(document.getElementById('aggr-elec-perkg')?.value ?? aggrConstants.elecPerKgDay);
  const efElectricity = parseNum(document.getElementById('aggr-ef-elec')?.value ?? aggrConstants.efElectricity);
  const waterPerKg = parseNum(document.getElementById('aggr-water-perkg')?.value ?? aggrConstants.waterPerKg);
  const efWater = parseNum(document.getElementById('aggr-ef-water')?.value ?? aggrConstants.efWater);
  const avgRefrigPerKg = parseNum(document.getElementById('aggr-avg-refrig')?.value ?? aggrConstants.avgRefrigPerKg);
  const refrigLabel = selVal('aggr-refrigerant', CTE_DATA.aggrDisaggr.refrigerants[1].label).value;
  const refrig = CTE_DATA.aggrDisaggr.refrigerants.find(r=>r.label===refrigLabel);
  const gwp = refrig ? refrig.gwp : 0;

  const calcFor = (weightKG)=>{
    const water = weightKG * waterPerKg * efWater;
    const refrigEnergy = weightKG * avgRefrigPerKg * gwp;
    const electricity = weightKG * elecPerKgDay * efElectricity;
    return { water, refrigEnergy, electricity, total: water + refrigEnergy + electricity };
  };

  const ttl = calcFor(ttlWeightKG);
  const dri = calcFor(driWeightKG);

  const setVal = (id,v)=>{ const e=document.getElementById(id); if(e) e.value=fmtNum(v); };
  setVal('aggr-water-usage', ttl.water);
  setVal('aggr-refrig-energy', ttl.refrigEnergy);
  setVal('aggr-electricity', ttl.electricity);
  const gwpEl = document.getElementById('aggr-gwp-readout');
  if(gwpEl) gwpEl.value = fmtNum(gwp, 0);
  setVal('aggr-metric-ttl', ttl.total);
  setVal('aggr-metric-ttl-perkg', ttlWeightKG>0 ? ttl.total/ttlWeightKG : 0);
  setVal('aggr-metric-dri', dri.total);
  setVal('aggr-metric-dri-perkg', driWeightKG>0 ? dri.total/driWeightKG : 0);

  // Using DRI Species per-kg (the specific tracked species) rather than
  // TTL (the whole mixed-species batch) for the grand total — flagging
  // this choice since it wasn't explicitly specified either way.
  grandTotalParts.aggrDisaggr = driWeightKG>0 ? dri.total/driWeightKG : 0;
  updateGrandTotal();

  const bbWeightEl = document.getElementById('bb-weight-value');
  if(bbWeightEl) bbWeightEl.value = document.getElementById('aggr-weight-input')?.value ?? sec.weight.value;
  const bbUnitEl = document.getElementById('bb-weight-unit');
  if(bbUnitEl) bbUnitEl.textContent = sec.weight.unit.toUpperCase();
}

function renderAggrDisaggr(){
  const data = CTE_DATA.aggrDisaggr;
  const initial = {
    main: data.fields,
    species:'Multiple*',
    weight:{value:'311,112.00', unit:'kg'},
    driSpecies:'Skipjack',
    driWeight:{value:'258,265.00', unit:'kg'},
  };
  const st = ensureInstance('aggr', data.instanceBase, initial);
  const sec = st.data[st.active];
  if(shipmentOverrides?.aggr && !sec._shipmentApplied){
    const a = shipmentOverrides.aggr;
    if(a.species) sec.species = a.species;
    if(a.weight) sec.weight = { ...a.weight };
    if(a.driSpecies) sec.driSpecies = a.driSpecies;
    if(a.driWeight) sec.driWeight = { ...a.driWeight };
    if(a.productOwnership || a.eventDate) applyLabelOverrides(sec.main, {'Product Ownership': a.productOwnership, 'Event Date & Time': a.eventDate});
    sec._shipmentApplied = true;
  }
  if(freshCalcMode && !sec._freshApplied){
    applyFreshReset(sec, []);
    sec.species = ''; sec.driSpecies = ''; // flat strings — blankSections() doesn't touch these
    sec._freshApplied = true;
  }
  const multiple = st.labels.length > 1;
  const refrigOptions = data.refrigerants.map(r=>r.label);

  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${data.title}${cteProductTag(sec.main, sec.species)}</h2><p>${data.desc}</p></div>
        <div class="card-top-actions">${renderInfoButton('aggrDisaggr')}${headerToggle(data.headerToggle)}</div>
      </div>
      ${bottomBar(data.metrics, data.checkbox, multiple, 'aggrDisaggr', {label:'Total Volume', initial:sec.weight.value, unit:sec.weight.unit.toUpperCase()})}
      ${renderInstanceSubtabs('aggr', data.instanceBase)}
      <div style="height:16px"></div>
      ${fieldGrid(sec.main, 'aggr-main::'+st.active)}

      <div class="section-label">Received (all species combined)</div>
      <div class="field-grid" style="margin-top:2px;">
        <div class="field">
          <label>Species</label>
          <input type="text" id="aggr-species-input" value="${sec.species}" oninput="onAggrTextChange('species',this)">
        </div>
        <div class="field">
          <label>Weight or Quantity <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="aggr-weight-input" value="${sec.weight.value}" oninput="onAggrWeightChange('weight',this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${sec.weight.unit==='kg'?'active':''}" data-action="aggr-weight-unit" data-field="weight" data-unit="kg">KG</button>
              <button type="button" class="seg-opt-sm ${sec.weight.unit==='mt'?'active':''}" data-action="aggr-weight-unit" data-field="weight" data-unit="mt">MT</button>
            </div>
          </div>
        </div>
      </div>
      <div class="section-label">DRI (this specific species)</div>
      <div class="field-grid" style="margin-top:2px;">
        <div class="field">
          <label>DRI Species</label>
          <input type="text" id="aggr-dri-species-input" value="${sec.driSpecies}" oninput="onAggrTextChange('driSpecies',this)">
        </div>
        <div class="field">
          <label>DRI Species Weight or Quantity <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="aggr-dri-weight-input" value="${sec.driWeight.value}" oninput="onAggrWeightChange('driWeight',this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${sec.driWeight.unit==='kg'?'active':''}" data-action="aggr-weight-unit" data-field="driWeight" data-unit="kg">KG</button>
              <button type="button" class="seg-opt-sm ${sec.driWeight.unit==='mt'?'active':''}" data-action="aggr-weight-unit" data-field="driWeight" data-unit="mt">MT</button>
            </div>
          </div>
        </div>
      </div>

      <div class="section-label">Emission Line Items</div>
      <div class="field-grid">
        <div class="field">
          <label>Water Usage</label>
          <div class="unit-row"><input type="text" id="aggr-water-usage" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
        </div>
        <div class="field">
          <label>Refrigeration Energy</label>
          <div class="unit-row"><input type="text" id="aggr-refrig-energy" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
        </div>
        <div class="field">
          <label>Electricity Consumption</label>
          <div class="unit-row"><input type="text" id="aggr-electricity" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
        </div>
      </div>

      <button type="button" class="collapse-toggle" data-action="aggr-factors-toggle">
        <span>Emission Factors <span class="collapse-note">(constant fields)</span></span>
        <span class="collapse-chev ${state.aggrFactorsOpen?'open':''}">⌄</span>
      </button>
      <div class="collapse-panel ${state.aggrFactorsOpen?'open':''}">
        <div class="emission-boxes" style="grid-template-columns:repeat(3,1fr);margin-top:14px;">
          <div class="emission-box emission-box-photo" style="background-image:url('elec.jpg');">
            <h4>Electricity</h4>
            <div class="field"><label>Electricity usage per kg/day</label><input type="text" id="aggr-elec-perkg" value="${aggrConstants.elecPerKgDay}" oninput="recalcAggr()"></div>
            <div class="field"><label>EF of Electricity</label><input type="text" id="aggr-ef-elec" value="${aggrConstants.efElectricity}" oninput="recalcAggr()"></div>
          </div>
          <div class="emission-box emission-box-photo" style="background-image:url('wat.jpg');">
            <h4>Water usage</h4>
            <div class="field"><label>Water usage for a kg (L/kg)</label><input type="text" id="aggr-water-perkg" value="${aggrConstants.waterPerKg}" oninput="recalcAggr()"></div>
            <div class="field"><label>EF of water</label><input type="text" id="aggr-ef-water" value="${aggrConstants.efWater}" oninput="recalcAggr()"></div>
          </div>
          <div class="emission-box emission-box-photo" style="background-image:url('Ref.jpg');">
            <h4>Refrigerant emission</h4>
            <div class="field"><label>Avg Refrigerant emission (per kg)</label><input type="text" id="aggr-avg-refrig" value="${aggrConstants.avgRefrigPerKg}" oninput="recalcAggr()"></div>
            <div class="field"><label>Refrigerant</label>${buildSelect('aggr-refrigerant', refrigOptions, {value:'R-404A'})}</div>
            <div class="field"><label>GWP</label><input type="text" id="aggr-gwp-readout" class="is-computed" readonly value="3,922"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderLandingCTE(){
  const data = CTE_DATA.landing;
  const initial = {
    main: data.fields,
    weight:{value:'311,112.00', unit:'kg'},
    distance:{value:'48.00', unit:'km'},
  };
  const st = ensureInstance('landing', data.instanceBase, initial);
  const sec = st.data[st.active];
  if(shipmentOverrides && !sec._shipmentApplied){
    applyLabelOverrides(sec.main, shipmentOverrides.landing);
    applySpeciesTagsOverride('landing-main::'+st.active, sec.main, shipmentOverrides.landingSpecies);
    if(shipmentOverrides.landingWeight) sec.weight = { ...shipmentOverrides.landingWeight };
    sec._shipmentApplied = true;
  }
  if(freshCalcMode && !sec._freshApplied){
    applyFreshReset(sec, []);
    sec._freshApplied = true;
  }
  const multiple = st.labels.length > 1;
  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${data.title}${cteProductTag(sec.main)}</h2><p>${data.desc}</p></div>
        <div class="card-top-actions">${renderInfoButton('landing')}${headerToggle(data.headerToggle)}</div>
      </div>
      ${bottomBar(data.metrics, data.checkbox, multiple, 'landing', {label:'Total Volume', initial:sec.weight.value, unit:sec.weight.unit.toUpperCase()})}
      ${renderInstanceSubtabs('landing', data.instanceBase)}
      <div style="height:16px"></div>
      ${fieldGrid(sec.main, 'landing-main::'+st.active)}
      <div class="field-grid" style="margin-top:2px;">
        <div class="field">
          <label>Weight or Quantity <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="ld-weight-input" value="${sec.weight.value}" oninput="onLandingWeightChange(this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${sec.weight.unit==='kg'?'active':''}" data-action="ld-weight-unit" data-unit="kg">KG</button>
              <button type="button" class="seg-opt-sm ${sec.weight.unit==='mt'?'active':''}" data-action="ld-weight-unit" data-unit="mt">MT</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Distance to Facility <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="ld-distance-input" value="${sec.distance.value}" oninput="onLandingDistanceChange(this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${sec.distance.unit==='km'?'active':''}" data-action="ld-distance-unit" data-unit="km">KM</button>
              <button type="button" class="seg-opt-sm ${sec.distance.unit==='mi'?'active':''}" data-action="ld-distance-unit" data-unit="mi">MI</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function tsRCSToggleHTML(sec){
  return `<label class="pill-toggle">RCS<span class="switch"><input type="checkbox" ${sec.rcs?'checked':''} data-action="ts-rcs"><span class="track"></span></span></label>`;
}

function renderTransshipment(){
  const data = CTE_DATA.transshipment;
  const initial = {
    main: data.fields, mode:'atPort', rcs:false,
    weightOff:{value:'5,500.00', unit:'mt'}, distanceOff:'7,600.00', waterOff:'0.00',
    containers:'2,800.00', gw:'34', type:'FCL', distanceOn:'4,200.00', waterOn:'0.00',
  };
  const st = ensureInstance('transshipment', data.instanceBase, initial);
  const sec = st.data[st.active];
  if(shipmentOverrides?.transshipment && !sec._shipmentApplied){
    applyLabelOverrides(sec.main, shipmentOverrides.transshipment);
    applySpeciesTagsOverride('transship-main::'+st.active, sec.main, shipmentOverrides.transshipmentSpecies);
    sec._shipmentApplied = true;
  }
  if(freshCalcMode && !sec._freshApplied){
    applyFreshReset(sec, []);
    sec.rcs = null; // forces the explicit RCS/Normal Carrier question below, rather than silently defaulting
    sec.mode = 'atPort';
    sec._freshApplied = true;
  }
  const multiple = st.labels.length > 1;

  const modePills = `<div class="subtab-row" style="margin:0;">
    <button class="subtab-btn ${sec.mode==='atPort'?'active':''}" data-action="ts-mode" data-value="atPort">At Port</button>
    <button class="subtab-btn ${sec.mode==='atSea'?'active':''}" data-action="ts-mode" data-value="atSea">At Sea</button>
  </div>`;

  if(sec.mode==='atSea'){
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>${data.title}${cteProductTag(sec.main)}</h2><p>${data.desc}</p></div>
          <div class="card-top-actions">${renderInfoButton('transshipment')}${tsRCSToggleHTML(sec)}</div>
        </div>
        ${modePills}
        <div style="height:16px"></div>
        ${renderInstanceSubtabs('transshipment', data.instanceBase)}
        <div class="ovp-disabled-note" style="margin-top:16px;">At Sea transshipment isn't built out yet — in progress. Switch to "At Port" for now.</div>
      </div>`;
  }

  if(sec.rcs === null){
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>${data.title}${cteProductTag(sec.main)}</h2><p>${data.desc}</p></div>
          <div class="card-top-actions">${renderInfoButton('transshipment')}</div>
        </div>
        ${modePills}
        <div style="height:16px"></div>
        ${renderInstanceSubtabs('transshipment', data.instanceBase)}
        <div class="ts-rcs-question">
          <p>Is this an RCS (Reefer Container Shipment) or a normal carrier transshipment?</p>
          <div class="ts-rcs-question-btns">
            <button class="btn btn-outline" data-action="ts-choose-rcs" data-value="false">Normal Carrier</button>
            <button class="btn btn-primary" data-action="ts-choose-rcs" data-value="true">RCS</button>
          </div>
        </div>
      </div>`;
  }

  const rcsBlock = sec.rcs ? `
    <div class="section-label">Reefer Container Shipment</div>
    <div class="field-grid">
      <div class="field"><label>No. of containers</label><input type="text" id="ts-containers" value="${sec.containers}" oninput="recalcTransshipment()"></div>
      <div class="field"><label>GW</label>${buildSelect('ts-gw::'+st.active, data.gwOptions, {value:sec.gw})}</div>
      <div class="field"><label>type</label>${buildSelect('ts-type::'+st.active, ['FCL','LCL'], {value:sec.type})}</div>
      <div class="field"><label>FCL GW (MT) × No. of TEU</label>
        <div class="unit-row"><input type="text" id="ts-fclgwteu" class="is-computed" readonly value="0.00"><div class="unit">mt</div></div>
      </div>
      <div class="field"><label>Water usage</label>
        <div class="unit-row"><input type="text" id="ts-water-on" value="${sec.waterOn}"><div class="unit">Ltr</div></div>
      </div>
      <div class="field"><label>Distance Travelled</label>
        <div class="unit-row"><input type="text" id="ts-distance-on" value="${sec.distanceOn}" oninput="recalcTransshipment()"><div class="unit">Km</div></div>
      </div>
    </div>
  ` : `
    <div class="section-label">Reefer Carrier</div>
    <div class="field-grid">
      <div class="field">
        <label>Weight or Quantity <span class="req">*</span></label>
        <div class="unit-row weight-unit-row">
          <input type="text" id="ts-weight-input" value="${sec.weightOff.value}" oninput="onTSWeightChange(this)">
          <div class="seg-toggle-sm">
            <button type="button" class="seg-opt-sm ${sec.weightOff.unit==='mt'?'active':''}" data-action="ts-unit" data-unit="mt">MT</button>
            <button type="button" class="seg-opt-sm ${sec.weightOff.unit==='kg'?'active':''}" data-action="ts-unit" data-unit="kg">KG</button>
          </div>
        </div>
      </div>
      <div class="field"><label>Distance Travelled</label>
        <div class="unit-row"><input type="text" id="ts-distance-off" value="${sec.distanceOff}" oninput="recalcTransshipment()"><div class="unit">Km</div></div>
      </div>
      <div class="field"><label>Water usage</label>
        <div class="unit-row"><input type="text" id="ts-water-off" value="${sec.waterOff}"><div class="unit">Ltr</div></div>
      </div>
    </div>
  `;

  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${data.title}${cteProductTag(sec.main)}</h2><p>${data.desc}</p></div>
        <div class="card-top-actions">${renderInfoButton('transshipment')}${tsRCSToggleHTML(sec)}</div>
      </div>
      ${bottomBar(data.metrics, data.checkbox, multiple, 'transshipment', {label:'Total Volume', initial: sec.rcs?'–':sec.weightOff.value, unit: sec.rcs?'':sec.weightOff.unit.toUpperCase(), tooltip:'We have considered the average total volume in a reefer carrier.'})}
      ${modePills}
      <div style="height:16px"></div>
      ${renderInstanceSubtabs('transshipment', data.instanceBase)}
      <div style="height:16px"></div>
      ${fieldGrid(sec.main, 'transship-main::'+st.active)}
      ${rcsBlock}
    </div>
  `;
}

function renderInstanceSubtabs(cteKey, baseLabel){
  const st = instanceState[cteKey];
  return `<div class="subtab-scroll">
    ${st.labels.map((l,i)=>{
      const empty = isSectionsEmpty(st.data[l]);
      return `<div class="subtab-pill-wrap ${l===st.active?'active':''}">
        <button class="subtab-pill ${l===st.active?'active':''} ${empty?'is-empty':''}" data-action="instance-tab" data-cte="${cteKey}" data-value="${l}">${l}</button>
        ${i>0?`<button class="subtab-close" data-action="instance-remove" data-cte="${cteKey}" data-value="${l}" title="Remove ${l}">✕</button>`:''}
      </div>`;
    }).join('')}
    <button class="subtab-add" data-action="instance-add" data-cte="${cteKey}" data-base="${baseLabel}" title="Add another ${baseLabel.toLowerCase()}">+</button>
  </div>`;
}


/* ---------- PREMIUM SELECT ---------- */
const tagsState = {}; // keyed by field id: {selected:[...], options:[...], open:false}
function tagsVal(id, fallbackSelected, allOptions){
  if(!(id in tagsState)){
    tagsState[id] = {
      selected: Array.isArray(fallbackSelected) ? [...fallbackSelected] : [fallbackSelected],
      options: allOptions || [],
      open: false,
    };
  }
  return tagsState[id];
}
function buildTagsField(id, allOptions, fallbackSelected){
  const st = tagsVal(id, fallbackSelected, allOptions);
  const remaining = st.options.filter(o => !st.selected.includes(o));
  return `
    <div class="tags-field">
      <div class="chip-row">
        ${st.selected.map(t=>`<span class="chip">${t}<span class="x" data-action="tag-remove" data-id="${id}" data-value="${t.replace(/"/g,'&quot;')}">✕</span></span>`).join('')}
        ${remaining.length>0 ? `<button type="button" class="chip-add" data-action="tag-add-toggle" data-id="${id}">+ Add</button>` : ''}
      </div>
      ${st.open ? `
        <div class="tags-menu">
          ${remaining.map(o=>`<div class="tags-option" data-action="tag-add-option" data-id="${id}" data-value="${o.replace(/"/g,'&quot;')}">${o}</div>`).join('')}
        </div>
      ` : ''}
    </div>`;
}

function buildSelect(id, options, field){
  const st = selVal(id, field.value);
  const isPlaceholder = !st.value || st.value==='Select an option';
  const descriptions = field.descriptions || null;
  return `
    <div class="pm-select ${st.open?'open':''} ${descriptions?'pm-select-described':''}" data-select-root="${id}">
      <button type="button" class="pm-select-trigger ${isPlaceholder?'placeholder':''}" data-action="select-toggle" data-id="${id}">
        <span>${st.value || 'Select an option'}</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="pm-select-menu">
        ${options.map(o=>{
          const desc = descriptions ? descriptions[o] : null;
          if(desc){
            return `
            <div class="pm-option pm-option-described ${o===st.value?'selected':''}" data-action="select-option" data-id="${id}" data-value="${o}">
              <div class="pm-option-head"><span class="pm-option-code">${o}</span>${o===st.value?'<span class="tick">✓</span>':''}</div>
              <div class="pm-option-desc">${desc}</div>
            </div>`;
          }
          return `
          <div class="pm-option ${o===st.value?'selected':''}" data-action="select-option" data-id="${id}" data-value="${o}">
            <span>${o}</span>${o===st.value?'<span class="tick">✓</span>':''}
          </div>
        `;
        }).join('')}
      </div>
    </div>`;
}

/* ---------- FIELD RENDERING ---------- */
function fieldHTML(f, ctx, idx){
  const selId = `${ctx}::${idx}::${f.label}`;
  const req = f.required ? '<span class="req"> *</span>' : '';
  const idAttr = f.id ? ` id="${f.id}"` : '';
  const roAttr = f.readonly ? ' readonly' : '';
  const onInputAttr = f.oninput ? ` oninput="${f.oninput}"` : '';
  let control = '';
  switch(f.type){
    case 'select':
      control = buildSelect(selId, f.options || [f.value], f);
      break;
    case 'daterange':{
      const [a,b] = String(f.value).split('–').map(s=>s.trim());
      control = `<div class="split2"><div class="date-field">${CALENDAR_ICON_SVG}<input type="date" value="${toISODate(a)}"></div><div class="date-field">${CALENDAR_ICON_SVG}<input type="date" value="${toISODate(b)}"></div></div>`;
      break;
    }
    case 'datetime':
      control = `<div class="date-field datetime">${CALENDAR_ICON_SVG}<input type="datetime-local"${idAttr}${onInputAttr} value="${toISODateTime(f.value)}"></div>`;
      break;
    case 'tags':{
      control = buildTagsField(selId, f.options || (Array.isArray(f.value)?f.value:[f.value]), f.value);
      break;
    }
    case 'weightUnit':{
      const wv = f.value || {value:'', unit:'mt'};
      control = `<div class="unit-row weight-unit-row">
        <input type="text" id="${f.id||'hv-weight-input'}" value="${wv.value}" oninput="onHarvestWeightChange(this)">
        <div class="seg-toggle-sm">
          <button type="button" class="seg-opt-sm ${wv.unit==='mt'?'active':''}" data-action="hv-unit" data-unit="mt">MT</button>
          <button type="button" class="seg-opt-sm ${wv.unit==='kg'?'active':''}" data-action="hv-unit" data-unit="kg">KG</button>
        </div>
      </div>`;
      break;
    }
    case 'url':
      control = `<input type="url" class="is-link"${idAttr}${roAttr}${onInputAttr} value="${f.value||''}" placeholder="${f.placeholder||''}">`;
      break;
    case 'number':
      control = f.unit
        ? `<div class="unit-row"><input type="text"${idAttr}${roAttr}${onInputAttr} class="${f.readonly?'is-computed':''}" value="${f.value||''}"><div class="unit">${f.unit}</div></div>`
        : `<input type="text"${idAttr}${roAttr}${onInputAttr} class="${f.readonly?'is-computed':''}" value="${f.value||''}">`;
      break;
    default:
      control = `<input type="text"${idAttr}${roAttr}${onInputAttr} value="${f.value||''}" placeholder="${f.placeholder||''}">`;
  }
  return `<div class="field ${f.full?'full':''}"><label>${f.label}${req}</label>${control}</div>`;
}

function fieldGrid(fields, ctx){
  return `<div class="field-grid">${fields.map((f,i)=>fieldHTML(f, ctx, i)).join('')}</div>`;
}

function subtabRow(list, active, group){
  return `<div class="subtab-row">${list.map(s=>
    `<button class="subtab-btn ${s===active?'active':''}" data-action="subtab" data-group="${group}" data-value="${s}">${s}</button>`
  ).join('')}</div>`;
}

function headerToggle(label){
  if(!label) return '';
  return `<label class="pill-toggle">${label}<span class="switch"><input type="checkbox" checked><span class="track"></span></span></label>`;
}

function splitMetric(v){
  const s = String(v).trim();
  if(s==='—' || s==='') return {value:'—', unit:''};
  const m = s.match(/^([\d,.\-–]+)\s*(.*)$/);
  return m ? {value:m[1], unit:m[2]} : {value:s, unit:''};
}

const METRIC_ICON_TOTAL = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 18C4.79 18 3 16.21 3 14C3 12.03 4.42 10.39 6.29 10.06C6.83 7.72 8.92 6 11.4 6C14.15 6 16.4 8.13 16.58 10.83C18.55 11.14 20.05 12.85 20.05 14.9C20.05 17.17 18.21 19 15.95 19H7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const METRIC_ICON_PERKG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3V21M12 3L8 7M12 3L16 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15C4 15 4.5 12 6.5 12C8.5 12 9 15 9 15C9 15 8.5 18 6.5 18C4.5 18 4 15 4 15Z" stroke="currentColor" stroke-width="1.6"/><path d="M15 15C15 15 15.5 12 17.5 12C19.5 12 20 15 20 15C20 15 19.5 18 17.5 18C15.5 18 15 15 15 15Z" stroke="currentColor" stroke-width="1.6"/></svg>`;
const METRIC_ICON_YIELD = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.5L9 17.5L20 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const METRIC_ICON_OTHER = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3V11M12 11L6 17M12 11L18 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="19" r="1.8" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="19" r="1.8" stroke="currentColor" stroke-width="1.6"/></svg>`;
const METRIC_ICON_WEIGHT = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 8L12 12M12 12L20 8M12 12V20" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

function bottomBar(metrics, checkboxLabel, checked=false, cteKey=null, weightConfig=null){
  const isConfirmed = cteKey && state.confirmed[cteKey];
  const weightCard = weightConfig ? `
    <div class="metric">
      <div class="metric-icon metric-icon-blue">${METRIC_ICON_WEIGHT}</div>
      <div class="metric-body">
        <div class="metric-row"><input type="text" inputmode="decimal" class="metric-input is-computed" id="bb-weight-value" readonly value="${weightConfig.initial||''}"><span class="metric-unit" id="bb-weight-unit">${weightConfig.unit||''}</span></div>
        <div class="l">${weightConfig.label}${weightConfig.tooltip?tooltip(weightConfig.tooltip):''}</div>
      </div>
    </div>
  ` : '';
  return `<div class="bottombar">
    <div class="metrics">${weightCard}${metrics.map((m,i)=>{
      const {value,unit} = splitMetric(m.v);
      const idAttr = m.id ? ` id="${m.id}"` : '';
      const roAttr = m.readonly ? ' readonly' : '';
      const cycle = [
        [METRIC_ICON_TOTAL, 'metric-icon-green'],
        [METRIC_ICON_PERKG, 'metric-icon-teal'],
        [METRIC_ICON_YIELD, 'metric-icon-amber'],
        [METRIC_ICON_OTHER, 'metric-icon-violet'],
      ][i%4];
      const [icon, iconClass] = cycle;
      return `<div class="metric">
        <div class="metric-icon ${iconClass}">${icon}</div>
        <div class="metric-body">
          <div class="metric-row"><input type="text" inputmode="decimal" class="metric-input${m.readonly?' is-computed':''}"${idAttr}${roAttr} value="${value}"><span class="metric-unit">${unit}</span></div>
          <div class="l">${m.l}</div>
        </div>
      </div>`;
    }).join('')}</div>
    <div class="right">
      ${checkboxLabel?`<label class="check"><input type="checkbox" ${checked?'checked':''}> ${checkboxLabel}</label>`:''}
      ${cteKey ? `<button class="btn ${isConfirmed?'btn-confirmed':'btn-primary'}" data-action="submit-cte" data-cte="${cteKey}">${isConfirmed?'✓ Confirmed':'Submit'}</button>`
               : `<button class="btn btn-primary">Submit</button>`}
    </div>
  </div>`;
}

/* ---------- TAB RENDERERS ---------- */
function ovpToggleHTML(){
  return `<label class="pill-toggle">Enable<span class="switch"><input type="checkbox" ${state.ovpEnabled?'checked':''} data-action="ovp-toggle"><span class="track"></span></span></label>`;
}

// OVP and Ship/Receive never went through ensureInstance()'s clone-per-
// instance pattern like the other CTEs — they read/wrote CTE_DATA's
// field arrays directly. That's fine for a single demo session, but it
// means any override (shipment-launch or fresh-calculation-reset) would
// permanently mutate the SAME object the demo displays. These lazy-
// cloned working copies fix that: everything reads/writes here instead,
// leaving CTE_DATA.onVesselProcessing/shipReceive untouched as the
// permanent demo reference.
let ovpFieldsWorking = null;
function getOVPFields(){
  if(!ovpFieldsWorking) ovpFieldsWorking = JSON.parse(JSON.stringify(CTE_DATA.onVesselProcessing.fields));
  return ovpFieldsWorking;
}
let shipReceiveFieldsWorking = null;
function getShipReceiveFields(){
  if(!shipReceiveFieldsWorking) shipReceiveFieldsWorking = {
    common: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.commonFields)),
    sea: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.seaFields)),
    air: JSON.parse(JSON.stringify(CTE_DATA.shipReceive.airFields)),
  };
  return shipReceiveFieldsWorking;
}

function renderOVP(){
  const data = CTE_DATA.onVesselProcessing;
  const workingFields = getOVPFields();
  ensureOVPWeight();

  if(shipmentOverrides && !ovpShipmentApplied){
    applyLabelOverrides(workingFields, shipmentOverrides.ovp);
    applySpeciesTagsOverride('ovp-main', workingFields, shipmentOverrides.ovpSpecies);
    if(shipmentOverrides.ovpWeight) ovpCalc.weight = { ...shipmentOverrides.ovpWeight };
    ovpShipmentApplied = true;
  }

  if(!state.ovpEnabled){
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>${data.title}</h2><p>${data.desc}</p></div>
          ${ovpToggleHTML()}
        </div>
        <div class="ovp-disabled-note">On Vessel Processing isn't available for this batch. Switch "Enable" on above if this vessel does perform onboard processing.</div>
      </div>`;
  }

  const refrigOptions = data.refrigerants.map(r=>r.label);

  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${data.title}${cteProductTag(workingFields)}</h2><p>${data.desc}</p></div>
        <div class="card-top-actions">${renderInfoButton('onVesselProcessing')}${ovpToggleHTML()}</div>
      </div>
      ${bottomBar(data.metrics, null, false, 'ovp', {label:'Total Volume', initial:ovpCalc.weight.value, unit:ovpCalc.weight.unit.toUpperCase()})}
      <div style="height:16px"></div>
      ${fieldGrid(workingFields, 'ovp-main')}

      <div class="section-label">Weight &amp; Yield</div>
      <div class="field-grid">
        <div class="field">
          <label>Weight or Quantity <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="ovp-weight-input" value="${ovpCalc.weight.value}" oninput="onOVPWeightChange(this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${ovpCalc.weight.unit==='mt'?'active':''}" data-action="ovp-unit" data-unit="mt">MT</button>
              <button type="button" class="seg-opt-sm ${ovpCalc.weight.unit==='kg'?'active':''}" data-action="ovp-unit" data-unit="kg">KG</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Yield %</label>
          <div class="unit-row"><input type="text" id="ovp-yield-pct" value="${ovpCalc.yieldPct}" oninput="onOVPYieldChange(this)"><div class="unit">%</div></div>
        </div>
        <div class="field">
          <label>Yield of Weight or Quantity</label>
          <div class="unit-row"><input type="text" id="ovp-yield-weight" class="is-computed" readonly value="0.00"><div class="unit" id="ovp-yield-unit-label">${ovpCalc.weight.unit}</div></div>
        </div>
      </div>

      <div class="section-label">Emission Factors</div>
      <div class="emission-rows">
        <div class="emission-row emission-row-3col">
          <div class="field"><label>Refrigeration Energy</label>
            <div class="unit-row"><input type="text" id="ovp-refrig-energy" value="0.023" oninput="recalcOVP()"><div class="unit">kg</div></div>
          </div>
          <div class="field"><label>of</label>${buildSelect('ovp-refrigerant', refrigOptions, {value:'R717 (NH3)'})}</div>
          <div class="field"><label>Emission</label>
            <div class="unit-row"><input type="text" id="ovp-em-refrig" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
          </div>
        </div>

        <div class="emission-row emission-row-2col">
          <div class="field"><label>Electricity Consumption <span class="req">*</span></label>
            <div class="unit-row"><input type="text" id="ovp-electricity" value="100.00" oninput="recalcOVP()"><div class="unit">Kwh</div></div>
          </div>
          <div class="field"><label>Emission</label>
            <div class="unit-row"><input type="text" id="ovp-em-electricity" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
          </div>
        </div>

        <div class="emission-row emission-row-2col">
          <div class="field"><label>Water Usage <span class="req">*</span></label>
            <div class="unit-row"><input type="text" id="ovp-water" value="0.00" oninput="recalcOVP()"><div class="unit">Ltr</div></div>
          </div>
          <div class="field"><label>Emission</label>
            <div class="unit-row"><input type="text" id="ovp-em-water" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
          </div>
        </div>

        <div class="emission-row emission-row-2col">
          <div class="field"><label>Waste Water <span class="req">*</span></label>
            <div class="unit-row"><input type="text" id="ovp-wastewater" value="0.00" oninput="recalcOVP()"><div class="unit">Ltr</div></div>
          </div>
          <div class="field"><label>Emission</label>
            <div class="unit-row"><input type="text" id="ovp-em-wastewater" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
          </div>
        </div>

        <div class="emission-row emission-row-2col">
          <div class="field"><label>Fuel Consumption <span class="req">*</span></label>
            <div class="unit-row"><input type="text" id="ovp-fuel" value="30.00" oninput="recalcOVP()"><div class="unit">Ltr</div></div>
          </div>
          <div class="field"><label>Emission</label>
            <div class="unit-row"><input type="text" id="ovp-em-fuel" class="is-computed" readonly value="0.00"><div class="unit">kg CO₂e</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGenericTab(data, ctx, subKey){
  if(data.instanceBase){
    const initial = { main: data.fields, emission: data.emissionFields };
    const st = ensureInstance(ctx, data.instanceBase, initial);
    const sec = st.data[st.active];
    if(ctx==='harvesting' && shipmentOverrides && !sec._shipmentApplied){
      applyLabelOverrides(sec.main, shipmentOverrides.harvesting);
      applySpeciesTagsOverride(ctx+'-main::'+st.active, sec.main, shipmentOverrides.harvestingSpecies);
      if(shipmentOverrides.harvestingDates){
        const dateField = sec.main.find(f=>f.type==='daterange');
        if(dateField) dateField.value = shipmentOverrides.harvestingDates;
      }
      if(shipmentOverrides.harvestingWeight){
        const wf = findWeightField(sec);
        if(wf) wf.value = { ...shipmentOverrides.harvestingWeight };
      }
      sec._shipmentApplied = true;
    }
    if(ctx==='harvesting' && freshCalcMode && !sec._freshApplied){
      applyFreshReset(sec, []); // no emission-factor fields to preserve here
      sec._freshApplied = true;
    }
    const multiple = st.labels.length > 1;
    const wField = findWeightField(sec);
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>${data.title}${cteProductTag(sec.main)}</h2><p>${data.desc}</p></div>
          <div class="card-top-actions">${renderInfoButton(ctx)}${headerToggle(data.headerToggle)}</div>
        </div>
        ${bottomBar(data.metrics, data.checkbox, multiple, ctx, {label:'Total Volume', initial: wField?wField.value.value:'', unit: wField?wField.value.unit.toUpperCase():''})}
        ${renderInstanceSubtabs(ctx, data.instanceBase)}
        <div style="height:16px"></div>
        ${fieldGrid(sec.main, ctx+'-main::'+st.active)}
        ${data.emissionHead ? `
          <div class="section-label">${data.emissionHead}</div>
          ${fieldGrid(sec.emission, ctx+'-emission::'+st.active)}
        ` : ''}
        ${data.constFactors ? renderConstFactors(data.constFactors) : ''}
      </div>
    `;
  }
  const sub = data.subtabs ? subtabRow(data.subtabs, state[subKey], subKey) : '';
  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${data.title}${cteProductTag(data.fields)}</h2><p>${data.desc}</p></div>
        ${headerToggle(data.headerToggle)}
      </div>
      ${bottomBar(data.metrics, data.checkbox, false, ctx)}
      ${sub}
      <div style="height:16px"></div>
      ${fieldGrid(data.fields, ctx+'-main')}
      ${data.emissionHead ? `
        <div class="section-label">${data.emissionHead}</div>
        ${fieldGrid(data.emissionFields, ctx+'-emission')}
      ` : ''}
      ${data.constFactors ? renderConstFactors(data.constFactors) : ''}
      ${data.meterRow ? renderMeterRow(data.meterRow, ctx+'-meter') : ''}
    </div>
  `;
}

function renderMeterRow(rows, ctx){
  return `<div class="field-grid" style="margin-top:6px;">
    ${rows.map((r,i)=>`
      <div class="field">
        <label>${r.label}${r.required?'<span class="req"> *</span>':''}</label>
        <div class="unit-row"><input type="text" value="${r.value}"><div class="unit">${r.unit}</div></div>
        ${r.emission!==null?`<div style="font-size:11px;color:var(--ink-400);margin-top:4px;">Emission: <b style="color:var(--ink-700)">${r.emission}</b></div>`:''}
      </div>
    `).join('')}
  </div>`;
}

function renderConstFactors(cf){
  return `
    <div class="section-label" style="text-align:center;">${cf.heading}</div>
    <div class="section-note">${cf.note}</div>
    <div class="emission-boxes" style="grid-template-columns:repeat(${cf.groups.length},1fr);">
      ${cf.groups.map(g=>`
        <div class="emission-box">
          <h4>${g.title}</h4>
          ${g.rows.map(([l,v])=>`<div class="field" style="margin-bottom:10px;"><label>${l}</label><input type="text" value="${v}"></div>`).join('')}
        </div>
      `).join('')}
    </div>`;
}

function renderProcessing(){
  const sub = state.processingSub;
  if(sub==='Transformation'){
    const inner = CTE_DATA.processing.transformation;
    const initial = {
      main: inner.fields,
      weight:{value:'258,265.00', unit:'kg'},
      yieldPct:'40',
      yieldUnit:'kg',
      datesOpen:false,
      productionDate:'',
      expiryDate:'Aug 7, 2026',
      factorFields: inner.factorFields,
      tagFields: inner.tagFields,
    };
    const st = ensureInstance('transformation', inner.instanceBase, initial);
    const sec = st.data[st.active];
    if(shipmentOverrides && !sec._shipmentApplied){
      applyLabelOverrides(sec.main, shipmentOverrides.transformation);
      if(shipmentOverrides.transformationWeight) sec.weight = { ...shipmentOverrides.transformationWeight };
      sec._shipmentApplied = true;
    }
    if(freshCalcMode && !sec._freshApplied){
      applyFreshReset(sec, ['factorFields']); // preserve the 11 emission factors
      sec.yieldPct = ''; sec.productionDate = ''; sec.expiryDate = ''; // flat strings blankSections() won't touch
      sec._freshApplied = true;
    }
    const multiple = st.labels.length > 1;
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>Transformation${cteProductTag(sec.main)}</h2><p>${inner.desc}</p></div>
          <div class="card-top-actions">${renderInfoButton('transformation')}</div>
        </div>
        ${bottomBar(inner.metrics, inner.checkbox, multiple, 'transformation', {label:'Total Volume', initial:sec.weight.value, unit:sec.weight.unit.toUpperCase()})}
        ${subtabRow(CTE_DATA.processing.subtabs, sub, 'processingSub')}
        ${renderInstanceSubtabs('transformation', inner.instanceBase)}
        <div style="height:16px"></div>
        ${fieldGrid(sec.main, 'transform-main::'+st.active)}

        <button type="button" class="collapse-toggle" data-action="tf-dates-toggle">
          <span>Production &amp; Expiry Dates <span class="collapse-note">(optional)</span></span>
          <span class="collapse-chev ${sec.datesOpen?'open':''}">⌄</span>
        </button>
        <div class="collapse-panel ${sec.datesOpen?'open':''}">
          <div class="field-grid" style="margin-top:14px;">
            <div class="field"><label>Production Date</label><div class="date-field">${CALENDAR_ICON_SVG}<input type="date" id="tf-production-date" value="${toISODate(sec.productionDate)}" oninput="onTransformDateChange('productionDate',this)"></div></div>
            <div class="field"><label>Expiry Date</label><div class="date-field">${CALENDAR_ICON_SVG}<input type="date" id="tf-expiry-date" value="${toISODate(sec.expiryDate)}" oninput="onTransformDateChange('expiryDate',this)"></div></div>
          </div>
        </div>

        <div class="field-grid" style="margin-top:22px;">
          <div class="field">
            <label>Weight or Quantity <span class="req">*</span></label>
            <div class="unit-row weight-unit-row">
              <input type="text" id="tf-weight-input" value="${sec.weight.value}" oninput="onTransformWeightChange(this)">
              <div class="seg-toggle-sm">
                <button type="button" class="seg-opt-sm ${sec.weight.unit==='kg'?'active':''}" data-action="tf-weight-unit" data-unit="kg">KG</button>
                <button type="button" class="seg-opt-sm ${sec.weight.unit==='mt'?'active':''}" data-action="tf-weight-unit" data-unit="mt">MT</button>
              </div>
            </div>
          </div>
          <div class="field">
            <label>Yield %</label>
            <div class="unit-row"><input type="text" id="tf-yield-pct" value="${sec.yieldPct}" oninput="onTransformYieldPctChange(this)"><div class="unit">%</div></div>
          </div>
          <div class="field">
            <label>Yield of Weight or Quantity</label>
            <div class="unit-row weight-unit-row">
              <input type="text" id="tf-yield-weight" class="is-computed" readonly value="0.00">
              <div class="seg-toggle-sm">
                <button type="button" class="seg-opt-sm ${sec.yieldUnit==='kg'?'active':''}" data-action="tf-yield-unit" data-unit="kg">KG</button>
                <button type="button" class="seg-opt-sm ${sec.yieldUnit==='mt'?'active':''}" data-action="tf-yield-unit" data-unit="mt">MT</button>
              </div>
            </div>
          </div>
        </div>

        <div class="section-label">${inner.factorsHead}</div>
        ${fieldGrid(sec.factorFields, 'transform-factors::'+st.active)}
        ${fieldGrid(sec.tagFields, 'transform-tags::'+st.active)}
      </div>
    `;
  }else{
    const inner = CTE_DATA.processing.storage;
    const initial = {
      main: inner.fields,
      weight:'', weightPulled:false,
      electricPerKg: inner.electricityConstants[0][1], efElectricity: inner.electricityConstants[1][1],
      refrigPerKg: inner.refrigerantConstants[0][1], gwp: inner.refrigerantConstants[1][1],
      refrigEnabled:false,
    };
    const st = ensureInstance('storage', inner.instanceBase, initial);
    const sec = st.data[st.active];
    if(freshCalcMode && !sec._freshApplied){
      applyFreshReset(sec, ['electricPerKg','efElectricity','refrigPerKg','gwp']);
      sec.weight = ''; sec.weightPulled = false; // force a clean re-pull from Transformation
      sec._freshApplied = true;
    }
    ensureStorageWeight(sec);
    const multiple = st.labels.length > 1;
    return `
      <div class="card">
        <div class="card-top">
          <div><h2>Storage</h2><p>${inner.desc}</p></div>
          <div class="card-top-actions">${renderInfoButton('storage')}</div>
        </div>
        ${bottomBar(inner.metrics, inner.checkbox, multiple, 'storage', {label:'Total Volume', initial:sec.weight, unit:'KG'})}
        ${subtabRow(CTE_DATA.processing.subtabs, sub, 'processingSub')}
        ${renderInstanceSubtabs('storage', inner.instanceBase)}
        <div style="height:16px"></div>
        ${fieldGrid(sec.main, 'storage-main::'+st.active)}

        <div class="field-grid" style="margin-top:2px;">
          <div class="field">
            <label>Yield of Weight</label>
            <div class="unit-row"><input type="text" id="st-weight-input" value="${sec.weight}" oninput="onStorageWeightChange(this)"><div class="unit">kg</div></div>
          </div>
        </div>

        <div class="emission-boxes" style="grid-template-columns:1fr 1fr;">
          <div class="emission-box">
            <h4>Electricity</h4>
            <div class="field" style="margin-bottom:10px;"><label>Electricity consumption</label><input type="text" id="st-electricity" class="is-computed" readonly value="0.00"></div>
            <div class="field" style="margin-bottom:10px;"><label>Electricity usage per kg</label><input type="text" id="st-elec-perkg" value="${sec.electricPerKg}" oninput="recalcStorage()"></div>
            <div class="field"><label>EF of Electricity</label><input type="text" id="st-ef-elec" value="${sec.efElectricity}" oninput="recalcStorage()"></div>
          </div>
          <div class="emission-box">
            <h4>Refrigeration ${storageRefrigToggleHTML(sec)}</h4>
            <div class="field" style="margin-bottom:10px;"><label>Refrigeration Energy</label><input type="text" id="st-refrig" class="is-computed" readonly value="0.00"></div>
            <div class="field" style="margin-bottom:10px;"><label>Average Refrigerant emission (per kg)</label><input type="text" id="st-refrig-perkg" value="${sec.refrigPerKg}" oninput="recalcStorage()"></div>
            <div class="field"><label>GWP</label><input type="text" id="st-gwp" value="${sec.gwp}" oninput="recalcStorage()"></div>
          </div>
        </div>
      </div>
    `;
  }
}

function pkgTable(data, isCirc){
  const cols = data.cols;
  return `
    <table class="pkg-table">
      <thead><tr><th style="width:70px;">${isCirc?'':'CTE'}</th><th>KDE's</th>${cols.map(c=>`<th>${c}</th>`).join('')}${!isCirc?'<th>Scope</th>':''}</tr></thead>
      <tbody>
        ${data.rows.map((r,i)=>`
          <tr>
            ${i===0 ? `<td class="rowhead" rowspan="${data.rows.length}">${isCirc?'Packaging<br>Circularity':'Packaging'}</td>` : ''}
            <td>${r.label}</td>
            ${r.span!==undefined
              ? `<td colspan="${cols.length}" style="text-align:${isCirc?'center':'left'};">${r.span}</td>`
              : r.vals.map(v=>`<td ${r.bold?'style="font-weight:800;"':''}>${v}</td>`).join('')}
            ${(!isCirc && i===0) ? `<td rowspan="${data.rows.length}" style="text-align:center;font-weight:700;">${data.scope}</td>` : ''}
          </tr>
        `).join('')}
        ${!isCirc ? `<tr><td colspan="${cols.length+2}" class="grand" style="text-align:center;">${data.grandTotal}</td></tr>` : ''}
      </tbody>
    </table>`;
}

function renderPackaging(){
  const sub = state.packagingSub;
  const isEmission = sub==='Packaging Emission';
  const d = CTE_DATA.packaging;
  if(shipmentOverrides?.packagingFacility) d.productInfo.facility = shipmentOverrides.packagingFacility;

  if(!isEmission){
    return `
      <div class="card">
        <div class="card-top"><div><h2>Packaging</h2></div></div>
        ${subtabRow(d.subtabs, sub, 'packagingSub')}
        <div style="height:16px"></div>
        <div class="pkg-layout"><div>${pkgTable(d.circularity, true)}</div></div>
      </div>
      <div style="height:26px"></div>
    `;
  }

  const breakdown = computePackagingBreakdown();
  const columns = ['Primary Pkg','Secondary Pkg','Tertiary Pkg'];
  const layerKeys = ['primary','secondary','tertiary'];
  const layers = [breakdown.primary, breakdown.secondary, breakdown.tertiary];
  const rowsMeta = [
    {label:'Packaging Type', kind:'type'},
    {label:'Packaging Material', kind:'material'},
    {label:'Packaging Quantity (g)', kind:'qty'},
    {label:'Emission (kg CO₂e)', kind:'emission'},
  ];
  const capacityG = parseNum(packagingContext.netWeightG) * parseNum(packagingContext.innerUnit);
  const cartonTier = CARTON_SIZE_TIERS.find(t=>capacityG>=t.capMin && capacityG<=t.capMax) || CARTON_SIZE_TIERS[CARTON_SIZE_TIERS.length-1];

  return `
    <div class="card">
      <div class="card-top">
        <div><h2>Packaging</h2><p>Emissions embodied in the primary, secondary, and tertiary packaging materials used for this product.</p></div>
        <div class="card-top-actions"><span class="scope-badge">${d.scope}</span></div>
      </div>
      ${subtabRow(d.subtabs, sub, 'packagingSub')}
      <div style="height:16px"></div>

      <div class="pkg-info-table">
        <div class="pkg-info-row"><div class="pkg-info-label">Packaging Facility</div><div class="pkg-info-value">${d.productInfo.facility}</div></div>
        <div class="pkg-info-row"><div class="pkg-info-label">Traceability Lot Code</div><div class="pkg-info-value">${d.productInfo.lotCode}</div></div>
        <div class="pkg-info-row"><div class="pkg-info-label">GTIN</div><div class="pkg-info-value">${d.productInfo.gtin}</div></div>
        <div class="pkg-info-row highlight"><div class="pkg-info-label">Product</div><div class="pkg-info-value">${d.productInfo.product}</div></div>
      </div>

      <div style="height:20px"></div>
      <div class="section-label">Packaging Inputs${packagingContext.answered?'':' <span class=\"pkg-demo-tag\">demo values — not yet confirmed for this shipment</span>'}</div>
      <div class="field-grid">
        <div class="field"><label>Product Type</label>${buildSelect('pkg-product-type', Object.keys(PACKAGING_RULES), {value:packagingContext.productType})}</div>
        <div class="field"><label>Net Weight</label><div class="unit-row"><input type="text" id="pkg-net-weight" value="${packagingContext.netWeightG}" oninput="recalcPackaging()"><div class="unit">g</div></div></div>
        <div class="field"><label>Packaging Material Quantity</label><div class="unit-row"><input type="text" id="pkg-material-qty" value="${packagingContext.packagingMaterialQuantity}" oninput="recalcPackaging()"><div class="unit">g</div></div></div>
        <div class="field"><label>Inner Unit</label><input type="text" id="pkg-inner-unit" value="${packagingContext.innerUnit}" oninput="recalcPackaging()"></div>
        <div class="field"><label>Empty Wooden Pallet Weight</label><div class="unit-row"><input type="text" id="pkg-pallet-weight" value="${packagingContext.palletWeight}" oninput="recalcPackaging()"><div class="unit">kg</div></div></div>
        <div class="field"><label>Pallet Stacking Configuration</label><input type="text" id="pkg-pallet-units" value="${packagingContext.palletUnits}" oninput="recalcPackaging()" placeholder="e.g. 120 for 10×12"></div>
        <div class="field"><label>Carton Size Tier (auto)</label><input type="text" class="is-computed" readonly value="${cartonTier.tier} — Avg WT ${cartonTier.avgWtG}g (capacity ${fmtNum(capacityG,0)}g)"></div>
      </div>

      <div style="height:20px"></div>

      <div class="pkg-grid-table">
        <div class="pkg-grid-head">KDE's</div>
        ${columns.map(c=>`<div class="pkg-grid-head">${c}</div>`).join('')}

        ${[0,1,2].map(slotIdx => rowsMeta.map(rm => `
          <div class="pkg-grid-kde${rm.kind==='emission'?' emission-label':''}">${rm.kind==='type' ? `${rm.label} ${slotIdx+1}` : rm.label}</div>
          ${layerKeys.map((layerKey,colIdx)=>{
            const row = layers[colIdx][slotIdx];
            const cellId = `pkg-${layerKey}::${slotIdx}`;
            if(rm.kind==='type') return `<div class="pkg-grid-cell">${buildSelect(cellId+'::type', PKG_TYPE_OPTIONS, {value:row.type})}</div>`;
            if(rm.kind==='material') return `<div class="pkg-grid-cell">${buildSelect(cellId+'::material', PKG_MATERIAL_OPTIONS, {value:row.material})}</div>`;
            if(rm.kind==='qty') return `<div class="pkg-grid-cell"><input type="text" id="${cellId}::qty" value="${fmtNum(row.qty,3)}" oninput="recalcPackaging()"></div>`;
            return `<div class="pkg-grid-cell emission-cell"><input type="text" class="is-computed" readonly value="${fmtNum(row.emission,3)}"></div>`;
          }).join('')}
        `).join('')).join('')}

        <div class="pkg-grid-kde ttl-label">TTL Emissions (kg CO₂e)</div>
        ${layers.map(layerRows=>`<div class="pkg-grid-cell ttl-cell">${fmtNum(layerRows.reduce((a,r)=>a+r.emission,0),3)}</div>`).join('')}
      </div>

      <div class="pkg-grand-total">
        <span id="pkg-grand-total">${fmtNum(breakdown.total,3)}</span> <span>kg CO₂e</span>
      </div>
    </div>
    <div style="height:26px"></div>
  `;
}


function renderShipReceive(){
  const d = CTE_DATA.shipReceive;
  const wf = getShipReceiveFields();
  const mode = state.shipSub; // 'Sea' | 'Air'

  if(shipmentOverrides && !shipReceiveShipmentApplied){
    applyLabelOverrides(wf.common, shipmentOverrides.shipReceive);
    applyLabelOverrides(wf.sea, shipmentOverrides.shipReceive);
    if(shipmentOverrides.shipReceiveWeight) shipCalc.yieldWeight = { ...shipmentOverrides.shipReceiveWeight };
    if(shipmentOverrides.shipReceiveDistanceSea) shipCalc.distanceSea = fmtNum(shipmentOverrides.shipReceiveDistanceSea);
    shipReceiveShipmentApplied = true;
  }

  const modeFieldsHTML = mode==='Sea' ? `
    ${fieldGrid(wf.sea, 'ship-sea')}
    <div class="field-grid" style="margin-top:2px;">
      <div class="field">
        <label>Distance travelled <span class="req">*</span></label>
        <div class="unit-row"><input type="text" id="sr-distance-sea" value="${shipCalc.distanceSea}" oninput="onShipInputChange('distanceSea',this)"><div class="unit">Km</div></div>
      </div>
      <div class="field">
        <label>No. of TEU</label>
        <input type="text" id="sr-teu" value="${shipCalc.teu}" oninput="onShipInputChange('teu',this)">
      </div>
      <div class="field">
        <label>GW of Dry container</label>
        <div class="unit-row weight-unit-row">
          <input type="text" id="sr-dry-gw" value="${shipCalc.dryGW.value}" oninput="onShipInputChange('dryGW',this)">
          <div class="seg-toggle-sm">
            <button type="button" class="seg-opt-sm ${shipCalc.dryGW.unit==='kg'?'active':''}" data-action="sr-gw-unit" data-field="dryGW" data-unit="kg">KG</button>
            <button type="button" class="seg-opt-sm ${shipCalc.dryGW.unit==='mt'?'active':''}" data-action="sr-gw-unit" data-field="dryGW" data-unit="mt">MT</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>GW of Reefer container</label>
        <div class="unit-row weight-unit-row">
          <input type="text" id="sr-reefer-gw" value="${shipCalc.reeferGW.value}" oninput="onShipInputChange('reeferGW',this)">
          <div class="seg-toggle-sm">
            <button type="button" class="seg-opt-sm ${shipCalc.reeferGW.unit==='kg'?'active':''}" data-action="sr-gw-unit" data-field="reeferGW" data-unit="kg">KG</button>
            <button type="button" class="seg-opt-sm ${shipCalc.reeferGW.unit==='mt'?'active':''}" data-action="sr-gw-unit" data-field="reeferGW" data-unit="mt">MT</button>
          </div>
        </div>
      </div>
    </div>
  ` : `
    ${fieldGrid(wf.air, 'ship-air')}
    <div class="field-grid" style="margin-top:2px;">
      <div class="field">
        <label>Distance travelled <span class="req">*</span></label>
        <div class="unit-row"><input type="text" id="sr-distance-air" value="${shipCalc.distanceAir}" oninput="onShipInputChange('distanceAir',this)"><div class="unit">Km</div></div>
      </div>
      <div class="field">
        <label>Est GW of Aircraft</label>
        <div class="unit-row weight-unit-row">
          <input type="text" id="sr-aircraft-gw" value="${shipCalc.aircraftGW.value}" oninput="onShipInputChange('aircraftGW',this)">
          <div class="seg-toggle-sm">
            <button type="button" class="seg-opt-sm ${shipCalc.aircraftGW.unit==='kg'?'active':''}" data-action="sr-gw-unit" data-field="aircraftGW" data-unit="kg">KG</button>
            <button type="button" class="seg-opt-sm ${shipCalc.aircraftGW.unit==='mt'?'active':''}" data-action="sr-gw-unit" data-field="aircraftGW" data-unit="mt">MT</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const metrics = mode==='Sea' ? d.metricsSea : d.metricsAir;

  return `
    <div class="card">
      <div class="card-top">
        <div><h2>${d.title}${cteProductTag(wf.common)}</h2><p>${d.desc}</p></div>
        ${renderInfoButton('shipReceive')}
      </div>
      ${bottomBar(metrics, null, false, 'shipReceive', {label:'Total Volume', initial:`${fmtNum(parseNum(shipCalc.teu),0)} (${fmtNum(parseNum(shipCalc.distanceSea),0)} km)`, unit:'containers', tooltip:'We have considered the average number of containers and distance travelled.'})}
      <div class="subtab-row" style="margin:0;">
        <button class="subtab-btn ${mode==='Sea'?'active':''}" data-action="subtab" data-group="shipSub" data-value="Sea">Sea</button>
        <button class="subtab-btn ${mode==='Air'?'active':''}" data-action="subtab" data-group="shipSub" data-value="Air">Air</button>
      </div>
      <div style="height:16px"></div>
      ${fieldGrid(wf.common, 'ship-common')}
      ${modeFieldsHTML}
      <div class="field-grid" style="margin-top:2px;">
        <div class="field"><label>Inner Unit</label><input type="text" value="${d.innerRow.inner}"></div>
        <div class="field"><label>Gross Weight (g)</label><input type="text" value="${d.innerRow.gross}"></div>
        <div class="field"><label>Drain Weight (g)</label><input type="text" value="${d.innerRow.drain}"></div>
      </div>
      <div class="field-grid" style="margin-top:2px;">
        <div class="field">
          <label>Yield Weight or Quantity <span class="req">*</span></label>
          <div class="unit-row weight-unit-row">
            <input type="text" id="sr-yield-weight" value="${shipCalc.yieldWeight.value}" oninput="onShipInputChange('yieldWeight',this)">
            <div class="seg-toggle-sm">
              <button type="button" class="seg-opt-sm ${shipCalc.yieldWeight.unit==='kg'?'active':''}" data-action="sr-weight-unit" data-unit="kg">KG</button>
              <button type="button" class="seg-opt-sm ${shipCalc.yieldWeight.unit==='mt'?'active':''}" data-action="sr-weight-unit" data-unit="mt">MT</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTabContent(){
  switch(state.activeTab){
    case 'harvesting': return renderGenericTab(CTE_DATA.harvesting, 'harvesting');
    case 'onVesselProcessing': return renderOVP();
    case 'transshipment': return renderTransshipment();
    case 'landing': return renderLandingCTE();
    case 'aggrDisaggr': return renderAggrDisaggr();
    case 'processing': return renderProcessing();
    case 'packaging': return renderPackaging();
    case 'shipReceive': return renderShipReceive();
    default: return '';
  }
}

/* ---------- SHARED SHELL ----------
   Lifted verbatim from home-logged-in.html: hover-driven .nav-dropdown
   (no JS state needed), real icon filenames already in your /assets,
   avatar menu toggled by the same toggleAvatarMenu() used site-wide.
   TODO(supabase): greeting name / avatar initials / photo_url should
   come from the profiles row once this is wired in, same as
   home-logged-in.html's DOMContentLoaded block does. */
function topNav(){
  return `
  <div class="topbar">
    <a href="index.html" class="sc-brand">
      <img src="sc-blue-logo.png" alt="SmarTuna Concept" class="sc-brand-logo" onerror="this.style.display='none';">
      <span class="sc-brand-text"><span class="sc-blue">SMARTUNA</span><span class="sc-black">CONCEPT</span></span>
    </a>
    <div class="topbar-nav">
      <div class="nav-pill">
        <a href="home-logged-in.html" class="nav-item"><img src="home.png" alt=""/>Home</a>
        <div class="nav-item-wrap">
          <a href="organisation.html" class="nav-item active"><img src="my-studio.png" alt=""/>My Studio</a>
          <div class="nav-dropdown">
            <a href="product-list.html" class="nav-dropdown-item">Product</a>
            <a href="organisation.html" class="nav-dropdown-item">Your Company</a>
            <a href="#" class="nav-dropdown-item active">Carbon Calculator</a>
          </div>
        </div>
        <div class="nav-item-wrap">
          <a href="Species.html" class="nav-item"><img src="atlas.png" alt=""/>Atlas</a>
          <div class="nav-dropdown">
            <a href="Species.html" class="nav-dropdown-item">Species</a>
            <a href="cold-storage-list.html" class="nav-dropdown-item">Cold Storage</a>
            <a href="port-list.html" class="nav-dropdown-item">Ports</a>
            <a href="vessel-list.html" class="nav-dropdown-item">Vessels</a>
            <a href="country.html" class="nav-dropdown-item">Country</a>
          </div>
        </div>
        <a href="#" class="nav-item"><img src="features.png" alt=""/>Features</a>
        <a href="#" class="nav-item"><img src="messages.png" alt=""/>Messages</a>
        <a href="#" class="nav-item"><img src="report.png" alt=""/>Reports</a>
        <a href="report.html" class="nav-item"><img src="support.png" alt=""/>Support</a>
      </div>
    </div>
    <div class="topbar-right">
      <div class="search-pill">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Search here...
      </div>
      <div class="notif-btn"><img src="notification.png" alt=""/><div class="notif-dot"></div></div>
      <div style="position:relative;flex-shrink:0;">
        <button class="avatar-btn" id="avatarBtn" onclick="toggleAvatarMenu()"><span id="avatarInitials">VI</span></button>
        <div class="avatar-menu" id="avatarMenu">
          <div class="avatar-menu-name" id="avatarGreeting">Hello!</div>
          <a href="profile.html"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>Profile</a>
          <button onclick="handleLogout()">Logout</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* Same functions home-logged-in.html defines globally — kept identical
   so this file behaves the same way once it's sitting in your repo. */
function toggleAvatarMenu(){ document.getElementById('avatarMenu')?.classList.toggle('open'); }
document.addEventListener('click', e=>{
  if(!e.target.closest('.avatar-btn')) document.getElementById('avatarMenu')?.classList.remove('open');
});
async function handleLogout(){
  // TODO(supabase): await dbClient.auth.signOut(); window.location.href='index.html';
  window.location.href = 'index.html';
}

function renderLanding(){
  return `
  ${topNav()}
  <div class="page-wrap">
    <div class="page-header">
      <div>
        <h1>Carbon Footprint Calculator</h1>
        <div class="sub">Trace emissions across your seafood supply chain using GDST-compliant Critical Tracking Events (CTEs) and Key Data Elements (KDEs).</div>
      </div>
      <button class="btn btn-outline btn-sm">View past calculations</button>
    </div>

    <div class="stat-row">
      <div class="stat-card"><b>8</b><span>Critical Tracking Events mapped, from Harvesting through Ship/Receive</span></div>
      <div class="stat-card"><b>2</b><span>Production types supported today — Wild Capture and Aquaculture</span></div>
      <div class="stat-card"><b>GDST</b><span>Built on GDST-compliant Critical Tracking Events and Key Data Elements</span></div>
      <div class="stat-card"><b>CO₂e</b><span>Every stage rolls up into one per-kg carbon footprint for the final product</span></div>
    </div>

    <div class="hero-grid">
      <div class="hero-panel">
        <video class="hero-video" autoplay muted loop playsinline>
          <source src="cf-hero.mp4" type="video/mp4">
        </video>
        <div class="hero-overlay"></div>
        <div class="hero-icon">
          <svg width="42" height="42" viewBox="0 0 46 46" fill="none"><rect x="0" y="0" width="20" height="20" rx="5" stroke="white" stroke-width="2.5"/><rect x="26" y="0" width="20" height="20" rx="5" fill="white"/><rect x="0" y="26" width="20" height="20" rx="5" fill="white"/><rect x="26" y="26" width="20" height="20" rx="5" stroke="white" stroke-width="2.5"/></svg>
        </div>
        <h2>Know the footprint<br>behind every catch.</h2>
        <p>Pick a processor and production type to pull in the relevant catch data and CTE records — the calculator does the rest, stage by stage.</p>
      </div>

      <div class="select-card">
        <h3>Please select the following</h3>
        <p>These selections retrieve the relevant catch data and processor-specific information required for further processing.</p>

        <label class="field-label">Processor</label>
        <div style="margin-bottom:18px;">${buildSelect('landing-processor', ['MMP International Ltd','FCF Co. Ltd','Novamira'], {value:''})}</div>

        <label class="field-label">Select Production type</label>
        <div style="margin-bottom:8px;">${buildSelect('landing-production', ['Wild Capture','Aquaculture'], {value:'Wild Capture'})}</div>

        <div class="seg-toggle" data-pill-key="calcmode" style="margin-top:18px;">
          <button class="seg-opt ${state.calcMode!=='manual'?'active':''}" data-action="calc-mode" data-value="system">System generated</button>
          <button class="seg-opt ${state.calcMode==='manual'?'active':''}" data-action="calc-mode" data-value="manual">Manual Calculation</button>
        </div>

        <button class="btn btn-primary btn-block" data-action="proceed-landing">Proceed</button>
      </div>
    </div>
  </div>`;
}

function renderModal(){
  return `
  ${renderLanding()}
  <div class="modal-overlay">
    <div class="modal-card">
      <div>
        <h3>Wild Capture Carbon Emission Calculator</h3>
        <p class="modal-desc">Select the below to continue.</p>
        <label class="field-label">Select DRI</label>
        <!-- TODO(supabase): Raw Material module — see RAW_MATERIALS placeholder above. -->
        <div style="margin-bottom:16px;">${buildSelect('modal-dri', RAW_MATERIALS, {value:''})}</div>
        <label class="field-label">Select the Product</label>
        <!-- TODO(supabase): Product module — dbClient.from('products').select('id,name'). -->
        <div style="margin-bottom:16px;">${buildSelect('modal-product', ['Canned Tuna Chunks in Sunflower Oil','Canned Tuna','Frozen Loin','Whole Round'], {value:''})}</div>
        <label class="field-label">Select the Destination</label>
        <div class="seg-toggle seg-toggle-xs" data-pill-key="destmode">
          <button class="seg-opt ${state.destinationMode!=='port'?'active':''}" data-action="dest-mode" data-value="country">Country</button>
          <button class="seg-opt ${state.destinationMode==='port'?'active':''}" data-action="dest-mode" data-value="port">Port</button>
        </div>
        <!-- TODO(supabase): Country module when toggle=country, Port module when toggle=port.
             COUNTRIES/PORTS below are this file's own placeholder constants. -->
        <div style="margin-top:8px;">${buildSelect('modal-destination', state.destinationMode==='port'?PORTS:COUNTRIES, {value:''})}</div>
      </div>
      <div class="modal-thumb">
        <video autoplay muted loop playsinline poster="wildcapture-thumb.jpg">
          <source src="wildcapture-thumb.mp4" type="video/mp4">
        </video>
        <div class="modal-thumb-scrim"></div>
        <div class="modal-quote" id="modal-quote">${quoteHTML(HERO_QUOTES[quoteIndex])}</div>
      </div>
      <div class="modal-info">
        <img src="wildcapture-icon.png" alt="" onerror="this.style.display='none';">
        <p>Fuel consumption from fishing vessels is one of the largest contributors to emissions.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="cancel-modal">Cancel</button>
        <button class="btn btn-primary" data-action="proceed-modal">Proceed</button>
      </div>
    </div>
  </div>`;
}

const OVERVIEW_CTES = [
  {key:'harvesting', label:'Harvesting'},
  {key:'ovp', label:'On Vessel Processing'},
  {key:'transshipment', label:'Transshipment'},
  {key:'landing', label:'Landing'},
  {key:'aggrDisaggr', label:'Aggregation/Disaggregation'},
  {key:'transformation', label:'Processing — Transformation'},
  {key:'storage', label:'Processing — Storage'},
  {key:'shipReceive', label:'Ship/Receive'},
];

function renderOverview(){
  const total = fmtNum(Object.values(grandTotalParts).reduce((a,b)=>a+b, 0), 2);
  const allConfirmed = OVERVIEW_CTES.every(c => state.confirmed[c.key]);
  const confirmedCount = OVERVIEW_CTES.filter(c => state.confirmed[c.key]).length;

  return `
  <div class="shell">
    <div class="pm-detail-topbar">
      <div class="pm-detail-left">
        <button class="pm-back" data-action="back-to-calculator">←</button>
        <div class="pm-brand-pill">
          <img src="sc-blue-logo.png" alt="" class="pm-brand-pill-logo" onerror="this.style.display='none';">
          <span class="sc-blue">SMARTUNA</span><span class="sc-black">CONCEPT</span>
        </div>
      </div>
      ${renderEmissionBadge(total)}
      <div class="pm-detail-right"></div>
    </div>

    <div class="content-area">
      <div class="card">
        <div class="card-top">
          <div>
            <h2>Review &amp; Save</h2>
            <p>Confirm every CTE (click Submit on each tab) before saving. ${confirmedCount} of ${OVERVIEW_CTES.length} confirmed. Packaging isn't included — it has no live formula yet.</p>
          </div>
        </div>

        <div class="overview-list">
          ${OVERVIEW_CTES.map(c=>{
            const confirmed = !!state.confirmed[c.key];
            const val = grandTotalParts[c.key] !== undefined ? fmtNum(grandTotalParts[c.key], 3) : '—';
            return `
            <div class="overview-row ${confirmed?'ok':'pending'}">
              <div class="overview-row-status">${confirmed?'✓':'!'}</div>
              <div class="overview-row-label">${c.label}</div>
              <div class="overview-row-note">${confirmed?'Confirmed':'Not yet submitted'}</div>
              <div class="overview-row-value">${val}<span> kg CO₂e/kg</span></div>
            </div>`;
          }).join('')}
        </div>

        <div class="overview-actions">
          <button class="btn btn-outline" data-action="overview-cancel">Cancel</button>
          <button class="btn ${allConfirmed?'btn-primary':'btn-ghost-dark'}" data-action="overview-save" ${allConfirmed?'':'disabled'}>
            ${allConfirmed?'Save':'Confirm all CTEs to save'}
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

const SCOPE_META = {
  scope1:{label:'Scope I', desc:'Direct greenhouse gas emissions from sources that are owned or controlled by the organization.'},
  scope2:{label:'Scope II', desc:'Indirect greenhouse gas emissions from the generation of purchased electricity, steam, heating, and cooling consumed by the organization.'},
  scope3:{label:'Scope III', desc:'All other indirect greenhouse gas emissions that occur in the organization\u2019s value chain, both upstream and downstream.'},
};

function reportProductInfo(){
  // Product name pulled live from the modal selection where available;
  // product code now sourced from Packaging's own Traceability Lot Code
  // (the pkg-info-value row) rather than a static placeholder. GTIN
  // still isn't tracked anywhere in this calculator, so that one stays
  // illustrative.
  const liveProduct = selVal('modal-product', '').value;
  return {
    code: CTE_DATA.packaging.productInfo.lotCode,
    name: liveProduct || 'Century Tuna Fishflakes (Tuna) in oil - 12 x 180 g',
    gtin:'09001234567898',
  };
}

function renderReportSummary(){
  const report = computeScopeReport();
  const pi = reportProductInfo();
  const scopes = [
    {key:'scope1', value:report.s1},
    {key:'scope2', value:report.s2},
    {key:'scope3', value:report.s3},
  ];
  const maxVal = Math.max(report.s1, report.s2, report.s3);

  return `
  <div class="shell">
    <div class="pm-detail-topbar">
      <div class="pm-detail-left">
        <button class="pm-back" data-action="back-to-calculator">←</button>
        <div class="pm-brand-pill">
          <img src="sc-blue-logo.png" alt="" class="pm-brand-pill-logo" onerror="this.style.display='none';">
          <span class="sc-blue">SMARTUNA</span><span class="sc-black">CONCEPT</span>
        </div>
      </div>
      <div class="pm-detail-right"></div>
    </div>
    <div class="content-area">
      <div class="report-hero">
        <div class="report-hero-left">
          <div class="report-kicker">
            <span class="report-foot-icon">🐾</span>
            <div><div class="report-kicker-label">Know your Products</div><div class="report-kicker-title">Carbon FootPrint</div></div>
          </div>
          <div class="report-product-row">
            <div class="report-product-thumb">🥫</div>
            <div>
              <div class="report-product-code">${pi.code}</div>
              <div class="report-product-name">${pi.name}</div>
              <div class="report-product-gtin">GTIN : ${pi.gtin}</div>
            </div>
          </div>
        </div>
        <div class="report-hero-total">
          <div class="report-total-value">${fmtNum(report.total,2)}<span> kg CO₂e</span></div>
          <div class="report-total-label">Total Carbon Emission</div>
        </div>
      </div>

      <div class="report-scope-grid">
        ${scopes.map(s=>{
          const meta = SCOPE_META[s.key];
          const pct = report.total>0 ? (s.value/report.total*100) : 0;
          const isMax = s.value===maxVal && maxVal>0;
          return `
          <div class="report-scope-card ${isMax?'highlight':''}">
            <div class="report-scope-title">${meta.label}</div>
            <div class="report-scope-value">${fmtNum(s.value,2)} kg CO₂e</div>
            <div class="report-scope-pct">(${fmtNum(pct,0)}%)</div>
            <div class="report-scope-desc">${meta.desc}</div>
            <button class="btn ${isMax?'btn-primary':'btn-outline'} report-scope-btn" data-action="go-report-scope-detail" data-scope="${s.key}">View Detailed Summary</button>
          </div>`;
        }).join('')}
      </div>
      <div class="report-footnote">*Emission scopes are categories defined by the Greenhouse Gas (GHG) Protocol that classify an organization's greenhouse gas emissions based on their source and level of control.</div>
      ${renderFlowReportCard(report)}
    </div>
  </div>`;
}

function renderReportScopeDetail(){
  const report = computeScopeReport();
  const scopeKey = state.reportScopeKey || 'scope3';
  const sField = {scope1:'s1', scope2:'s2', scope3:'s3'}[scopeKey];
  const meta = SCOPE_META[scopeKey];
  const scopeTotal = report[sField];

  const rows = REPORT_STAGES.map(({key,label})=>({
    key, label, val: report.perStage[key][sField],
  })).filter(r=>r.val > 0.0005).sort((a,b)=>b.val-a.val);

  return `
  <div class="shell">
    <div class="pm-detail-topbar">
      <div class="pm-detail-left">
        <button class="pm-back" data-action="go-report-summary">←</button>
        <div class="pm-brand-pill">
          <img src="sc-blue-logo.png" alt="" class="pm-brand-pill-logo" onerror="this.style.display='none';">
          <span class="sc-blue">SMARTUNA</span><span class="sc-black">CONCEPT</span>
        </div>
      </div>
      <div class="pm-detail-right"></div>
    </div>
    <div class="content-area">
      <div class="card">
        <div class="card-top">
          <div><h2>${meta.label} — Detailed Summary</h2><p>${meta.desc}</p></div>
        </div>
        <div class="overview-list">
          ${rows.map(r=>`
            <div class="overview-row ok">
              <div class="overview-row-status">${TAB_ICONS[r.key]||'•'}</div>
              <div class="overview-row-label">${r.label}</div>
              <div class="overview-row-note">${scopeTotal>0?fmtNum(r.val/scopeTotal*100,0):0}% of ${meta.label}</div>
              <div class="overview-row-value">${fmtNum(r.val,3)}<span> kg CO₂e</span></div>
            </div>
          `).join('')}
        </div>
        <div class="overview-actions" style="justify-content:space-between;align-items:center;">
          <div style="font-size:13px;font-weight:800;color:var(--ink-900);">${meta.label} Total: ${fmtNum(scopeTotal,2)} kg CO₂e</div>
          <button class="btn btn-outline" data-action="go-report-summary">Back to Summary</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderDonutChart(s1, s2, s3, total){
  const r = 62, cx = 90, cy = 90, sw = 22;
  const circumference = 2*Math.PI*r;
  const p1 = total>0 ? s1/total : 0;
  const p2 = total>0 ? s2/total : 0;
  const p3 = total>0 ? s3/total : 1;
  const len1 = p1*circumference, len2 = p2*circumference, len3 = p3*circumference;
  const seg = (len, offset, color) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${len} ${circumference-len}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
  return `
    <svg viewBox="0 0 180 180" width="168" height="168">
      ${seg(len1, 0, '#f5b400')}
      ${seg(len2, -len1, '#22c55e')}
      ${seg(len3, -(len1+len2), '#3b82f6')}
      <text x="${cx}" y="${cy-10}" text-anchor="middle" font-size="11" fill="#8a90a3" font-family="inherit">Total</text>
      <text x="${cx}" y="${cy+12}" text-anchor="middle" font-size="22" font-weight="800" fill="#151b2e" font-family="inherit">${fmtNum(total,2)}</text>
      <text x="${cx}" y="${cy+27}" text-anchor="middle" font-size="10" fill="#8a90a3" font-family="inherit">kg CO₂e</text>
    </svg>`;
}

// Smooth cubic-bezier interpolation through a sequence of points — used to
// give the stacked scope bands an organic "flowing" look between the 8
// discrete stages, rather than a jagged stepped line.
function smoothPath(points){
  if(points.length<2) return `M ${points[0][0]},${points[0][1]}`;
  let d = `M ${points[0][0]},${points[0][1]}`;
  for(let i=0;i<points.length-1;i++){
    const [x0,y0] = points[i], [x1,y1] = points[i+1];
    const midX = (x0+x1)/2;
    d += ` C ${midX},${y0} ${midX},${y1} ${x1},${y1}`;
  }
  return d;
}

function showFlowTooltip(e, label, s1, s2, s3, total){
  const tip = document.getElementById('flow-tooltip');
  if(!tip) return;
  tip.innerHTML = `
    <div class="flow-tooltip-title">${label}</div>
    <div class="flow-tooltip-row"><span class="dot" style="background:#f5b400"></span>Scope I: ${fmtNum(s1,3)} kg CO₂e</div>
    <div class="flow-tooltip-row"><span class="dot" style="background:#22c55e"></span>Scope II: ${fmtNum(s2,3)} kg CO₂e</div>
    <div class="flow-tooltip-row"><span class="dot" style="background:#3b82f6"></span>Scope III: ${fmtNum(s3,3)} kg CO₂e</div>
    <div class="flow-tooltip-total">Total: ${fmtNum(total,3)} kg CO₂e</div>
  `;
  tip.style.display = 'block';
  positionFlowTooltip(e);
}
function positionFlowTooltip(e){
  const tip = document.getElementById('flow-tooltip');
  if(!tip) return;
  const container = tip.parentElement.getBoundingClientRect();
  tip.style.left = (e.clientX - container.left) + 'px';
  tip.style.top = (e.clientY - container.top) + 'px';
}
function hideFlowTooltip(){
  const tip = document.getElementById('flow-tooltip');
  if(tip) tip.style.display = 'none';
}

function renderFlowChart(report){
  const W = 900, H = 190, padX = 45, padTop = 15, padBottom = 15;
  const chartH = H - padTop - padBottom;
  const n = REPORT_STAGES.length;
  const stepX = (W - padX*2) / (n-1);
  const maxTotal = Math.max(...REPORT_STAGES.map(s=>report.perStage[s.key].total), 0.0001);
  const scaleY = v => (v/maxTotal) * chartH;

  // Baseline (bottom of chart) stays fixed; each stage stacks Scope III
  // (bottom), Scope II (middle), Scope I (top), all vertically centered
  // around the chart's mid-line so the ribbon grows both up and down.
  const baseline = padTop + chartH/2;
  const points = REPORT_STAGES.map((s,i)=>{
    const p = report.perStage[s.key];
    const totalH = scaleY(p.total);
    const h3 = p.total>0 ? (p.s3/p.total)*totalH : 0;
    const h2 = p.total>0 ? (p.s2/p.total)*totalH : 0;
    const h1 = p.total>0 ? (p.s1/p.total)*totalH : 0;
    const x = padX + i*stepX;
    const yBottom = baseline + totalH/2;
    const y3top = yBottom - h3;
    const y2top = y3top - h2;
    const y1top = y2top - h1;
    return { x, yBottom, y3top, y2top, y1top };
  });

  const band = (bottomKey, topKey, color) => {
    const top = points.map(p=>[p.x, p[topKey]]);
    const bottom = points.map(p=>[p.x, p[bottomKey]]).reverse();
    return `<path d="${smoothPath(top)} L ${bottom[0][0]},${bottom[0][1]} ${smoothPath(bottom).replace(/^M [^ ]+ /,'')} Z" fill="${color}" opacity="0.82"/>`;
  };

  const hoverZones = REPORT_STAGES.map((s,i)=>{
    const p = report.perStage[s.key];
    const x = padX + i*stepX - stepX/2;
    const label = s.label.replace(/'/g, "\\'");
    return `<rect class="report-flow-hover-zone" x="${x}" y="0" width="${stepX}" height="${H}"
      onmouseenter="showFlowTooltip(event,'${label}',${p.s1},${p.s2},${p.s3},${p.total})"
      onmousemove="positionFlowTooltip(event)"
      onmouseleave="hideFlowTooltip()"/>`;
  }).join('');

  const bands = band('yBottom','y3top','#3b82f6') + band('y3top','y2top','#22c55e') + band('y2top','y1top','#f5b400');
  const stageLines = points.map(p=>`<line x1="${p.x}" y1="${padTop}" x2="${p.x}" y2="${H-padBottom}" stroke="#e7e9f2" stroke-width="1"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="report-flow-svg">${stageLines}${bands}${hoverZones}</svg>`;
}

function renderFlowReportCard(report){
  return `
      <div class="card" style="margin-top:26px;">
        <div class="report-flow-top">
          <div class="report-flow-donut">${renderDonutChart(report.s1, report.s2, report.s3, report.total)}</div>
          <div class="report-flow-legend">
            <div class="report-legend-row"><span class="report-legend-dot" style="background:#f5b400;"></span>Scope I <b>${fmtNum(report.s1,2)} kg CO₂e (${report.total>0?fmtNum(report.s1/report.total*100,1):0}%)</b></div>
            <div class="report-legend-row"><span class="report-legend-dot" style="background:#22c55e;"></span>Scope II <b>${fmtNum(report.s2,2)} kg CO₂e (${report.total>0?fmtNum(report.s2/report.total*100,1):0}%)</b></div>
            <div class="report-legend-row"><span class="report-legend-dot" style="background:#3b82f6;"></span>Scope III <b>${fmtNum(report.s3,2)} kg CO₂e (${report.total>0?fmtNum(report.s3/report.total*100,1):0}%)</b></div>
          </div>
        </div>
        <p class="report-flow-caption">This chart illustrates the distribution of greenhouse gas emissions associated with the production of a single canned tuna product, expressed in kilograms of CO₂ equivalent (kg CO₂e). Emissions are categorized according to the Greenhouse Gas (GHG) Protocol into Scope 1 (direct operations), Scope 2 (purchased energy), and Scope 3 (value chain activities).</p>

        <div class="report-stage-row">
          ${REPORT_STAGES.map(s=>`
            <div class="report-stage-card">
              <div class="report-stage-icon">${TAB_ICONS[s.key]||''}</div>
              <div class="report-stage-label">${s.label}</div>
              <div class="report-stage-value">${fmtNum(report.perStage[s.key].total,2)}</div>
              <div class="report-stage-unit">kg CO₂e</div>
            </div>
          `).join('')}
        </div>

        <div class="report-flow-scroll">${renderFlowChart(report)}<div class="report-flow-tooltip" id="flow-tooltip"></div></div>

        <div class="report-flow-legend report-flow-legend-bottom">
          <div class="report-legend-row"><span class="report-legend-dot" style="background:#f5b400;"></span>Scope I</div>
          <div class="report-legend-row"><span class="report-legend-dot" style="background:#22c55e;"></span>Scope II</div>
          <div class="report-legend-row"><span class="report-legend-dot" style="background:#3b82f6;"></span>Scope III</div>
          <div class="report-flow-total">Total Emission (All Stages) <b>${fmtNum(report.total,2)} kg CO₂e</b></div>
        </div>
      </div>
      <div class="report-disclaimer">
        <b>Disclaimer:</b> The emissions data presented are illustrative estimates and may not represent actual values. Figures are based on available data and reasonable assumptions and are subject to uncertainty due to limitations in data availability, quality, and completeness.
      </div>
      <div class="report-copyright">© 2026 SmarTuna Concept. All rights reserved.</div>
  `;
}

function renderCalculator(){
  return `
  <div class="pm-detail-topbar">
    <div class="pm-detail-left">
      <button class="pm-back" data-action="back-landing">←</button>
      <div class="pm-brand-pill">
        <img src="sc-blue-logo.png" alt="" class="pm-brand-pill-logo" onerror="this.style.display='none';">
        <span class="sc-blue">SMARTUNA</span><span class="sc-black">CONCEPT</span>
      </div>
    </div>
    ${renderEmissionBadge()}
    <div class="pm-detail-right">
      <button class="btn btn-outline btn-sm" data-action="gdsn-open">View in GSI GDSN Format</button>
      <button class="btn btn-primary btn-sm" data-action="go-overview">Review &amp; Save</button>
      <button class="btn btn-primary btn-sm" data-action="go-report-summary">Report →</button>
    </div>
  </div>
  <div class="tab-strip">
    <div class="tab-strip-inner">
      ${TABS.map(t=>{
        const isConfirmed = t.id==='processing' ? (state.confirmed.transformation && state.confirmed.storage)
          : t.id==='onVesselProcessing' ? state.confirmed.ovp
          : t.id==='packaging' ? false
          : !!state.confirmed[t.id];
        return `<button class="tab-btn ${t.id===state.activeTab?'active':''}" data-action="tab" data-value="${t.id}"><span class="tab-icon">${TAB_ICONS[t.id]||''}</span>${t.label}${isConfirmed?' <span class="tab-confirmed-dot">✓</span>':''}</button>`;
      }).join('')}
    </div>
  </div>
  <div class="content-area">
    ${renderTabContent()}
  </div>
  ${renderInfoPanel()}
  ${renderGDSNModal()}
  ${renderMissingFieldsModal()}`;
}

// Remembers each pill's last on-screen position across full re-renders.
// Every click rebuilds the DOM from scratch (see render()), so the old
// .pill-indicator is destroyed and a new one created each time — without
// this, the new one always starts at its CSS default (left:0, width:0)
// and visibly slides in from the first item before correcting itself.
const pillMemory = {};
const PILL_CONTAINERS = { topnav: '.nav-pill', ctetabs: '.tab-strip-inner' };

function capturePillMemory(){
  for(const key in PILL_CONTAINERS){
    const container = document.querySelector(PILL_CONTAINERS[key]);
    const ind = container && container.querySelector('.pill-indicator');
    if(ind){
      pillMemory[key] = { left: parseFloat(ind.style.left)||0, width: parseFloat(ind.style.width)||0 };
    }
  }
  document.querySelectorAll('.seg-toggle').forEach(el=>{
    const ind = el.querySelector('.pill-indicator');
    if(ind){
      pillMemory['seg-'+(el.dataset.pillKey||'default')] = { left: parseFloat(ind.style.left)||0, width: parseFloat(ind.style.width)||0 };
    }
  });
}

function mountPillNav(container, memoryKey){
  if(!container) return;
  let indicator = container.querySelector('.pill-indicator');
  const isNew = !indicator;
  if(isNew){
    indicator = document.createElement('div');
    indicator.className = 'pill-indicator';
    container.prepend(indicator);
  }
  const items = [...container.querySelectorAll('.nav-item, .tab-btn, .seg-opt')];

  const place = (left, width)=>{
    indicator.style.left = left+'px';
    indicator.style.width = width+'px';
  };

  const moveTo = (el)=>{
    items.forEach(it=> it.classList.remove('pill-covered'));
    if(!el){ place(0,0); return; }
    el.classList.add('pill-covered');
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    place(r.left - c.left + container.scrollLeft, r.width);
  };

  const getActive = ()=> container.querySelector('.nav-item.active, .tab-btn.active, .seg-opt.active') || items[0];

  if(isNew){
    const mem = memoryKey && pillMemory[memoryKey];
    // Seed the new indicator at its last remembered spot with transitions
    // off, force the browser to commit that layout (the reflow read below),
    // then hand back to normal transitions — so the very next style change
    // (moveTo, right after) is what animates, with no frame gap in between
    // for a default/first-item position to ever actually get painted.
    indicator.style.transition = 'none';
    place(mem ? mem.left : 0, mem ? mem.width : 0);
    void indicator.offsetWidth;
    indicator.style.transition = '';
  }

  moveTo(getActive());

  items.forEach(it=> it.addEventListener('mouseenter', ()=>moveTo(it)));
  container.addEventListener('mouseleave', ()=>moveTo(getActive()));
}

/* ---------- ROOT RENDER + EVENTS ---------- */
function render(){
  capturePillMemory(); // read the outgoing DOM's pill positions before innerHTML wipes it
  const app = document.getElementById('app');
  if(state.page==='landing') app.innerHTML = renderLanding();
  else if(state.page==='modal') app.innerHTML = renderModal();
  else if(state.page==='overview') app.innerHTML = renderOverview();
  else if(state.page==='reportSummary') app.innerHTML = renderReportSummary();
  else if(state.page==='reportScopeDetail') app.innerHTML = renderReportScopeDetail();
  else app.innerHTML = renderCalculator();

  mountPillNav(document.querySelector('.nav-pill'), 'topnav');
  mountPillNav(document.querySelector('.tab-strip-inner'), 'ctetabs');
  document.querySelectorAll('.seg-toggle').forEach(el=>{
    mountPillNav(el, 'seg-'+(el.dataset.pillKey||'default'));
  });

  if(state.page==='modal') startQuoteRotation(); else stopQuoteRotation();

  if(state.page==='calculator' && state.activeTab==='harvesting') recalcHarvesting();
  if(state.page==='calculator' && state.activeTab==='onVesselProcessing'){
    if(state.ovpEnabled) recalcOVP();
    else { grandTotalParts.ovp = 0; updateGrandTotal(); }
  }
  if(state.page==='calculator' && state.activeTab==='transshipment') recalcTransshipment();
  if(state.page==='calculator' && state.activeTab==='landing') recalcLanding();
  if(state.page==='calculator' && state.activeTab==='aggrDisaggr') recalcAggr();
  if(state.page==='calculator' && state.activeTab==='processing' && state.processingSub==='Transformation') recalcTransform();
  if(state.page==='calculator' && state.activeTab==='processing' && state.processingSub==='Storage') recalcStorage();
  if(state.page==='calculator' && state.activeTab==='shipReceive') recalcShip();
  if(state.page==='calculator' && state.activeTab==='packaging' && state.packagingSub==='Packaging Emission') recalcPackaging();

  if(state.page==='calculator') updateGrandTotal();
}

document.getElementById('app').addEventListener('click', (e)=>{
  const el = e.target.closest('[data-action]');

  if(!el){
    // clicked outside any actionable element — close open premium-selects/tags menus
    let changed = false;
    Object.values(selectState).forEach(s=>{ if(s.open){ s.open=false; changed=true; } });
    Object.values(tagsState).forEach(s=>{ if(s.open){ s.open=false; changed=true; } });
    if(changed) render();
    return;
  }

  // This click is being fully handled here — stop it from also reaching the
  // outer document-level "click outside #app" listener below. Without this,
  // render() (called at the end of this handler) replaces #app's contents
  // mid-bubble, and the outer listener's e.target.closest('#app') check would
  // then be evaluating an already-detached node.
  e.stopPropagation();

  const action = el.dataset.action;

  if(action==='select-toggle'){
    const id = el.dataset.id;
    const wasOpen = selectState[id]?.open;
    closeAllSelects();
    selVal(id).open = !wasOpen;
  }
  else if(action==='select-option'){
    const id = el.dataset.id;
    selVal(id).value = el.dataset.value;
    selVal(id).open = false;
    // TODO(supabase): push this value into the relevant CTE record here
  }
  else if(action==='tag-remove'){
    const id = el.dataset.id;
    const st = tagsState[id];
    if(st) st.selected = st.selected.filter(v => v !== el.dataset.value);
  }
  else if(action==='tag-add-toggle'){
    const id = el.dataset.id;
    const wasOpen = tagsState[id]?.open;
    Object.values(tagsState).forEach(s => { s.open = false; });
    if(tagsState[id]) tagsState[id].open = !wasOpen;
  }
  else if(action==='tag-add-option'){
    const id = el.dataset.id;
    const st = tagsState[id];
    if(st){ st.selected.push(el.dataset.value); st.open = false; }
  }
  else if(action==='calc-mode'){ state.calcMode = el.dataset.value; }
  else if(action==='dest-mode'){
    state.destinationMode = el.dataset.value;
    if(shipmentOverrides?.modal){
      const m = shipmentOverrides.modal;
      const next = state.destinationMode==='port' ? m.destinationPort : m.destinationCountry;
      if(next) selVal('modal-destination', next).value = next;
    }
  }
  else if(action==='proceed-landing'){
    const production = selVal('landing-production', 'Wild Capture').value || 'Wild Capture';
    if(production !== 'Wild Capture'){
      showToast(`${production} is still in progress — check back soon.`);
    } else if(state.calcMode === 'manual'){
      startFreshCalculation();
    } else {
      state.page = 'modal';
    }
  }
  else if(action==='cancel-modal'){ state.page='landing'; }
  else if(action==='proceed-modal'){
    state.page='calculator'; state.activeTab='harvesting';
    if(shipmentOverrides) state.showMissingModal = true;
  }
  else if(action==='back-landing'){ state.page='landing'; }
  else if(action==='tab'){ state.activeTab = el.dataset.value; }
  else if(action==='subtab'){
    state[el.dataset.group] = el.dataset.value;
  }
  else if(action==='instance-tab'){
    const st = instanceState[el.dataset.cte];
    if(st) st.active = el.dataset.value;
  }
  else if(action==='instance-add'){
    addInstance(el.dataset.cte, el.dataset.base);
  }
  else if(action==='instance-remove'){
    removeInstance(el.dataset.cte, el.dataset.value);
  }
  else if(action==='hv-unit'){
    setHarvestUnit(el.dataset.unit);
  }
  else if(action==='ovp-toggle'){
    state.ovpEnabled = !state.ovpEnabled;
  }
  else if(action==='ovp-unit'){
    setOVPUnit(el.dataset.unit);
  }
  else if(action==='ts-mode'){
    setTSMode(el.dataset.value);
  }
  else if(action==='ts-rcs'){
    toggleTSRCS();
  }
  else if(action==='ts-choose-rcs'){
    const st = instanceState.transshipment;
    if(st) st.data[st.active].rcs = (el.dataset.value === 'true');
  }
  else if(action==='ts-unit'){
    setTSUnit(el.dataset.unit);
  }
  else if(action==='ld-weight-unit'){
    setLandingWeightUnit(el.dataset.unit);
  }
  else if(action==='ld-distance-unit'){
    setLandingDistanceUnit(el.dataset.unit);
  }
  else if(action==='aggr-weight-unit'){
    setAggrWeightUnit(el.dataset.field, el.dataset.unit);
  }
  else if(action==='aggr-factors-toggle'){
    toggleAggrFactors();
  }
  else if(action==='tf-dates-toggle'){
    toggleTransformDates();
  }
  else if(action==='tf-weight-unit'){
    setTransformWeightUnit(el.dataset.unit);
  }
  else if(action==='tf-yield-unit'){
    setTransformYieldUnit(el.dataset.unit);
  }
  else if(action==='st-refrig-toggle'){
    toggleStorageRefrig();
  }
  else if(action==='sr-gw-unit'){
    setShipGWUnit(el.dataset.field, el.dataset.unit);
  }
  else if(action==='sr-weight-unit'){
    setShipWeightUnit(el.dataset.unit);
  }
  else if(action==='info-open'){
    state.infoPanelOpen = el.dataset.cte;
  }
  else if(action==='info-close'){
    state.infoPanelOpen = null;
  }
  else if(action==='gdsn-open'){
    state.gdsnModalOpen = true;
  }
  else if(action==='gdsn-close'){
    state.gdsnModalOpen = false;
  }
  else if(action==='close-missing-modal'){
    state.showMissingModal = false;
  }
  else if(action==='submit-missing-modal'){
    const questions = shipmentOverrides?.packagingQuestions || [];
    questions.forEach(q=>{
      const el = document.getElementById(q.key);
      const v = parseNum(el?.value);
      if(el?.value && v>0) q.apply(v);
    });
    if(questions.length) packagingContext.answered = true;
    state.showMissingModal = false;
  }
  else if(action==='submit-cte'){
    const cteKey = el.dataset.cte;
    confirmedData[cteKey] = captureCTESnapshot(cteKey);
    state.confirmed[cteKey] = true;
    showToast(`${CONFIRM_LABELS[cteKey]||cteKey} confirmed.`);
  }
  else if(action==='go-overview'){
    state.page = 'overview';
  }
  else if(action==='back-to-calculator'){
    state.page = 'calculator';
  }
  else if(action==='go-report-summary'){
    state.page = 'reportSummary';
  }
  else if(action==='go-report-scope-detail'){
    state.reportScopeKey = el.dataset.scope;
    state.page = 'reportScopeDetail';
  }
  else if(action==='overview-cancel'){
    state.page = 'calculator';
  }
  else if(action==='overview-save'){
    saveCalculation();
    return; // saveCalculation manages its own render() calls (async)
  }

  render();
});

// Close open premium-selects on outside click (clicks landing outside #app, e.g. body padding).
// Uses composedPath() rather than e.target.closest('#app') deliberately: the #app listener
// above may have just replaced #app's entire innerHTML (including the clicked element itself)
// before this listener runs, leaving e.target a detached/orphaned node whose .closest('#app')
// call can no longer find its way back up — composedPath() is a snapshot of the real bubble
// path taken at dispatch time, so it stays correct even after the DOM underneath it changes.
document.addEventListener('click', (e)=>{
  const appEl = document.getElementById('app');
  if(appEl && e.composedPath().includes(appEl)) return;
  let changed = false;
  Object.values(selectState).forEach(s=>{ if(s.open){ s.open=false; changed=true; } });
  Object.values(tagsState).forEach(s=>{ if(s.open){ s.open=false; changed=true; } });
  if(changed) render();
});

/* ---------- LAUNCH-FROM-PRODUCT ENTRY POINT ----------
   The calculator's real use case is: open it FROM a specific product
   record (Product module) with a destination already in mind — "what's
   the emission if I send THIS product to Germany" — not picking DRI/
   Product/Destination from scratch every time. This reads optional URL
   params so a product page can link straight in with both pre-filled:
     carbon-calculator.html?product=Canned%20Tuna&destination=Germany&dri=MSC-C-52839
   This doesn't build the actual product-page integration (that page
   doesn't exist here) — it's the receiving end of that link, ready for
   whenever the product module actually passes these along. */
function renderMissingFieldsModal(){
  if(!state.showMissingModal) return '';
  const items = shipmentOverrides?.missing || [];
  const questions = shipmentOverrides?.packagingQuestions || [];
  const hasAnything = items.length || questions.length;
  return `
  <div class="modal-overlay">
    <div class="gdsn-card" style="width:480px;">
      <div class="gdsn-head">
        <div>
          <span class="gdsn-badge">shipment data</span>
          <h3>${hasAnything ? 'A few things aren\u2019t in the shipment data' : 'Shipment data loaded'}</h3>
          <p>${hasAnything
            ? 'Everything else pre-filled from the real shipment/raw material records. Fill in what you can below — Packaging can\u2019t compute correctly without these.'
            : 'All the fields this page tries to pre-fill were found in the shipment and raw material records.'}</p>
        </div>
        <button type="button" class="gdsn-close-x" data-action="close-missing-modal">✕</button>
      </div>
      ${questions.length ? `
        <div class="gdsn-group">
          ${questions.map(q=>`
            <div class="missing-field-row">
              <label>${q.label}</label>
              <input type="text" id="${q.key}" placeholder="${q.unit||'value'}">
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${items.length ? `<div class="gdsn-group">${items.map(i=>`<div class="gdsn-row"><label style="width:auto;font-family:inherit;font-weight:600;color:var(--ink-700);">${i}</label></div>`).join('')}</div>` : ''}
      <div class="gdsn-footer">
        <button type="button" class="btn btn-primary" style="padding:12px 40px;" data-action="submit-missing-modal">${questions.length?'Save & Continue':'Continue to Calculator'}</button>
      </div>
    </div>
  </div>`;
}

async function initFromURL(){
  const params = new URLSearchParams(window.location.search);
  const shipmentId = params.get('shipment');

  if(shipmentId){
    try{
      const ctx = await loadShipmentContext(shipmentId);
      shipmentOverrides = buildShipmentOverrides(ctx);

      const m = shipmentOverrides.modal;
      if(m.product) selVal('modal-product', m.product).value = m.product;
      if(m.dri) selVal('modal-dri', m.dri).value = m.dri;
      if(m.destinationCountry) selVal('modal-destination', m.destinationCountry).value = m.destinationCountry;
      state.destinationMode = 'country';

      // Real shipment data is already known — skip straight past the
      // outer landing page (Processor / Production Type / System vs
      // Manual) into the Wild Capture modal itself, pre-filled, so the
      // user can see and confirm DRI/Product/Destination before hitting
      // the existing Proceed button to enter the calculator.
      state.page = 'modal';
    }catch(err){
      console.error('[loadShipmentContext] failed:', err);
      shipmentFetchError = (err && err.message) ? err.message : String(err);
      showToast('Could not load shipment data — check the console for details.');
    }
    render();
    return;
  }

  // No ?shipment= param — existing demo/product/destination/dri prefill,
  // completely unchanged from before.
  const product = params.get('product');
  const destination = params.get('destination');
  const dri = params.get('dri');
  if(product) selVal('modal-product', product).value = product;
  if(dri) selVal('modal-dri', dri).value = dri;
  if(destination){
    const isPort = PORTS.some(p => p.toLowerCase() === destination.toLowerCase());
    state.destinationMode = isPort ? 'port' : 'country';
    selVal('modal-destination', destination).value = destination;
  }
}

initFromURL();
render();