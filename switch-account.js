/* ============================================================
   PROJECT MANHATTAN — switch-account.js
   Switch Account modal — admin & operator only
   ============================================================ */

// Inject modal HTML into page
function injectSwitchAccountModal() {
  if (document.getElementById('switchAccountModal')) return;

  const modal = document.createElement('div');
  modal.id = 'switchAccountModal';
  modal.innerHTML = `
    <div class="sa-backdrop" onclick="closeSwitchAccount()"></div>
    <div class="sa-modal">
      <div class="sa-header">
        <div class="sa-header-left">
          <div class="sa-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a6fdb" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          </div>
          <div>
            <h2 class="sa-title">Switch Account</h2>
            <p class="sa-subtitle">Select a company to view their workspace</p>
          </div>
        </div>
        <button class="sa-close" onclick="closeSwitchAccount()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="sa-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="saSearchInput" placeholder="Search companies..." oninput="filterSACompanies(this.value)" />
      </div>

      <div class="sa-list" id="saCompanyList">
        <div class="sa-loading">
          <div class="sa-spinner"></div>
          Loading companies...
        </div>
      </div>

      <div class="sa-footer">
        <button class="sa-cancel" onclick="closeSwitchAccount()">Cancel</button>
      </div>
    </div>
  `;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #switchAccountModal {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
    }

    #switchAccountModal.open {
      display: flex;
    }

    .sa-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 20, 40, 0.35);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .sa-modal {
      position: relative;
      background: #fff;
      border-radius: 20px;
      width: 480px;
      max-width: 92vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 32px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
      overflow: hidden;
      animation: saSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes saSlideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .sa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 22px 24px 16px;
      border-bottom: 1px solid #f0f2f8;
    }

    .sa-header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sa-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: #eef4fd;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sa-title {
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0;
    }

    .sa-subtitle {
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 12px;
      color: #9aa0b4;
      margin: 2px 0 0;
    }

    .sa-close {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f4f6fb;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #6b7280;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .sa-close:hover { background: #e8eaf0; color: #1a1a2e; }

    .sa-search {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      border-bottom: 1px solid #f0f2f8;
      color: #9aa0b4;
    }

    .sa-search input {
      flex: 1;
      border: none;
      outline: none;
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      background: transparent;
    }

    .sa-search input::placeholder { color: #c0c4d0; }

    .sa-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
    }

    .sa-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 24px;
      justify-content: center;
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 13px;
      color: #9aa0b4;
    }

    .sa-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #e8eaf0;
      border-top-color: #1a6fdb;
      border-radius: 50%;
      animation: saSpin 0.6s linear infinite;
    }

    @keyframes saSpin { to { transform: rotate(360deg); } }

    .sa-company-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 14px;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .sa-company-item:hover { background: #f4f6fb; }

    .sa-company-avatar {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: #eef4fd;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 800;
      color: #1a6fdb;
      flex-shrink: 0;
      overflow: hidden;
    }

    .sa-company-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .sa-company-info { flex: 1; min-width: 0; }

    .sa-company-name {
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sa-company-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 3px;
    }

    .sa-company-type {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 20px;
    }

    .sa-company-type.supplier { background: #dcfce7; color: #16a34a; }
    .sa-company-type.buyer { background: #eef4fd; color: #1a6fdb; }
    .sa-company-type.partner { background: #fef3c7; color: #d97706; }
    .sa-company-type.other { background: #f4f6fb; color: #6b7280; }

    .sa-company-members {
      font-size: 11px;
      color: #9aa0b4;
    }

    .sa-company-code {
      font-size: 11px;
      font-weight: 600;
      color: #c0c4d0;
      letter-spacing: 0.5px;
    }

    .sa-arrow {
      color: #c0c4d0;
      flex-shrink: 0;
    }

    .sa-empty {
      text-align: center;
      padding: 32px;
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 13px;
      color: #9aa0b4;
    }

    .sa-footer {
      padding: 14px 24px;
      border-top: 1px solid #f0f2f8;
      display: flex;
      justify-content: flex-end;
    }

    .sa-cancel {
      padding: 9px 22px;
      border-radius: 10px;
      border: 1.5px solid #e0e3ed;
      background: #fff;
      font-family: 'Poppins', 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #4a4e69;
      cursor: pointer;
      transition: border-color 0.15s;
    }

    .sa-cancel:hover { border-color: #1a6fdb; color: #1a6fdb; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(modal);
}

let saAllCompanies = [];

async function openSwitchAccount() {
  injectSwitchAccountModal();
  document.getElementById('switchAccountModal').classList.add('open');
  document.getElementById('saSearchInput').value = '';
  await loadSACompanies();
}

function closeSwitchAccount() {
  document.getElementById('switchAccountModal')?.classList.remove('open');
}

async function loadSACompanies() {
  const { data } = await dbClient
    .from('companies')
    .select('id, company_name, company_type, company_code, photo_url, status')
    .order('company_name');

  saAllCompanies = data || [];

  // Get member counts
  const withCounts = await Promise.all(saAllCompanies.map(async c => {
    const { count } = await dbClient
      .from('company_members')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', c.id);
    return { ...c, memberCount: count || 0 };
  }));

  saAllCompanies = withCounts;
  renderSACompanies(saAllCompanies);
}

function renderSACompanies(companies) {
  const list = document.getElementById('saCompanyList');
  if (!companies.length) {
    list.innerHTML = '<div class="sa-empty">No companies found.</div>';
    return;
  }

  list.innerHTML = companies.map(c => `
    <div class="sa-company-item" onclick="switchToCompany('${c.id}')">
      <div class="sa-company-avatar">
        ${c.photo_url
          ? `<img src="${c.photo_url}" alt="${c.company_name}" />`
          : c.company_name.charAt(0).toUpperCase()
        }
      </div>
      <div class="sa-company-info">
        <div class="sa-company-name">${c.company_name}</div>
        <div class="sa-company-meta">
          ${c.company_type ? `<span class="sa-company-type ${c.company_type}">${c.company_type}</span>` : ''}
          <span class="sa-company-members">${c.memberCount} member${c.memberCount !== 1 ? 's' : ''}</span>
          ${c.company_code ? `<span class="sa-company-code">${c.company_code}</span>` : ''}
        </div>
      </div>
      <div class="sa-arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `).join('');
}

function filterSACompanies(query) {
  const q = query.toLowerCase();
  const filtered = saAllCompanies.filter(c =>
    c.company_name.toLowerCase().includes(q) ||
    (c.company_type || '').toLowerCase().includes(q) ||
    (c.company_code || '').toLowerCase().includes(q)
  );
  renderSACompanies(filtered);
}

function switchToCompany(companyId) {
  closeSwitchAccount();
  window.location.href = `home-logged-in.html?company=${companyId}`;
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSwitchAccount();
});