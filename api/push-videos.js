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
    const sha = getRes.ok ? (await getRes.json()).sha : undefined;

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
