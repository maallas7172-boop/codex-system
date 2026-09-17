/* =========================================================
   login.js — تسجيل الدخول
   ========================================================= */
(async function () {
  const msg = document.getElementById('loginMessage');
  function show(m, type) {
    msg.textContent = m;
    msg.className = 'login-msg ' + (type || 'err');
    setTimeout(() => { if (msg.textContent === m) msg.className = 'login-msg'; }, 5000);
  }
  const params = new URLSearchParams(location.search);
  if (params.get('blocked') === '1') show('تم إغلاق الدخول لهذا المستخدم إلى أن يعيد المدير منحه صلاحية جديدة', 'err');

  // زر إظهار / إخفاء كلمة المرور
  const toggleBtn = document.getElementById('toggleLoginPasswordBtn');
  const pwdInput = document.getElementById('password');
  if (toggleBtn && pwdInput) {
    toggleBtn.onclick = () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        toggleBtn.textContent = '🙈';
      } else {
        pwdInput.type = 'password';
        toggleBtn.textContent = '👁️';
      }
    };
  }

  // استيقاظ مسبق للسيرفر السحابي في الخلفية عند فتح الواجهة
  try {
    const preUrl = getServerBaseUrl() || '';
    if (preUrl) {
      fetch(preUrl + '/api/public/users', {
        headers: {
          'Accept': 'application/json',
          'X-Device-Id': getDeviceId(),
          'X-Device-Name': encodeURIComponent(getDeviceName())
        }
      }).catch(() => {});
    }
  } catch(e){}

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userName = document.getElementById('userName').value.trim();
    const password = document.getElementById('password').value;
    if (!userName || !password) return show('أدخل اسم المستخدم وكلمة المرور', 'err');
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'جارٍ الدخول...';
    try {
      let passwordHash = null;
      try { passwordHash = await sha256Hex(password); } catch (e) { passwordHash = null; }
      
      const serverUrl = getServerBaseUrl() || '';
      let response = null;
      let isNetworkError = false;

      // محاولة تسجيل الدخول مع إعادة المحاولة التلقائية في حال كان السيرفر في وضع الاستيقاظ (Cold Start)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(serverUrl + '/api/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Id': getDeviceId(),
              'X-Device-Name': encodeURIComponent(getDeviceName())
            },
            body: JSON.stringify({ userName, password, passwordHash })
          });
          isNetworkError = false;

          // إذا أرجع السيرفر 502 أو 503 (استيقاظ Render)، ننتظر 3 ثوانٍ ونعيد المحاولة تلقائياً
          if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt === 1) {
            btn.textContent = 'السيرفر يستيقظ... يرجى الانتظار';
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          break;
        } catch (networkError) {
          isNetworkError = true;
          if (attempt === 1) {
            btn.textContent = 'إعادة المحاولة...';
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          break;
        }
      }

      // إذا تعذر الاتصال بالخادم (أوفلاين)، نتحقق من الحساب المحفوظ على هذا الهاتف محلياً
      if (isNetworkError) {
        const offline = getOfflineAuth();
        if (offline && offline.userName && offline.userName.toLowerCase() === userName.toLowerCase()) {
          if (offline.passwordHash && passwordHash && offline.passwordHash === passwordHash) {
            setToken(offline.token || 'offline-token');
            setMe({ token: offline.token || 'offline-token', user: offline.user }, passwordHash);
            show('تم الدخول بنجاح في وضع عدم الاتصال (أوفلاين) ✔', 'ok');
            setTimeout(() => {
              const u = offline.user;
              const hasAnyAdminPerm = u.role === 'Admin' || u.canDash || u.canReports || u.canUsers || u.canSettings;
              location.href = hasAnyAdminPerm ? 'admin.html' : 'entry.html';
            }, 600);
            return;
          } else {
            throw new Error('كلمة المرور غير صحيحة (تحقق محلي في وضع عدم الاتصال).');
          }
        }
        throw new Error('تعذر الاتصال بالخادم المركزي (' + (serverUrl || location.origin) + '). قد يكون السيرفر يستيقظ من وضع السكون أو لا يتوفر إنترنت.');
      }

      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (parseError) {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new Error('⏳ الخادم السحابي قيد الاستيقاظ الآن (Cold Start)... يرجى الانتظار 10 ثوانٍ ثم الضغط على دخول.');
        }
        if (response.status === 404) {
          throw new Error('⚠️ مسار الخادم غير متطابق (404). تأكد من تحديث ملفات الخادم.');
        }
        throw new Error('استجابة غير متوقعة من الخادم (كود ' + response.status + '). يرجى إعادة المحاولة.');
      }

      if (!response.ok) {
        if (data && data.code === 'DEVICE_PENDING') {
          throw new Error('📱 هذا الهاتف جديد وقيد المراجعة بانتظار اعتماد مدير النظام. يرجى إبلاغ المدير لتفعيل هاتفك من لوحة التحكم (معرّف الهاتف: ' + getDeviceId().slice(0, 12) + ').');
        }
        if (data && data.code === 'DEVICE_BLOCKED') {
          throw new Error('🚫 تم حظر هذا الهاتف من الاتصال بالنظام من قِبل الإدارة.');
        }
        throw new Error((data && data.error) || 'فشل تسجيل الدخول (كود ' + response.status + ')');
      }
      if (!data || !data.token || !data.user) throw new Error('لم تكتمل استجابة الخادم. أعد المحاولة.');
      
      setToken(data.token);
      setMe(data, passwordHash);

      // التوجيه الديناميكي وفق الصلاحيات الممنوحة من المدير
      const u = data.user;
      const hasAnyAdminPerm = u.role === 'Admin' || u.canDash || u.canReports || u.canUsers || u.canSettings;
      if (hasAnyAdminPerm) {
        location.href = 'admin.html';
      } else {
        location.href = 'entry.html';
      }
    } catch (err) {
      show(err.message, 'err');
      btn.disabled = false; btn.textContent = 'دخول';
    }
  });
})();
