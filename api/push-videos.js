// Vercel Serverless Function — chạy server-side, không lộ token ra client
// GitHub token lưu trong Vercel Environment Variables: GITHUB_TOKEN
// Admin panel gọi POST /api/push-videos với Firebase ID token để xác thực

const REPO      = 'goldmenvt-svg/amz-pickleball';
const FILE_PATH = 'data/videos.json';
const BRANCH    = 'master';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Xác thực Firebase ID token từ header Authorization
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.replace('Bearer ', '').trim();
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Firebase auth token' });
  }

  try {
    // Verify Firebase ID token bằng REST API (không cần Admin SDK)
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
    const verifyRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Invalid Firebase token' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Auth verification failed' });
  }

  // 2. Lấy GitHub token từ env (không bao giờ gửi ra client)
  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    return res.status(500).json({ error: 'GitHub token not configured on server' });
  }

  // 3. Nhận videoData từ body
  const { videoData } = req.body || {};
  if (!videoData) {
    return res.status(400).json({ error: 'Missing videoData in request body' });
  }

  try {
    // 4. Lấy SHA hiện tại của file
    const getRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github.v3+json' }, cache: 'no-store' }
    );
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const fileInfo = await getRes.json();

    // 5. Encode nội dung mới
    const content = Buffer.from(JSON.stringify(videoData, null, 2) + '\n').toString('base64');
    const today   = new Date().toISOString().substring(0, 10);

    // 6. Push lên GitHub
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
          sha: fileInfo.sha,
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
}
