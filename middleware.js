export const config = {
  matcher: ['/admin.html', '/admin'],
};

export default function middleware(request) {
  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const base64 = authHeader.replace('Basic ', '');
    const decoded = atob(base64);
    const [user, pass] = decoded.split(':');

    const expectedUser = process.env.ADMIN_USER || 'amzadmin';
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedPass) return new Response('Server misconfigured', { status: 500 });
    if (user === expectedUser && pass === expectedPass) {
      return; // pass through → Vercel phục vụ static file bình thường
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
