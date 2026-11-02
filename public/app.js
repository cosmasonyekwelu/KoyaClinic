document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('api-status');

  // Check API health status
  async function checkHealth() {
    try {
      const response = await fetch('/health');
      if (response.ok) {
        const data = await response.json();
        if (data.ok) {
          statusBadge.textContent = 'API Status: Online';
          statusBadge.className = 'status-badge online';
          return;
        }
      }
      throw new Error('API reported unhealthy status');
    } catch (err) {
      statusBadge.textContent = 'API Status: Offline';
      statusBadge.className = 'status-badge offline';
    }
  }

  checkHealth();
});
