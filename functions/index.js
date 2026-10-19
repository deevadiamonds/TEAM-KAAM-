/**
 * Team Kaam — notification server (Cloud Functions, 2nd gen, asia-south1).
 * Sends a push notification (FCM) to the people involved in a task:
 *   - new task            → the person / every member of the group it was given to
 *   - task given to someone else (edit) → the new receiver(s)
 *   - task marked done    → the person who gave it
 *   - task reopened       → the receiver(s)
 *   - "Update" note       → everyone involved except the writer
 * Device tokens live in pushTokens/{token} = { who: memberId | 'owner', uid, platform, at }.
 */
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

setGlobalOptions({ region: 'asia-south1', maxInstances: 5, memory: '256MiB' });
admin.initializeApp();
const db = admin.firestore();

const APP_URL = 'https://deevadiamonds.github.io/TEAM-KAAM-/';
const DEAD_TOKEN = /registration-token-not-registered|invalid-registration-token|invalid-argument/;

const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function assigneesOf(t) {
  if (!t) return [];
  if (t.kind === 'group') {
    if (!t.groupId) return [];
    const g = await db.doc('groups/' + t.groupId).get();
    return g.exists ? (g.data().memberIds || []) : [];
  }
  return t.memberId ? [t.memberId] : [];
}

async function nameOf(id) {
  if (!id || id === 'owner') {
    const a = await db.doc('config/app').get();
    return (a.exists && a.data().ownerName) || 'Admin';
  }
  const m = await db.doc('team/' + id).get();
  return (m.exists && m.data().name) || 'Team';
}

async function tokensFor(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection('pushTokens').where('who', 'in', ids.slice(i, i + 30)).get();
    snap.forEach(d => out.push(d));
  }
  return out;
}

async function notify(ids, title, body, taskId) {
  ids = [...new Set((ids || []).filter(Boolean))];
  if (!ids.length) return;
  const docs = await tokensFor(ids);
  if (!docs.length) { logger.info('no device tokens', { ids }); return; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens: docs.map(d => d.id),
    notification: { title: short(title, 80), body: short(body, 240) },
    data: { taskId: taskId || '', url: APP_URL },
    android: { priority: 'high', notification: { channelId: 'tasks', icon: 'ic_stat', color: '#2343B3', sound: 'default' } },
    webpush: {
      headers: { Urgency: 'high' },
      notification: { icon: APP_URL + 'icons/icon-192.png', badge: APP_URL + 'icons/icon-192.png', lang: 'hi' },
      fcmOptions: { link: APP_URL }
    }
  });
  const dead = [];
  res.responses.forEach((r, i) => { if (!r.success && DEAD_TOKEN.test((r.error && r.error.code) || '')) dead.push(docs[i].ref.delete()); });
  await Promise.all(dead);
  logger.info('sent', { title, ok: res.successCount, failed: res.failureCount, removed: dead.length });
}

exports.taskCreated = onDocumentCreated('tasks/{taskId}', async (event) => {
  const t = event.data && event.data.data();
  if (!t) return;
  const by = t.createdBy || 'owner';
  const to = (await assigneesOf(t)).filter(id => id !== by);
  await notify(to, 'नया Task · ' + (await nameOf(by)) + ' से', t.title, event.params.taskId);
});

exports.taskUpdated = onDocumentUpdated('tasks/{taskId}', async (event) => {
  const b = event.data && event.data.before.data();
  const a = event.data && event.data.after.data();
  if (!a || !b) return;
  const id = event.params.taskId;
  const creator = a.createdBy || 'owner';
  const newLogs = Object.entries(a.log || {}).filter(([k]) => !(b.log || {})[k]).map(([, v]) => v);

  if (b.status !== 'done' && a.status === 'done') {
    if (a.doneBy !== creator) {
      await notify([creator], '✓ ' + (await nameOf(a.doneBy)) + ' ने पूरा किया', a.title + (a.doneNote ? ' — ' + a.doneNote : ''), id);
    }
    return;
  }
  if (b.status === 'done' && a.status !== 'done') {
    const e = newLogs.find(l => l.type === 'reopened');
    const by = e ? e.by : creator;
    await notify((await assigneesOf(a)).filter(x => x !== by), 'Task वापस खुला · ' + (await nameOf(by)), a.title + (e && e.text ? ' — ' + e.text : ''), id);
    return;
  }
  if (a.kind !== b.kind || a.memberId !== b.memberId || a.groupId !== b.groupId) {
    const before = new Set(await assigneesOf(b));
    const added = (await assigneesOf(a)).filter(x => !before.has(x) && x !== creator);
    if (added.length) await notify(added, 'नया Task · ' + (await nameOf(creator)) + ' से', a.title, id);
  }
  for (const n of newLogs.filter(l => l.type === 'note' && l.text)) {
    const involved = [creator, ...(await assigneesOf(a))].filter(x => x !== n.by);
    await notify(involved, 'Update · ' + (await nameOf(n.by)), short(a.title, 60) + ': ' + n.text, id);
  }
});
