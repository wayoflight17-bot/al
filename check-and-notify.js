/**
 * scripts/check-and-notify.js
 *
 * Runs on a schedule via GitHub Actions (no server, no Cloud Functions, no Blaze plan needed).
 * Each run:
 *   1. Reads "lastCheckedAt" from a small Firestore document (so it remembers where it left off
 *      between runs — GitHub Actions itself keeps no memory between runs on its own).
 *   2. Looks for any season / test / study material created after that time, and any season
 *      whose winners were announced after that time.
 *   3. Sends a push notification (via the Web Push protocol, using your VAPID keys) to every
 *      subscribed user for anything it finds.
 *   4. Updates "lastCheckedAt" to now, so the same item is never notified twice.
 *
 * You do not need to understand or edit this file. Everything you need to configure lives in
 * GitHub repository Secrets (see SETUP.md) — this script reads those automatically.
 */

const admin = require('firebase-admin');
const webpush = require('web-push');

// ---- Load config from GitHub Actions secrets (set as environment variables by the workflow) ----
const APP_ID = process.env.APP_ID || 'way-of-light-v3';
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'admin@example.com';

if (!FIREBASE_SERVICE_ACCOUNT_JSON || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('Missing one or more required secrets. Check that FIREBASE_SERVICE_ACCOUNT_JSON, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY are all set in your repository Secrets.');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON))
});
const db = admin.firestore();

webpush.setVapidDetails(`mailto:${VAPID_CONTACT_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const base = () => db.collection('artifacts').doc(APP_ID).collection('public').doc('data');
const subscriptionsCol = () => base().collection('push_subscriptions');
const checkpointDoc = () => base().collection('notification_meta').doc('checkpoint');

async function getLastCheckedAt() {
    const snap = await checkpointDoc().get();
    if (snap.exists && snap.data().lastCheckedAt) return snap.data().lastCheckedAt;
    // First-ever run: don't notify for everything that already exists, just start the clock now.
    return Date.now();
}

async function setLastCheckedAt(ts) {
    await checkpointDoc().set({ lastCheckedAt: ts }, { merge: true });
}

async function getAllSubscriptions() {
    const snap = await subscriptionsCol().get();
    return snap.docs
        .map((d) => ({ ref: d.ref, ...d.data() }))
        .filter((s) => s.subscription && s.subscription.endpoint);
}

async function broadcast(subs, payload) {
    let sent = 0;
    const staleRefs = [];
    await Promise.all(subs.map(async (s) => {
        try {
            await webpush.sendNotification(s.subscription, JSON.stringify(payload));
            sent++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                staleRefs.push(s.ref);
            } else {
                console.warn(`Push failed for ${s.ref.id}:`, err.statusCode, err.body || err.message);
            }
        }
    }));
    if (staleRefs.length > 0) {
        const batch = db.batch();
        staleRefs.forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
    console.log(`  -> sent=${sent} removed-stale=${staleRefs.length}`);
}

async function main() {
    const lastCheckedAt = await getLastCheckedAt();
    const now = Date.now();
    console.log(`Checking for content created after ${new Date(lastCheckedAt).toISOString()}`);

    const subs = await getAllSubscriptions();
    console.log(`Found ${subs.length} subscribed device(s).`);
    if (subs.length === 0) {
        // No one to notify — still move the checkpoint forward so we don't re-scan old content
        // once someone eventually does subscribe.
        await setLastCheckedAt(now);
        console.log('No subscribers yet, nothing to send. Checkpoint updated.');
        return;
    }

    // --- New seasons ---
    const seasonsSnap = await base().collection('exam_seasons')
        .where('createdAt', '>', lastCheckedAt).get().catch(() => ({ empty: true, docs: [] }));
    for (const doc of seasonsSnap.docs || []) {
        const season = doc.data();
        console.log(`New season: ${season.name}`);
        await broadcast(subs, {
            title: '🏆 New Season Started!',
            body: `${season.name || 'A new season'} is live now. Jump in and start climbing the leaderboard!`,
            icon: 'logo.jpeg',
            tag: 'season',
            type: 'season',
            url: '#test'
        });
    }

    // --- New tests ---
    const quizzesSnap = await base().collection('exam_quizzes')
        .where('createdAt', '>', lastCheckedAt).get().catch(() => ({ empty: true, docs: [] }));
    for (const doc of quizzesSnap.docs || []) {
        const quiz = doc.data();
        console.log(`New test: ${quiz.title}`);
        await broadcast(subs, {
            title: '📝 New Test Available',
            body: `"${quiz.title || 'A new test'}" has been published. Good luck!`,
            icon: 'logo.jpeg',
            tag: 'test-' + doc.id,
            type: 'test',
            url: '#test'
        });
    }

    // --- New study material ---
    const materialSnap = await base().collection('study_content')
        .where('createdAt', '>', lastCheckedAt).get().catch(() => ({ empty: true, docs: [] }));
    for (const doc of materialSnap.docs || []) {
        const item = doc.data();
        console.log(`New study material: ${item.title}`);
        await broadcast(subs, {
            title: '📚 New Study Material',
            body: item.title ? `"${item.title}" was just posted.` : 'New study material was just posted.',
            icon: 'logo.jpeg',
            tag: 'material-' + doc.id,
            type: 'material',
            url: '#study'
        });
    }

    // --- Winner announcements ---
    // The admin panel sets `winner`, `updatedAt`, and `popupShownVersion` together in one write
    // when winners are announced (see admin's announceSeasonWinner function) — so this safely
    // detects a genuine new announcement, not just any edit to a season that happens to still
    // have winners from before. A season getting its name/dates edited after winners were
    // announced won't re-trigger this, since that kind of edit doesn't touch popupShownVersion.
    const updatedSeasonsSnap = await base().collection('exam_seasons')
        .where('updatedAt', '>', lastCheckedAt).get().catch(() => ({ empty: true, docs: [] }));
    for (const doc of updatedSeasonsSnap.docs || []) {
        const season = doc.data();
        if (!season.winner || !season.popupShownVersion) continue;
        console.log(`Winners announced: ${season.name}`);
        const first = season.winner.first;
        const body = first
            ? `${first.name} took 1st place in ${season.name || 'the season'}! See the full results.`
            : `Winners for ${season.name || 'the season'} have been announced!`;
        await broadcast(subs, {
            title: '🥇 Winners Announced!',
            body,
            icon: 'logo.jpeg',
            tag: 'winners-' + doc.id,
            type: 'winners',
            url: '#dashboard'
        });
    }

    await setLastCheckedAt(now);
    console.log('Done. Checkpoint updated to', new Date(now).toISOString());
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
