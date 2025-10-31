// process_registries.js
// Ejecutar en GH Actions con GOOGLE_SERVICE_ACCOUNT env var y DISCORD_WEBHOOK env var.

const admin = require('firebase-admin');
const fetch = require('node-fetch');

async function main(){
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) throw new Error('Env GOOGLE_SERVICE_ACCOUNT missing');
  if (!process.env.DISCORD_WEBHOOK) throw new Error('Env DISCORD_WEBHOOK missing');
  if (!process.env.FIREBASE_PROJECT_ID) throw new Error('Env FIREBASE_PROJECT_ID missing');

  // Parse service account JSON from secret
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  // Inicializar admin SDK
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: process.env.FIREBASE_PROJECT_ID
  });

  const db = admin.firestore();

  // Buscar registries no procesados
  const regsSnap = await db.collection('registries').where('processed', '==', false).limit(50).get();
  if (regsSnap.empty) {
    console.log('No registries to process.');
    return;
  }

  // Preload items & ranks & profiles for faster lookup
  const itemsSnap = await db.collection('items').get();
  const ranksSnap = await db.collection('ranks').get();
  const profilesSnap = await db.collection('profiles').get();

  const itemsMap = {};
  itemsSnap.forEach(d => itemsMap[d.id] = d.data());

  const ranksMap = {};
  ranksSnap.forEach(d => ranksMap[d.id] = d.data());

  const profilesMap = {};
  profilesSnap.forEach(d => profilesMap[d.id] = d.data());

  for (const doc of regsSnap.docs) {
    const reg = doc.data();
    try {
      // calculamos total y preparamos campos para embed
      let total = 0;
      const lines = reg.items.map(it => {
        const meta = itemsMap[it.itemId] || {};
        const rank = ranksMap[ profilesMap[reg.memberId]?.rankId ] || {};
        const pctRank = (profilesMap[reg.memberId]?.tiene500) ? (rank.pct500 || rank.pct || 0) : (rank.pct || 0);
        const pctItem = (typeof meta.pct === 'number') ? meta.pct : null;
        const effectivePct = (pctItem !== null) ? pctItem : pctRank || 1;
        const valorUnit = Math.round( (meta.valorBase || it.valorBase || 0) * effectivePct );
        const lineTotal = valorUnit * (it.qty || 1);
        total += lineTotal;
        return `• **${meta.nombre || it.nombre || it.itemId}** — x${it.qty || 1} — Unit: ${valorUnit} — Total: ${lineTotal}`;
      });

      // Compose embed payload (Discord webhook)
      const embed = {
        username: 'Inventario LM',
        embeds: [
          {
            title: `Registro: ${reg.memberName || reg.memberId}`,
            description: `Actividad: ${reg.actividad}\nAutor: ${reg.authorEmail || reg.authorId}`,
            color: 0x00c2a8,
            fields: [
              { name: 'Items', value: lines.join('\n') || '—', inline: false },
              { name: 'Total', value: `${total}`, inline: true }
            ],
            timestamp: (reg.createdAt && reg.createdAt.toDate) ? reg.createdAt.toDate().toISOString() : new Date().toISOString()
          }
        ]
      };

      // Send to Discord
      const res = await fetch(process.env.DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(embed)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error('Discord error: ' + res.status + ' ' + text);
      }

      // mark processed
      await doc.ref.update({ processed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log('Processed registry', doc.id);
    } catch (err) {
      console.error('Error processing registry', doc.id, err);
      // opcional: enviar mensaje a log channel o guardar error en el doc
      await doc.ref.update({ processedError: String(err), processedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }

  // cierre
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
