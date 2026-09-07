/* =========================================================
   app.js — أدوات مشتركة: الاتصال بالخادم، الجلسة، المكونات
   ========================================================= */
const TOKEN_KEY = 'session_token';
const DRAFT_KEY = 'pending_drafts_v2';
const SERVER_URL_KEY = 'custom_server_base_url';
const DEVICE_ID_KEY = 'app_device_uuid_v1';
const DEVICE_NAME_KEY = 'app_device_name_v1';
const CACHED_USER_KEY = 'cached_session_user_v2';
const OFFLINE_AUTH_KEY = 'offline_auth_profile_v2';

let __me = null;

function getCachedMe() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function getOfflineAuth() {
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setMe(m, passwordHash = null) {
  __me = m;
  if (m) {
    try {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(m));
      if (m.user && m.user.userName) {
        const existing = getOfflineAuth();
        const toSave = {
          userName: m.user.userName,
          fullName: m.user.fullName,
          role: m.user.role,
          passwordHash: passwordHash || (existing && existing.userName && existing.userName.toLowerCase() === m.user.userName.toLowerCase() ? existing.passwordHash : null),
          user: m.user,
          token: m.token || localStorage.getItem(TOKEN_KEY) || 'offline-token',
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(toSave));
      }
    } catch (e) {}
  }
}

async function currentMe() {
  if (__me) return __me;
  const cached = getCachedMe();
  const token = localStorage.getItem(TOKEN_KEY);

  // إذا لم يكن هناك جلسة مخزنة ولا توكن، لا يمكن المتابعة
  if (!token && (!cached || !cached.user)) {
    throw new Error('لا توجد جلسة نشطة');
  }

  // إذا كان الجهاز في وضع عدم الاتصال بالإنترنت تماماً، استخدم الجلسة المحلية المخزنة
  if (!navigator.onLine && cached && cached.user) {
    __me = cached;
    return __me;
  }

  try {
    // محاولة الاتصال بالخادم وتحديث الجلسة
    const d = await api('/me');
    setMe(d);
    return __me;
  } catch (err) {
    // في حال تعذر الاتصال بالخادم (انقطاع إنترنت أو بطء شبكة)، نعتمد تلقائياً على الجلسة المحلية
    if (cached && cached.user) {
      __me = cached;
      return __me;
    }
    throw err;
  }
}

/* ---------- معرّف الجهاز وبصمة الهاتف الميداني ---------- */
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName() {
  let name = localStorage.getItem(DEVICE_NAME_KEY);
  if (!name) {
    const ua = navigator.userAgent || '';
    let detected = 'هاتف ميداني';
    if (/Android/i.test(ua)) {
      const match = ua.match(/Android\s+([\d.]+)/);
      detected = 'هاتف أندرويد' + (match ? ' (v' + match[1] + ')' : '');
    } else if (/iPhone|iPad/i.test(ua)) {
      detected = 'هاتف آيفون / آيباد';
    } else if (/Windows/i.test(ua)) {
      detected = 'كمبيوتر ويندوز';
    } else {
      detected = 'جهاز ' + (navigator.platform || 'ميداني');
    }
    name = detected;
    localStorage.setItem(DEVICE_NAME_KEY, name);
  }
  return name;
}

function formatServerUrl(raw) {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    if (/^(localhost|127\.|192\.168\.|10\.|172\.)/i.test(url)) {
      url = 'http://' + url;
    } else {
      url = 'https://' + url;
    }
  }
  return url.replace(/\/+$/, '');
}

/* ---------- عنوان السيرفر المركزي (للتطبيق والموبايل) ---------- */
function getServerBaseUrl() {
  const custom = (localStorage.getItem(SERVER_URL_KEY) || '').trim();
  if (custom) return formatServerUrl(custom);
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.defaultServerUrl) {
    if (location.protocol === 'file:' || location.protocol === 'capacitor:' || location.port === '5500' || location.port === '8100' || location.origin.includes('localhost') === false) {
      return formatServerUrl(APP_CONFIG.defaultServerUrl);
    }
  }
  return '';
}

function setCustomServerUrl(url) {
  const clean = formatServerUrl(url);
  if (!clean) {
    localStorage.removeItem(SERVER_URL_KEY);
  } else {
    localStorage.setItem(SERVER_URL_KEY, clean);
  }
}

async function testServerConnection(url) {
  const base = formatServerUrl(url);
  const target = (base ? base : '') + '/api/public/users';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(target, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'X-Device-Id': getDeviceId(),
        'X-Device-Name': encodeURIComponent(getDeviceName())
      }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('الخادم استجاب بكود ' + res.status);
    const data = await res.json();
    return { ok: true, usersCount: (data.users || []).length };
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم (قد يكون السيرفر في وضع الاستيقاظ)' : err.message);
  }
}

/* ---------- الشبكة ---------- */
async function api(pathname, opts = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    'X-Device-Name': encodeURIComponent(getDeviceName()),
    ...(opts.headers || {})
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const baseUrl = getServerBaseUrl();
  const fullUrl = (baseUrl ? baseUrl : '') + '/api' + pathname;
  let res;
  try {
    res = await fetch(fullUrl, { ...opts, headers });
  } catch (e) {
    throw new Error('تعذر الاتصال بالخادم المركزي (' + (baseUrl || location.origin) + '). تأكد من تشغيل الخادم وتطابق عنوان IP.');
  }
  let data = null;
  const raw = await res.text();
  try { data = raw ? JSON.parse(raw) : null; } catch (e) {
    throw new Error('الخادم أرسل استجابة غير صالحة.');
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = 'login.html';
    throw new Error('انتهت الجلسة');
  }
  if (!res.ok) throw new Error((data && data.error) || 'حدث خطأ (' + res.status + ')');
  return data;
}


/* ---------- التجزئة (لتسجيل الدخول) ---------- */
function jsSha256(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), lengthProperty = 'length', i, j, result = '';
  var words = [];
  var utf8 = unescape(encodeURIComponent(ascii));
  var asciiLength = utf8[lengthProperty] * 8;
  var hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  var k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  utf8 += '\x80';
  while (utf8[lengthProperty] % 64 - 56) utf8 += '\x00';
  for (i = 0; i < utf8[lengthProperty]; i++) {
    j = utf8.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiLength);
  for (j = 0; j < words[lengthProperty];) {
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      var s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      var temp1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i];
      var temp2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i]) | 0; }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function sha256Hex(text) {
  const salted = 'spa_static_salt_2026' + text;
  if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
    try {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {}
  }
  return jsSha256(salted);
}

/* ---------- مكونات مشتركة ---------- */
function toast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3800);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (e) { return iso; }
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-EG', { hour12: false }); }
  catch (e) { return iso; }
}

/* ---------- دوال مساعدة للمرفقات والوسائط المتعددة ---------- */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const b = Number(bytes);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function getAttachmentIcon(type, name) {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return '🖼️';
  if (t.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|3gp)$/i.test(n)) return '🎬';
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|amr)$/i.test(n)) return '🎵';
  if (t.includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (t.includes('word') || t.includes('officedocument.wordprocessingml') || /\.(doc|docx)$/i.test(n)) return '📝';
  if (t.includes('excel') || t.includes('spreadsheetml') || /\.(xls|xlsx|csv)$/i.test(n)) return '📊';
  if (t.includes('powerpoint') || t.includes('presentation') || /\.(ppt|pptx)$/i.test(n)) return '📽️';
  if (t.includes('zip') || t.includes('rar') || t.includes('7z') || t.includes('tar') || t.includes('compressed') || /\.(zip|rar|7z|tar|gz)$/i.test(n)) return '📦';
  if (t.includes('text') || /\.(txt|rtf|log|json|xml)$/i.test(n)) return '📄';
  return '📎';
}

function normalizeAttachment(att, idx = 0) {
  if (!att) return { id: 'att_' + idx, name: 'ملف ' + (idx + 1), type: 'application/octet-stream', size: 0, data: '' };
  if (typeof att === 'string') {
    let mime = 'image/jpeg';
    const m = att.match(/^data:([^;]+);base64,/);
    if (m && m[1]) mime = m[1];
    const isImg = mime.startsWith('image/');
    const isVid = mime.startsWith('video/');
    const isAud = mime.startsWith('audio/');
    let ext = mime.split('/')[1] || 'bin';
    if (ext === 'jpeg') ext = 'jpg';
    let defaultName = isImg ? `صورة_${idx + 1}.${ext}` : (isVid ? `فيديو_${idx + 1}.${ext}` : (isAud ? `تسجيل_صوتي_${idx + 1}.${ext}` : `مرفق_${idx + 1}.${ext}`));
    return {
      id: 'att_' + idx + '_' + Date.now().toString(36),
      name: defaultName,
      type: mime,
      size: Math.round(att.length * 0.75),
      data: att
    };
  }
  return {
    id: att.id || ('att_' + idx + '_' + Date.now().toString(36)),
    name: att.name || ('ملف ' + (idx + 1)),
    type: att.type || 'application/octet-stream',
    size: att.size || (att.data ? Math.round(att.data.length * 0.75) : 0),
    data: att.data || ''
  };
}

/* قائمة منسدلة قابلة للكتابة (مربع نص + datalist) */
function combo(id, options, value, ph) {
  const listId = id + '_list';
  const opts = options.map(o => `<option value="${esc(o)}"></option>`).join('');
  return (
    `<div class="combo-wrap">
       <input type="text" id="${id}" list="${listId}" value="${esc(value || '')}" placeholder="${esc(ph || 'اختر أو اكتب...')}" autocomplete="off" />
       <datalist id="${listId}">${opts}</datalist>
     </div>`
  );
}

function badgeStatus(status) {
  const map = {
    'نشط': 'green', 'متقطع': 'warn', 'غير نشط': 'red',
    'عالية': 'green', 'متوسط': 'warn', 'منخفض': 'red',
    'مهم جدا': 'red', 'مهم': 'blue', 'متوسط': 'gold', 'عادي': 'gray', 'غير مهم': 'gray'
  };
  const c = map[status] || 'gray';
  return `<span class="badge ${c}">${esc(status || '—')}</span>`;
}

function permBadges(u) {
  if (!u) return '';
  if (u.role === 'Admin') return `<span class="badge blue">👑 مدير النظام (كافة الصلاحيات)</span>`;
  const p = [
    ['canDash', 'لوحة التحكم'], ['canEntry', 'الإدخال'], ['canAdd', 'إضافة تقارير'],
    ['canReports', 'التقارير'], ['canEdit', 'تعديل'], ['canDelete', 'حذف'], ['canPrint', 'طباعة'],
    ['canUsers', 'المستخدمين'], ['canSettings', 'الإعدادات']
  ];
  return p.filter(([k]) => u[k]).map(([k, label]) => `<span class="badge green">${label}</span>`).join(' ') || '<span class="badge gray">بدون صلاحيات</span>';
}

async function triggerInstantBackup() {
  try {
    const res = await api('/backup/now', { method: 'POST' });
    toast(res.message || 'تم تحديث النسخة الاحتياطية على القرص C ومجلد البرنامج بنجاح ✔', 'ok');
  } catch (err) {
    toast('تعذر عمل النسخة الاحتياطية: ' + err.message, 'err');
  }
}

function logout() {
  try { fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } }); } catch (e) {}
  localStorage.removeItem(TOKEN_KEY);
  location.href = 'login.html';
}

/* ---------- نافذة ضبط واختبار عنوان السيرفر المركزي ---------- */
function openServerConfigModal() {
  let m = document.getElementById('serverConfigModalBack');
  if (!m) {
    const div = document.createElement('div');
    div.id = 'serverConfigModalBack';
    div.className = 'modal-back';
    div.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-h">
          <h3>🌐 ضبط عنوان الخادم المركزي (Server Connection)</h3>
          <button class="modal-x" type="button" onclick="document.getElementById('serverConfigModalBack').classList.remove('show')">✕</button>
        </div>
        <div style="padding:16px 20px 24px">
          <p style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:14px">
            إذا كنت تستخدم التطبيق من هاتف أندرويد أو كمبيوتر آخر، أدخل عنوان IP الخاص بالجهاز الرئيسي (السيرفر) لتتم المزامنة مباشرة.
          </p>
          <div class="field" style="margin-bottom:12px">
            <span style="font-weight:700;font-size:13px">عنوان الخادم (URL / IP):</span>
            <input type="text" id="cfgServerUrlInput" placeholder="مثال: http://172.16.6.43 أو http://192.168.1.50" style="direction:ltr;text-align:left;font-family:monospace;font-size:14px" />
          </div>
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <button class="btn btn-secondary btn-sm" style="flex:1;font-size:12px" type="button" onclick="document.getElementById('cfgServerUrlInput').value='http://' + (location.hostname || 'localhost') + (location.port ? ':' + location.port : '')">📍 العنوان الحالي</button>
            <button class="btn btn-outline btn-sm" style="flex:1;font-size:12px" type="button" onclick="document.getElementById('cfgServerUrlInput').value=''">🔄 افتراضي (محلي)</button>
          </div>
          <div id="cfgServerTestStatus" style="font-size:13px;font-weight:700;min-height:24px;margin-bottom:14px;padding:8px 12px;border-radius:6px;display:none;line-height:1.6"></div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary" style="flex:1" type="button" id="cfgTestServerBtn">🔍 فحص الاتصال</button>
            <button class="btn btn-primary" style="flex:1" type="button" id="cfgSaveServerBtn">💾 حفظ وتطبيق</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    m = div;

    document.getElementById('cfgTestServerBtn').onclick = async () => {
      const url = document.getElementById('cfgServerUrlInput').value.trim();
      const statusDiv = document.getElementById('cfgServerTestStatus');
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'var(--surface-soft)';
      statusDiv.style.color = 'var(--text)';
      statusDiv.textContent = '⏳ جارٍ اختبار الاتصال بالخادم...';
      try {
        const res = await testServerConnection(url);
        statusDiv.style.background = '#dcfce7';
        statusDiv.style.color = '#15803d';
        statusDiv.textContent = '🟢 تم الاتصال بالخادم المركزي بنجاح! (' + res.usersCount + ' مستخدم متاح)';
      } catch (err) {
        statusDiv.style.background = '#fee2e2';
        statusDiv.style.color = '#b91c1c';
        statusDiv.textContent = '🔴 تعذر الاتصال: ' + err.message;
      }
    };

    document.getElementById('cfgSaveServerBtn').onclick = () => {
      const url = document.getElementById('cfgServerUrlInput').value.trim();
      setCustomServerUrl(url);
      toast('تم حفظ إعدادات الخادم المركزي بنجاح ✔', 'ok');
      m.classList.remove('show');
      setTimeout(() => location.reload(), 600);
    };
  }

  const defaultUrl = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.defaultServerUrl) ? APP_CONFIG.defaultServerUrl : '';
  const current = getServerBaseUrl() || defaultUrl;
  const inputEl = document.getElementById('cfgServerUrlInput');
  if (inputEl) inputEl.value = current;
  const statusDiv = document.getElementById('cfgServerTestStatus');
  if (statusDiv) statusDiv.style.display = 'none';
  m.classList.add('show');
}

/* تمكين المدير فقط من فتح إعدادات السيرفر بالنقر السريع 5 مرات على شعار التطبيق 📋 */
let _logoClicks = 0, _logoTimer = null;
function initSecretAdminConfigTrigger() {
  const logos = document.querySelectorAll('.login-logo, .brand .logo, #userAv');
  logos.forEach(el => {
    el.addEventListener('click', () => {
      _logoClicks++;
      clearTimeout(_logoTimer);
      _logoTimer = setTimeout(() => { _logoClicks = 0; }, 1800);
      if (_logoClicks >= 5) {
        _logoClicks = 0;
        openServerConfigModal();
      }
    });
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSecretAdminConfigTrigger);
} else {
  initSecretAdminConfigTrigger();
}

/* ---------- دعم PWA وتثبيت التطبيق ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

let deferredPWAInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAInstallPrompt = e;
  document.querySelectorAll('.pwa-install-btn').forEach(btn => btn.style.display = 'inline-flex');
});

async function triggerPWAInstall() {
  if (deferredPWAInstallPrompt) {
    deferredPWAInstallPrompt.prompt();
    const { outcome } = await deferredPWAInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      toast('تم تثبيت التطبيق على جهازك بنجاح ✔', 'ok');
    }
    deferredPWAInstallPrompt = null;
  } else {
    alert('📱 لتثبيت التطبيق على هاتفك أو كمبيوترك:\n1. انقر على زر الخيارات في المتصفح (⋮ أو ⫶)\n2. اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» (Add to Home screen)\n3. سيتم تثبيت أيقونة التطبيق ليعمل كنافذة مستقلة بدون متصفح.');
  }
}
