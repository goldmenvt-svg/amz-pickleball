export const config = {
  matcher: ['/admin.html', '/admin'],
};

export default function middleware(request) {
  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const base64 = authHeader.replace('Basic ', '');
    const decoded = atob(base64);
    const [user, pass] = decoded.split(':');

    // ⚠️ ĐỔI MẬT KHẨU NÀY TRƯỚC KHI DEPLOY
    // Username: amzadmin
    // Password: đổi thành mật khẩu mạnh của bạn
    if (user === 'amzadmin' && pass === 'Thu140708@') {
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
