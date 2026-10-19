/* Sends a test notification to registered devices and lists who has notifications set up.
   Runs in GitHub Actions (workflow "Test notification") with the FIREBASE_SERVICE_ACCOUNT key.
   TARGET = 'owner' (Admin), a member's name, or 'all'. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'task-management-5b21b' });
const db = admin.firestore();
const APP_URL = 'https://deevadiamonds.github.io/TEAM-KAAM-/';

(async () => {
  const [toks, team] = await Promise.all([db.collection('pushTokens').get(), db.collection('team').get()]);
  const names = { owner: 'Admin' };
  team.forEach(d => { names[d.id] = d.data().name; });
  const byWho = {};
  toks.forEach(d => { const v = d.data(); (byWho[v.who] = byWho[v.who] || []).push(v.platform || '?'); });
  const summary = Object.entries(byWho).map(([w, l]) => `${names[w] || w}: ${l.join(', ')}`).join(' | ');
  console.log('::notice title=Devices with notifications on::' + (summary || 'none yet'));

  const target = (process.env.TARGET || 'owner').trim();
  const who = target === 'all' || target === 'owner' ? target
    : (Object.entries(names).find(([, n]) => String(n).toLowerCase() === target.toLowerCase()) || [])[0];
  const docs = toks.docs.filter(d => target === 'all' || d.data().who === who);
  if (!docs.length) { console.log(`::warning title=Test notification::No device registered for "${target}" yet`); return; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens: docs.map(d => d.id),
    notification: { title: 'Team Kaam · Test', body: 'Notification सही काम कर रहे हैं ✓' },
    android: { priority: 'high', notification: { channelId: 'tasks', icon: 'ic_stat', color: '#2343B3', sound: 'default' } },
    webpush: { headers: { Urgency: 'high' }, notification: { icon: APP_URL + 'icons/icon-192.png' }, fcmOptions: { link: APP_URL } }
  });
  const errs = res.responses.filter(r => !r.success).map(r => r.error && r.error.code).join(', ');
  console.log(`::notice title=Test notification::sent ${res.successCount}, failed ${res.failureCount}${errs ? ' (' + errs + ')' : ''}`);
})().catch(e => { console.log('::error title=Test notification::' + e.message); process.exit(1); });
