const { net } = require('electron');

async function verifySystemClock() {
  return new Promise((resolve) => {
    const request = net.request({
      url: 'http://worldtimeapi.org/api/timezone/Etc/UTC',
      method: 'GET'
    });

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        resolve({ ok: true }); // Ignore if API fails
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk.toString();
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          const networkTime = new Date(json.utc_datetime).getTime();
          const localTime = Date.now();
          const driftMinutes = Math.abs(networkTime - localTime) / (1000 * 60);

          if (driftMinutes > 5) {
            resolve({
              ok: false,
              driftMinutes: Math.round(driftMinutes),
              networkTime: new Date(networkTime).toISOString(),
              localTime: new Date(localTime).toISOString()
            });
          } else {
            resolve({ ok: true });
          }
        } catch (_error) {
          resolve({ ok: true }); // Ignore parse errors
        }
      });
    });

    request.on('error', () => {
      resolve({ ok: true }); // Offline, trust local clock
    });

    request.end();
  });
}

function startNtpGuard(mainWindow) {
  setTimeout(async () => {
    const result = await verifySystemClock();
    if (!result.ok && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('security:clock-drift', result.driftMinutes);
    }
  }, 3000); // Check 3 seconds after boot
}

module.exports = { startNtpGuard, verifySystemClock };
