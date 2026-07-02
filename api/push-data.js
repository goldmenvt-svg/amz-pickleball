// Vercel Serverless Function — push events.json + players.json lên GitHub
// Gọi từ admin panel: POST /api/push-data
// Yêu cầu Firebase ID token trong header Authorization: Bearer <idToken>

const REPO   = 'goldmenvt-svg/amz-pickleball';
const BRANCH = 'master';

async function pushFile(ghToken, filePath, content, commitMsg) {
  const getRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filePath}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github.v3+json' }, cache: 'no-store' }
  );
  const sha = getRes.ok ? (await getRes.json()).sha : undefined;
  const encoded = Buffer.from(content).toString('base64');
  const putRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: commitMsg, content: encoded, sha, branch: BRANCH }),
    }
  );
  if (!putRes.ok) throw new Error(`${filePath}: ${putRes.status}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Xác thực Firebase ID token
  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  // TD-02: verify token HỢP LỆ và đúng ADMIN (không chỉ verifyRes.ok)
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!adminEmail) return res.status(500).json({ error: 'ADMIN_EMAIL not set on server' });
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://amzpickleball.vn/' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const info = await verifyRes.json();
    const email = info?.users?.[0]?.email?.toLowerCase();
    if (email !== adminEmail) {
      console.warn('[push-data] Forbidden: non-admin token');
      return res.status(403).json({ error: 'Forbidden: not admin' });
    }
  } catch {
    return res.status(401).json({ error: 'Auth failed' });
  }

  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) return res.status(500).json({ error: 'GITHUB_TOKEN not set on server' });

  const { eventsJSON, playersJSON } = req.body || {};
  if (!eventsJSON || !playersJSON) return res.status(400).json({ error: 'Missing data' });

  const today = new Date().toISOString().substring(0, 10);
  try {
    await pushFile(ghToken, 'data/events.json',  eventsJSON,  `chore: export events ${today}`);
    await pushFile(ghToken, 'data/players.json', playersJSON, `chore: export players ${today}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[push-data] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
