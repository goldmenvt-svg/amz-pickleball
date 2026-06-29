export const config = {
  matcher: ['/admin.html', '/admin'],
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function middleware(request) {
  const authHeader = request.headers.get('authorization');

  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    let decoded;
    try { decoded = atob(base64); } catch { decoded = ''; }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx !== -1) {
      const user = decoded.slice(0, colonIdx);
      const pass = decoded.slice(colonIdx + 1);

      const expectedUser = process.env.ADMIN_USER || 'amzadmin';
      const expectedHash = process.env.ADMIN_PASSWORD_HASH;
      if (!expectedHash) return new Response('Server misconfigured', { status: 500 });

      const inputHash = await sha256Hex(pass);
      if (timingSafeEqual(user, expectedUser) && timingSafeEqual(inputHash, expectedHash)) {
        return;
      }
    }
  }

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="AMZ Admin Panel", charset="UTF-8"',
      'Content-Type': 'text/plain',
    },
  });
}
