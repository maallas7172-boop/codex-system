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
      } catch (networkError) {
        isNetworkError = true;
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
        throw new Error('تعذر الاتصال بالخادم المركزي (' + (serverUrl || location.origin) + '). يلزم توفر الإنترنت لأول مرة فقط لربط الحساب بالجهاز.');
      }

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; }
      catch (parseError) { throw new Error('استجابة غير صالحة من الخادم.'); }
      if (!response.ok) {
        if (data && data.code === 'DEVICE_PENDING') {
          throw new Error('📱 هذا الهاتف جديد وقيد المراجعة بانتظار اعتماد مدير النظام. يرجى إبلاغ المدير لتفعيل هاتفك من لوحة التحكم (معرّف الهاتف: ' + getDeviceId().slice(0, 12) + ').');
        }
        if (data && data.code === 'DEVICE_BLOCKED') {
          throw new Error('🚫 تم حظر هذا الهاتف من الاتصال بالنظام من قِبل الإدارة.');
        }
        throw new Error((data && data.error) || 'فشل تسجيل الدخول');
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
