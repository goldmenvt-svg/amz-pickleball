const REPO      = 'goldmenvt-svg/amz-pickleball';
const FILE_PATH = 'data/videos.json';
const BRANCH    = 'master';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.replace('Bearer ', '').trim();
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Firebase auth token' });
  }

  // TD-02: verify token HỢP LỆ và đúng ADMIN (không chỉ verifyRes.ok)
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!adminEmail) {
    return res.status(500).json({ error: 'ADMIN_EMAIL not set on server' });
  }
  try {
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
    const verifyRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://amzpickleball.vn/',
      },
      body: JSON.stringify({ idToken }),
    });
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Invalid Firebase token' });
    }
    const info = await verifyRes.json();
    const email = info?.users?.[0]?.email?.toLowerCase();
    if (email !== adminEmail) {
      console.warn('[push-videos] Forbidden: non-admin token');
      return res.status(403).json({ error: 'Forbidden: not admin' });
    }
  } catch {
    return res.status(401).json({ error: 'Auth verification failed' });
  }

  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    return res.status(500).json({ error: 'GitHub token not configured on server' });
  }

  const { videoData } = req.body || {};
  if (!videoData) {
    return res.status(400).json({ error: 'Missing videoData in request body' });
  }

  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github.v3+json' }, cache: 'no-store' }
    );
    if (!getRes.ok) {
      return res.status(500).json({ error: 'Không đọc được dữ liệu hiện tại trên GitHub để kiểm tra xung đột — vui lòng thử lại.' });
    }
    const current = await getRes.json();
    const sha = current.sha;

    // TD-10: chống ghi đè âm thầm. lastScan chỉ bị cron (sync-youtube/video-discover)
    // thay đổi — admin approve/reject không đụng tới field này. Nếu lastScan hiện tại
    // trên GitHub khác với lastScan mà client đang giữ (baseline lúc admin tải dữ liệu),
    // nghĩa là cron đã ghi thêm/duyệt video sau khi admin tải — từ chối ghi đè.
    let currentContent;
    try {
      currentContent = JSON.parse(Buffer.from(current.content, 'base64').toString('utf-8'));
    } catch {
      return res.status(500).json({ error: 'Không đọc được dữ liệu hiện tại trên GitHub để kiểm tra xung đột — vui lòng thử lại.' });
    }
    if (currentContent.lastScan !== videoData.lastScan) {
      return res.status(409).json({
        error: 'Dữ liệu video đã thay đổi trên GitHub (có thể do đồng bộ tự động). Vui lòng tải lại trang rồi duyệt lại.',
      });
    }

    const content = Buffer.from(JSON.stringify(videoData, null, 2) + '\n').toString('base64');
    const today   = new Date().toISOString().substring(0, 10);

    const putRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `chore: update video approvals ${today}`,
          content,
          sha,
          branch: BRANCH,
        }),
      }
    );
    if (!putRes.ok) {
      const err = await putRes.text();
      throw new Error(`GitHub PUT failed: ${putRes.status} ${err.substring(0, 100)}`);
    }

    return res.status(200).json({ ok: true, message: 'Pushed to GitHub successfully' });
  } catch (err) {
    console.error('[push-videos] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
