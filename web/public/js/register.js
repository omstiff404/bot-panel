// Terapkan preferensi tema yang sudah tersimpan (dark/light + gaya UI)
document.body.classList.toggle('theme-light', localStorage.getItem('wa-dashboard-theme') === 'light');
document.body.setAttribute('data-ui-theme', localStorage.getItem('wa-ui-theme') || 'default');

let pendingData = null;

document.getElementById('requestOtpBtn').addEventListener('click', async () => {
  const username = document.getElementById('regUsername').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const botName = document.getElementById('regBotName').value.trim();
  const password = document.getElementById('regPassword').value;
  const errorEl = document.getElementById('formError');
  errorEl.textContent = '';

  if (!username || !phone || !password) {
    errorEl.textContent = 'Username, nomor WhatsApp, dan password wajib diisi.';
    return;
  }

  const res = await fetch('/api/register/request-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  const data = await res.json();
  if (!data.ok) {
    errorEl.textContent = data.message || 'Gagal mengirim kode verifikasi.';
    return;
  }

  pendingData = { username, phone, botName, password };
  document.getElementById('stepForm').classList.add('hidden');
  document.getElementById('stepOtp').classList.remove('hidden');
});

document.getElementById('backToFormBtn').addEventListener('click', () => {
  document.getElementById('stepOtp').classList.add('hidden');
  document.getElementById('stepForm').classList.remove('hidden');
});

document.getElementById('confirmRegisterBtn').addEventListener('click', async () => {
  const otp = document.getElementById('otpCode').value.trim();
  const errorEl = document.getElementById('otpError');
  errorEl.textContent = '';

  if (!pendingData) return;
  if (!otp) { errorEl.textContent = 'Masukkan kode OTP.'; return; }

  const res = await fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pendingData, otp })
  });
  const data = await res.json();
  if (!data.ok) {
    errorEl.textContent = data.message || 'Gagal mendaftar.';
    return;
  }

  window.location.href = '/settings.html';
});
