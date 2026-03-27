function isConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_FROM_NUMBER
  );
}

async function sendSmsTwilio(recipient, message) {
  if (!isConfigured()) {
    return {
      status: 'simulated',
      provider: 'twilio',
      providerMessageId: null,
      error: null
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const body = new URLSearchParams();
  body.set('To', recipient);
  body.set('From', from);
  body.set('Body', message);

  const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 'failed',
      provider: 'twilio',
      providerMessageId: null,
      error: json.message || `Twilio API error (${response.status})`,
      retriable: response.status >= 500 || response.status === 429
    };
  }

  return {
    status: 'sent',
    provider: 'twilio',
    providerMessageId: json.sid || null,
    error: null,
    retriable: false
  };
}

module.exports = {
  sendSmsTwilio,
  isSmsConfigured: isConfigured
};
