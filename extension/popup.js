const API_URL = 'http://localhost:8000';

document.addEventListener('DOMContentLoaded', async () => {
  const loader = document.getElementById('loader');
  const content = document.getElementById('content');
  const errorMsg = document.getElementById('errorMsg');

  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`${API_URL}/api/profile`).catch(() => null),
      fetch(`${API_URL}/api/stats`).catch(() => null)
    ]);

    if (!profileRes || !profileRes.ok || !statsRes || !statsRes.ok) {
      throw new Error('Backend is not running at http://localhost:8000');
    }

    const profile = await profileRes.json();
    const stats = await statsRes.json();

    document.getElementById('pName').innerText = profile.name || 'No Name';
    document.getElementById('pEmail').innerText = profile.email || 'No Email';
    document.getElementById('pPhone').innerText = profile.phone || 'No Phone';
    
    document.getElementById('sToday').innerText = stats.today || 0;
    document.getElementById('sTotal').innerText = stats.total || 0;

    loader.style.display = 'none';
    content.style.display = 'block';
  } catch (err) {
    loader.style.display = 'none';
    errorMsg.innerText = `Error: ${err.message}`;
    errorMsg.style.display = 'block';
    // Still show dashboard button
    content.style.display = 'block';
    document.getElementById('profileCard').style.display = 'none';
    document.querySelector('.stats').style.display = 'none';
  }

});
