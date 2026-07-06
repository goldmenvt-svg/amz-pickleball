// Vercel Serverless Function — push events.json + players.json lên GitHub
// Gọi từ admin panel: POST /api/push-data
// Yêu cầu Firebase ID token trong header Authorization: Bearer <idToken>

const REPO   = 'goldmenvt-svg/amz-pickleball';
const BRANCH = 'master';

function isPositiveInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function isValidTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function isValidHttpsUrl(u) {
  return typeof u === 'string' && /^https:\/\/.+/.test(u);
}

function validatePricing(p) {
  const errors = [];
  if (!p || typeof p !== 'object') { errors.push('pricing data must be an object'); return errors; }

  const cp = (p.courtPricing && typeof p.courtPricing === 'object') ? p.courtPricing : {};
  ['weekday', 'weekend'].forEach(function (key) {
    const slot = cp[key];
    if (!slot || typeof slot !== 'object') { errors.push(key + ' is missing'); return; }
    if (!slot.label) errors.push(key + '.label is required');
    if (!isValidTime(slot.startTime)) errors.push(key + '.startTime must be HH:MM (00:00-23:59)');
    if (!isValidTime(slot.endTime)) errors.push(key + '.endTime must be HH:MM (00:00-23:59)');
    if (!isPositiveInt(slot.pricePerHour)) errors.push(key + '.pricePerHour must be a positive integer');
  });

  const social = p.socialPlan;
  if (!social || !social.name) errors.push('socialPlan.name is required');
  if (!social || !isPositiveInt(social.pricePerMonth)) errors.push('socialPlan.pricePerMonth must be a positive integer');

  const walkIn = p.walkInPass;
  if (!walkIn || !walkIn.name) errors.push('walkInPass.name is required');
  if (!walkIn || !isPositiveInt(walkIn.pricePerVisit)) errors.push('walkInPass.pricePerVisit must be a positive integer');

  const cta = (p.cta && typeof p.cta === 'object') ? p.cta : {};
  if (!cta.phone) errors.push('cta.phone is required');
  if (cta.facebook && !isValidHttpsUrl(cta.facebook)) errors.push('cta.facebook must be a https URL');
  if (cta.zalo && !isValidHttpsUrl(cta.zalo)) errors.push('cta.zalo must be a https URL or empty/null');

  return errors;
}

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

  const { eventsJSON, playersJSON, pricingJSON } = req.body || {};
  const hasPlayersEvents = !!(eventsJSON && playersJSON);
  if (!hasPlayersEvents && !pricingJSON) return res.status(400).json({ error: 'Missing data' });

  let pricingToWrite = null;
  if (pricingJSON) {
    let parsedPricing;
    try {
      parsedPricing = JSON.parse(pricingJSON);
    } catch {
      return res.status(400).json({ error: 'pricingJSON is not valid JSON' });
    }
    const pricingErrors = validatePricing(parsedPricing);
    if (pricingErrors.length) {
      return res.status(400).json({ error: 'Invalid pricing data: ' + pricingErrors.join('; ') });
    }
    parsedPricing.lastUpdated = new Date().toISOString();
    parsedPricing.cta.facebook = parsedPricing.cta.facebook || null;
    parsedPricing.cta.zalo = parsedPricing.cta.zalo || null;
    pricingToWrite = JSON.stringify(parsedPricing, null, 2);
  }

  const today = new Date().toISOString().substring(0, 10);
  try {
    if (hasPlayersEvents) {
      await pushFile(ghToken, 'data/events.json',  eventsJSON,  `chore: export events ${today}`);
      await pushFile(ghToken, 'data/players.json', playersJSON, `chore: export players ${today}`);
    }
    if (pricingToWrite) {
      await pushFile(ghToken, 'data/pricing.json', pricingToWrite, 'Update AMZ pricing data');
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[push-data] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
