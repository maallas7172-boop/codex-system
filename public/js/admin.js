/* =========================================================
   admin.js — لوحة مدير النظام (الواجهة الكاملة)
   ========================================================= */
(async function () {
  let me = null;
  try { me = await currentMe(); } catch (e) { location.replace('login.html'); return; }
  const u = me.user;
  const canAccessAdmin = u.role === 'Admin' || u.canDash || u.canReports || u.canUsers || u.canSettings;
  if (!canAccessAdmin) {
    location.href = 'entry.html';
    return;
  }
  if (me.settings && me.settings.reportHeaderConfig && typeof updateReportHeaderConfig === 'function') {
    updateReportHeaderConfig(me.settings.reportHeaderConfig);
  }

  const $ = id => document.getElementById(id);
  const PRINTS = ['printView', 'printFrame'];
  $('adminName').textContent = u.fullName + (u.role === 'Admin' ? ' (مدير)' : '');

  // إظهار أو إخفاء أزرار التبويب حسب الصلاحيات الممنوحة من المدير
  const navDash = document.querySelector('.nav-btn[data-page="dash"]');
  const navReports = document.querySelector('.nav-btn[data-page="reports"]');
  const navUsers = document.querySelector('.nav-btn[data-page="users"]');
  const navSettings = document.querySelector('.nav-btn[data-page="settings"]');

  if (navDash) navDash.style.display = (u.role === 'Admin' || u.canDash) ? 'flex' : 'none';
  if (navReports) navReports.style.display = (u.role === 'Admin' || u.canReports) ? 'flex' : 'none';
  if (navUsers) navUsers.style.display = (u.role === 'Admin' || u.canUsers) ? 'flex' : 'none';
  if (navSettings) navSettings.style.display = (u.role === 'Admin' || u.canSettings) ? 'flex' : 'none';

  /* ---------- التنقل ---------- */
  const NAVS = {
    dash: 'dashPage', reports: 'reportsPage',
    users: 'usersPage', settings: 'settingsPage'
  };
  const PERMS = {
    dash: u.role === 'Admin' || u.canDash,
    reports: u.role === 'Admin' || u.canReports,
    users: u.role === 'Admin' || u.canUsers,
    settings: u.role === 'Admin' || u.canSettings
  };

  document.querySelectorAll('.nav-btn[data-page]').forEach(b => {
    b.onclick = () => {
      const pageKey = b.dataset.page;
      if (!PERMS[pageKey]) {
        toast('ليس لديك صلاحية الوصول لهذا القسم', 'err');
        return;
      }
      document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      Object.values(NAVS).forEach(p => { if ($(p)) $(p).classList.remove('active'); });
      if ($(NAVS[pageKey])) $(NAVS[pageKey]).classList.add('active');
      if (pageKey === 'dash') renderDash();
      if (pageKey === 'reports') renderReports();
      if (pageKey === 'users') renderUsers();
      if (pageKey === 'settings') renderSettings();
    };
  });

  // تفعيل أول صفحة مصرح للمستخدم بفتحها
  const hashPage = (location.hash || '').replace('#', '');
  if (hashPage && NAVS[hashPage] && PERMS[hashPage]) {
    const target = document.querySelector('.nav-btn[data-page="' + hashPage + '"]');
    if (target) target.click();
  } else {
    const firstAllowed = Object.keys(PERMS).find(k => PERMS[k]);
    if (firstAllowed) {
      const target = document.querySelector('.nav-btn[data-page="' + firstAllowed + '"]');
      if (target) target.click();
    }
  }

  /* ================= لوحة التحكم ================= */
  let dashStatsData = null;
  async function renderDash() {
    try {
      const s = await api('/stats');
      dashStatsData = s;
      updateDashUI(s);
    } catch (err) { toast(err.message, 'err'); }
  }

  function updateDashUI(s) {
    if (!s) return;
    const kpis = [
      { l: 'إجمالي التقارير', v: s.reportsTotal, h: 'في قاعدة البيانات', c: 'blue', i: '📄' },
      { l: 'تقارير اليوم', v: s.reportsToday, h: 'بتاريخ ' + todayStr(), c: 'green', i: '📅' },
      { l: 'المستخدمون', v: s.usersTotal, h: s.usersActive + ' نشط', c: 'blue', i: '👥' },
      { l: 'الهواتف المعتمدة', v: s.devicesApproved || 0, h: (s.devicesPending ? '⚠️ ' + s.devicesPending + ' بانتظار الاعتماد' : 'كافة الهواتف مصرحة'), c: (s.devicesPending ? 'warn' : 'green'), i: '📱' }
    ];
    if ($('kpiGrid')) {
      $('kpiGrid').innerHTML = kpis.map(k => `
        <div class="kpi ${k.c}">
          <div class="lbl">${k.i} ${k.l}</div>
          <div class="val">${k.v}</div>
          <div class="hint">${k.h}</div>
        </div>`).join('');
    }

    // توزيع تقييم التقارير
    const maxR = Math.max(...(s.reportsByRating || []).map(x => x.v), 1);
    if ($('ratingDist')) {
      $('ratingDist').innerHTML = (s.reportsByRating || []).map(x => `
        <div class="mini-item">
          <span class="k">${x.k}</span>
          <div style="flex:1;max-width:140px"><div class="bar-track"><div class="bar-fill" style="width:${(x.v / maxR * 100).toFixed(0)}%"></div></div></div>
          <span class="v">${x.v}</span>
        </div>`).join('');
    }

    // تقارير لكل مستخدم
    const maxU = Math.max(...(s.reportsPerUser || []).map(x => x.v), 1);
    if ($('perUserDist')) {
      $('perUserDist').innerHTML = (s.reportsPerUser && s.reportsPerUser.length) ? s.reportsPerUser.map(x => `
        <div class="mini-item">
          <span class="k">👤 ${esc(x.k)}</span>
          <div style="flex:1;max-width:140px"><div class="bar-track"><div class="bar-fill" style="width:${(x.v / maxU * 100).toFixed(0)}%;background:linear-gradient(90deg,var(--secondary),#2bb3a6)"></div></div></div>
          <span class="v">${x.v}</span>
        </div>`).join('') : '<div class="empty">لا توجد بيانات</div>';
    }

    // أحدث التقارير مع تطبيق فلتر البحث
    const searchVal = $('dashSearch') ? $('dashSearch').value.trim().toLowerCase() : '';
    let recReports = s.recentReports || [];
    if (searchVal) {
      recReports = recReports.filter(r =>
        (r.reportNumber || '').toLowerCase().includes(searchVal) ||
        (r.subject || '').toLowerCase().includes(searchVal) ||
        (r.enteredBy || '').toLowerCase().includes(searchVal) ||
        (r.target || '').toLowerCase().includes(searchVal)
      );
    }
    if ($('latestReports')) {
      $('latestReports').innerHTML = recReports.length ? recReports.map(r => `
        <tr>
          <td><b>${esc(r.reportNumber)}</b></td>
          <td class="det">${esc(r.subject)}</td>
          <td>${esc(r.enteredBy || '—')}</td>
          <td>${esc(r.reportDate)}</td>
          <td>${badgeStatus(r.rating || 'بدون تصنيف')}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="empty">لا توجد تقارير مطابقة</td></tr>';
    }
  }
  if ($('dashSearch')) $('dashSearch').oninput = () => updateDashUI(dashStatsData);

  /* ================= التقارير ================= */
  let currentReports = [];
  const RATING_OPTS = ['مهم جدا', 'مهم', 'متوسط', 'عادي', 'غير مهم'];

  async function renderReports() {
    const q = {};
    const from = $('rFrom').value, to = $('rTo').value, u = $('rUser').value, rt = $('rRating').value;
    if (from) q.from = from; if (to) q.to = to;
    if (u) q.userId = u; if (rt) q.rating = rt;
    try {
      const d = await api('/reports?' + new URLSearchParams(q));
      currentReports = d.reports || [];
      const searchVal = $('rSearch') ? $('rSearch').value.trim().toLowerCase() : '';
      if (searchVal) {
        currentReports = currentReports.filter(r =>
          (r.reportNumber || '').toLowerCase().includes(searchVal) ||
          (r.subject || '').toLowerCase().includes(searchVal) ||
          (r.target || '').toLowerCase().includes(searchVal) ||
          (r.details || '').toLowerCase().includes(searchVal) ||
          (r.location || '').toLowerCase().includes(searchVal) ||
          (r.enteredBy || '').toLowerCase().includes(searchVal)
        );
      }
      $('repCount').textContent = 'عدد التقارير: ' + currentReports.length;
      $('reportsTableBody').innerHTML = currentReports.length ? currentReports.map(r => `
        <tr>
          <td><b>${esc(r.reportNumber)}</b></td>
          <td class="det" style="min-width:200px">${esc(r.subject)}</td>
          <td>${esc(r.target || '—')}</td>
          <td>${esc(r.reportDate)}</td>
          <td>
            <select class="rating-select" data-id="${r.id}" style="width:auto;padding:6px 10px;font-size:12.5px;border-radius:9px" title="تقييم التقرير (خاص بالمدير)">
              <option value="">بدون تقييم</option>
              ${RATING_OPTS.map(o => `<option ${r.rating === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </td>
          <td>${r.imageCount > 0 ? `<span class="badge blue">📎 ${r.imageCount}</span>` : '<span class="badge gray">—</span>'}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              <button class="btn btn-outline btn-xs" data-view="${r.id}">👁 عرض</button>
              <button class="btn btn-primary btn-xs" data-print="${r.id}">🖨 طباعة</button>
            </div>
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty"><span class="ic">📄</span>لا توجد تقارير مطابقة للتصفية</td></tr>';
      bindRatingSelects();
      bindReportActions();
    } catch (err) { toast(err.message, 'err'); }
  }
  if ($('rSearch')) $('rSearch').oninput = () => renderReports();

  function bindRatingSelects() {
    document.querySelectorAll('.rating-select').forEach(sel => {
      sel.onchange = async () => {
        try {
          await api('/reports/' + sel.dataset.id + '/rating', {
            method: 'PUT', body: JSON.stringify({ rating: sel.value })
          });
          toast('تم تحديث تقييم التقرير ✔');
        } catch (err) { toast(err.message, 'err'); renderReports(); }
      };
    });
  }

  function bindReportActions() {
    document.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = () => showReportDetail(currentReports.find(r => r.id === b.dataset.view));
    });
    document.querySelectorAll('[data-print]').forEach(b => {
      b.onclick = () => printReport(currentReports.find(r => r.id === b.dataset.print));
    });
  }

  /* نافذة تفاصيل التقرير */
  function showReportDetail(r) {
    if (!r) return;
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : '';
    const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
    const attachments = rawImages.map(normalizeAttachment);

    let attHtml = '';
    if (attachments.length) {
      attHtml = `
        <h3 style="margin:20px 0 12px;font-size:15px;display:flex;align-items:center;gap:6px">
          <span>📎 المرفقات والوسائط المتعددة (${attachments.length})</span>
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:14px">
          ${attachments.map((att, idx) => {
            const isImg = att.type.startsWith('image/');
            const isVid = att.type.startsWith('video/');
            const isAud = att.type.startsWith('audio/');
            const icon = getAttachmentIcon(att.type, att.name);
            const sizeStr = formatBytes(att.size);

            if (isImg) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f8fafc;display:flex;flex-direction:column">
                  <a href="${att.data}" target="_blank" download="${esc(att.name)}" style="display:block;height:120px;overflow:hidden;background:#000" title="اضغط للتكبير أو التنزيل">
                    <img src="${att.data}" alt="${esc(att.name)}" style="width:100%;height:100%;object-fit:cover" />
                  </a>
                  <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;background:#fff">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:110px" title="${esc(att.name)}">${esc(att.name)}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 8px;font-size:11px" title="تنزيل">⬇️</a>
                  </div>
                </div>`;
            } else if (isVid) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0f172a;color:#fff;display:flex;flex-direction:column">
                  <video src="${att.data}" controls style="width:100%;height:120px;background:#000;object-fit:contain"></video>
                  <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;background:#1e293b">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:110px" title="${esc(att.name)}">🎬 ${esc(att.name)}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-primary btn-xs" style="padding:2px 8px;font-size:11px" title="تنزيل الفيديو">⬇️</a>
                  </div>
                </div>`;
            } else if (isAud) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;padding:10px;background:#f8fafc;display:flex;flex-direction:column;gap:8px">
                  <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px">
                    <span style="font-size:18px">🎵</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${esc(att.name)}">${esc(att.name)}</span>
                  </div>
                  <audio src="${att.data}" controls style="width:100%;height:32px"></audio>
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted)">
                    <span>${sizeStr}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 8px;font-size:11px">⬇️ تنزيل</a>
                  </div>
                </div>`;
            } else {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:#ffffff;display:flex;flex-direction:column;justify-content:space-between;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                  <div style="display:flex;align-items:flex-start;gap:10px">
                    <span style="font-size:28px;line-height:1">${icon}</span>
                    <div style="flex:1;overflow:hidden">
                      <div style="font-size:12.5px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(att.name)}">${esc(att.name)}</div>
                      <div style="font-size:11px;color:var(--muted);margin-top:2px">${sizeStr}</div>
                    </div>
                  </div>
                  <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-sm" style="width:100%;justify-content:center;font-size:12px;gap:6px">
                    <span>⬇️ تنزيل الملف</span>
                  </a>
                </div>`;
            }
          }).join('')}
        </div>`;
    }

    $('mDetailBody').innerHTML = `
      ${headerHtml}
      <table class="recent-table" style="margin-bottom:6px">
        <tr><th style="width:180px">رقم التقرير</th><td><b>${esc(r.reportNumber || '—')}</b></td></tr>
        <tr><th>موضوع التقرير</th><td><b>${esc(r.subject || '—')}</b></td></tr>
        <tr><th>الجهة / الشخص</th><td>${esc(r.target || '—')}</td></tr>
        <tr><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
        <tr><th>التاريخ والوقت</th><td>${esc(r.reportDate || '—')} ${r.reportTime ? '— ' + esc(r.reportTime) : ''}</td></tr>
        <tr><th>تقييم التقرير</th><td>${badgeStatus(r.rating || 'غير مقيم')}</td></tr>
      </table>
      <h3 style="margin:18px 0 10px;font-size:15px">التقرير التفصيلي</h3>
      <div style="background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--r-md);padding:16px;line-height:2;white-space:pre-wrap">${esc(r.details || '—')}</div>
      ${attHtml}
      <div style="font-size:12px;color:var(--muted);margin-top:14px;border-top:1px dashed var(--line);padding-top:10px">
        مُدخل التقرير: <b>${esc(r.enteredBy || '—')}</b>
      </div>
    `;
    $('modal').classList.add('show');
    $('mPrintBtn').onclick = () => { $('modal').classList.remove('show'); printReport(r); };
    $('mCloseBtn').onclick = () => $('modal').classList.remove('show');
  }

  /* طباعة التقرير */
  function printReport(r) {
    if (!r) return;
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : `<div style="font-size:20px;font-weight:900;color:#1f6feb;border-bottom:2px solid #1f6feb;padding-bottom:10px;margin-bottom:20px">تقرير ${esc(r.reportNumber)}</div>`;
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
    const attachments = rawImages.map(normalizeAttachment);
    const imgList = attachments.filter(a => a.type.startsWith('image/'));
    const otherList = attachments.filter(a => !a.type.startsWith('image/'));

    const imgHtml = imgList.length ? `
      <h3 style="font-size:15px;margin:16px 0 8px">الصور المرفقة (${imgList.length})</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        ${imgList.map(img => `<img src="${img.data}" alt="${esc(img.name)}" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid #ccc;margin:4px" />`).join('')}
      </div>` : '';

    const otherDocsHtml = otherList.length ? `
      <h3 style="font-size:15px;margin:16px 0 8px">المستندات والملفات المرفقة (${otherList.length})</h3>
      <table style="width:100%;margin-bottom:14px;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="width:40px;text-align:center;border:1px solid #cbd5e1;padding:6px">#</th>
            <th style="border:1px solid #cbd5e1;padding:6px">اسم الملف</th>
            <th style="width:120px;text-align:center;border:1px solid #cbd5e1;padding:6px">نوع الملف</th>
            <th style="width:100px;text-align:center;border:1px solid #cbd5e1;padding:6px">الحجم</th>
          </tr>
        </thead>
        <tbody>
          ${otherList.map((doc, idx) => `
            <tr>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${idx + 1}</td>
              <td style="border:1px solid #cbd5e1;padding:6px"><b>${getAttachmentIcon(doc.type, doc.name)} ${esc(doc.name)}</b></td>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${esc(doc.type.split('/')[1] || doc.type)}</td>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${formatBytes(doc.size)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : '';

    const attSummaryHtml = attachments.length ? (imgHtml + otherDocsHtml) : '<p style="color:#888;font-size:13px">لا توجد مرفقات مع هذا التقرير</p>';

    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>تقرير ${esc(r.reportNumber)}</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a2233;margin:0;padding:32px;background:#fff}
  ${headerCss}
  table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px}
  th{background:#f2f6fc;text-align:right;padding:10px 12px;border:1px solid #dbe4f0;width:170px;font-size:13px}
  td{padding:10px 12px;border:1px solid #dbe4f0}
  .det{background:#fafcff;border:1px solid #dbe4f0;border-radius:8px;padding:16px;line-height:2;white-space:pre-wrap;margin-bottom:18px}
  .foot{margin-top:34px;border-top:1px solid #ccc;padding-top:12px;font-size:12px;color:#888;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${headerHtml}
  <table>
    <tr><th>رقم التقرير</th><td>${esc(r.reportNumber)}</td><th>تاريخ التقرير</th><td>${esc(r.reportDate || '—')}</td></tr>
    <tr><th>الوقت</th><td>${esc(r.reportTime || '—')}</td><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
    <tr><th>الجهة / الشخص</th><td colspan="3">${esc(r.target || '—')}</td></tr>
    <tr><th>موضوع التقرير</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
    <tr><th>تقييم التقرير</th><td colspan="3">${esc(r.rating || 'غير مقيم')}</td></tr>
  </table>
  <h3 style="font-size:15px;margin-bottom:8px">التقرير التفصيلي</h3>
  <div class="det">${esc(r.details || '—')}</div>
  ${attSummaryHtml}
  <div class="foot"><span>نظام إدارة التقارير • مُدخل التقرير: ${esc(r.enteredBy || '—')}</span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
  <div class="no-print" style="text-align:center;margin-top:22px"><button onclick="window.print()" style="padding:10px 26px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 طباعة</button></div>
</body></html>`);
    w.document.close();
  }

  /* ================= طباعة وتصدير التقارير (إجمالي / تفصيلي / Word / PDF) ================= */

  /* فتح نافذة خيارات الطباعة */
  if ($('openPrintChoiceBtn')) {
    $('openPrintChoiceBtn').onclick = () => {
      if (!currentReports.length) { toast('لا توجد تقارير مطابقة في القائمة للطباعة', 'err'); return; }
      if ($('printModalCount')) $('printModalCount').textContent = currentReports.length;
      if ($('printModalBack')) $('printModalBack').classList.add('show');
    };
  }
  if ($('pCloseBtn')) {
    $('pCloseBtn').onclick = () => {
      if ($('printModalBack')) $('printModalBack').classList.remove('show');
    };
  }

  /* 1. طباعة إجمالية (كشف ملخص بجدول منظم) */
  function printReportsSummary() {
    if (!currentReports.length) { toast('لا توجد تقارير للطباعة', 'err'); return; }
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML({ reportDate: todayStr() }) : '';
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const rows = currentReports.map(r => `
      <tr>
        <td style="text-align:center"><b>${esc(r.reportNumber)}</b></td>
        <td><b>${esc(r.subject)}</b></td>
        <td>${esc(r.target || '—')}</td>
        <td>${esc(r.location || '—')}</td>
        <td style="text-align:center">${esc(r.reportDate || '—')}</td>
        <td style="text-align:center">${esc(r.reportTime || '—')}</td>
        <td style="text-align:center">${esc(r.rating || 'بدون تقييم')}</td>
        <td style="text-align:center">${r.images && r.images.length ? '📎 ' + r.images.length : '—'}</td>
        <td>${esc(r.enteredBy || '—')}</td>
      </tr>`).join('');

    const w = window.open('', '_blank', 'width=1000,height=750');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>كشف إجمالي التقارير</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1e293b;margin:0;padding:28px;background:#fff;line-height:1.6}
  ${headerCss}
  .doc-title{text-align:center;font-size:18px;font-weight:900;color:#0f172a;margin:16px 0;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #cbd5e1}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:18px}
  th{background:#f1f5f9;text-align:center;padding:9px 8px;border:1px solid #cbd5e1;font-weight:800;color:#334155}
  td{padding:8px 8px;border:1px solid #cbd5e1}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:40px;text-align:center;font-size:13.5px;font-weight:700;page-break-inside:avoid}
  .sig-box{border-top:1px dashed #64748b;padding-top:10px;margin-top:45px}
  .foot{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;color:#64748b;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${headerHtml}
  <div class="doc-title">📊 كشف إجمالي التقارير الميدانية والموثقة (العدد الإجمالي: ${currentReports.length} تقرير)</div>
  <table>
    <thead>
      <tr>
        <th>رقم التقرير</th><th>موضوع التقرير</th><th>الجهة / الشخص</th><th>المكان</th>
        <th>التاريخ</th><th>الوقت</th><th>التقييم</th><th>المرفقات</th><th>مُدخل التقرير</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sig-grid">
    <div><span>المُعِد / المستخرج</span><div class="sig-box">${esc(dashStatsData?.user?.fullName || 'مدير النظام')}</div></div>
    <div><span>مسؤول الرقابة والمتابعة</span><div class="sig-box">التوقيع والمراجعة</div></div>
    <div><span>المدير العام / المسؤول</span><div class="sig-box">الختم والاعتماد الرسمي</div></div>
  </div>
  <div class="foot"><span>نظام إدارة التقارير الرسمية</span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
  <div class="no-print" style="text-align:center;margin-top:22px"><button onclick="window.print()" style="padding:10px 26px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:700">🖨 طباعة الكشف الإجمالي</button></div>
</body></html>`);
    w.document.close();
  }

  /* 2. طباعة تفصيلية (كافة التقارير بالتفصيل كل تقرير ببياناته ومرفقاته) */
  function printReportsDetailed() {
    if (!currentReports.length) { toast('لا توجد تقارير للطباعة', 'err'); return; }
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const reportsHtml = currentReports.map((r, idx) => {
      const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : '';
      const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
      const attachments = rawImages.map(normalizeAttachment);
      const imgList = attachments.filter(a => a.type.startsWith('image/'));
      const otherList = attachments.filter(a => !a.type.startsWith('image/'));

      const imgHtml = imgList.length ? `
        <h4 style="font-size:14px;margin:14px 0 6px">الصور المرفقة (${imgList.length}):</h4>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          ${imgList.map(img => `<img src="${img.data}" alt="${esc(img.name)}" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid #ccc;margin:4px" />`).join('')}
        </div>` : '';

      const otherDocsHtml = otherList.length ? `
        <h4 style="font-size:14px;margin:14px 0 6px">المستندات والملفات المرفقة (${otherList.length}):</h4>
        <table style="width:100%;margin-bottom:14px;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="width:40px;text-align:center;border:1px solid #cbd5e1;padding:6px">#</th>
              <th style="border:1px solid #cbd5e1;padding:6px">اسم الملف</th>
              <th style="width:120px;text-align:center;border:1px solid #cbd5e1;padding:6px">نوع الملف</th>
              <th style="width:100px;text-align:center;border:1px solid #cbd5e1;padding:6px">الحجم</th>
            </tr>
          </thead>
          <tbody>
            ${otherList.map((doc, i) => `
              <tr>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${i + 1}</td>
                <td style="border:1px solid #cbd5e1;padding:6px"><b>${getAttachmentIcon(doc.type, doc.name)} ${esc(doc.name)}</b></td>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${esc(doc.type.split('/')[1] || doc.type)}</td>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${formatBytes(doc.size)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '';

      const attSection = attachments.length ? (imgHtml + otherDocsHtml) : '';

      return `
        <div class="single-report-block" style="${idx < currentReports.length - 1 ? 'page-break-after:always;break-after:page;' : ''}">
          ${headerHtml}
          <div style="text-align:center;font-size:16px;font-weight:800;color:#0f172a;margin:12px 0 16px;background:#f8fafc;padding:6px;border-radius:6px;border:1px solid #cbd5e1">
            تقرير رقم (${esc(r.reportNumber)}) — ${esc(r.subject)}
          </div>
          <table>
            <tr><th style="width:140px">رقم التقرير</th><td><b>${esc(r.reportNumber)}</b></td><th style="width:120px">التاريخ</th><td>${esc(r.reportDate || '—')}</td></tr>
            <tr><th>الوقت</th><td>${esc(r.reportTime || '—')}</td><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
            <tr><th>الجهة / الشخص</th><td colspan="3">${esc(r.target || '—')}</td></tr>
            <tr><th>موضوع التقرير</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
            <tr><th>تقييم التقرير</th><td colspan="3">${esc(r.rating || 'غير مقيم')}</td></tr>
          </table>
          <h4 style="font-size:14px;margin:14px 0 6px">التقرير التفصيلي:</h4>
          <div class="det-box">${esc(r.details || '—')}</div>
          ${attSection}
          <div class="foot"><span>نظام إدارة التقارير • مُدخل التقرير: <b>${esc(r.enteredBy || '—')}</b></span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
        </div>
      `;
    }).join('\n<hr class="no-print" style="margin:40px 0;border:2px dashed #94a3b8"/>\n');

    const w = window.open('', '_blank', 'width=950,height=750');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>التقارير التفصيلية المجمعة</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1e293b;margin:0;padding:28px;background:#fff;line-height:1.6}
  ${headerCss}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:16px}
  th{background:#f8fafc;text-align:right;padding:8px 12px;border:1px solid #cbd5e1;font-weight:700;color:#334155}
  td{padding:8px 12px;border:1px solid #cbd5e1;color:#0f172a}
  .det-box{background:#fafcff;border:1px solid #cbd5e1;border-radius:8px;padding:14px;line-height:1.9;white-space:pre-wrap;font-size:13.5px;margin-bottom:14px}
  .foot{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;color:#64748b;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${reportsHtml}
  <div class="no-print" style="text-align:center;margin:30px 0"><button onclick="window.print()" style="padding:12px 30px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:800">🖨 طباعة كافة التقارير التفصيلية</button></div>
</body></html>`);
    w.document.close();
  }

  /* 3. التصدير إلى Word (.doc) */
  function exportReportsToWord(detailed = false) {
    if (!currentReports.length) { toast('لا توجد تقارير لتصديرها', 'err'); return; }
    let bodyHtml = '';
    const dateStr = todayStr();

    if (!detailed) {
      // تصدير إجمالي
      const rows = currentReports.map(r => `
        <tr>
          <td style="text-align:center"><b>${esc(r.reportNumber)}</b></td>
          <td><b>${esc(r.subject)}</b></td>
          <td>${esc(r.target || '—')}</td>
          <td>${esc(r.location || '—')}</td>
          <td style="text-align:center">${esc(r.reportDate || '—')}</td>
          <td style="text-align:center">${esc(r.rating || 'بدون تقييم')}</td>
          <td>${esc(r.enteredBy || '—')}</td>
        </tr>`).join('');
      bodyHtml = `
        <h2 style="text-align:center;font-size:18pt;color:#1e3a8a;">كشف تقارير إجمالي</h2>
        <p style="text-align:center;color:#475569;">تاريخ التصدير: ${dateStr} — إجمالي عدد التقارير: ${currentReports.length}</p>
        <table border="1" style="width:100%;border-collapse:collapse;margin-top:15px">
          <thead>
            <tr style="background-color:#e2e8f0">
              <th>رقم التقرير</th><th>الموضوع</th><th>الجهة / الشخص</th><th>المكان</th><th>التاريخ</th><th>التقييم</th><th>مُدخل التقرير</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      // تصدير تفصيلي
      bodyHtml = currentReports.map(r => `
        <div style="page-break-after:always;margin-bottom:30px">
          <h2 style="text-align:center;color:#1e3a8a">تقرير رقم (${esc(r.reportNumber)})</h2>
          <table border="1" style="width:100%;border-collapse:collapse;margin-bottom:12px">
            <tr><th style="background:#f1f5f9;width:150px">رقم التقرير</th><td><b>${esc(r.reportNumber)}</b></td><th style="background:#f1f5f9;width:100px">التاريخ</th><td>${esc(r.reportDate||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">الموضوع</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
            <tr><th style="background:#f1f5f9">الجهة / الشخص</th><td colspan="3">${esc(r.target||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">المكان</th><td>${esc(r.location||'—')}</td><th style="background:#f1f5f9">التقييم</th><td>${esc(r.rating||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">مُدخل التقرير</th><td colspan="3">${esc(r.enteredBy||'—')}</td></tr>
          </table>
          <h3 style="font-size:13pt;margin:10px 0 5px">تفاصيل التقرير:</h3>
          <div style="border:1px solid #ccc;padding:12px;background:#fafafa;line-height:1.8;white-space:pre-wrap">${esc(r.details||'—')}</div>
        </div>
      `).join('<hr style="margin:25px 0"/>');
    }

    const fullDoc = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8"/>
        <title>تقارير النظام</title>
        <style>
          body { font-family: 'Calibri', 'Arial', sans-serif; direction: rtl; text-align: right; margin: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 15px; }
          th, td { border: 1px solid #94a3b8; padding: 7px 10px; font-size: 11pt; }
          th { background-color: #f1f5f9; font-weight: bold; }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', fullDoc], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `تقارير_${detailed ? 'تفصيلية' : 'إجمالية'}_${dateStr}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`تم تصدير ملف Word (${detailed ? 'تفصيلي' : 'إجمالي'}) بنجاح ✔`);
  }

  /* ربط أزرار نافذة خيارات الطباعة والتصدير */
  if ($('btnPrintSummary')) $('btnPrintSummary').onclick = () => { $('printModalBack').classList.remove('show'); printReportsSummary(); };
  if ($('btnPrintDetailed')) $('btnPrintDetailed').onclick = () => { $('printModalBack').classList.remove('show'); printReportsDetailed(); };
  if ($('btnExportWordSummary')) $('btnExportWordSummary').onclick = () => { $('printModalBack').classList.remove('show'); exportReportsToWord(false); };
  if ($('btnExportWordDetailed')) $('btnExportWordDetailed').onclick = () => { $('printModalBack').classList.remove('show'); exportReportsToWord(true); };
  if ($('btnExportPdfChoice')) $('btnExportPdfChoice').onclick = () => { $('printModalBack').classList.remove('show'); printReportsSummary(); };

  /* ================= تصدير واستيراد التقارير (JSON) ================= */
  if ($('btnExportReportsJson')) {
    $('btnExportReportsJson').onclick = async () => {
      if (!currentReports || !currentReports.length) {
        toast('لا توجد تقارير في القائمة لتصديرها', 'err');
        return;
      }
      try {
        const dump = {
          system: 'إدارة الحسابات',
          version: '2.0.0',
          exportedAt: new Date().toISOString(),
          count: currentReports.length,
          reports: currentReports
        };
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        const dateStr = (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10));
        a.href = URL.createObjectURL(blob);
        a.download = `تقارير_إدارة_الحسابات_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`تم تصدير (${currentReports.length}) تقرير إلى ملف JSON بنجاح ✔`);
      } catch (err) {
        toast('تعذر تصدير التقارير: ' + err.message, 'err');
      }
    };
  }

  if ($('btnImportReportsJson')) {
    $('btnImportReportsJson').onclick = () => {
      if ($('importReportsFileInput')) {
        $('importReportsFileInput').value = '';
        $('importReportsFileInput').click();
      }
    };
  }

  if ($('importReportsFileInput')) {
    $('importReportsFileInput').onchange = async function () {
      const file = this.files && this.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw new Error('الملف المحدد ليس ملف JSON صالحاً');
        }

        let reportsList = [];
        if (Array.isArray(parsed)) {
          reportsList = parsed;
        } else if (parsed && Array.isArray(parsed.reports)) {
          reportsList = parsed.reports;
        } else if (parsed && parsed.backup && Array.isArray(parsed.backup.reports)) {
          reportsList = parsed.backup.reports;
        } else {
          throw new Error('لم يتم العثور على قائمة تقارير صالحة داخل الملف');
        }

        if (!reportsList.length) {
          throw new Error('الملف لا يحتوي على أي تقارير لاستيرادها');
        }

        const confirmMsg = `تم العثور على (${reportsList.length}) تقرير في الملف:\n«${file.name}»\n\nهل ترغب في استيرادها وإضافتها إلى النظام الآن؟`;
        if (!confirm(confirmMsg)) return;

        toast('⏳ جارٍ استيراد ومعالجة التقارير...');
        const res = await api('/reports/import', {
          method: 'POST',
          body: JSON.stringify({ reports: reportsList })
        });

        toast(res.message || `تم استيراد (${res.importedCount || reportsList.length}) تقرير بنجاح ✔`, 'ok');
        await renderReports();
        if (typeof renderDashboard === 'function') renderDashboard();
      } catch (err) {
        toast('فشل الاستيراد: ' + err.message, 'err');
      }
    };
  }

  /* تعبئة قوائم اختيار المستخدمين (لتصفية التقارير) */
  async function loadUserSelects() {
    try {
      const d = await api('/users');
      const entryUsers = d.users.filter(u => u.role === 'EntryUser');
      const opts = entryUsers.map(u => `<option value="${u.id}">${esc(u.fullName)} (${esc(u.userName)})</option>`).join('');
      if ($('rUser')) $('rUser').innerHTML = '<option value="">كل المستخدمين</option>' + opts;
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ================= المستخدمون والصلاحيات ================= */
  async function renderUsers() {
    try {
      const d = await api('/users');
      const list = d.users.filter(u => u.userName.toLowerCase().includes(($('userSearch').value || '').trim().toLowerCase()));
      $('userTableBody').innerHTML = list.map(u => {
        if (u.role === 'Admin') {
          return `<tr>
            <td><div class="rep-row"><div class="rep-badge" style="background:var(--gold-soft);color:var(--gold)">👑</div><div><b>${esc(u.fullName)}</b><div class="s" style="color:var(--muted);font-size:12px">${esc(u.userName)}</div></div></div></td>
            <td>${badgeStatus(u.isActive ? 'نشط' : 'غير نشط')}</td>
            <td><span class="badge blue">👑 مدير النظام (كافة الصلاحيات)</span></td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>
              <div class="btn-row" style="gap:6px">
                <button class="btn btn-outline btn-xs" data-edit="${u.id}">✏️ تعديل</button>
                <button class="btn btn-outline btn-xs" data-pwd="${u.id}">🔑 كلمة المرور</button>
              </div>
            </td>
          </tr>`;
        }
        return `<tr>
          <td><div class="rep-row"><div class="rep-badge">👤</div><div><b>${esc(u.fullName)}</b><div class="s" style="color:var(--muted);font-size:12px">${esc(u.userName)}</div></div></div></td>
          <td>${badgeStatus(u.isActive ? 'نشط' : 'غير نشط')}</td>
          <td><div class="chips" style="gap:4px;max-width:240px">${permBadges(u)}</div></td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              <button class="btn btn-primary btn-xs" data-edit="${u.id}">⚙️ تعديل</button>
              <button class="btn btn-outline btn-xs" data-pwd="${u.id}">🔑</button>
              <button class="btn btn-danger btn-xs" data-del="${u.id}">🗑</button>
            </div>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">لا يوجد مستخدمون</td></tr>';

      document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserEditor(list.find(u => u.id === b.dataset.edit)));
      document.querySelectorAll('[data-pwd]').forEach(b => b.onclick = () => openPwdEditor(list.find(u => u.id === b.dataset.pwd)));
      document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const u = list.find(x => x.id === b.dataset.del);
        if (!u) return;
        if (u.role === 'Admin') {
          toast('لا يمكن حذف حساب مدير النظام الرئيسي', 'err');
          return;
        }
        if (!confirm('حذف المستخدم «' + u.fullName + '» نهائياً؟ لا يمكن التراجع.')) return;
        try {
          await api('/users/' + u.id, { method: 'DELETE' });
          toast('تم حذف المستخدم');
          renderUsers();
        } catch (err) { toast(err.message, 'err'); }
      });
      renderDevices();
    } catch (err) { toast(err.message, 'err'); }
  }
  $('userSearch').oninput = renderUsers;

  /* ================= إدارة الأجهزة والهواتف المعتمدة ================= */
  function updateDeviceAuthBadge(isActive) {
    const badge = $('deviceAuthStatusBadge');
    if (!badge) return;
    if (isActive) {
      badge.className = 'badge green';
      badge.textContent = 'مفعّل (حماية عالية)';
    } else {
      badge.className = 'badge warn';
      badge.textContent = 'معطّل (سماح مباشر للجميع)';
    }
  }

  async function renderDevices() {
    if (!$('devicesTableBody')) return;

    // تهيئة زر ومفتاح الحماية
    const toggle = $('enforceDeviceAuthToggle');
    if (toggle) {
      if (!toggle._bound) {
        toggle._bound = true;
        toggle.onchange = async () => {
          try {
            await api('/settings', { method: 'PUT', body: JSON.stringify({ enforceDeviceAuth: toggle.checked }) });
            toast(toggle.checked ? 'تم تفعيل نظام حماية واعتماد الأجهزة ✔' : 'تم إيقاف فحص الأجهزة (السماح بالدخول المباشر) 🔓');
            updateDeviceAuthBadge(toggle.checked);
            if (me.settings) me.settings.enforceDeviceAuth = toggle.checked;
          } catch (err) {
            toast(err.message, 'err');
            toggle.checked = !toggle.checked;
          }
        };
      }
      toggle.checked = me.settings?.enforceDeviceAuth !== false;
      updateDeviceAuthBadge(toggle.checked);
    }

    const appAllBtn = $('approveAllDevicesBtn');
    if (appAllBtn && !appAllBtn._bound) {
      appAllBtn._bound = true;
      appAllBtn.onclick = async () => {
        try {
          const res = await api('/devices/approve-all', { method: 'POST' });
          toast(res.message || 'تم اعتماد وتفعيل كافة الأجهزة المعلقة بنجاح ✔');
          renderDevices();
          if (typeof renderStats === 'function') renderStats();
        } catch (err) { toast(err.message, 'err'); }
      };
    }

    try {
      const d = await api('/devices');
      const list = d.devices || [];
      const pendingCount = list.filter(x => x.status === 'pending').length;
      if ($('pendingDevicesBadge')) {
        $('pendingDevicesBadge').textContent = pendingCount + ' بانتظار الاعتماد';
        $('pendingDevicesBadge').style.display = pendingCount ? 'inline-block' : 'none';
      }

      $('devicesTableBody').innerHTML = list.length ? list.map(dev => {
        let statusBadge = '';
        if (dev.status === 'approved') {
          statusBadge = '<span class="badge green">🟢 معتمد دائم ومصرح</span>';
        } else if (dev.status === 'blocked') {
          statusBadge = '<span class="badge red">🔴 محظور وموقوف</span>';
        } else {
          statusBadge = '<span class="badge warn">⏳ بانتظار اعتماد المدير</span>';
        }

        const shortId = (dev.deviceId || '').slice(0, 16);

        return `<tr>
          <td>
            <b>${esc(dev.userFullName || '—')}</b>
            <div style="font-size:12px;color:var(--muted)">👤 ${esc(dev.userName || 'غير مسجل')}</div>
          </td>
          <td>
            <b>📱 ${esc(dev.deviceName || 'هاتف ميداني')}</b>
          </td>
          <td>
            <code style="font-family:monospace;font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px" title="${esc(dev.deviceId)}">${esc(shortId)}...</code>
          </td>
          <td>${fmtDate(dev.registeredAt)}</td>
          <td>${fmtDateTime(dev.lastSeenAt)}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              ${dev.status !== 'approved' ? `<button class="btn btn-primary btn-xs" data-approve="${dev.id}">✅ اعتماد دائم</button>` : ''}
              ${dev.status !== 'blocked' ? `<button class="btn btn-warn btn-xs" data-block="${dev.id}">🚫 حظر / توقيف</button>` : ''}
              <button class="btn btn-danger btn-xs" data-deldev="${dev.id}">🗑️ حذف</button>
            </div>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="7" class="empty">لا توجد أجهزة مسجلة في النظام بعد</td></tr>';

      document.querySelectorAll('[data-approve]').forEach(b => {
        b.onclick = async () => {
          try {
            const res = await api('/devices/' + b.dataset.approve + '/approve', { method: 'POST' });
            toast(res.message || 'تم اعتماد الهاتف وتفعيله بشكل دائم ✔');
            renderDevices();
            if (typeof renderStats === 'function') renderStats();
          } catch (e) { toast(e.message, 'err'); }
        };
      });

      document.querySelectorAll('[data-block]').forEach(b => {
        b.onclick = async () => {
          try {
            const res = await api('/devices/' + b.dataset.block + '/block', { method: 'POST' });
            toast(res.message || 'تم حظر وتوقيف الهاتف 🚫', 'err');
            renderDevices();
            if (typeof renderStats === 'function') renderStats();
          } catch (e) { toast(e.message, 'err'); }
        };
      });

      document.querySelectorAll('[data-deldev]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('حذف هذا الجهاز من السجل؟')) return;
          try {
            await api('/devices/' + b.dataset.deldev, { method: 'DELETE' });
            toast('تم حذف الجهاز من السجل');
            renderDevices();
            if (typeof renderStats === 'function') renderStats();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    } catch (err) {
      if ($('devicesTableBody')) $('devicesTableBody').innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">تعذر تحميل الأجهزة: ${esc(err.message)}</td></tr>`;
    }
  }
  window.renderDevices = renderDevices;

  $('newUserBtn').onclick = () => openUserEditor(null);

  function openUserEditor(u) {
    $('userFormTitle').textContent = u ? 'تعديل المستخدم: ' + u.fullName : 'إضافة مستخدم جديد';
    $('ufUserName').value = u ? u.userName : '';
    $('ufUserName').readOnly = false; // السماح بتعديل اسم الدخول
    $('ufFullName').value = u ? u.fullName : '';
    $('ufPassword').value = '';
    $('ufPassword').placeholder = u ? '(اتركه فارغاً للإبقاء على كلمة المرور الحالية)' : 'كلمة المرور';
    $('ufActive').checked = u ? !!u.isActive : true;
    
    const permKeys = ['Dash', 'Entry', 'Add', 'Reports', 'Edit', 'Delete', 'Print', 'Users', 'Settings'];
    permKeys.forEach(k => {
      const el = $('ufCan' + k);
      if (el) {
        if (u) {
          el.checked = !!u['can' + k];
        } else {
          el.checked = (k === 'Dash' || k === 'Entry' || k === 'Add' || k === 'Reports' || k === 'Print');
        }
      }
    });
    $('userForm').dataset.id = u ? u.id : '';
    $('userForm').style.display = 'block';
    $('userForm').scrollIntoView({ behavior: 'smooth' });
  }
  $('userCancelBtn').onclick = () => { $('userForm').style.display = 'none'; };
  $('userSaveBtn').onclick = async () => {
    const id = $('userForm').dataset.id;
    const userName = $('ufUserName').value.trim();
    const fullName = $('ufFullName').value.trim();
    if (!userName || !fullName) { toast('الاسم واسم المستخدم مطلوبان', 'err'); return; }
    const body = {
      userName, fullName, isActive: $('ufActive').checked,
      canDash: !!$('ufCanDash')?.checked,
      canEntry: !!$('ufCanEntry')?.checked,
      canAdd: !!$('ufCanAdd')?.checked,
      canReports: !!$('ufCanReports')?.checked,
      canEdit: !!$('ufCanEdit')?.checked,
      canDelete: !!$('ufCanDelete')?.checked,
      canPrint: !!$('ufCanPrint')?.checked,
      canUsers: !!$('ufCanUsers')?.checked,
      canSettings: !!$('ufCanSettings')?.checked,
      canOpen: !!$('ufCanEntry')?.checked || !!$('ufCanReports')?.checked
    };
    const pw = $('ufPassword').value;
    if (pw) body.passwordHash = await sha256Hex(pw);
    if (!id && !pw) { toast('كلمة المرور مطلوبة للمستخدم الجديد', 'err'); return; }
    try {
      if (id) await api('/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/users', { method: 'POST', body: JSON.stringify(body) });
      toast('تم حفظ المستخدم وصلاحياته ✔');
      $('userForm').style.display = 'none';
      renderUsers();
    } catch (err) { toast(err.message, 'err'); }
  };

  function openPwdEditor(u) {
    if (!confirm('تعيين كلمة مرور جديدة للمستخدم «' + u.fullName + '»؟')) return;
    const pw = prompt('كلمة المرور الجديدة (6 أحرف على الأقل):');
    if (!pw) return;
    if (pw.length < 6) { toast('كلمة المرور قصيرة جداً', 'err'); return; }
    (async () => {
      try {
        await api('/users/' + u.id, { method: 'PUT', body: JSON.stringify({ passwordHash: await sha256Hex(pw) }) });
        toast('تم تغيير كلمة المرور ✔');
      } catch (err) { toast(err.message, 'err'); }
    })();
  }

  /* ================= الإعدادات وتخصيص الترويسة ================= */
  let customLogoBase64 = '';

  function getHeaderFormConfig() {
    const rawLines = $('hRightLines') ? $('hRightLines').value.trim() : '';
    const rightLines = rawLines ? rawLines.split('\n').map(l => l.trim()).filter(Boolean) : REPORT_HEADER_CONFIG.rightLines;
    let logoSrc = $('hLogoSel') ? $('hLogoSel').value : REPORT_HEADER_CONFIG.logoSrc;
    if (logoSrc === 'custom' && customLogoBase64) {
      logoSrc = customLogoBase64;
    } else if (logoSrc === 'custom') {
      logoSrc = REPORT_HEADER_CONFIG.logoSrc;
    }
    const fontFamily = $('hFontSel') ? $('hFontSel').value : (REPORT_HEADER_CONFIG.fontFamily || 'amiri');
    const showBasmala = $('hShowBasmala') ? $('hShowBasmala').checked : (REPORT_HEADER_CONFIG.showBasmala !== false);
    const basmalaText = $('hBasmalaText') ? $('hBasmalaText').value.trim() : (REPORT_HEADER_CONFIG.basmalaText || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
    const confidentialityBadge = $('hConfidential') ? $('hConfidential').value.trim() : REPORT_HEADER_CONFIG.confidentialityBadge;
    return { rightLines, logoSrc, fontFamily, showBasmala, basmalaText, confidentialityBadge };
  }

  function renderHeaderPreview() {
    if (!$('hLivePreview')) return;
    const cfg = getHeaderFormConfig();
    $('hLivePreview').innerHTML = renderReportHeaderHTML({ reportDate: todayStr(), reportTime: '10:30' }, cfg);
  }

  if ($('hRightLines')) $('hRightLines').oninput = renderHeaderPreview;
  if ($('hConfidential')) $('hConfidential').oninput = renderHeaderPreview;
  if ($('hFontSel')) $('hFontSel').onchange = renderHeaderPreview;
  if ($('hShowBasmala')) $('hShowBasmala').onchange = renderHeaderPreview;
  if ($('hBasmalaText')) $('hBasmalaText').oninput = renderHeaderPreview;
  if ($('hLogoSel')) {
    $('hLogoSel').onchange = function () {
      if (this.value === 'custom') {
        $('hLogoFile').click();
      } else {
        customLogoBase64 = '';
        renderHeaderPreview();
      }
    };
  }
  if ($('hLogoFile')) {
    $('hLogoFile').onchange = function () {
      const file = this.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('حجم الصورة كبير، اختر صورة أقل من 2 ميجابايت', 'err'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        customLogoBase64 = reader.result;
        renderHeaderPreview();
        toast('تم اختيار الصورة بنجاح ✔ — اضغط «حفظ وتطبيق» لحفظها على النظام');
      };
      reader.readAsDataURL(file);
    };
  }

  if ($('hSaveBtn')) {
    $('hSaveBtn').onclick = async () => {
      const cfg = getHeaderFormConfig();
      try {
        await api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ reportHeaderConfig: cfg })
        });
        updateReportHeaderConfig(cfg);
        renderHeaderPreview();
        toast('تم حفظ وتطبيق الترويسة الجديدة على جميع التقارير بنجاح ✔');
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  async function renderSettings() {
    try {
      const d = await api('/settings');
      const s = d.settings;
      if ($('netInfo')) $('netInfo').textContent = 'عنوان الخادم للشبكة: ' + s.baseUrl + ' — تعمل على نفس شبكة (واي فاي) المدير.';
      if (s.reportHeaderConfig) {
        updateReportHeaderConfig(s.reportHeaderConfig);
      }
      if ($('hRightLines')) {
        const lines = REPORT_HEADER_CONFIG.rightLines;
        $('hRightLines').value = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
      }
      if ($('hConfidential')) {
        $('hConfidential').value = REPORT_HEADER_CONFIG.confidentialityBadge || '';
      }
      if ($('hFontSel')) {
        $('hFontSel').value = REPORT_HEADER_CONFIG.fontFamily || 'diwani';
      }
      if ($('hShowBasmala')) {
        $('hShowBasmala').checked = REPORT_HEADER_CONFIG.showBasmala !== false;
      }
      if ($('hBasmalaText')) {
        $('hBasmalaText').value = REPORT_HEADER_CONFIG.basmalaText || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
      }
      if ($('hLogoSel')) {
        const currentSrc = REPORT_HEADER_CONFIG.logoSrc || '';
        if (currentSrc === 'Image/1754379379088.jpg') {
          $('hLogoSel').value = currentSrc;
        } else if (currentSrc) {
          $('hLogoSel').value = 'custom';
          customLogoBase64 = currentSrc;
        } else {
          $('hLogoSel').value = 'Image/1754379379088.jpg';
        }
      }
      renderHeaderPreview();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* النسخ الاحتياطي */
  $('backupBtn').onclick = async () => {
    try {
      const d = await api('/backup');
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'نظام-التقارير-نسخة-احتياطية-' + todayStr() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('تم تنزيل النسخة الاحتياطية ✔');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('restoreInput').onchange = async function () {
    const file = this.files[0];
    if (!file) return;
    if (!confirm('سيتم استبدال جميع البيانات الحالية بمحتوى النسخة الاحتياطية. متابعة؟')) { this.value = ''; return; }
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await api('/restore', { method: 'POST', body: JSON.stringify({ backup }) });
      toast('تمت الاستعادة بنجاح ✔');
      renderSettings(); renderUsers();
    } catch (err) { toast('فشلت الاستعادة: ' + err.message, 'err'); }
    this.value = '';
  };

  /* ================= إغلاق النوافذ ================= */
  document.querySelectorAll('.x-btn').forEach(b => b.onclick = () => b.closest('.modal-back').classList.remove('show'));

  /* ================= التشغيل الأولي ================= */
  window.renderDash = renderDash;
  window.renderReports = renderReports;
  window.renderUsers = renderUsers;
  window.renderSettings = renderSettings;
  loadUserSelects();
  renderDash();
})();
