// Terapkan preferensi tema yang sudah tersimpan (dark/light + gaya UI)
document.body.classList.toggle('theme-light', localStorage.getItem('wa-dashboard-theme') === 'light');
document.body.setAttribute('data-ui-theme', localStorage.getItem('wa-ui-theme') || 'default');

(async () => {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.loggedIn) window.location.href = '/settings.html';
})();

document.getElementById('loginSubmit').addEventListener('click', submitLogin);
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitLogin();
});

async function submitLogin() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.ok) {
    window.location.href = '/settings.html';
  } else {
    document.getElementById('loginError').textContent = data.message || 'Login gagal.';
  }
}
