#!/usr/bin/env node
'use strict';
/* =========================================================
   نظام إدارة التقارير — الخادم المحلي
   - بدون أي تبعيات خارجية (يعتمد على node:sqlite المدمج، Node 22+)
   - التشغيل: node server.js  ثم افتح http://localhost:8765/
   - الأجهزة الأخرى على نفس الشبكة تتصل عبر http://<IP>:8765/
   ========================================================= */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'system.db');
// المنفذ الأساسي هو 80 حتى يعمل النظام بدون كتابة رقم منفذ في المتصفح.
// يمكن تغييره فقط عند الحاجة عبر PORT=8765 node server.js.
const PORT = parseInt(process.env.PORT || '80', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SALT = 'spa_static_salt_2026';
const SESSION_TTL = 48 * 3600 * 1000;
const MAX_BODY = 60 * 1024 * 1024;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------- قاعدة البيانات ------------------------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, userName TEXT UNIQUE NOT NULL, fullName TEXT NOT NULL,
  passwordHash TEXT NOT NULL, role TEXT NOT NULL, isActive INTEGER DEFAULT 1,
  canOpen INTEGER DEFAULT 0, canAdd INTEGER DEFAULT 0, canDelete INTEGER DEFAULT 0,
  canEdit INTEGER DEFAULT 0, canPrint INTEGER DEFAULT 0, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reportNumber TEXT NOT NULL, subject TEXT NOT NULL, target TEXT,
  reportDate TEXT, reportTime TEXT, location TEXT, details TEXT, images TEXT DEFAULT '[]',
  enteredBy TEXT, enteredByUserId TEXT, rating TEXT, createdAt TEXT NOT NULL,
  updatedAt TEXT, syncedAt TEXT);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, deviceId TEXT UNIQUE NOT NULL, deviceName TEXT,
  userId TEXT, userName TEXT, userFullName TEXT, status TEXT DEFAULT 'pending',
  registeredAt TEXT NOT NULL, approvedAt TEXT, lastSeenAt TEXT, approvedBy TEXT);
`);

// إضافة أعمدة الصلاحيات المخصصة تلقائياً لقاعدة البيانات عند الحاجة
['canDash', 'canEntry', 'canReports', 'canReportsEdit', 'canReportsDelete', 'canReportsPrint', 'canUsers', 'canSettings'].forEach(col => {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 0;`); } catch(e){}
});
try { db.exec('ALTER TABLE reports ADD COLUMN logoId TEXT DEFAULT "logo1";'); } catch(e){}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// المسار الإضافي على القرص C
const EXTERNAL_BACKUP_DIR = process.platform === 'win32' ? 'C:\\ReportsSystem_Backups' : path.join(os.homedir(), 'ReportsSystem_Backups');
try {
  if (!fs.existsSync(EXTERNAL_BACKUP_DIR)) fs.mkdirSync(EXTERNAL_BACKUP_DIR, { recursive: true });
} catch(e){}

function createAutoBackup(){
  const users = db.prepare('SELECT * FROM users').all();
  const reports = db.prepare('SELECT * FROM reports').all();
  const settings = db.prepare('SELECT * FROM settings').all();
  const dump = { version: '2026-v2', exportedAt: nowIso(), users, reports, settings };
  const jsonContent = JSON.stringify(dump, null, 2);
  const locations = [];

  // 1. التحديث على نفس ملف النسخة الثابت داخل مجلد البرنامج (قاعدة بيانات + ملف JSON)
  try {
    const localJson = path.join(BACKUP_DIR, 'system_backup.json');
    const localDb = path.join(BACKUP_DIR, 'system_backup.db');
    fs.writeFileSync(localJson, jsonContent, 'utf8');
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, localDb);
    locations.push(localDb);
  } catch(err) {
    console.warn('تنبيه النسخ المحلي:', err.message);
  }

  // 2. التحديث على نفس الملف في المسار الخارجي الإضافي على القرص C
  try {
    if (!fs.existsSync(EXTERNAL_BACKUP_DIR)) fs.mkdirSync(EXTERNAL_BACKUP_DIR, { recursive: true });
    const extJson = path.join(EXTERNAL_BACKUP_DIR, 'system_backup.json');
    const extDb = path.join(EXTERNAL_BACKUP_DIR, 'system_backup.db');
    fs.writeFileSync(extJson, jsonContent, 'utf8');
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, extDb);
    locations.push(extDb);
  } catch(err) {
    console.warn('تنبيه النسخ الخارجي:', err.message);
  }

  return { ok: true, locations, time: nowIso() };
}

/* ------------------------- أدوات مساعدة ------------------------- */
function hashHex(text){ return crypto.createHash('sha256').update(SALT + text).digest('hex'); }
function uid(){ return crypto.randomUUID(); }
function nowIso(){ return new Date().toISOString(); }
function todayStr(){ return nowIso().slice(0,10); }
function lanIP(){
  try{
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets))
      for (const n of (nets[name]||[]))
        if (n.family === 'IPv4' && !n.internal) return n.address;
  }catch(e){}
  return '127.0.0.1';
}
function getSetting(k, def){ const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : def; }
function setSetting(k, v){ db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); }
function publicUser(u){
  const isAdminUser = u.role === 'Admin';
  return {
    id: u.id, userName: u.userName, fullName: u.fullName, role: u.role,
    isActive: !!u.isActive,
    canOpen: isAdminUser || !!u.canOpen || !!u.canReports || !!u.canEntry,
    canAdd: isAdminUser || !!u.canAdd,
    canDelete: isAdminUser || !!u.canDelete || !!u.canReportsDelete,
    canEdit: isAdminUser || !!u.canEdit || !!u.canReportsEdit,
    canPrint: isAdminUser || !!u.canPrint || !!u.canReportsPrint,
    canDash: isAdminUser || !!u.canDash,
    canEntry: isAdminUser || !!u.canEntry,
    canReports: isAdminUser || !!u.canReports,
    canReportsEdit: isAdminUser || !!u.canReportsEdit || !!u.canEdit,
    canReportsDelete: isAdminUser || !!u.canReportsDelete || !!u.canDelete,
    canReportsPrint: isAdminUser || !!u.canReportsPrint || !!u.canPrint,
    canUsers: isAdminUser || !!u.canUsers,
    canSettings: isAdminUser || !!u.canSettings,
    createdAt: u.createdAt
  };
}
function publicUserLite(u){ return { id: u.id, userName: u.userName, fullName: u.fullName, role: u.role }; }
function parseReportRow(r){
  let images = [];
  try{ images = JSON.parse(r.images || '[]'); }catch(e){ images = []; }
  return { ...r, images, imageCount: images.length };
}

/* ------------------------- التحقق من اعتماد الأجهزة ------------------------- */
function checkDeviceAuth(user, req) {
  if (!user || user.role === 'Admin') return { ok: true };
  const enforce = getSetting('enforceDeviceAuth', '1') === '1';
  if (!enforce) return { ok: true };

  const deviceId = (req.headers['x-device-id'] || '').trim();
  let deviceName = '';
  try { deviceName = decodeURIComponent(req.headers['x-device-name'] || ''); } catch(e){ deviceName = req.headers['x-device-name'] || ''; }
  if (!deviceName) deviceName = 'هاتف (' + (req.headers['user-agent'] || 'ميداني').slice(0, 35) + ')';

  if (!deviceId) {
    return { ok: false, code: 'DEVICE_MISSING', message: 'لم يتم إرسال معرّف الجهاز (Device ID). يرجى فتح التطبيق الرسمي.' };
  }

  const dev = db.prepare('SELECT * FROM devices WHERE deviceId=?').get(deviceId);
  if (!dev) {
    const id = uid();
    const t = nowIso();
    db.prepare('INSERT INTO devices(id, deviceId, deviceName, userId, userName, userFullName, status, registeredAt, lastSeenAt) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, deviceId, deviceName, user.id, user.userName, user.fullName, 'pending', t, t);
    return { ok: false, code: 'DEVICE_PENDING', message: '📱 هذا الهاتف جديد وقيد المراجعة بانتظار اعتماد مدير النظام. يرجى إبلاغ المدير لتفعيل هاتفك من لوحة التحكم.' };
  }

  // تحديث وقت آخر ظهور والبيانات
  db.prepare('UPDATE devices SET lastSeenAt=?, userId=?, userName=?, userFullName=?, deviceName=? WHERE id=?')
    .run(nowIso(), user.id, user.userName, user.fullName, deviceName, dev.id);

  if (dev.status === 'blocked') {
    return { ok: false, code: 'DEVICE_BLOCKED', message: '🚫 تم حظر هذا الهاتف من الاتصال بالنظام من قِبل مدير النظام.' };
  }

  if (dev.status === 'pending') {
    return { ok: false, code: 'DEVICE_PENDING', message: '📱 هذا الهاتف قيد المراجعة وبانتظار اعتماد مدير النظام. يرجى إبلاغ المدير لتفعيل هاتفك من لوحة التحكم.' };
  }

  return { ok: true, device: dev };
}
function buildMe(user){
  const entryUsers = db.prepare("SELECT * FROM users WHERE role='EntryUser' ORDER BY fullName").all()
    .map(publicUserLite);
  let headerConfig = null;
  try {
    const raw = getSetting('reportHeaderConfig', '');
    if (raw) headerConfig = JSON.parse(raw);
  } catch(e){}
  return {
    user: publicUser(user),
    users: entryUsers,
    settings: {
      consumeAddAfterSync: getSetting('consumeAddAfterSync', '0') === '1',
      reportHeaderConfig: headerConfig,
      lanIP: lanIP(),
      port: PORT,
      baseUrl: 'http://' + lanIP() + ':' + PORT + '/'
    }
  };
}

/* ------------------------- الجلسات ------------------------- */
const sessions = new Map(); // token -> {userId, expires}
function createSession(userId){
  const token = crypto.randomUUID();
  sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
  return token;
}
function cleanupSessions(){
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}
function auth(req){
  cleanupSessions();
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = tok && sessions.get(tok);
  if (!s) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(s.userId) || null;
}
function isAdmin(u){ return u && u.role === 'Admin'; }
function can(u, p){ return isAdmin(u) || (u && !!u[p]); }

/* ------------------------- أدوات HTTP ------------------------- */
function send(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(body);
}
function sendError(res, code, msg){ send(res, code, { error: msg }); }
function readBody(req, limit){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limit || MAX_BODY)){ reject(new Error('حجم الطلب كبير جداً')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try{ resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch(e){ reject(new Error('بيانات JSON غير صالحة')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp',
  '.txt':'text/plain; charset=utf-8', '.md':'text/markdown; charset=utf-8'
};
function serveStatic(req, res, pathname){
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)){ sendError(res, 403, 'ممنوع'); return; }
  fs.readFile(full, (err, data) => {
    if (err){ sendError(res, 404, 'الملف غير موجود'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}

/* ------------------------- بذر البيانات التجريبية ------------------------- */
function seed(){
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  const t = nowIso();
  const adminId = uid();
  db.prepare('INSERT INTO users(id,userName,fullName,passwordHash,role,isActive,canOpen,canAdd,canDelete,canEdit,canPrint,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(adminId, 'admin', 'مدير النظام', hashHex('Admin@123'), 'Admin', 1, 1, 1, 1, 1, 1, t);
  const mkUser = (userName, fullName, pw, o) => {
    const id = uid();
    db.prepare('INSERT INTO users(id,userName,fullName,passwordHash,role,isActive,canOpen,canAdd,canDelete,canEdit,canPrint,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userName, fullName, hashHex(pw), 'EntryUser', o.active?1:0, o.canOpen?1:0, o.canAdd?1:0, o.canDelete?1:0, o.canEdit?1:0, o.canPrint?1:0, t);
    return id;
  };
  const ahmed = mkUser('ahmed', 'أحمد محمد', '123456', { active:1, canOpen:1, canAdd:1, canDelete:0, canEdit:0, canPrint:1 });
  const sara  = mkUser('sara',  'سارة علي',   '123456', { active:1, canOpen:1, canAdd:1, canDelete:0, canEdit:1, canPrint:1 });
  const khaled= mkUser('khaled','خالد حسن',   '123456', { active:1, canOpen:0, canAdd:0, canDelete:0, canEdit:0, canPrint:0 });
  setSetting('consumeAddAfterSync', '0');
  const demoReports = [
    { n:'2026-001', s:'حادث مروري على الطريق الدائري',  target:'شرطة المرور — القسم الرابع', d:'2026-08-20', tm:'09:30', loc:'الطريق الدائري، التقاطع الثالث', det:'ورد بلاغ عن حادث تصادم بين سيارتين... تم الانتقال للموقع وتوثيق الحالة وتحرير محضر.', by:'أحمد محمد', uid:ahmed, rate:'مهم' },
    { n:'2026-002', s:'شكوى سكان بخصوص انقطاع المياه',   target:'بلدية المنطقة الغربية', d:'2026-08-22', tm:'11:15', loc:'حي النور — المنطقة الغربية', det:'تقدم عدد من السكان بشكوى حول انقطاع المياه منذ ثلاثة أيام، تم رفع البلاغ وزيارة الموقع وتصوير الخزانات.', by:'سارة علي', uid:sara, rate:'مهم جدا' },
    { n:'2026-003', s:'متابعة أعمال صيانة الإنارة',       target:'إدارة الخدمات الفنية', d:'2026-08-24', tm:'14:00', loc:'شارع الاستقلال', det:'متابعة سير أعمال صيانة أعمدة الإنارة المبلغ عنها، الأعمال جارية بنسبة 60%.', by:'أحمد محمد', uid:ahmed, rate:'متوسط' },
    { n:'2026-004', s:'اجتماع تنسيقي مع الجهات المعنية',  target:'مجلس التنسيق المحلي', d:'2026-08-27', tm:'10:00', loc:'قاعة الاجتماعات الرئيسية', det:'عُقد اجتماع لمناقشة خطة العمل الربعية، تم الاتفاق على مواعيد التسليم والمسؤوليات.', by:'سارة علي', uid:sara, rate:'مهم' },
    { n:'2026-005', s:'بلاغ عن أعطال في إشارات المرور',   target:'إدارة المرور العامة', d:'2026-08-30', tm:'13:45', loc:'تقاطع الجامعة', det:'تبين وجود خلل في الإشارة الضوئية الرئيسية، تم إبلاغ الدورية المختصة ووضع تحويلة مؤقتة.', by:'خالد حسن', uid:khaled, rate:'عادي' },
    { n:'2026-006', s:'جولة ميدانية لمتابعة المشاريع',    target:'إدارة المشاريع', d:'2026-09-01', tm:'08:30', loc:'الموقع الجنوبي للمشروع', det:'جولة ميدانية للاطلاع على سير التنفيذ، نسبة الإنجاز 85% مع ملاحظة بطء في استلام المواد.', by:'أحمد محمد', uid:ahmed, rate:'' }
  ];
  const insR = db.prepare('INSERT INTO reports(id,reportNumber,subject,target,reportDate,reportTime,location,details,images,enteredBy,enteredByUserId,rating,createdAt,updatedAt,syncedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  demoReports.forEach(r => {
    insR.run(uid(), r.n, r.s, r.target, r.d, r.tm, r.loc, r.det, '[]', r.by, r.uid, r.rate || null, t + 'Z', t + 'Z', t + 'Z');
  });
  console.log('✔ تم بذر البيانات الأولية بنجاح');
}

seed();
// ترحيل قواعد البيانات القديمة إلى سلوك إدخال التقارير المتعددة مرة واحدة.
// يبقى خيار المدير قابلاً للتغيير لاحقاً من الإعدادات.
if (getSetting('multiReportMigration2026', '0') !== '1') {
  setSetting('consumeAddAfterSync', '0');
  setSetting('multiReportMigration2026', '1');
}

/* ------------------------- منطق الأعمال ------------------------- */
function listReports(query){
  let sql = 'SELECT * FROM reports WHERE 1=1'; const p = [];
  if (query.q){
    sql += ' AND (reportNumber LIKE ? OR subject LIKE ? OR target LIKE ? OR details LIKE ? OR enteredBy LIKE ?)';
    const like = '%' + query.q + '%'; p.push(like, like, like, like, like);
  }
  if (query.from){ sql += ' AND reportDate >= ?'; p.push(query.from); }
  if (query.to){ sql += ' AND reportDate <= ?'; p.push(query.to); }
  if (query.userId){ sql += ' AND enteredByUserId = ?'; p.push(query.userId); }
  if (query.rating){ sql += ' AND rating = ?'; p.push(query.rating); }
  sql += ' ORDER BY reportDate DESC, createdAt DESC';
  return db.prepare(sql).all(...p).map(r => {
    const full = parseReportRow(r);
    const { images, ...rest } = full;
    return { ...rest, imageCount: images.length };
  });
}
function getNextReportNumber(){
  const allReports = db.prepare('SELECT reportNumber FROM reports').all();
  let maxSeq = 0;
  for (const rep of allReports){
    const str = String(rep.reportNumber || '').trim();
    const dashMatch = str.match(/^\d{4}-(\d+)$/);
    if (dashMatch){
      const n = parseInt(dashMatch[1], 10);
      if (!isNaN(n) && n < 100000 && n > maxSeq) maxSeq = n;
    } else {
      const pureNum = str.match(/^(\d+)$/);
      if (pureNum){
        const n = parseInt(pureNum[1], 10);
        if (!isNaN(n) && n < 100000 && n > maxSeq) maxSeq = n;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  const year = new Date().getFullYear();
  return `${year}-${String(nextSeq).padStart(3, '0')}`;
}

function buildStats(){
  const usersTotal = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const usersActive = db.prepare('SELECT COUNT(*) c FROM users WHERE isActive=1').get().c;
  const reportsTotal = db.prepare('SELECT COUNT(*) c FROM reports').get().c;
  const reportsToday = db.prepare('SELECT COUNT(*) c FROM reports WHERE reportDate=?').get(todayStr()).c;
  const byRating = db.prepare('SELECT rating, COUNT(*) c FROM reports GROUP BY rating').all();
  const ratingLabels = ['مهم جدا','مهم','متوسط','عادي','غير مهم'];
  const reportsByRating = ratingLabels.map(l => ({ k: l, v: 0 })).concat([{ k: 'بدون تصنيف', v: 0 }]);
  byRating.forEach(r => {
    const row = reportsByRating.find(x => x.k === r.rating);
    if (row) row.v = r.c; else reportsByRating[reportsByRating.length-1].v += r.c;
  });
  const perUser = db.prepare('SELECT enteredBy k, COUNT(*) v FROM reports GROUP BY enteredBy ORDER BY v DESC').all().slice(0,8);
  const recentReports = listReports({}).slice(0, 8).map(r => parseReportRow(r));
  let devicesPending = 0, devicesApproved = 0, devicesTotal = 0;
  try {
    devicesPending = db.prepare("SELECT COUNT(*) c FROM devices WHERE status='pending'").get().c;
    devicesApproved = db.prepare("SELECT COUNT(*) c FROM devices WHERE status='approved'").get().c;
    devicesTotal = db.prepare("SELECT COUNT(*) c FROM devices").get().c;
  } catch(e){}
  return {
    usersTotal, usersActive, reportsTotal, reportsToday,
    reportsByRating, reportsPerUser: perUser,
    recentReports,
    devicesPending, devicesApproved, devicesTotal
  };
}

/* ------------------------- الخادم ------------------------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const method = req.method;

  /* ملفات ثابتة */
  if (!p.startsWith('/api')){ serveStatic(req, res, p); return; }

  try{
    /* فحص حالة اعتماد الهاتف */
    if (method === 'GET' && p === '/api/public/device-status'){
      const devId = (req.headers['x-device-id'] || u.searchParams.get('deviceId') || '').trim();
      if (!devId) { send(res, 200, { registered: false, status: 'none' }); return; }
      const dev = db.prepare('SELECT id, deviceId, deviceName, status, registeredAt, approvedAt, userName, userFullName FROM devices WHERE deviceId=?').get(devId);
      if (!dev) {
        send(res, 200, { registered: false, status: 'none' });
      } else {
        send(res, 200, { registered: true, status: dev.status, dev });
      }
      return;
    }

    /* قائمة المستخدمين العامة لتسهيل اختيار اسم المستخدم في شاشة الدخول */
    if (method === 'GET' && p === '/api/public/users'){
      const list = db.prepare('SELECT id, userName, fullName, role FROM users WHERE isActive=1 ORDER BY role DESC, fullName ASC').all();
      send(res, 200, { users: list });
      return;
    }

    /* تسجيل الدخول */
    if (method === 'POST' && p === '/api/login'){
      const b = await readBody(req);
      const userName = String(b.userName||'').trim();
      const user = db.prepare('SELECT * FROM users WHERE userName=?').get(userName);
      let hashToCompare = b.passwordHash;
      if (!hashToCompare && b.password) {
        hashToCompare = hashHex(b.password);
      }
      if (!user || !user.isActive || !hashToCompare || hashToCompare !== user.passwordHash){
        sendError(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة'); return;
      }
      const devAuth = checkDeviceAuth(user, req);
      if (!devAuth.ok) {
        send(res, 403, { error: devAuth.message, code: devAuth.code, deviceId: req.headers['x-device-id'] });
        return;
      }
      const token = createSession(user.id);
      send(res, 200, { token, ...buildMe(user) });
      return;
    }
    if (method === 'POST' && p === '/api/logout'){
      const h = req.headers.authorization || '';
      const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
      if (tok) sessions.delete(tok);
      try { createAutoBackup(); } catch(e){}
      send(res, 200, { ok: true, message: 'تم الخروج بنجاح وتفعيل النسخ الاحتياطي التلقائي' }); return;
    }

    const me = auth(req);
    if (!me){ sendError(res, 401, 'انتهت الجلسة، يرجى تسجيل الدخول'); return; }

    if (method === 'GET' && p === '/api/me'){
      send(res, 200, buildMe(me)); return;
    }

    /* ---- الإحصائيات (لوحة التحكم) ---- */
    if (method === 'GET' && p === '/api/stats'){
      if (!can(me, 'canDash')){ sendError(res, 403, 'غير مصرح'); return; }
      send(res, 200, buildStats()); return;
    }

    /* ---- المستخدمون والصلاحيات ---- */
    if (p === '/api/users'){
      if (!isAdmin(me) && !can(me, 'canUsers')){ sendError(res, 403, 'غير مصرح'); return; }
      if (method === 'GET'){
        const list = db.prepare('SELECT * FROM users ORDER BY role DESC, fullName').all().map(publicUser);
        send(res, 200, { users: list }); return;
      }
      if (method === 'POST'){
        const b = await readBody(req);
        const userName = String(b.userName||'').trim();
        const fullName = String(b.fullName||'').trim();
        if (!userName || !fullName) { sendError(res, 400, 'اسم المستخدم والاسم الكامل مطلوبان'); return; }
        if (!b.passwordHash) { sendError(res, 400, 'كلمة المرور مطلوبة'); return; }
        if (db.prepare('SELECT id FROM users WHERE userName=?').get(userName)){ sendError(res, 409, 'اسم المستخدم موجود مسبقاً'); return; }
        const id = uid();
        db.prepare(`INSERT INTO users(
          id,userName,fullName,passwordHash,role,isActive,
          canOpen,canAdd,canDelete,canEdit,canPrint,
          canDash,canEntry,canReports,canReportsEdit,canReportsDelete,canReportsPrint,
          canEvals,canEvalsAdd,canEvalsDelete,canUsers,canSettings,createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, userName, fullName, b.passwordHash, 'EntryUser', b.isActive?1:0,
            b.canOpen?1:0, b.canAdd?1:0, b.canDelete?1:0, b.canEdit?1:0, b.canPrint?1:0,
            b.canDash?1:0, b.canEntry?1:0, b.canReports?1:0, b.canReportsEdit?1:0, b.canReportsDelete?1:0, b.canReportsPrint?1:0,
            b.canEvals?1:0, b.canEvalsAdd?1:0, b.canEvalsDelete?1:0, b.canUsers?1:0, b.canSettings?1:0, nowIso());
        send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) }); return;
      }
    }
    const um = p.match(/^\/api\/users\/([^/]+)$/);
    if (um){
      if (!isAdmin(me) && !can(me, 'canUsers')){ sendError(res, 403, 'غير مصرح'); return; }
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(um[1]);
      if (!user){ sendError(res, 404, 'المستخدم غير موجود'); return; }
      if (method === 'PUT'){
        const b = await readBody(req);
        if (user.role === 'Admin' && Object.prototype.hasOwnProperty.call(b, 'isActive') && (!b.isActive || b.isActive === 0) && db.prepare("SELECT COUNT(*) c FROM users WHERE role='Admin' AND isActive=1").get().c <= 1){
          sendError(res, 400, 'لا يمكن تعطيل المدير الوحيد'); return;
        }
        db.prepare(`UPDATE users SET
          fullName=?, isActive=?, canOpen=?, canAdd=?, canDelete=?, canEdit=?, canPrint=?,
          canDash=?, canEntry=?, canReports=?, canReportsEdit=?, canReportsDelete=?, canReportsPrint=?,
          canEvals=?, canEvalsAdd=?, canEvalsDelete=?, canUsers=?, canSettings=?
          WHERE id=?`)
          .run(String(b.fullName ?? user.fullName),
            Object.prototype.hasOwnProperty.call(b, 'isActive') ? (b.isActive ? 1 : 0) : user.isActive,
            Object.prototype.hasOwnProperty.call(b, 'canOpen') ? (b.canOpen ? 1 : 0) : user.canOpen,
            Object.prototype.hasOwnProperty.call(b, 'canAdd') ? (b.canAdd ? 1 : 0) : user.canAdd,
            Object.prototype.hasOwnProperty.call(b, 'canDelete') ? (b.canDelete ? 1 : 0) : user.canDelete,
            Object.prototype.hasOwnProperty.call(b, 'canEdit') ? (b.canEdit ? 1 : 0) : user.canEdit,
            Object.prototype.hasOwnProperty.call(b, 'canPrint') ? (b.canPrint ? 1 : 0) : user.canPrint,
            Object.prototype.hasOwnProperty.call(b, 'canDash') ? (b.canDash ? 1 : 0) : (user.canDash ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canEntry') ? (b.canEntry ? 1 : 0) : (user.canEntry ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canReports') ? (b.canReports ? 1 : 0) : (user.canReports ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canReportsEdit') ? (b.canReportsEdit ? 1 : 0) : (user.canReportsEdit ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canReportsDelete') ? (b.canReportsDelete ? 1 : 0) : (user.canReportsDelete ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canReportsPrint') ? (b.canReportsPrint ? 1 : 0) : (user.canReportsPrint ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canEvals') ? (b.canEvals ? 1 : 0) : (user.canEvals ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canEvalsAdd') ? (b.canEvalsAdd ? 1 : 0) : (user.canEvalsAdd ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canEvalsDelete') ? (b.canEvalsDelete ? 1 : 0) : (user.canEvalsDelete ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canUsers') ? (b.canUsers ? 1 : 0) : (user.canUsers ?? 0),
            Object.prototype.hasOwnProperty.call(b, 'canSettings') ? (b.canSettings ? 1 : 0) : (user.canSettings ?? 0),
            user.id);
        if (b.userName) {
          const newUserName = String(b.userName).trim();
          if (newUserName && newUserName !== user.userName) {
            const exists = db.prepare('SELECT id FROM users WHERE userName=? AND id<>?').get(newUserName, user.id);
            if (exists) { sendError(res, 409, 'اسم المستخدم موجود مسبقاً'); return; }
            db.prepare('UPDATE users SET userName=? WHERE id=?').run(newUserName, user.id);
          }
        }
        if (b.passwordHash) db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(b.passwordHash, user.id);
        send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) }); return;
      }
      if (method === 'DELETE'){
        if (user.role === 'Admin'){ sendError(res, 400, 'لا يمكن حذف حساب مدير النظام'); return; }
        if (user.id === me.id){ sendError(res, 400, 'لا يمكنك حذف حسابك'); return; }
        db.prepare('DELETE FROM users WHERE id=?').run(user.id);
        send(res, 200, { ok: true }); return;
      }
    }

    /* ---- إدارة الأجهزة والهواتف المعتمدة ---- */
    if (p === '/api/devices'){
      if (!isAdmin(me) && !can(me, 'canUsers')){ sendError(res, 403, 'غير مصرح'); return; }
      if (method === 'GET'){
        const list = db.prepare("SELECT * FROM devices ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, registeredAt DESC").all();
        send(res, 200, { devices: list }); return;
      }
    }
    const devMatch = p.match(/^\/api\/devices\/([^/]+)\/(approve|block)$/);
    if (devMatch && method === 'POST'){
      if (!isAdmin(me) && !can(me, 'canUsers')){ sendError(res, 403, 'غير مصرح'); return; }
      const devId = devMatch[1];
      const action = devMatch[2];
      const dev = db.prepare('SELECT * FROM devices WHERE id=?').get(devId);
      if (!dev){ sendError(res, 404, 'الجهاز غير موجود'); return; }
      if (action === 'approve'){
        db.prepare("UPDATE devices SET status='approved', approvedAt=?, approvedBy=? WHERE id=?").run(nowIso(), me.fullName, dev.id);
        send(res, 200, { ok: true, message: `تم اعتماد وتفعيل هاتف (${dev.userFullName || dev.userName || dev.deviceId}) بنجاح ✔` }); return;
      } else if (action === 'block'){
        db.prepare("UPDATE devices SET status='blocked' WHERE id=?").run(dev.id);
        send(res, 200, { ok: true, message: `تم حظر هاتف (${dev.userFullName || dev.userName || dev.deviceId}) 🚫` }); return;
      }
    }
    const devDelMatch = p.match(/^\/api\/devices\/([^/]+)$/);
    if (devDelMatch && method === 'DELETE'){
      if (!isAdmin(me) && !can(me, 'canUsers')){ sendError(res, 403, 'غير مصرح'); return; }
      db.prepare('DELETE FROM devices WHERE id=?').run(devDelMatch[1]);
      send(res, 200, { ok: true, message: 'تم حذف الجهاز من السجل بنجاح' }); return;
    }

    /* ---- التقارير ---- */
    if (p === '/api/reports/mine' && method === 'GET'){
      if (!can(me, 'canOpen')){ sendError(res, 403, 'غير مصرح: ليس لديك صلاحية فتح التقارير'); return; }
      const rows = db.prepare('SELECT * FROM reports WHERE enteredByUserId=? ORDER BY createdAt DESC').all(me.id)
        .map(parseReportRow).map(r => { const { images, ...rest } = r; return { ...rest, imageCount: images.length }; });
      send(res, 200, { reports: rows }); return;
    }
    if (p === '/api/reports/mine/count' && method === 'GET'){
      const c = db.prepare('SELECT COUNT(*) c FROM reports WHERE enteredByUserId=?').get(me.id).c;
      send(res, 200, { count: c }); return;
    }
    if (p === '/api/reports' && method === 'GET'){
      if (!can(me, 'canOpen')){ sendError(res, 403, 'غير مصرح: ليس لديك صلاحية فتح التقارير'); return; }
      const q = Object.fromEntries(u.searchParams);
      send(res, 200, { reports: listReports(q) }); return;
    }
    if (p === '/api/reports' && method === 'POST'){
      if (!can(me, 'canAdd')){ sendError(res, 403, 'لم يمنحك المدير صلاحية الإضافة حالياً'); return; }
      const devAuth = checkDeviceAuth(me, req);
      if (!devAuth.ok) {
        send(res, 403, { error: devAuth.message, code: devAuth.code, deviceId: req.headers['x-device-id'] });
        return;
      }
      const b = await readBody(req);
      const r = b.report || {};
      let reportNumber = String(r.reportNumber || '').trim();
      const subject = String(r.subject || '').trim();
      if (!subject){ sendError(res, 400, 'موضوع التقرير مطلوب'); return; }

      // إذا كان رقم التقرير مسودة أو مؤقتاً أو مكرراً أو فارغاً، يُولَّد تلقائياً الرقم التسلسلي التالي لمنع أي تعارض
      const isTemp = !reportNumber || reportNumber.includes('مسودة') || reportNumber.includes('DRAFT') || reportNumber.includes('مؤقت');
      const exists = reportNumber ? db.prepare('SELECT id FROM reports WHERE reportNumber=?').get(reportNumber) : null;
      if (isTemp || exists){
        reportNumber = getNextReportNumber();
      }

      const id = uid(); const t = nowIso();
      const images = Array.isArray(r.images) ? r.images : [];
      db.prepare('INSERT INTO reports(id,reportNumber,subject,target,logoId,reportDate,reportTime,location,details,images,enteredBy,enteredByUserId,rating,createdAt,updatedAt,syncedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, reportNumber, subject, String(r.target||''), String(r.logoId||'logo1'), String(r.reportDate||todayStr()), String(r.reportTime||''), String(r.location||''), String(r.details||''), JSON.stringify(images), me.fullName, me.id, null, t, t, t);
      send(res, 200, { id, reportNumber, consumed: false, message: `تمت المزامنة وحجز رقم التقرير الرسمي: (${reportNumber})` }); return;
    }
    const rm = p.match(/^\/api\/reports\/([^/]+)$/);
    if (rm){
      const report = db.prepare('SELECT * FROM reports WHERE id=?').get(rm[1]);
      if (!report){ sendError(res, 404, 'التقرير غير موجود'); return; }
      if (method === 'GET'){
        if (!can(me, 'canOpen')){ sendError(res, 403, 'غير مصرح'); return; }
        send(res, 200, { report: parseReportRow(report) }); return;
      }
      if (method === 'PUT'){
        if (!can(me, 'canEdit')){ sendError(res, 403, 'غير مصرح: ليس لديك صلاحية تعديل'); return; }
        const b = await readBody(req);
        const r = b.report || {};
        const subject = String(r.subject||report.subject).trim();
        const reportNumber = String(r.reportNumber||report.reportNumber).trim();
        if (!reportNumber || !subject){ sendError(res, 400, 'رقم التقرير وموضوع التقرير مطلوبان'); return; }
        const dup = db.prepare('SELECT id FROM reports WHERE reportNumber=? AND id<>?').get(reportNumber, report.id);
        if (dup){ sendError(res, 409, 'رقم التقرير مستخدم في تقرير آخر'); return; }
        const images = Array.isArray(r.images) ? r.images : (parseReportRow(report).images);
        db.prepare('UPDATE reports SET reportNumber=?, subject=?, target=?, logoId=?, reportDate=?, reportTime=?, location=?, details=?, images=?, updatedAt=? WHERE id=?')
          .run(reportNumber, subject, String(r.target??report.target), String(r.logoId??report.logoId??'logo1'), String(r.reportDate??report.reportDate), String(r.reportTime??report.reportTime), String(r.location??report.location), String(r.details??report.details), JSON.stringify(images), nowIso(), report.id);
        send(res, 200, { ok: true }); return;
      }
      if (method === 'DELETE'){
        if (!can(me, 'canDelete')){ sendError(res, 403, 'غير مصرح: ليس لديك صلاحية حذف'); return; }
        db.prepare('DELETE FROM reports WHERE id=?').run(report.id);
        send(res, 200, { ok: true }); return;
      }
    }
    const rrm = p.match(/^\/api\/reports\/([^/]+)\/rating$/);
    if (rrm && method === 'PUT'){
      if (!isAdmin(me)){ sendError(res, 403, 'تقييم التقارير خاص بمدير النظام فقط'); return; }
      const report = db.prepare('SELECT * FROM reports WHERE id=?').get(rrm[1]);
      if (!report){ sendError(res, 404, 'التقرير غير موجود'); return; }
      const b = await readBody(req);
      db.prepare('UPDATE reports SET rating=?, updatedAt=? WHERE id=?').run(String(b.rating||''), nowIso(), report.id);
      send(res, 200, { ok: true }); return;
    }

    /* ---- النسخ الاحتياطي (خاص بمدير النظام فقط) ---- */
    if (p === '/api/backup/now' && method === 'POST'){
      if (!isAdmin(me)){ sendError(res, 403, 'غير مصرح: النسخ الاحتياطي مخصص لمدير النظام فقط وعلى جهازه'); return; }
      const resB = createAutoBackup();
      send(res, 200, {
        ok: true,
        message: 'تم تحديث النسخة الاحتياطية بنجاح في مجلد البرنامج وعلى القرص C',
        locations: resB.locations,
        time: resB.time
      });
      return;
    }
    if (p === '/api/backup' && method === 'GET'){
      if (!isAdmin(me)){ sendError(res, 403, 'غير مصرح: النسخ الاحتياطي مخصص لمدير النظام فقط'); return; }
      const dump = {
        exportedAt: nowIso(), version: '2.0',
        users: db.prepare('SELECT * FROM users').all(),
        reports: db.prepare('SELECT * FROM reports').all().map(parseReportRow),
        settings: db.prepare('SELECT * FROM settings').all()
      };
      send(res, 200, dump); return;
    }
    if (p === '/api/restore' && method === 'POST'){
      if (!isAdmin(me)){ sendError(res, 403, 'غير مصرح: استعادة النسخة الاحتياطية خاصة بمدير النظام فقط'); return; }
      const b = await readBody(req);
      const d = b.backup || {};
      if (!Array.isArray(d.users) || !Array.isArray(d.reports)){
        sendError(res, 400, 'ملف نسخة احتياطية غير صالح'); return;
      }
      db.exec('DELETE FROM reports; DELETE FROM users; DELETE FROM settings;');
      const insU = db.prepare('INSERT INTO users(id,userName,fullName,passwordHash,role,isActive,canOpen,canAdd,canDelete,canEdit,canPrint,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
      d.users.forEach(u => insU.run(u.id, u.userName, u.fullName, u.passwordHash, u.role, u.isActive, u.canOpen, u.canAdd, u.canDelete, u.canEdit, u.canPrint, u.createdAt));
      const insR = db.prepare('INSERT INTO reports(id,reportNumber,subject,target,reportDate,reportTime,location,details,images,enteredBy,enteredByUserId,rating,createdAt,updatedAt,syncedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      d.reports.forEach(r => insR.run(r.id, r.reportNumber, r.subject, r.target, r.reportDate, r.reportTime, r.location, r.details, JSON.stringify(r.images||[]), r.enteredBy, r.enteredByUserId, r.rating, r.createdAt, r.updatedAt, r.syncedAt));
      (d.settings || []).forEach(s => setSetting(s.key, s.value));
      const adminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='Admin'").get().c;
      if (adminCount === 0){
        db.prepare('INSERT INTO users(id,userName,fullName,passwordHash,role,isActive,canOpen,canAdd,canDelete,canEdit,canPrint,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(uid(), 'admin', 'مدير النظام', hashHex('Admin@123'), 'Admin', 1, 1, 1, 1, 1, 1, nowIso());
      }
      send(res, 200, { ok: true, message: 'تمت استعادة البيانات بنجاح' }); return;
    }

    /* ---- الإعدادات ---- */
    if (p === '/api/settings'){
      if (!can(me, 'canSettings')){ sendError(res, 403, 'غير مصرح'); return; }
      if (method === 'GET'){
        send(res, 200, { settings: buildMe(me).settings }); return;
      }
      if (method === 'PUT'){
        const b = await readBody(req);
        if (b.consumeAddAfterSync != null) setSetting('consumeAddAfterSync', b.consumeAddAfterSync ? '1' : '0');
        if (b.reportHeaderConfig != null) {
          const val = typeof b.reportHeaderConfig === 'object' ? JSON.stringify(b.reportHeaderConfig) : String(b.reportHeaderConfig);
          setSetting('reportHeaderConfig', val);
        }
        send(res, 200, { settings: buildMe(me).settings, message: 'تم حفظ الإعدادات بنجاح' }); return;
      }
    }

    sendError(res, 404, 'المسار غير موجود');
  }catch(err){
    sendError(res, 400, err.message || 'خطأ غير متوقع');
  }
});

function startServer(targetPort) {
  server.removeAllListeners('error');
  server.on('error', (err) => {
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && targetPort === 80) {
      console.warn(`⚠️ تعذر استخدام المنفذ 80 (${err.code}). جارٍ التشغيل التلقائي على المنفذ 8080...`);
      startServer(8080);
    } else if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && targetPort === 8080) {
      console.warn(`⚠️ تعذر استخدام المنفذ 8080 (${err.code}). جارٍ التشغيل التلقائي على المنفذ 8765...`);
      startServer(8765);
    } else {
      console.error('خطأ في تشغيل الخادم:', err.message);
      process.exitCode = 1;
    }
  });

  server.listen(targetPort, HOST, () => {
    const portStr = targetPort === 80 ? '' : (':' + targetPort);
    console.log('============================================');
    console.log(' نظام إدارة التقارير');
    console.log(' الخادم يعمل بنجاح على:');
    console.log('   محلياً:   http://localhost' + portStr + '/');
    console.log('   للشبكة:  http://' + lanIP() + portStr + '/');
    console.log(' حسابات تجريبية: admin/Admin@123  |  ahmed/123456');
    console.log(' للإيقاف: Ctrl+C');
    console.log('============================================');
  });
}

startServer(PORT);
