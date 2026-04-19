const isLocalHost =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

window.APP_CONFIG = {
  apiBaseUrl: isLocalHost ? 'http://localhost:3001' : '',
  createJobPath: '/jobs',
  defaultStatusPath: '/jobs/{jobId}',
  uploadMethod: 'PUT'
};
