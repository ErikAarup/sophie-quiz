// /qr — printable QR code pointing at this deployment's player page (WORK_ORDER §2.1).
import QRCode from 'qrcode';

const params = new URLSearchParams(location.search);
const target = params.get('u') || `${location.origin}/`;

const urlEl = document.getElementById('url');
const qrEl = document.getElementById('qr');
if (urlEl) urlEl.textContent = target.replace(/^https?:\/\//, '');

QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0a0b10', light: '#ffffff' } })
  .then((svg) => {
    if (qrEl) qrEl.innerHTML = svg;
  })
  .catch((err: unknown) => {
    if (qrEl) qrEl.textContent = `Kunde inte skapa QR-kod: ${err instanceof Error ? err.message : String(err)}`;
  });
