/* ============================================================
   PROJECT MANHATTAN — mri-dashboard.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYmRhYWpjcm9teG1oZ2N2ZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjc4MTUsImV4cCI6MjA5MzcwMzgxNX0.wlVbN57eAwRmTROEEY3D6BIX3H5pI6MwZ5hM2BqpnEs';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

const STAGE_MAX = { FV: 1080, CR: 430, FCL: 460, PP: 270, SP: 470, LFP: 440 };

const STAGE_INFO = {
  FV: { label: 'Fishing Vessel', desc: 'Vessel identification, certification and catch data' },
  CR: { label: 'Carrier / Transshipment Vessel', desc: 'Carrier vessel identification and compliance' },
  FCL: { label: 'Reefer Container Loading', desc: 'Port, container and logistics data' },
  PP: { label: 'Primary Processor', desc: 'First processing facility data' },
  SP: { label: 'Secondary Processor', desc: 'Second processing, lot codes and compliance' },
  LFP: { label: 'Logistics - Final Product', desc: 'Final shipment documentation to end market' },
};

// ── ALL 77 KDE DESCRIPTIONS ───────────────────────────────────
const KDE_DESCRIPTIONS = {
  FV_001: { label: 'Fishing Method - Gear type', why: 'Gear type determines the selectivity and environmental impact of the catch. Regulators and buyers use this to verify the catch method aligns with species permits and area authorisations.' },
  FV_002: { label: 'Vessel Name', why: 'The vessel name is the primary identifier linking catch records to a specific fishing unit. Without it, the catch cannot be traced back to its origin vessel.' },
  FV_003: { label: 'Vessel VID', why: 'The Vessel Identification number is the official registration code used by flag states and RFMOs to track fishing vessels. It enables cross-referencing with international vessel databases.' },
  FV_004: { label: 'Vessel Flag', why: 'The flag state is responsible for regulating and monitoring vessels under its jurisdiction. Flag state identity is critical for determining which legal frameworks govern the vessel.' },
  FV_005: { label: 'On Register of RFMO of Fishing Zone', why: 'RFMOs manage fish stocks in international waters and maintain authorised vessel lists. Vessels not on the RFMO register may be conducting illegal fishing in those waters.' },
  FV_006: { label: 'Goods standing on FFA register', why: 'The Pacific Islands Forum Fisheries Agency (FFA) register confirms vessel authorisation to fish in Pacific waters. Absence from this register is a major IUU red flag for Pacific-origin tuna.' },
  FV_007: { label: 'Flag State Registration', why: 'Formal registration with the flag state confirms the vessel operates under a recognised legal authority. Unregistered vessels are among the highest-risk indicators of IUU activity.' },
  FV_008: { label: 'Flag State is not FOC', why: 'Flags of Convenience (FOC) states are known for weak oversight and are frequently exploited by IUU operators. Non-FOC status significantly reduces supply chain risk.' },
  FV_009: { label: 'Flag State has no EU Yellow/Red Card', why: 'The EU IUU Regulation assigns yellow and red cards to countries with inadequate fisheries control. A carded flag state means the catch may be banned from EU markets.' },
  FV_010: { label: 'Previous Flag Declared', why: 'Vessels that frequently change flags may be evading monitoring or sanctions. Declaring the previous flag allows auditors to check for a history of IUU-related reflagging.' },
  FV_011: { label: 'Previous Name Declared', why: 'Renaming a vessel is a common tactic used by IUU operators to obscure a vessel\'s history. Disclosing the previous name enables cross-referencing against IUU vessel databases.' },
  FV_012: { label: 'IMO Number', why: 'The IMO number is a permanent, internationally recognised vessel identifier that remains with a ship regardless of flag or name changes. It is the gold standard for vessel traceability.' },
  FV_013: { label: 'IRCS', why: 'The International Radio Call Sign is used for vessel communication identification across maritime authorities. It provides an additional verification layer alongside the IMO number.' },
  FV_014: { label: 'MMSI', why: 'The Maritime Mobile Service Identity is transmitted by AIS and used to track vessel positions in real time. Its absence may indicate AIS tampering, which is associated with IUU fishing.' },
  FV_015: { label: 'Fishing Permit Number', why: 'A valid fishing permit authorises a vessel to operate in specific waters and target specific species. Missing permit data means the legality of the catch cannot be confirmed.' },
  FV_016: { label: 'EU Facility Approval #', why: 'The EU requires all fish processing and handling facilities to hold an official approval number. Without this, the product cannot legally enter the EU market.' },
  FV_017: { label: 'Name of Captain', why: 'The captain bears legal responsibility for the vessel\'s fishing operations and compliance with regulations. Captain identity is essential for accountability in IUU investigations.' },
  FV_018: { label: 'Crew List Provided', why: 'Crew lists are required by port state control and flag state authorities to verify vessel operations. They also help identify forced labour and human rights violations at sea.' },
  FV_019: { label: 'Flag State Approval for Transshipment', why: 'Transshipment at sea is tightly regulated to prevent laundering of IUU catch. Flag state approval confirms the vessel is authorised to conduct transshipment operations.' },
  FV_020: { label: 'Transshipment in Port or Observed', why: 'In-port or observer-monitored transshipment significantly reduces IUU risk compared to at-sea transshipment. This KDE confirms the highest level of transshipment oversight.' },
  FV_021: { label: 'Catch Area - FAO Fishing Zones', why: 'The FAO fishing zone identifies where the fish was caught and is used to verify the vessel held the right permits for that area. It is a legal requirement for catch documentation and EU importation.' },
  FV_022: { label: 'Port of Departure', why: 'The port of departure confirms where the fishing trip began and is cross-referenced with vessel monitoring records. It anchors the catch event geographically for traceability purposes.' },
  FV_023: { label: 'Port of Arrival', why: 'The port of arrival is where the catch is officially landed and documented by port state authorities. It is a key link in the chain of custody from sea to shore.' },
  FV_024: { label: 'Vessel Trip - Capture Dates', why: 'Start and end dates of the fishing trip allow auditors to verify the vessel\'s location during the catch period using VMS data. Gaps or inconsistencies here are major IUU red flags.' },
  FV_025: { label: 'Date of Discharge / Landing', why: 'The discharge date confirms when the catch entered the supply chain on land. It must align with vessel trip records and port authority logs to ensure catch legitimacy.' },
  FV_026: { label: 'Species Scientific Name', why: 'Using the scientific name prevents mislabelling and ensures species-specific regulations are correctly applied. It is required for accurate catch documentation and buyer specifications.' },
  CR_001: { label: 'Name of Carrier Vessel', why: 'The carrier vessel transports catch from the fishing vessel to port, and its identity is required to complete the chain of custody. Unidentified carriers are a major IUU laundering risk.' },
  CR_002: { label: 'Carrier Vessel VID', why: 'The VID allows the carrier to be cross-checked against authorised vessel registries. Carriers without a valid VID may be operating outside regulatory oversight.' },
  CR_003: { label: 'Carrier Vessel Flag', why: 'The carrier\'s flag state determines which regulations govern its transshipment operations. FOC-flagged carriers are high-risk and may facilitate IUU catch laundering.' },
  CR_004: { label: 'Carrier Flag State Registration', why: 'Formal registration confirms the carrier operates under a recognised authority with enforceable compliance obligations. Unregistered carriers undermine supply chain integrity.' },
  CR_005: { label: 'Carrier IMO Number', why: 'The IMO number provides a permanent, tamper-proof identifier for the carrier vessel. It is essential for cross-referencing with international shipping and IUU watch lists.' },
  CR_006: { label: 'Carrier IRCS', why: 'The radio call sign allows maritime authorities to communicate with and identify the carrier vessel during port inspections. It supports real-time vessel verification.' },
  CR_007: { label: 'Carrier MMSI', why: 'The MMSI is broadcast via AIS for real-time tracking of the carrier. Its absence may indicate the carrier is evading location monitoring, a common IUU tactic.' },
  CR_008: { label: 'Carrier on RFMO Register', why: 'RFMOs maintain lists of authorised carrier vessels for transshipment in their convention areas. Carriers not on the register are prohibited from receiving catch in those waters.' },
  CR_009: { label: 'Carrier Flag is not FOC', why: 'FOC-flagged carriers are disproportionately linked to IUU catch transport. Confirming the flag is not a FOC jurisdiction significantly reduces transshipment risk.' },
  CR_010: { label: 'Carrier Flag has no EU Card', why: 'A yellow or red card from the EU signals inadequate fisheries governance in the flag state. Catch transported by a carded-flag carrier faces EU market access restrictions.' },
  CR_011: { label: 'Carrier Previous Flag Declared', why: 'Frequent reflagging by carrier vessels is a known IUU evasion tactic. Declaring prior flags allows verification against IUU vessel histories and sanctions lists.' },
  FCL_001: { label: 'Port Name + Wharf (Loading)', why: 'The loading port and wharf identify exactly where the cargo entered the container. This location must be validated against vessel arrival records and port authority documentation.' },
  FCL_002: { label: 'Geo-location of Loading Wharf', why: 'GPS coordinates or a GLN provide precise identification of the loading point. This enables satellite cross-referencing to confirm the vessel was physically present at the declared location.' },
  FCL_003: { label: 'Port State has EU Competence', why: 'The EU recognises competent authorities that can certify catch documentation. Loading at a non-competent port means catch certificates may not be accepted for EU import.' },
  FCL_004: { label: 'Loading Wharf Covered by MSC CoC', why: 'For MSC-certified products, the loading wharf must fall within the scope of a valid MSC Chain of Custody certificate. Failure invalidates the MSC claim for that shipment.' },
  FCL_005: { label: 'Independently Monitored by Port State CA', why: 'Independent monitoring by a competent authority adds a layer of official verification at the loading stage. It significantly reduces the risk of undeclared catch entering the supply chain.' },
  FCL_006: { label: 'Bill of Lading (MSC noted)', why: 'The Bill of Lading is the primary shipping document and must reference MSC certification where applicable. It legally links the product to the shipment and buyer.' },
  FCL_007: { label: 'Product Ownership', why: 'Clear ownership records at the container loading stage prevent undeclared transfers of IUU product. Ownership gaps are a key indicator of catch substitution or laundering.' },
  FCL_008: { label: 'Consignee', why: 'The consignee is the party receiving the shipment and is legally responsible for import compliance. Identifying the consignee is required for customs, SIMP, and EU catch certificate validation.' },
  FCL_009: { label: 'Date of Loading', why: 'The container loading date must align with vessel discharge records and port authority logs. Discrepancies may indicate product substitution or falsified catch documentation.' },
  FCL_010: { label: 'Container Number', why: 'The container number uniquely identifies the physical unit carrying the seafood and is used across all logistics documentation. It enables end-to-end tracking from port to final buyer.' },
  PP_001: { label: 'Name of Primary Processor', why: 'The primary processor is the first land-based facility to handle the catch. Its identity must appear on catch certificates, and it must hold relevant approvals for traceability.' },
  PP_002: { label: 'Geo-location of Primary Processor', why: 'GPS coordinates or GLN confirm the physical location of the processing facility. This is used to verify the facility exists at the declared address and holds the required approvals.' },
  PP_003: { label: 'EU Facility Approval # (Primary)', why: 'Products intended for the EU must be processed at EU-approved facilities. Without a valid approval number, the product is ineligible for EU market entry.' },
  PP_004: { label: 'Coldstore Covered by MSC CoC', why: 'Any cold storage used by the primary processor must be included in the MSC CoC scope. Uncovered cold storage breaks the MSC chain of custody and invalidates the certification claim.' },
  PP_005: { label: 'Holding Facility (if not processor)', why: 'If the catch is held at a separate facility before processing, that facility must be declared and verified. Undeclared holding points are a common point of IUU product insertion.' },
  PP_006: { label: 'Geo-location of Holding Facility', why: 'The location of any holding facility must be verifiable against approvals and permits. Unverified storage locations undermine the integrity of the chain of custody.' },
  PP_007: { label: 'Date Received Raw Material', why: 'The receipt date at the primary processor must align with vessel discharge and transport records. It anchors the catch temporally in the supply chain and flags any custody gaps.' },
  SP_001: { label: 'Name of Secondary Processor', why: 'The secondary processor transforms the primary-processed product into the final retail form. Its identity is required on all traceability documents from this stage onward.' },
  SP_002: { label: 'Geo-location of Secondary Processor', why: 'The facility\'s physical location must be verifiable to confirm it holds the required certifications and approvals. Unverifiable locations raise significant IUU and food safety concerns.' },
  SP_003: { label: 'EU Facility Approval # (Secondary)', why: 'The secondary processor must also hold an EU facility approval if the product is destined for European markets. This approval number must appear on all EU catch certificate documentation.' },
  SP_004: { label: 'Coldstore Covered by MSC CoC (SP)', why: 'Cold storage at the secondary processing stage must remain within the MSC CoC scope. Any break in certified storage coverage invalidates the MSC claim for that lot.' },
  SP_005: { label: 'Geo-location of SP Holding Facility', why: 'Any secondary holding facility must be declared and its location verified. Undeclared storage at this stage is a common vulnerability exploited to mix certified and uncertified product.' },
  SP_006: { label: 'Verified MSC CoC (Broker/SP)', why: 'If a broker or secondary processor is involved, their MSC CoC must be independently verified as current and in scope. An expired or out-of-scope CoC renders the MSC label non-compliant.' },
  SP_007: { label: 'Container Discharge / Arrival Date (SP)', why: 'The arrival date of raw material at the secondary processor must reconcile with shipping records. Unexplained time gaps between stages can indicate undeclared storage or product substitution.' },
  SP_008: { label: 'Full Catch Data from Primary Processor', why: 'The secondary processor must receive complete catch documentation from the primary processor. Incomplete data breaks the traceability chain and is a non-conformity under MSC and EU requirements.' },
  SP_009: { label: 'Lot Code (PP to SP Match)', why: 'The primary processor\'s lot code must be matched to the secondary processor\'s own lot code. This linkage is the core of product-level traceability and is required for MSC CoC and SIMP compliance.' },
  SP_010: { label: 'Single Batch per Lot Code', why: 'Mixing batches from different fishing trips or vessels within a single lot code is a major traceability violation. Single-batch integrity is fundamental to MSC and SIMP audit requirements.' },
  SP_011: { label: 'Provides Full Data Timely', why: 'Timely and complete data submission from the secondary processor to the programme coordinator is a compliance obligation. Repeated delays are a performance indicator used in annual audits.' },
  SP_012: { label: 'Passes Pacifical Audits', why: 'Passing independent CoC and reporting audits confirms the secondary processor meets programme standards. Audit failures directly impact the ability to use the MSC label on outgoing product.' },
  SP_013: { label: 'Product Subject to MSC CoC', why: 'This confirms the product batch is explicitly covered under an active MSC Chain of Custody certificate. Without this confirmation, the MSC claim on the final product label is unsubstantiated.' },
  LFP_001: { label: 'Name of Shipper / End Buyer (GLN)', why: 'The shipper\'s identity and GLN are required on all final logistics documentation and EU catch certificates. This establishes who is legally responsible for the product at the point of export.' },
  LFP_002: { label: 'MSC CoC # of Shipper', why: 'The shipper must hold a valid MSC CoC if they are making an MSC claim on the shipped product. An invalid or missing CoC number at this stage constitutes an MSC non-conformity.' },
  LFP_003: { label: 'Name of Receiver / End Buyer (GLN)', why: 'The receiver\'s identity and location are required for customs clearance, SIMP entry, and EU catch certificate filing. Missing receiver data prevents legal import in regulated markets.' },
  LFP_004: { label: 'Buyer\'s Purchase Order', why: 'The purchase order links the physical shipment to a confirmed commercial transaction. It is required for invoice reconciliation, customs documentation, and audit trail completeness.' },
  LFP_005: { label: 'Container Number (Final)', why: 'The container number at the final logistics stage must match all prior shipping documentation. Any discrepancy indicates possible cargo substitution or documentation fraud.' },
  LFP_006: { label: 'Seal Number', why: 'Container seal numbers confirm the container has not been opened or tampered with since loading. Missing or mismatched seal numbers are a red flag for cargo interference in transit.' },
  LFP_007: { label: 'Bill of Lading (MSC noted)', why: 'The final Bill of Lading must reference the MSC certificate and claim where applicable. It is a legally binding shipping document and a core requirement for EU catch certificate validation.' },
  LFP_008: { label: 'Commercial Invoice (MSC noted)', why: 'The commercial invoice must accurately reflect the MSC status of the product for customs and importer compliance. Incorrect or missing certification references create SIMP and EU import compliance failures.' },
  LFP_009: { label: 'Packing List (MSC noted)', why: 'The packing list must align with the invoice and Bill of Lading, including MSC references. Discrepancies between these documents are a primary trigger for customs holds and IUU investigations.' },
  LFP_010: { label: 'Port State IUU Risk Index', why: 'The IUU risk rating of the destination port state indicates the likelihood of inadequate import controls. High-risk destination ports require additional documentation and verification to ensure legal trade compliance.' },
};

function getMriStatus(score) {
  if (score === 0) return { label: 'Transparent', cls: 'transparent', emoji: '🟢' };
  if (score < 100) return { label: 'Low Risk', cls: 'low', emoji: '🔵' };
  if (score < 500) return { label: 'Medium Risk', cls: 'medium', emoji: '🟡' };
  return { label: 'Critical', cls: 'critical', emoji: '🔴' };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function handleLogout() { dbClient.auth.signOut().then(() => window.location.href = 'login.html'); }

function toggleNavDropdown() {
  document.getElementById('navDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-right')) {
    document.getElementById('navDropdown')?.classList.remove('open');
  }
});

// ── GAUGE ─────────────────────────────────────────────────────
function animateGauge(score, maxScore) {
  const arc = document.getElementById('gaugeArc');
  const dot = document.getElementById('gaugeDot');
  if (!arc || !dot) return;

  const totalLength = 251.2;
  const ratio = maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
  const offset = totalLength - (ratio * totalLength);

  const status = getMriStatus(score);
  const colors = { transparent: '#22c55e', low: '#3b82f6', medium: '#f59e0b', critical: '#e63946' };
  const color = colors[status.cls];

  arc.style.stroke = color;
  arc.style.strokeDashoffset = offset;
  dot.style.stroke = color;

  const angle = -180 + (ratio * 180);
  const rad = (angle * Math.PI) / 180;
  const cx = 100 + 80 * Math.cos(rad);
  const cy = 110 + 80 * Math.sin(rad);
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);

  let current = 0;
  const step = Math.max(1, Math.ceil(score / 40));
  const timer = setInterval(() => {
    current = Math.min(current + step, score);
    document.getElementById('gaugeScore').textContent = current.toLocaleString();
    if (current >= score) clearInterval(timer);
  }, 30);
}

// ── STAGE MODAL ───────────────────────────────────────────────

// ── STAGE MODAL ───────────────────────────────────────────────
// Dummy assessment data for beta (Trident proj-002)
const DUMMY_STAGE_RESPONSIBILITY = { FV: "seller", CR: "seller", FCL: "seller", PP: "seller", SP: "buyer", LFP: "buyer" };

const DUMMY_ASSESSMENT = {
  FV: [
    { key: 'FV_001', score: 0 }, { key: 'FV_002', score: 50 }, { key: 'FV_003', score: 0 },
    { key: 'FV_004', score: 0 }, { key: 'FV_005', score: 50 }, { key: 'FV_006', score: 0 },
    { key: 'FV_007', score: 0 }, { key: 'FV_008', score: 0 }, { key: 'FV_009', score: 30 },
    { key: 'FV_010', score: 0 }, { key: 'FV_011', score: 0 }, { key: 'FV_012', score: 0 },
    { key: 'FV_013', score: 0 }, { key: 'FV_014', score: 30 }, { key: 'FV_015', score: 0 },
    { key: 'FV_016', score: 0 }, { key: 'FV_017', score: 0 }, { key: 'FV_018', score: 30 },
    { key: 'FV_019', score: 0 }, { key: 'FV_020', score: 0 }, { key: 'FV_021', score: 0 },
    { key: 'FV_022', score: 0 }, { key: 'FV_023', score: 0 }, { key: 'FV_024', score: 0 },
    { key: 'FV_025', score: 0 }, { key: 'FV_026', score: 0 },
  ],
  CR: [
    { key: 'CR_001', score: 50 }, { key: 'CR_002', score: 0 }, { key: 'CR_003', score: 0 },
    { key: 'CR_004', score: 0 }, { key: 'CR_005', score: 0 }, { key: 'CR_006', score: 30 },
    { key: 'CR_007', score: 0 }, { key: 'CR_008', score: 0 }, { key: 'CR_009', score: 0 },
    { key: 'CR_010', score: 0 }, { key: 'CR_011', score: 0 },
  ],
  FCL: [
    { key: 'FCL_001', score: 0 }, { key: 'FCL_002', score: 0 }, { key: 'FCL_003', score: 50 },
    { key: 'FCL_004', score: 0 }, { key: 'FCL_005', score: 0 }, { key: 'FCL_006', score: 0 },
    { key: 'FCL_007', score: 0 }, { key: 'FCL_008', score: 0 }, { key: 'FCL_009', score: 0 },
    { key: 'FCL_010', score: 0 },
  ],
  PP: [
    { key: 'PP_001', score: 0 }, { key: 'PP_002', score: 0 }, { key: 'PP_003', score: 0 },
    { key: 'PP_004', score: 0 }, { key: 'PP_005', score: 30 }, { key: 'PP_006', score: 0 },
    { key: 'PP_007', score: 0 },
  ],
  SP: [
    { key: 'SP_001', score: 0 }, { key: 'SP_002', score: 0 }, { key: 'SP_003', score: 0 },
    { key: 'SP_004', score: 0 }, { key: 'SP_005', score: 0 }, { key: 'SP_006', score: 40 },
    { key: 'SP_007', score: 0 }, { key: 'SP_008', score: 0 }, { key: 'SP_009', score: 0 },
    { key: 'SP_010', score: 0 }, { key: 'SP_011', score: 0 }, { key: 'SP_012', score: 0 },
    { key: 'SP_013', score: 0 },
  ],
  LFP: [
    { key: 'LFP_001', score: 0 }, { key: 'LFP_002', score: 0 }, { key: 'LFP_003', score: 0 },
    { key: 'LFP_004', score: 0 }, { key: 'LFP_005', score: 0 }, { key: 'LFP_006', score: 0 },
    { key: 'LFP_007', score: 0 }, { key: 'LFP_008', score: 0 }, { key: 'LFP_009', score: 0 },
    { key: 'LFP_010', score: 0 },
  ],
};
// ── LOW RISK DUMMY (Cermaq proj-003) ─────────────────────────
const DUMMY_LOW_STAGE_RESPONSIBILITY = { FV: "seller", CR: "seller", FCL: "seller", PP: "seller", SP: "seller", LFP: "buyer" };

const DUMMY_LOW_ASSESSMENT = {
  FV: [
    { key: 'FV_001', score: 0 }, { key: 'FV_002', score: 0 }, { key: 'FV_003', score: 0 },
    { key: 'FV_004', score: 0 }, { key: 'FV_005', score: 0 }, { key: 'FV_006', score: 0 },
    { key: 'FV_007', score: 0 }, { key: 'FV_008', score: 0 }, { key: 'FV_009', score: 0 },
    { key: 'FV_010', score: 30 }, { key: 'FV_011', score: 0 }, { key: 'FV_012', score: 0 },
    { key: 'FV_013', score: 0 }, { key: 'FV_014', score: 0 }, { key: 'FV_015', score: 0 },
    { key: 'FV_016', score: 0 }, { key: 'FV_017', score: 0 }, { key: 'FV_018', score: 0 },
    { key: 'FV_019', score: 0 }, { key: 'FV_020', score: 0 }, { key: 'FV_021', score: 0 },
    { key: 'FV_022', score: 0 }, { key: 'FV_023', score: 0 }, { key: 'FV_024', score: 0 },
    { key: 'FV_025', score: 0 }, { key: 'FV_026', score: 0 },
  ],
  CR: [
    { key: 'CR_001', score: 0 }, { key: 'CR_002', score: 0 }, { key: 'CR_003', score: 0 },
    { key: 'CR_004', score: 0 }, { key: 'CR_005', score: 0 }, { key: 'CR_006', score: 0 },
    { key: 'CR_007', score: 35 }, { key: 'CR_008', score: 0 }, { key: 'CR_009', score: 0 },
    { key: 'CR_010', score: 0 }, { key: 'CR_011', score: 0 },
  ],
  FCL: [
    { key: 'FCL_001', score: 0 }, { key: 'FCL_002', score: 0 }, { key: 'FCL_003', score: 0 },
    { key: 'FCL_004', score: 0 }, { key: 'FCL_005', score: 0 }, { key: 'FCL_006', score: 0 },
    { key: 'FCL_007', score: 0 }, { key: 'FCL_008', score: 0 }, { key: 'FCL_009', score: 0 },
    { key: 'FCL_010', score: 0 },
  ],
  PP: [
    { key: 'PP_001', score: 0 }, { key: 'PP_002', score: 0 }, { key: 'PP_003', score: 0 },
    { key: 'PP_004', score: 0 }, { key: 'PP_005', score: 0 }, { key: 'PP_006', score: 0 },
    { key: 'PP_007', score: 0 },
  ],
  SP: [
    { key: 'SP_001', score: 0 }, { key: 'SP_002', score: 0 }, { key: 'SP_003', score: 0 },
    { key: 'SP_004', score: 0 }, { key: 'SP_005', score: 0 }, { key: 'SP_006', score: 0 },
    { key: 'SP_007', score: 0 }, { key: 'SP_008', score: 0 }, { key: 'SP_009', score: 0 },
    { key: 'SP_010', score: 0 }, { key: 'SP_011', score: 0 }, { key: 'SP_012', score: 0 },
    { key: 'SP_013', score: 0 },
  ],
  LFP: [
    { key: 'LFP_001', score: 0 }, { key: 'LFP_002', score: 0 }, { key: 'LFP_003', score: 0 },
    { key: 'LFP_004', score: 0 }, { key: 'LFP_005', score: 0 }, { key: 'LFP_006', score: 0 },
    { key: 'LFP_007', score: 0 }, { key: 'LFP_008', score: 0 }, { key: 'LFP_009', score: 0 },
    { key: 'LFP_010', score: 0 },
  ],
};

function openStageModal(stageCode, isDummy = false, isLow = false) {
  const stageInfo = STAGE_INFO[stageCode];
  const assessment = isLow ? DUMMY_LOW_ASSESSMENT : DUMMY_ASSESSMENT;
  const stageData = isDummy ? assessment[stageCode] : [];
  const resp = isDummy ? (isLow ? DUMMY_LOW_STAGE_RESPONSIBILITY[stageCode] : DUMMY_STAGE_RESPONSIBILITY[stageCode]) : 'seller';

  const missing = stageData.filter(k => k.score > 0);
  const ok = stageData.filter(k => k.score === 0);
  const totalRisk = stageData.reduce((s, k) => s + k.score, 0);

  const modal = document.getElementById('stageModal');
  document.getElementById('stageModalTitle').textContent = stageInfo.label;
  document.getElementById('stageModalDesc').textContent = stageInfo.desc;
  document.getElementById('stageModalScore').textContent = `${totalRisk} / ${STAGE_MAX[stageCode]} risk pts`;
  document.getElementById('stageModalCode').textContent = stageCode;

  // Responsibility badge
  const respConfigs = {
    seller: { label: 'Seller Responsible', bg: '#dbeafe', color: '#1d4ed8' },
    buyer:  { label: 'Buyer Responsible',  bg: '#dcfce7', color: '#16a34a' },
    both:   { label: 'Both Responsible',   bg: '#fef3c7', color: '#d97706' },
  };
  const respCfg = respConfigs[resp] || respConfigs.seller;
  const respBadgeEl = document.getElementById('stageModalRespBadge');
  if (respBadgeEl) {
    respBadgeEl.textContent = respCfg.label;
    respBadgeEl.style.background = respCfg.bg;
    respBadgeEl.style.color = respCfg.color;
  }

  const statusObj = getMriStatus(totalRisk);
  const pill = document.getElementById('stageModalStatus');
  pill.className = `mri-status-pill ${statusObj.cls}`;
  pill.innerHTML = `<span class="dot"></span> ${statusObj.label}`;

  const missingEl = document.getElementById('stageModalMissing');
  const okEl = document.getElementById('stageModalOk');

  if (missing.length === 0) {
    missingEl.innerHTML = `<div style="text-align:center; padding:24px; color:#16a34a; font-size:13px; font-weight:600;">✅ All KDEs complete — no risk identified at this stage.</div>`;
  } else {
    missingEl.innerHTML = missing.map(item => {
      const kde = KDE_DESCRIPTIONS[item.key];
      const wClass = item.score >= 50 ? 'w50' : item.score >= 30 ? 'w30' : 'w10';
      const wLabel = item.score >= 50 ? 'Critical' : item.score >= 30 ? 'High' : 'Low';
      return `
        <div class="stage-modal-kde missing">
          <div class="stage-modal-kde-top">
            <div class="stage-modal-kde-label">${kde?.label || item.key}</div>
            <span class="kde-weight ${wClass}" style="font-size:10px; padding:2px 8px;">${wLabel} — ${item.score} pts</span>
          </div>
          <p class="stage-modal-kde-why">${kde?.why || 'No description available.'}</p>
        </div>`;
    }).join('');
  }

  if (ok.length === 0) {
    okEl.innerHTML = '';
  } else {
    okEl.innerHTML = `
      <div class="stage-modal-ok-header">✅ ${ok.length} KDE${ok.length !== 1 ? 's' : ''} with no risk</div>
      <div class="stage-modal-ok-list">
        ${ok.map(item => {
          const kde = KDE_DESCRIPTIONS[item.key];
          return `<div class="stage-modal-ok-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ${kde?.label || item.key}
          </div>`;
        }).join('')}
      </div>`;
  }

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeStageModal() {
  document.getElementById('stageModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// Close on backdrop click
document.addEventListener('click', (e) => {
  const modal = document.getElementById('stageModal');
  if (modal && e.target === modal) closeStageModal();
});

// ── TOP 10 CRITICAL KDEs ──────────────────────────────────────
function renderTop10KDEs(assessmentData) {
  const container = document.getElementById('top10KDEs');
  if (!container) return;

  // Flatten all KDEs with scores > 0
  const allMissing = [];
  Object.entries(assessmentData).forEach(([stage, kdes]) => {
    kdes.forEach(kde => {
      if (kde.score > 0) {
        allMissing.push({
          key: kde.key,
          stage,
          score: kde.score,
          label: KDE_DESCRIPTIONS[kde.key]?.label || kde.key,
        });
      }
    });
  });

  // Sort by score descending, take top 10
  const top10 = allMissing.sort((a, b) => b.score - a.score).slice(0, 10);

  if (!top10.length) {
    container.innerHTML = '<div style="text-align:center; padding:24px; color:#16a34a; font-size:13px; font-weight:600;">✅ No critical KDEs missing</div>';
    return;
  }

  const maxScore = top10[0].score;
  const stageColors = { FV: '#1a6fdb', CR: '#7c3aed', FCL: '#0d9488', PP: '#f59e0b', SP: '#e63946', LFP: '#64748b' };

  container.innerHTML = top10.map((kde, i) => {
    const barWidth = Math.round((kde.score / maxScore) * 100);
    const color = stageColors[kde.stage] || '#1a6fdb';
    const wLabel = kde.score >= 50 ? 'Critical' : kde.score >= 30 ? 'High' : 'Medium';
    const wClass = kde.score >= 50 ? 'w50' : kde.score >= 30 ? 'w30' : 'w10';
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid #f0f2f8;">
        <div style="font-family:'DM Mono',monospace; font-size:11px; color:#9aa0b4; width:20px; text-align:right; flex-shrink:0;">${i + 1}</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <div style="font-size:12px; font-weight:600; color:#1a1a2e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px;">${kde.label}</div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <span style="font-size:10px; font-weight:700; color:${color}; background:${color}18; padding:2px 7px; border-radius:20px;">${kde.stage}</span>
              <span class="kde-weight ${wClass}" style="font-size:10px; padding:2px 7px;">${wLabel}</span>
            </div>
          </div>
          <div style="height:5px; background:#f0f2f8; border-radius:999px; overflow:hidden;">
            <div style="height:100%; width:${barWidth}%; background:${color}; border-radius:999px; transition:width 0.6s ease;"></div>
          </div>
        </div>
        <div style="font-family:'DM Mono',monospace; font-size:13px; font-weight:500; color:#1a1a2e; width:40px; text-align:right; flex-shrink:0;">${kde.score}</div>
      </div>`;
  }).join('');
}

// ── CTE PIE CHART ─────────────────────────────────────────────
function renderStagePieChart(stageScores) {
  const canvas = document.getElementById('stagePieChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 20;

  const stageColors = {
    FV: '#1a6fdb', CR: '#7c3aed', FCL: '#0d9488',
    PP: '#f59e0b', SP: '#e63946', LFP: '#64748b'
  };

  const stages = Object.keys(stageScores);
  const total = stages.reduce((s, k) => s + (stageScores[k] || 0), 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (total === 0) {
    // Draw full green circle for transparent
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Poppins';
    ctx.textAlign = 'center';
    ctx.fillText('Transparent', cx, cy);
    return;
  }

  let startAngle = -Math.PI / 2;
  stages.forEach(stage => {
    const score = stageScores[stage] || 0;
    if (score === 0) return;
    const slice = (score / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = stageColors[stage];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    const midAngle = startAngle + slice / 2;
    const lx = cx + (radius * 0.65) * Math.cos(midAngle);
    const ly = cy + (radius * 0.65) * Math.sin(midAngle);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px DM Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stage, lx, ly);

    startAngle += slice;
  });

  // Center hole (donut)
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 14px DM Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy - 8);
  ctx.font = '10px Poppins';
  ctx.fillStyle = '#9aa0b4';
  ctx.fillText('risk pts', cx, cy + 8);
}
// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();

  const email = session.user.email || '';
  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, email.substring(0, 2).toUpperCase(), profile?.avatar_color || '#1a6fdb');
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(profile?.first_name || email.split('@')[0]);

  if (['admin', 'operator'].includes(profile?.role)) {
    document.getElementById('dashEditBtn').classList.remove('hidden');
  }

  const params = new URLSearchParams(window.location.search);
  const projectName = decodeURIComponent(params.get('name') || 'Project');
  const projectStatus = params.get('status') || 'transparent';

  document.getElementById('dashProjectName').textContent = projectName;
  document.title = `${projectName} — MRI`;

  const statusBadge = document.getElementById('dashStatusBadge');
  statusBadge.textContent = projectStatus === 'medium' ? 'Medium Risk' : projectStatus === 'low' ? 'Low Risk' : 'Transparent';
  statusBadge.style.background = projectStatus === 'medium' ? '#fef3c7' : projectStatus === 'low' ? '#dbeafe' : '#dcfce7';
  statusBadge.style.color = projectStatus === 'medium' ? '#d97706' : projectStatus === 'low' ? '#1d4ed8' : '#16a34a';

  const isLow = projectStatus === 'low';
  const isDummy = projectStatus === 'medium' || isLow;

  if (isDummy) {
    const score = isLow ? 65 : 280;
    const maxScore = 2890;
    const stageScores = isLow
      ? { FV: 30, CR: 35, FCL: 0, PP: 0, SP: 0, LFP: 0 }
      : { FV: 120, CR: 80, FCL: 50, PP: 30, SP: 0, LFP: 0 };
    const activeAssessment = isLow ? DUMMY_LOW_ASSESSMENT : DUMMY_ASSESSMENT;
    const activeResp = isLow ? DUMMY_LOW_STAGE_RESPONSIBILITY : DUMMY_STAGE_RESPONSIBILITY;

    document.getElementById('gaugeMax').textContent = `/ ${maxScore.toLocaleString()}`;
    const s = getMriStatus(score);
    document.getElementById('gaugeStatus').textContent = `${s.emoji} ${s.label}`;
    animateGauge(score, maxScore);

    Object.entries(stageScores).forEach(([stage, stageScore]) => {
      const max = STAGE_MAX[stage];
      document.getElementById(`stageMiniScore-${stage}`).innerHTML = `${stageScore} <span>/ ${max}</span>`;
      const pct = Math.round((stageScore / max) * 100);
      document.getElementById(`stageMiniBar-${stage}`).style.width = `${pct}%`;
    });

    // Org responsibility scores
    let sellerScore = 0, buyerScore = 0;
    Object.entries(stageScores).forEach(([stage, stageScore]) => {
      const resp = activeResp[stage];
      if (resp === 'seller') sellerScore += stageScore;
      else if (resp === 'buyer') buyerScore += stageScore;
      else { sellerScore += Math.round(stageScore / 2); buyerScore += Math.round(stageScore / 2); }
    });

    const sellerEl = document.getElementById('sellerScore');
    const buyerEl = document.getElementById('buyerScore');
    if (sellerEl) {
      sellerEl.textContent = `${sellerScore} pts`;
      const ss = getMriStatus(sellerScore);
      sellerEl.className = `org-list-score ${ss.cls}`;
    }
    if (buyerEl) {
      buyerEl.textContent = `${buyerScore} pts`;
      const bs = getMriStatus(buyerScore);
      buyerEl.className = `org-list-score ${bs.cls}`;
    }

    // Update org names based on project
    if (document.getElementById('sellerName')) {
      if (isLow) {
        document.getElementById('sellerName').textContent = 'Cermaq Group';
        document.getElementById('sellerAvatar').textContent = 'C';
        document.getElementById('sellerAvatar').style.background = '#7c3aed';
        document.getElementById('buyerName').textContent = 'Maruha Nichiro';
        document.getElementById('buyerAvatar').textContent = 'M';
        document.getElementById('buyerAvatar').style.background = '#b45309';
      } else {
        document.getElementById('sellerName').textContent = 'Trident Seafoods';
        document.getElementById('sellerAvatar').textContent = 'T';
        document.getElementById('sellerAvatar').style.background = '#1a6fdb';
        document.getElementById('buyerName').textContent = 'Nippon Suisan';
        document.getElementById('buyerAvatar').textContent = 'N';
        document.getElementById('buyerAvatar').style.background = '#0d9488';
      }
    }

    // Make stage cards clickable
    Object.keys(STAGE_MAX).forEach(code => {
      const card = document.getElementById(`stage-${code}`);
      if (card) {
        card.style.cursor = 'pointer';
        card.title = `Click to see ${STAGE_INFO[code].label} KDE details`;
        card.onclick = () => openStageModal(code, true, isLow);
      }
    });

    // Highlight LFP green (all clear)
    const lfpCard = document.getElementById('stage-LFP');
    if (lfpCard) {
      lfpCard.style.background = '#f0fdf4';
      lfpCard.style.border = '1px solid #bbf7d0';
    }
    const lfpScoreEl = document.getElementById('stageMiniScore-LFP');
    if (lfpScoreEl) {
      lfpScoreEl.insertAdjacentHTML('afterend', '<div style="font-size:10px; font-weight:700; color:#16a34a; margin-top:4px;">✅ All clear</div>');
    }
    const lfpBar = document.getElementById('stageMiniBar-LFP');
    if (lfpBar) { lfpBar.style.background = '#22c55e'; lfpBar.style.width = '0%'; }

    // Grey out SP (not applicable)
    const spCard = document.getElementById('stage-SP');
    if (spCard) {
      spCard.style.opacity = '0.4';
      spCard.style.cursor = 'not-allowed';
      spCard.style.pointerEvents = 'none';
      spCard.insertAdjacentHTML('beforeend', '<div style="font-size:10px; font-weight:700; color:#9aa0b4; text-align:center; padding:6px 0; text-transform:uppercase; letter-spacing:0.8px;">Not Applicable</div>');
    }

    // Products
    document.getElementById('productsEmpty').classList.add('hidden');
    const table = document.getElementById('productsTable');
    table.classList.remove('hidden');
    table.innerHTML = `
      <div class="product-row" style="border-bottom:1px solid #f0f2f8; padding-bottom:8px; margin-bottom:4px;">
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Product</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Risk Score</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Status</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Assessed</span>
      </div>
      <div class="product-row">
        <div>
          <div class="product-row-name">${isLow ? 'Atlantic Salmon Fillet — ASC' : 'Pacific Cod Loin — MSC'}</div>
          <div class="product-row-brand">${isLow ? 'Cermaq Norway' : 'Trident Seafoods'}</div>
        </div>
        <div class="product-row-score">${isLow ? '65' : '280'} <span>/ 2,890</span></div>
        <div><span class="mri-status-pill ${isLow ? 'low' : 'medium'}"><span class="dot"></span> ${isLow ? 'Low Risk' : 'Medium Risk'}</span></div>
        <div style="font-size:12px; color:#9aa0b4;">${isLow ? '15 May 2026' : '28 May 2026'}</div>
      </div>`;

    document.getElementById('kdeCovData').textContent = isLow ? '72' : '54';
    document.getElementById('kdeCovMissing').textContent = isLow ? '3' : '18';
    document.getElementById('kdeCovNA').textContent = isLow ? '2' : '5';
    document.getElementById('kdeCovBarGreen').style.width = isLow ? '93%' : '70%';
    document.getElementById('kdeCovBarRed').style.width = isLow ? '4%' : '23%';
    document.getElementById('kdeCovBarGrey').style.width = isLow ? '3%' : '7%';
    document.querySelector('.kde-cov-note').textContent = isLow ? '93% data coverage across 77 KDEs' : '70% data coverage across 77 KDEs';

    document.getElementById('lastAssessEmpty').classList.add('hidden');
    document.getElementById('lastAssessInfo').classList.remove('hidden');
    document.getElementById('lastAssessDate').textContent = isLow ? '15 May 2026' : '28 May 2026';
    document.getElementById('lastAssessBy').textContent = 'Assessed by Analyst';
    document.getElementById('lastAssessScore').textContent = isLow ? '65 / 2,890' : '280 / 2,890';

    // Top 10 KDEs
    renderTop10KDEs(activeAssessment);

    // Pie chart
    renderStagePieChart(stageScores);

  } else {
    animateGauge(0, 3150);
    document.getElementById('gaugeStatus').textContent = '🟢 Transparent';

    if (document.getElementById('sellerName')) {
      document.getElementById('sellerName').textContent = 'Mowi ASA';
      document.getElementById('sellerAvatar').textContent = 'M';
      document.getElementById('sellerAvatar').style.background = '#0369a1';
      document.getElementById('buyerName').textContent = 'Maruha Nichiro';
      document.getElementById('buyerAvatar').textContent = 'M';
      document.getElementById('buyerAvatar').style.background = '#b45309';
    }

    Object.keys(STAGE_MAX).forEach(code => {
      document.getElementById(`stageMiniScore-${code}`).innerHTML = `0 <span>/ ${STAGE_MAX[code]}</span>`;
      const card = document.getElementById(`stage-${code}`);
      if (card) {
        card.style.cursor = 'pointer';
        card.onclick = () => openStageModal(code, false);
      }
    });
    renderTop10KDEs({ FV: [], CR: [], FCL: [], PP: [], SP: [], LFP: [] });
    renderStagePieChart({ FV: 0, CR: 0, FCL: 0, PP: 0, SP: 0, LFP: 0 });
  }
});