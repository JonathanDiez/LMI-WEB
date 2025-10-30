const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// usamos fetch global (Node18) - runtime modern
const DISCORD_WEBHOOK = functions.config().discord && functions.config().discord.webhook;

exports.sendDiscordEmbed = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Use POST');
    const auth = req.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).send('No token provided');

    const idToken = auth.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // opcional: comprobar si uid es admin
    const isAdmin = await admin.firestore().doc(`admins/${uid}`).get().then(d => d.exists);
    if (!isAdmin) return res.status(403).send('Forbidden');

    const payload = req.body; // espera { memberName, actividad, items: [{nombre,qty,valor}], total, authorName }
    const embed = {
      embeds: [
        {
          title: `📝 Nuevo registro de loot — ${payload.memberName || '—'}`,
          fields: [
            { name: 'Actividad', value: payload.actividad || '—', inline: true },
            { name: 'Autor', value: payload.authorName || uid, inline: true },
            { name: 'Total', value: `${payload.total || 0}`, inline: true },
            { name: 'Items', value: payload.items && payload.items.length ? payload.items.map(i=>`${i.nombre} x${i.qty} (${i.valor})`).join('\n') : '—' }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };

    if (!DISCORD_WEBHOOK) {
      console.error('No webhook configured');
      return res.status(500).send('Discord webhook not configured');
    }

    const resp = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(embed)
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Discord error', text);
      return res.status(500).send('Discord error: ' + text);
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(500).send(String(err));
  }
});
