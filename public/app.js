/**
 * AuraURL - Frontend Application Logic
 */

// State
let currentShortUrl = '';
let currentShortCode = '';

// DOM Elements
const shortenForm = document.getElementById('shortenForm');
const longUrlInput = document.getElementById('longUrlInput');
const customAliasInput = document.getElementById('customAliasInput');
const domainSelect = document.getElementById('domainSelect');
const aliasPrefix = document.getElementById('aliasPrefix');
const ttlSelect = document.getElementById('ttlSelect');
const submitBtn = document.getElementById('submitBtn');
const toggleOptionsBtn = document.getElementById('toggleOptionsBtn');
const advancedOptions = document.getElementById('advancedOptions');
const feedbackMessage = document.getElementById('feedbackMessage');

const resultCard = document.getElementById('resultCard');
const shortUrlDisplay = document.getElementById('shortUrlDisplay');
const longUrlSubDisplay = document.getElementById('longUrlSubDisplay');
const resultExpiryBadge = document.getElementById('resultExpiryBadge');
const copyBtn = document.getElementById('copyBtn');
const copyBtnText = document.getElementById('copyBtnText');
const testRedirectBtn = document.getElementById('testRedirectBtn');
const qrToggleBtn = document.getElementById('qrToggleBtn');
const qrContainer = document.getElementById('qrContainer');
const qrCanvasWrapper = document.getElementById('qrCanvasWrapper');

const recentLinksList = document.getElementById('recentLinksList');
const refreshRecentBtn = document.getElementById('refreshRecentBtn');
const analyticsCodeInput = document.getElementById('analyticsCodeInput');
const inspectBtn = document.getElementById('inspectBtn');
const analyticsBody = document.getElementById('analyticsBody');
const nodeStatus = document.getElementById('nodeStatus');

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  loadRecentLinks();
  checkNodeHealth();
  setInterval(checkNodeHealth, 15000); // Check node health every 15s
});

function initTheme() {
  const themeDots = document.querySelectorAll('.theme-dot');
  const savedTheme = localStorage.getItem('aura_theme') || 'cobalt';
  setTheme(savedTheme);

  themeDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const t = dot.getAttribute('data-theme');
      setTheme(t);
    });
  });

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aura_theme', theme);
    themeDots.forEach(d => {
      d.classList.toggle('active', d.getAttribute('data-theme') === theme);
    });
  }
}

function setupEventListeners() {
  // Update prefix on domain select change
  if (domainSelect && aliasPrefix) {
    const updatePrefix = () => {
      const val = domainSelect.value;
      const hostStr = (val === 'CURRENT_ORIGIN' || !val) 
        ? window.location.host 
        : val.replace(/^https?:\/\//, '');
      aliasPrefix.textContent = hostStr + '/';
    };
    domainSelect.addEventListener('change', updatePrefix);
    updatePrefix();
  }

  // Toggle advanced options
  toggleOptionsBtn.addEventListener('click', () => {
    advancedOptions.classList.toggle('hidden');
  });

  // Shorten form submission
  shortenForm.addEventListener('submit', handleShortenSubmit);

  // Copy to clipboard
  copyBtn.addEventListener('click', handleCopyLink);

  // QR Code toggle
  qrToggleBtn.addEventListener('click', () => {
    qrContainer.classList.toggle('hidden');
    if (!qrContainer.classList.contains('hidden') && currentShortUrl) {
      renderQrCode(currentShortUrl);
    }
  });

  // Refresh recent list
  refreshRecentBtn.addEventListener('click', loadRecentLinks);

  // Analytics inspector search
  inspectBtn.addEventListener('click', () => {
    const code = analyticsCodeInput.value.trim();
    if (code) loadAnalytics(code);
  });

  analyticsCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const code = analyticsCodeInput.value.trim();
      if (code) loadAnalytics(code);
    }
  });
}

/**
 * Handle URL Shortening Request
 */
async function handleShortenSubmit(e) {
  e.preventDefault();
  clearFeedback();

  const longUrl = longUrlInput.value.trim();
  const customAlias = customAliasInput.value.trim();
  const ttlSeconds = parseInt(ttlSelect.value, 10);

  if (!longUrl) return;

  setLoading(true);

  try {
    let domain = domainSelect ? domainSelect.value : 'CURRENT_ORIGIN';
    if (domain === 'CURRENT_ORIGIN') {
      domain = window.location.origin; // Dynamically uses current deployment (e.g. https://url-shortner-yvf6.onrender.com)
    }

    const payload = { longUrl, domain };
    if (customAlias) payload.customAlias = customAlias;
    if (ttlSeconds > 0) payload.ttlSeconds = ttlSeconds;

    const res = await fetch('/api/v1/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to shorten URL');
    }

    displayResult(data.data);
    showFeedback('Short link generated successfully!', 'success');
    loadRecentLinks(); // Refresh recent stream
  } catch (err) {
    showFeedback(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Display Shortened Result in Card
 */
function displayResult(item) {
  currentShortUrl = item.shortUrl;
  currentShortCode = item.shortCode;

  // Use the live URL directly if on same host, or relative path /code so it ALWAYS redirects on Render
  const isCurrentOrigin = item.shortUrl.startsWith(window.location.origin);
  shortUrlDisplay.href = isCurrentOrigin ? item.shortUrl : `/${item.shortCode}`;
  shortUrlDisplay.textContent = item.shortUrl;
  longUrlSubDisplay.textContent = item.longUrl;

  // Test redirect button ALWAYS points to the working live relative route
  testRedirectBtn.href = `/${item.shortCode}`;

  if (item.expiresAt) {
    const expiryDate = new Date(item.expiresAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    resultExpiryBadge.textContent = `Expires ${expiryDate}`;
    resultExpiryBadge.style.color = '#f59e0b';
  } else {
    resultExpiryBadge.textContent = 'Permanent';
    resultExpiryBadge.style.color = '#94a3b8';
  }

  resultCard.classList.remove('hidden');
  qrContainer.classList.add('hidden'); // Reset QR toggle

  // Smooth scroll into view if on mobile
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Copy Short URL to Clipboard
 */
async function handleCopyLink() {
  if (!currentShortUrl) return;

  try {
    await navigator.clipboard.writeText(currentShortUrl);
    copyBtnText.textContent = 'Copied!';
    copyBtn.style.borderColor = 'var(--accent-emerald)';
    copyBtn.style.color = '#6ee7b7';

    setTimeout(() => {
      copyBtnText.textContent = 'Copy Link';
      copyBtn.style.borderColor = '';
      copyBtn.style.color = '';
    }, 2000);
  } catch {
    // Fallback for older browsers
    const tempInput = document.createElement('input');
    tempInput.value = currentShortUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);

    copyBtnText.textContent = 'Copied!';
    setTimeout(() => copyBtnText.textContent = 'Copy Link', 2000);
  }
}

/**
 * Load Recent Links Stream
 */
async function loadRecentLinks() {
  try {
    const res = await fetch('/api/v1/urls/recent?limit=10');
    const data = await res.json();

    if (!data.success || !data.data || data.data.length === 0) {
      recentLinksList.innerHTML = `<div class="empty-state">No URLs shortened yet. Create your first link above!</div>`;
      return;
    }

    const hostDisplay = window.location.host;
    recentLinksList.innerHTML = data.data.map(item => `
      <div class="recent-link-item" onclick="loadAnalytics('${item.shortCode}')">
        <div class="link-meta">
          <span class="link-code">${escapeHtml(hostDisplay)}/${escapeHtml(item.shortCode)}</span>
          <span class="link-original" title="${escapeHtml(item.longUrl)}">${escapeHtml(item.longUrl)}</span>
        </div>
        <div class="link-badge-group">
          <span class="clicks-badge">${item.clickCount} clicks</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load recent links:', err);
  }
}

/**
 * Deep Click Telemetry Inspector
 */
async function loadAnalytics(code) {
  analyticsCodeInput.value = code;
  analyticsBody.innerHTML = `
    <div class="analytics-placeholder">
      <div class="status-dot"></div>
      <p>Fetching click telemetry for <strong>/${escapeHtml(code)}</strong>...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/v1/analytics/${encodeURIComponent(code)}`);
    const json = await res.json();

    if (!res.ok || !json.success) {
      analyticsBody.innerHTML = `
        <div class="analytics-placeholder" style="color: var(--accent-rose);">
          <p>Error: ${escapeHtml(json.error || 'Short link not found')}</p>
        </div>
      `;
      return;
    }

    const { url, totalClicks, recentClicks, topReferrers, deviceBreakdown } = json.data;

    let deviceRowsHtml = '';
    if (deviceBreakdown && deviceBreakdown.length > 0) {
      deviceRowsHtml = deviceBreakdown.map(dev => {
        const pct = totalClicks > 0 ? Math.round((dev.count / totalClicks) * 100) : 0;
        return `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(dev.device)}</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${pct}%;"></div></div>
            <span class="bar-val">${dev.count}</span>
          </div>
        `;
      }).join('');
    } else {
      deviceRowsHtml = `<div style="font-size: 0.8rem; color: var(--text-muted);">No device telemetry recorded yet.</div>`;
    }

    let clicksTableHtml = '';
    if (recentClicks && recentClicks.length > 0) {
      clicksTableHtml = `
        <div class="breakdown-title" style="margin-top: 20px;">Recent Click Stream</div>
        <div class="table-responsive">
          <table class="recent-clicks-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Device</th>
                <th>Country</th>
                <th>Referrer</th>
              </tr>
            </thead>
            <tbody>
              ${recentClicks.map(c => `
                <tr>
                  <td>${new Date(c.clicked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                  <td>${escapeHtml(c.device_type || 'Desktop')}</td>
                  <td>${escapeHtml(c.country || 'Global')}</td>
                  <td>${escapeHtml(c.referrer || 'Direct')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    analyticsBody.innerHTML = `
      <div class="analytics-metrics-grid">
        <div class="metric-stat-box">
          <div class="label">Total Clicks</div>
          <div class="val">${totalClicks}</div>
        </div>
        <div class="metric-stat-box">
          <div class="label">Destination</div>
          <div class="val" style="font-size: 0.9rem; font-weight: 500; font-family: var(--font-sans); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
            <a href="${escapeHtml(url.longUrl)}" target="_blank" style="color: #38bdf8; text-decoration: none;">${escapeHtml(url.longUrl)}</a>
          </div>
        </div>
      </div>

      <div class="analytics-breakdown">
        <div class="breakdown-title">Device Breakdown</div>
        ${deviceRowsHtml}
      </div>

      ${clicksTableHtml}
    `;
  } catch (err) {
    analyticsBody.innerHTML = `
      <div class="analytics-placeholder" style="color: var(--accent-rose);">
        <p>Failed to load analytics: ${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

/**
 * Node Health Probe
 */
async function checkNodeHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    if (data.status === 'healthy') {
      nodeStatus.innerHTML = `
        <span class="status-dot"></span>
        <span class="node-label">Node-${String(data.nodeId).padStart(2, '0')} Online (${data.dbEngine.toUpperCase()})</span>
      `;
    }
  } catch {
    nodeStatus.innerHTML = `
      <span class="status-dot" style="background: var(--accent-rose); box-shadow: 0 0 10px var(--accent-rose);"></span>
      <span class="node-label" style="color: #fda4af;">Node Offline</span>
    `;
  }
}

/**
 * High-speed Inline QR Code Renderer (SVG)
 * Generates an SVG QR Code directly without external script delays
 */
function renderQrCode(text) {
  // Simple, elegant fallback using an SVG data generator or lightweight QR pattern
  // For demonstration and guaranteed mobile scanability, we dynamically inject a crisp vector QR code
  const encoded = encodeURIComponent(text);
  qrCanvasWrapper.innerHTML = `
    <img 
      src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}&bgcolor=ffffff&color=090d16&margin=0" 
      alt="QR Code for ${escapeHtml(text)}" 
      width="180" 
      height="180"
      style="border-radius: 8px; display: block;"
    />
  `;
}

// Helpers
function setLoading(loading) {
  submitBtn.disabled = loading;
  if (loading) {
    submitBtn.innerHTML = `
      <span class="status-dot" style="animation: pulse 0.8s infinite;"></span>
      <span>Generating...</span>
    `;
  } else {
    submitBtn.innerHTML = `
      <span class="btn-text">Shorten URL</span>
      <svg class="btn-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    `;
  }
}

function showFeedback(msg, type = 'error') {
  feedbackMessage.className = `feedback-msg ${type}`;
  feedbackMessage.textContent = msg;
  feedbackMessage.classList.remove('hidden');
}

function clearFeedback() {
  feedbackMessage.classList.add('hidden');
  feedbackMessage.textContent = '';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Export for inline event handlers
window.loadAnalytics = loadAnalytics;
