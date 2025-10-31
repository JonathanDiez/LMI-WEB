// github-action/process_registries.js
import { Firestore } from '@google-cloud/firestore';

const discordWebhook = process.env.DISCORD_WEBHOOK;
const googleServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT;

if (!discordWebhook) {
  console.error('FATAL: DISCORD_WEBHOOK not defined in env (secrets).');
  process.exit(2);
}
if (!googleServiceAccount) {
  console.error('FATAL: GOOGLE_SERVICE_ACCOUNT not defined in env (secrets).');
  process.exit(2);
}

// Parse service account JSON (lo guardaste en secrets)
let sa;
try {
  sa = JSON.parse(googleServiceAccount);
} catch (err) {
  console.error('Error parsing GOOGLE_SERVICE_ACCOUNT JSON:', err);
  process.exit(2);
}

// Init Firestore client using credentials from secret
const projectId = sa.project_id || process.env.FIRESTORE_PROJECT;
const firestore = new Firestore({
  projectId,
  credentials: {
    client_email: sa.client_email,
    private_key: sa.private_key
  }
});

// Helper: small delay
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function sendDiscord(payload) {
  // Use global fetch since runner usa Node >= 18
  const res = await fetch(discordWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

function buildEmbedPayload(registry, computed) {
  // computed: {items: [{nombre, qty, valorUnit, subtotal}], total}
  const lines = computed.items.map(i => `• **${i.nombre}** — x${i.qty} — unit: ${i.valorUnit} — subtotal: ${i.subtotal}`);
  const description = [
    `**Miembro:** ${registry.memberName}`,
    `**Actividad:** ${registry.actividad}`,
    '',
    ...lines,
    '',
    `**Total:** ${computed.total}`
  ].join('\n');

  return {
    embeds: [
      {
        title: '📜 Nuevo registro de loot',
        description,
        color: 5814783,
        footer: { text: `Autor: ${registry.authorEmail || registry.authorId}` },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

async function computeRegistryTotals(registryDoc) {
  const data = registryDoc.data();
  const items = Array.isArray(data.items) ? data.items : [];
  // Load items metadata in batch
  const itemIds = Array.from(new Set(items.map(it => it.itemId).filter(Boolean)));
  const itemMetaMap = {};
  if (itemIds.length > 0) {
    const refs = itemIds.map(id => firestore.doc(`items/${id}`));
    const snaps = await Promise.all(refs.map(r => r.get()));
    snaps.forEach(s => {
      if (s.exists) itemMetaMap[s.id] = s.data();
    });
  }

  // Get rank pct if present in registry (we store only memberId/rank in profiles; but registry may not include rank)
  // We'll try to read profile to find rank and tiene500
  let pctRank = 1;
  if (data.memberId) {
    const profSnap = await firestore.doc(`profiles/${data.memberId}`).get();
    if (profSnap.exists) {
      const prof = profSnap.data();
      const rankId = prof.rankId;
      // try to get rank document:
      if (rankId) {
        const rankSnap = await firestore.doc(`ranks/${rankId}`).get();
        if (rankSnap.exists) {
          const rank = rankSnap.data();
          pctRank = prof.tiene500 ? (rank.pct500 ?? rank.pct ?? 1) : (rank.pct ?? 1);
        }
      }
    }
  }

  const computedItems = [];
  let total = 0;
  for (const it of items) {
    const meta = itemMetaMap[it.itemId] || {};
    const pctItem = (typeof meta.pct === 'number') ? meta.pct : null;
    const effectivePct = (pctItem !== null) ? pctItem : pctRank;
    const valorBase = Number(meta.valorBase || it.valorBase || 0);
    const valorUnit = Math.round(valorBase * (effectivePct || 1));
    const qty = Number(it.qty || 0);
    const subtotal = valorUnit * qty;
    computedItems.push({ nombre: meta.nombre || it.nombre || it.itemId, qty, valorUnit, subtotal, pctItem });
    total += subtotal;
  }

  return { items: computedItems, total };
}

async function processOnce() {
  const registriesRef = firestore.collection('registries');
  // Query unprocessed registries
  const q = registriesRef.where('processed', '==', false).orderBy('createdAt', 'asc').limit(20);
  const snap = await q.get();
  if (snap.empty) {
    console.log('No registries to process.');
    return;
  }
  console.log(`Found ${snap.size} registries to process.`);

  for (const doc of snap.docs) {
    const id = doc.id;
    const data = doc.data();
    console.log(`Processing registry ${id} (member: ${data.memberId || data.memberName})`);
    try {
      const computed = await computeRegistryTotals(doc);
      const payload = buildEmbedPayload(data, computed);

      // Send to Discord
      const res = await sendDiscord(payload);
      if (!res.ok) {
        console.error('Discord send failed', res.status, res.body);
        // don't mark as processed if Discord failed — optional: mark with error flag
        await doc.ref.update({ processedError: true, processedErrorText: `Discord error ${res.status}` });
        continue;
      }

      // Mark registry processed
      await doc.ref.update({
        processed: true,
        processedAt: Firestore.Timestamp ? Firestore.Timestamp.now() : new Date(),
        processedBy: 'github-action',
        discordResponse: res.body
      });

      console.log(`Registry ${id} processed and marked.`);
      // tiny delay to avoid rate limits
      await wait(300);
    } catch (err) {
      console.error(`Error processing registry ${id}:`, err);
      try {
        await doc.ref.update({ processedError: true, processedErrorText: String(err) });
      } catch (e) {
        console.error('Also failed to set processedError:', e);
      }
    }
  }
}

(async () => {
  try {
    console.log('Starting process_registries...');
    await processOnce();
    console.log('Done.');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
