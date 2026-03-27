function normalizeWhatsAppNumber(recipient) {
  return String(recipient || '').replace(/\D/g, '');
}

function isConfigured() {
  return Boolean(process.env.WHATSAPP_CLOUD_ACCESS_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID);
}

async function sendWhatsAppMessage(recipient, message) {
  if (!isConfigured()) {
    return {
      status: 'simulated',
      provider: 'whatsapp-cloud',
      providerMessageId: null,
      error: null
    };
  }

  const apiVersion = process.env.WHATSAPP_CLOUD_API_VERSION || 'v22.0';
  const token = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizeWhatsAppNumber(recipient),
      type: 'text',
      text: {
        body: message
      }
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 'failed',
      provider: 'whatsapp-cloud',
      providerMessageId: null,
      error: json.error?.message || `WhatsApp API error (${response.status})`,
      retriable: response.status >= 500 || response.status === 429
    };
  }

  return {
    status: 'sent',
    provider: 'whatsapp-cloud',
    providerMessageId: json.messages?.[0]?.id || null,
    error: null,
    retriable: false
  };
}

module.exports = {
  sendWhatsAppMessage,
  isWhatsAppConfigured: isConfigured
};
