// js/app.js
import { FIREBASE_CONFIG } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  getIdToken
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/* --------------------------
   CONFIG
   Pon aquí tu Worker URL
   -------------------------- */
const WORKER_URL = "https://flat-scene-48ab.ggoldenhhands.workers.dev/";

/* --------------------------
   Inicializar Firebase
   -------------------------- */
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

/* Exponer cosas útiles para usar desde la consola (temporal) */
window.auth = auth;
window.db = db;
window.serverTimestamp = serverTimestamp;
window.doc = doc;
window.getDoc = getDoc;
window.setDoc = setDoc;
window.addDoc = addDoc;
window.updateDoc = updateDoc;
window.deleteDoc = deleteDoc;
window.getDocs = getDocs;
window.query = query;
window.where = where;
window.collection = collection;
console.log('[DEVTOOLS] window.auth/window.db y helpers expuestos');

/* --------------------------
   ELEMENTOS UI
   -------------------------- */
const seccionLogin = document.getElementById('seccion-login');
const seccionDashboard = document.getElementById('seccion-dashboard');
const btnEntrar = document.getElementById('btn-entrar');
const btnLogout = document.getElementById('btn-logout');
const btnLogoutSidebar = document.getElementById('btn-logout-sidebar');
const userBadge = document.getElementById('user-badge');
const userNombreEl = document.getElementById('user-nombre');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');

const contenedorItems = document.getElementById('contenedor-items');
const buscarMiembroInput = document.getElementById('buscar-miembro');
const sugerenciasMiembro = document.getElementById('sugerencias-miembro');

const gridInventariosEl = document.getElementById('grid-inventarios');

/* --------------------------
   TOAST (pequeño)
   -------------------------- */
function toast(msg, type='info', timeout=3000) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.style.opacity = '0', timeout - 400);
  setTimeout(() => el.remove(), timeout);
}

/* --------------------------
   Estado local
   -------------------------- */
let ranks = {};
let catalogo = [];
let membersLocal = [];
let inventoriesLocal = {};

// --------------------------
// Unsubscribe helpers para realtime
// --------------------------
let unsubscribeFns = [];
let isWatching = false;

function addUnsub(fn) {
  if (typeof fn === 'function') unsubscribeFns.push(fn);
}

function unsubscribeAll() {
  try {
    unsubscribeFns.forEach(f => {
      try { f(); } catch (e) { /* ignore */ }
    });
  } finally {
    unsubscribeFns = [];
    isWatching = false;
    console.log('[DEBUG] Unsubscribed all realtime listeners');
  }
}

/* --------------------------
   NAV sencillo
   -------------------------- */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view)?.classList.add('active');
  });
});

/* --------------------------
   LOGIN / LOGOUT
   -------------------------- */
btnEntrar.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const pass = passInput.value.trim();
  if (!email || !pass) return toast('Rellena email y contraseña', 'error');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    toast('Sesión iniciada');
  } catch (err) {
    console.error(err);
    toast('Error login: ' + (err.message || err), 'error');
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    unsubscribeAll();
    await new Promise(r => setTimeout(r, 200));
    await signOut(auth);
    toast('Sesión cerrada');
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
    toast('Error cerrando sesión: ' + (err.message || err), 'error');
  }
});

btnLogoutSidebar.addEventListener('click', async () => {
  try {
    unsubscribeAll();
    await new Promise(r => setTimeout(r, 200));
    await signOut(auth);
    toast('Sesión cerrada');
  } catch (err) {
    console.error('Error al cerrar sesión (sidebar):', err);
    toast('Error cerrando sesión: ' + (err.message || err), 'error');
  }
});

/* --------------------------
   onAuthStateChanged
   -------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const adminDoc = await getDoc(doc(db, 'admins', user.uid));
      const isAdmin = adminDoc.exists();
      if (!isAdmin) {
        toast('No eres admin. Acceso restringido', 'error');
        unsubscribeAll();
        await signOut(auth);
        return;
      }
      seccionLogin.style.display = 'none';
      seccionDashboard.style.display = 'flex';
      userBadge.style.display = 'flex';
      userNombreEl.textContent = user.email;
      await cargarDatosIniciales();
      watchCollectionsRealtime();
    } catch (err) {
      console.error('Error en onAuthStateChanged:', err);
      toast('Error comprobando usuario: ' + (err.message || err), 'error');
    }
  } else {
    unsubscribeAll();
    seccionLogin.style.display = 'block';
    seccionDashboard.style.display = 'none';
    userBadge.style.display = 'none';
  }
});

/* --------------------------
   CARGAR DATOS INICIALES (once)
   -------------------------- */
async function cargarDatosIniciales() {
  const ranksSnap = await getDocs(collection(db, 'ranks'));
  ranks = {};
  ranksSnap.forEach(d => ranks[d.id] = d.data());

  const itemsSnap = await getDocs(collection(db, 'items'));
  catalogo = [];
  itemsSnap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));

  const profilesSnap = await getDocs(collection(db, 'profiles'));
  membersLocal = [];
  profilesSnap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));

  inventoriesLocal = {};

  renderSelectRangos();
  renderCatalogo();
  renderMiembros();
  contenedorItems.innerHTML = '';
  addItemRow();
  document.getElementById('grid-inventarios').innerHTML = '<p class="sub">Escribe un nombre de usuario o objeto para buscar</p>';
}

/* --------------------------
   Realtime watchers
   -------------------------- */
function watchCollectionsRealtime() {
  if (isWatching) {
    console.log('[DEBUG] watchCollectionsRealtime: ya activo');
    return;
  }
  if (!auth.currentUser) {
    console.warn('[DEBUG] watchCollectionsRealtime: no hay user, no iniciar listeners');
    return;
  }

  isWatching = true;
  unsubscribeAll();

  const add = (fn) => addUnsub(fn);

  try {
    const unsubItems = onSnapshot(collection(db, 'items'),
      (snap) => {
        catalogo = [];
        snap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));
        renderCatalogo();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) {
          console.warn('[realtime] items onSnapshot ignored permission-denied after signOut');
          return;
        }
        console.error('[realtime] items onSnapshot error:', err);
        toast('Error realtime (items): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    add(unsubItems);

    const unsubRanks = onSnapshot(collection(db, 'ranks'),
      (snap) => {
        ranks = {};
        snap.forEach(d => ranks[d.id] = d.data());
        renderSelectRangos();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) {
          console.warn('[realtime] ranks onSnapshot ignored permission-denied after signOut');
          return;
        }
        console.error('[realtime] ranks onSnapshot error:', err);
        toast('Error realtime (ranks): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    add(unsubRanks);

    const unsubProfiles = onSnapshot(collection(db, 'profiles'),
      (snap) => {
        membersLocal = [];
        snap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));
        renderMiembros();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) {
          console.warn('[realtime] profiles onSnapshot ignored permission-denied after signOut');
          return;
        }
        console.error('[realtime] profiles onSnapshot error:', err);
        toast('Error realtime (profiles): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    add(unsubProfiles);

    const unsubInventories = onSnapshot(collection(db, 'inventories'),
      (snap) => {
        inventoriesLocal = {};
        snap.forEach(d => {
          const data = d.data();
          if (!inventoriesLocal[data.userId]) inventoriesLocal[data.userId] = [];
          inventoriesLocal[data.userId].push({ id: d.id, ...data });
        });
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) {
          console.warn('[realtime] inventories onSnapshot ignored permission-denied after signOut');
          return;
        }
        console.error('[realtime] inventories onSnapshot error:', err);
        toast('Error realtime (inventories): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    add(unsubInventories);

    console.log('[DEBUG] watchCollectionsRealtime: listeners attached');
  } catch (err) {
    console.error('watchCollectionsRealtime error:', err);
    toast('Error iniciando realtime: ' + (err.message || err), 'error', 6000);
    isWatching = false;
  }
}

/* --------------------------
   UI: addItemRow
   -------------------------- */
function addItemRow() {
  const row = document.createElement('div');
  row.className = 'item-row';

  const optionsHtml = catalogo.length > 0
    ? catalogo.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)} (${Number(c.valorBase||0)})</option>`).join('')
    : `<option value="" disabled>— No hay items en catálogo —</option>`;

  row.innerHTML = `
    <select class="sel-item">
      ${optionsHtml}
    </select>
    <input class="qty-item" type="number" min="1" value="1" />
    <button class="btn-delete btn-remove-item" type="button">🗑️</button>
  `;
  contenedorItems.appendChild(row);
  row.querySelector('.btn-remove-item').onclick = () => row.remove();
}
document.getElementById('btn-add-item').addEventListener('click', () => addItemRow());

/* --------------------------
   Submit formulario - crear registry + actualizar inventarios + enviar Worker
   -------------------------- */
document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const memberName = buscarMiembroInput.value.trim();
  const member = membersLocal.find(m => (m.displayName === memberName) || (m.username === memberName));
  if (!member) return toast('Selecciona un miembro válido', 'error');

  const filas = Array.from(contenedorItems.querySelectorAll('.item-row'));
  if (filas.length === 0) return toast('Añade al menos un objeto', 'error');

  const actividad = document.getElementById('actividad').value;
  if (!actividad) return toast('Selecciona la actividad', 'error');

  const items = filas.map(r => {
    const id = r.querySelector('.sel-item').value;
    const qty = Number(r.querySelector('.qty-item').value) || 0;
    const item = catalogo.find(c => c.id === id) || {};
    return {
      itemId: id,
      nombre: item.nombre || id,
      qty,
      valorBase: item.valorBase || 0,
      pct: (typeof item.pct === 'number') ? item.pct : null
    };
  });

  try {
    // 1) crear registry en Firestore (processed:false)
    const registryRef = await addDoc(collection(db, 'registries'), {
      authorId: auth.currentUser.uid,
      authorEmail: auth.currentUser.email,
      memberId: member.id,
      memberName: member.displayName || member.username || member.id,
      actividad,
      items,
      createdAt: serverTimestamp(),
      processed: false
    });

    // 2) actualizar inventarios (upsert)
    for (const it of items) {
      const q = query(collection(db, 'inventories'), where('userId', '==', member.id), where('itemId', '==', it.itemId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const existingDoc = snap.docs[0];
        const newQty = (existingDoc.data().qty || 0) + it.qty;
        await updateDoc(existingDoc.ref, { qty: newQty, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'inventories'), {
          userId: member.id,
          itemId: it.itemId,
          qty: it.qty,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }

    // 3) preparar resumen del loot (cliente) y calcular total según prioridad pctItem ?? pctRank
    const rango = ranks[member.rankId] || {};
    const pctRank = member.tiene500 ? (rango.pct500 || rango.pct || 0) : (rango.pct || 0);

    let totalValor = 0;
    const lootParts = [];
    for (const it of items) {
      const pctItem = (typeof it.pct === 'number') ? it.pct : null;
      const effectivePct = (pctItem !== null) ? pctItem : pctRank;
      const valorUnit = Math.round((it.valorBase || 0) * (effectivePct || 1));
      totalValor += valorUnit * (it.qty || 0);
      lootParts.push(`${it.nombre} x${it.qty}`);
    }
    const lootSummary = lootParts.join(', ');

    // 4) enviar al Worker (instantáneo)
    try {
      let authorName = auth.currentUser.email || auth.currentUser.uid;
      try {
        const admSnap = await getDoc(doc(db, 'admins', auth.currentUser.uid));
        if (admSnap.exists() && admSnap.data().displayName) {
          authorName = admSnap.data().displayName;
        }
      } catch (e) { /* ignore */ }

      const idToken = await getIdToken(auth.currentUser, true);
      const payload = {
        registryId: registryRef.id,
        authorId: auth.currentUser.uid,
        authorEmail: auth.currentUser.email,
        authorName,
        memberId: member.id,
        memberName: member.displayName || member.username || member.id,
        actividad,
        items,
        lootSummary,
        totalValor,
        createdAt: new Date().toISOString()
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error('Worker error:', resp.status, text);
        toast('Worker error: ' + (resp.statusText || resp.status) + (text ? ' — ' + text : ''), 'error', 6000);
      } else {
        await updateDoc(registryRef, { processed: true, processedAt: serverTimestamp() });
        toast('Registro guardado y enviado a Discord (instantáneo).');
      }
    } catch (err) {
      console.error('Error enviando al worker:', err);
      toast('Error enviando a Discord: ' + (err.message || err), 'error', 6000);
    }

    // limpiar
    contenedorItems.innerHTML = '';
    addItemRow();
    buscarMiembroInput.value = '';
    document.getElementById('actividad').value = '';

  } catch (err) {
    console.error(err);
    toast('Error guardando registro: ' + (err.message || err), 'error');
  }
});

/* --------------------------
   RENDERS: select rangos, catalogo, miembros
   -------------------------- */
function renderSelectRangos() {
  const select = document.getElementById('mi-rango');
  if (!select) return;
  select.innerHTML = '<option value="">-- Selecciona un rango --</option>' +
    Object.keys(ranks).map(k => `<option value="${k}">${escapeHtml(k)}</option>`).join('');
}

function renderCatalogo() {
  const lista = document.getElementById('lista-catalogo');
  if (!lista) return;
  lista.innerHTML = '';
  catalogo.forEach(c => {
    const el = document.createElement('div');
    el.className = 'catalogo-item';

    const pctLabel = (typeof c.pct === 'number') ? ` • Item pct: ${Math.round(c.pct * 100)}%` : '';
    const pagableLabel = (c.pagable === false) ? '• No pagable' : '';

    el.innerHTML = `
      <div>
        <strong>${escapeHtml(c.nombre)}</strong>
        <div class="small">Valor: ${Number(c.valorBase || 0)} ${pagableLabel}${pctLabel}</div>
      </div>
      <button class="btn-delete" data-id="${c.id}">🗑️</button>
    `;

    el.querySelector('.btn-delete').onclick = async () => {
      if (!confirm('¿Borrar objeto del catálogo?')) return;
      try {
        await deleteDoc(doc(db, 'items', c.id));
        toast('Objeto eliminado');
      } catch (err) {
        console.error('Error borrando item:', err);
        toast('Error borrando item: ' + (err.message || err), 'error');
      }
    };
    lista.appendChild(el);
  });
}

function renderMiembros() {
  const grid = document.getElementById('grid-miembros');
  if (!grid) return;
  grid.innerHTML = '';
  membersLocal.forEach(m => {
    const el = document.createElement('div');
    el.className = 'miembro-card';
    el.innerHTML = `
      <div class="miembro-info">
        <strong>${escapeHtml(m.displayName || m.username || m.id)}</strong>
        <div class="small">Rango: ${escapeHtml(m.rankId || '—')}</div>
        ${m.tiene500 ? '<span class="small" style="color: var(--success)">✅ 500 aportaciones</span>' : ''}
      </div>
      <button class="btn-delete" data-id="${m.id}">🗑️</button>
    `;
    el.onclick = (e) => {
      if (!e.target.classList.contains('btn-delete')) {
        mostrarInventarioMiembro(m);
      }
    };
    el.querySelector('.btn-delete').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar miembro ' + (m.displayName || m.username) + '?')) return;
      try {
        await deleteDoc(doc(db, 'profiles', m.id));
        toast('Miembro eliminado');
      } catch (err) {
        console.error('Error eliminando miembro:', err);
        toast('Error eliminando miembro: ' + (err.message || err), 'error');
      }
    };
    grid.appendChild(el);
  });
}

/* --------------------------
   SUGERENCIAS MIEMBRO
   -------------------------- */
buscarMiembroInput.addEventListener('input', () => {
  const q = buscarMiembroInput.value.trim().toLowerCase();
  sugerenciasMiembro.innerHTML = '';
  if (!q) {
    sugerenciasMiembro.classList.remove('active');
    return;
  }
  const matches = membersLocal.filter(m => ((m.displayName || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q))).slice(0, 8);
  if (matches.length > 0) {
    sugerenciasMiembro.classList.add('active');
    matches.forEach(m => {
      const div = document.createElement('div');
      div.textContent = m.displayName || m.username;
      div.onclick = () => {
        buscarMiembroInput.value = m.displayName || m.username;
        buscarMiembroInput.dataset.id = m.id;
        sugerenciasMiembro.classList.remove('active');
        sugerenciasMiembro.innerHTML = '';
      };
      sugerenciasMiembro.appendChild(div);
    });
  } else {
    sugerenciasMiembro.classList.remove('active');
  }
});

document.addEventListener('click', (e) => {
  if (!buscarMiembroInput.contains(e.target) && !sugerenciasMiembro.contains(e.target)) {
    sugerenciasMiembro.classList.remove('active');
  }
});

/* --------------------------
   MODAL INVENTARIO (mostrar + decrementar 1 sin confirm)
   -------------------------- */
const modal = document.getElementById('modal-inventario');
const modalClose = document.getElementById('modal-close');
modalClose.onclick = () => modal.classList.remove('active');
modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };

async function mostrarInventarioMiembro(miembro) {
  const q = query(collection(db, 'inventories'), where('userId', '==', miembro.id));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));

  const rango = ranks[miembro.rankId] || {};
  const pctRank = miembro.tiene500 ? (rango.pct500 || rango.pct || 0) : (rango.pct || 0);

  const totalObjetos = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  let totalValor = 0;
  const body = document.getElementById('modal-body');

  if (items.length === 0) {
    body.innerHTML = '<p class="sub">Este miembro no tiene objetos en su inventario</p>';
  } else {
    let html = `<div style="display:flex;justify-content:space-between;margin-bottom:1rem;">
      <h4>Objetos en inventario: ${totalObjetos}</h4>
      <button class="btn-delete" id="clear-inventory">Vaciar inventario</button>
    </div><div class="inventario-items">`;

    for (const it of items) {
      const itemMeta = catalogo.find(ci => ci.id === it.itemId) || {};
      const pctItem = (itemMeta && (typeof itemMeta.pct === 'number')) ? itemMeta.pct : null;
      const effectivePct = (pctItem !== null) ? pctItem : pctRank;
      const valorUnit = Math.round((itemMeta.valorBase || 0) * (effectivePct || 1));
      totalValor += valorUnit * (it.qty || 0);

      html += `<div class="item-card" data-inv-id="${it.id}">
        <button class="btn-delete btn-decrement" data-id="${it.id}" title="Quitar 1">🗑️</button>
        <div class="item-image">📦</div>
        <strong>${escapeHtml(itemMeta.nombre || it.itemId)}</strong>
        <div class="small">Cantidad: <span class="item-qty" data-id="${it.id}">${it.qty}</span></div>
        <div class="small">Valor unit.: ${valorUnit}${ (pctItem !== null) ? ` • pct item: ${Math.round(pctItem*100)}%` : ` • pct rango: ${Math.round((pctRank||0)*100)}%` }</div>
        <div style="color: var(--accent); font-weight: 600; margin-top: 0.5rem;">
          ${valorUnit * it.qty}
        </div>
      </div>`;
    }

    html += `</div>`;
    body.innerHTML = html;

    body.querySelectorAll('.btn-decrement').forEach(btn => {
      btn.onclick = async (e) => {
        const invId = btn.dataset.id;
        try {
          const invRef = doc(db, 'inventories', invId);
          const invSnap = await getDoc(invRef);
          if (!invSnap.exists()) {
            mostrarInventarioMiembro(miembro);
            return;
          }
          const currentQty = Number(invSnap.data().qty || 0);
          const newQty = currentQty - 1;
          if (newQty > 0) {
            await updateDoc(invRef, { qty: newQty, updatedAt: serverTimestamp() });
          } else {
            await deleteDoc(invRef);
          }
          mostrarInventarioMiembro(miembro);
        } catch (err) {
          console.error('Error decrementando inventory:', err);
          toast('Error al quitar 1 unidad: ' + (err.message || err), 'error', 4000);
        }
      };
    });

    const clearBtn = document.getElementById('clear-inventory');
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (!confirm('¿Vaciar todo el inventario de ' + (miembro.displayName || miembro.username) + '?')) return;
        const snapClear = await getDocs(query(collection(db, 'inventories'), where('userId', '==', miembro.id)));
        for (const d of snapClear.docs) await deleteDoc(d.ref);
        toast('Inventario vaciado');
        mostrarInventarioMiembro(miembro);
      };
    }
  }

  document.getElementById('modal-titulo').textContent = miembro.displayName || miembro.username || miembro.id;
  document.getElementById('modal-subtitulo').innerHTML = `Rango: ${miembro.rankId || '—'} • Porcentaje rango: ${Math.round((pctRank || 0) * 100)}% • <strong>Total: ${Math.round(totalValor)}</strong>`;
  modal.classList.add('active');
}

/* --------------------------
   Crear miembro / crear item
   -------------------------- */
document.getElementById('btn-crear-miembro').addEventListener('click', async () => {
  const nombre = document.getElementById('mi-nombre').value.trim();
  if (!nombre) return toast('Nombre obligatorio', 'error');
  const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  const rango = document.getElementById('mi-rango').value;
  const tiene500 = document.getElementById('mi-500').checked;
  try {
    await setDoc(doc(db, 'profiles', id), { displayName: nombre, username: id, rankId: rango, tiene500 });
    toast('Miembro creado: ' + nombre);
    document.getElementById('mi-nombre').value = '';
  } catch (err) {
    console.error('Error creando miembro:', err);
    toast('Error creando miembro: ' + (err.message || err), 'error');
  }
});

document.getElementById('btn-crear-catalogo').addEventListener('click', async () => {
  const nombre = document.getElementById('cat-nombre').value.trim();
  const valor = Number(document.getElementById('cat-valor').value) || 0;
  const pagable = document.getElementById('cat-pagable').checked;
  const pctInput = document.getElementById('cat-pct') ? document.getElementById('cat-pct').value.trim() : '';
  let pct = null;
  if (pctInput !== '') {
    const n = Number(pctInput);
    if (isNaN(n) || n < 0 || n > 100) return toast('Porcentaje inválido (0-100)', 'error');
    pct = n / 100;
  }
  if (!nombre || valor <= 0) return toast('Nombre y valor válidos requeridos', 'error');
  const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  try {
    await setDoc(doc(db, 'items', id), { nombre, valorBase: valor, pagable, pct });
    toast('Objeto agregado al catálogo');
    document.getElementById('cat-nombre').value = '';
    document.getElementById('cat-valor').value = '';
    if (document.getElementById('cat-pct')) document.getElementById('cat-pct').value = '';
    document.getElementById('cat-pagable').checked = true;
  } catch (err) {
    console.error('Error creando item:', err);
    toast('Error creando item: ' + (err.message || err), 'error');
  }
});

/* --------------------------
   Buscador inventarios
   -------------------------- */
document.getElementById('buscador-inventario').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const grid = document.getElementById('grid-inventarios');
  grid.innerHTML = '';

  if (!q) {
    grid.innerHTML = '<p class="sub">Escribe un nombre de usuario o objeto para buscar</p>';
    return;
  }

  const miembroMatch = membersLocal.filter(m => (m.displayName || '').toLowerCase().includes(q));
  const objetoMatch = catalogo.filter(c => c.nombre.toLowerCase().includes(q));

  if (miembroMatch.length > 0) {
    miembroMatch.forEach(m => {
      const items = inventoriesLocal[m.id] || [];
      const card = document.createElement('div');
      card.className = 'inventario-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <h4>${escapeHtml(m.displayName || m.username)}</h4>
        <p class="small">Rango: ${escapeHtml(m.rankId || '—')}</p>
        <p class="small" style="margin-top: 0.5rem;">Objetos: ${items.length}</p>
      `;
      card.onclick = () => mostrarInventarioMiembro(m);
      grid.appendChild(card);
    });
  }

  if (objetoMatch.length > 0) {
    objetoMatch.forEach(obj => {
      const poseedores = membersLocal.filter(m => {
        const inv = inventoriesLocal[m.id] || [];
        return inv.some(i => i.itemId === obj.id);
      });

      if (poseedores.length > 0) {
        const card = document.createElement('div');
        card.className = 'inventario-card';
        card.innerHTML = `
          <h4>📦 ${escapeHtml(obj.nombre)}</h4>
          <p class="small">Este objeto lo tienen:</p>
          <div style="margin-top: 0.75rem;">
            ${poseedores.map(m => `<div class="small" style="margin-top: 0.25rem;">• ${escapeHtml(m.displayName || m.username)}</div>`).join('')}
          </div>
        `;
        grid.appendChild(card);
      }
    });
  }

  if (grid.innerHTML === '') {
    grid.innerHTML = '<p class="sub">No se encontraron resultados</p>';
  }
});

/* --------------------------
   UTIL: escapeHtml
   -------------------------- */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", "&#039;");
}

/* --------------------------
   Seed demo incrustada (ejecuta seedDemo({force:true}) desde consola)
   -------------------------- */
async function seedDemo(opts = { force: true }) {
  if (!auth || !auth.currentUser) {
    alert('Loguéate como admin primero');
    return;
  }
  const force = !!(opts && opts.force);
  if (!confirm(`Crear datos demo (ranks, items con pct, perfiles, inventories)?\nForce overwrite: ${force}`)) return;

  try {
    const uid = auth.currentUser.uid;
    const email = auth.currentUser.email || '';

    // crear admins/{uid} si no existe (opcional)
    const admRef = doc(db, 'admins', uid);
    const admSnap = await getDoc(admRef);
    if (!admSnap.exists()) {
      if (confirm('No existe admins/' + uid + '. ¿Crear admin para ' + email + ' (solo para pruebas)?')) {
        await setDoc(admRef, { email, createdAt: serverTimestamp() });
        console.log('admins/' + uid + ' creado.');
      } else {
        console.warn('No se creó admins/{uid}');
      }
    }

    const demoRanks = {
      'Peón': { nivel: 1, pct: 0.10, pct500: 0.20 },
      'Sangre Nueva': { nivel: 2, pct: 0.20, pct500: 0.30 },
      'Delta': { nivel: 3, pct: 0.35, pct500: 0.45 },
      'Sombra Roja': { nivel: 4, pct: 0.35, pct500: 0.45 },
      'Legión': { nivel: 5, pct: 0.50, pct500: 0.60 },
      'Torre': { nivel: 6, pct: 0.65, pct500: 0.75 },
      'Alpha': { nivel: 7, pct: 0.65, pct500: 0.75 },
      'Sangre Real': { nivel: 8, pct: 0.75, pct500: 0.85 },
      'Corona de Sangre': { nivel: 9, pct: 0.75, pct500: 0.85 }
    };

    for (const k of Object.keys(demoRanks)) {
      const ref = doc(db, 'ranks', k);
      if (!force) {
        const s = await getDoc(ref);
        if (s.exists()) continue;
      }
      await setDoc(ref, demoRanks[k]);
    }

    const demoItems = [
      { id: 'glock', nombre: 'de Combate (Glock)', valorBase: 240000, pagable: true },
      { id: 'beretta', nombre: 'Beretta', valorBase: 240000, pagable: true },
      { id: 'luger', nombre: 'Luger', valorBase: 270000, pagable: true },
      { id: 'tec9', nombre: 'Tec-9', valorBase: 215000, pagable: true },
      { id: 'thompson', nombre: 'Thompson', valorBase: 1200000, pagable: true, pct: 0.60 },
      { id: 'sns', nombre: 'Sns', valorBase: 150000, pagable: true },
      { id: 'skorpion', nombre: 'Skorpion', valorBase: 200000, pagable: false },
      { id: 'usp', nombre: 'Usp', valorBase: 450000, pagable: true },
      { id: 'uzi', nombre: 'Uzi', valorBase: 500000, pagable: true },
      { id: 'recortada', nombre: 'Recortada', valorBase: 500000, pagable: true },
      { id: 'ap', nombre: 'Pistola Ametralladora (Ap)', valorBase: 2600000, pagable: true, pct: 0.75 },
      { id: 'ak-compacta', nombre: 'Ak Compacta', valorBase: 17000000, pagable: true, pct: 0.80 }
    ];

    for (const it of demoItems) {
      const ref = doc(db, 'items', it.id);
      if (!force) {
        const s = await getDoc(ref);
        if (s.exists()) continue;
      }
      const payload = { nombre: it.nombre, valorBase: Number(it.valorBase || 0), pagable: !!it.pagable };
      if (typeof it.pct === 'number') payload.pct = it.pct;
      await setDoc(ref, payload);
    }

    const demoProfiles = [
      { id: 'juan-perez', displayName: 'Juan Pérez', username: 'juan-perez', rankId: 'Delta', tiene500: true },
      { id: 'maria-lopez', displayName: 'María López', username: 'maria-lopez', rankId: 'Legión', tiene500: false },
      { id: 'carlos-ruiz', displayName: 'Carlos Ruiz', username: 'carlos-ruiz', rankId: 'Sangre Nueva', tiene500: false }
    ];
    for (const p of demoProfiles) {
      const ref = doc(db, 'profiles', p.id);
      if (!force) {
        const s = await getDoc(ref);
        if (s.exists()) continue;
      }
      await setDoc(ref, {
        displayName: p.displayName,
        username: p.username,
        rankId: p.rankId,
        tiene500: !!p.tiene500,
        createdAt: serverTimestamp()
      });
    }

    const invSamples = [
      { userId: 'juan-perez', itemId: 'ak-compacta', qty: 1 },
      { userId: 'juan-perez', itemId: 'usp', qty: 2 },
      { userId: 'maria-lopez', itemId: 'thompson', qty: 1 },
      { userId: 'carlos-ruiz', itemId: 'glock', qty: 4 }
    ];

    for (const s of invSamples) {
      const q = query(collection(db, 'inventories'), where('userId', '==', s.userId), where('itemId', '==', s.itemId));
      const snap = await getDocs(q);
      if (!snap.empty && !force) continue;
      if (!snap.empty && force) {
        for (const d of snap.docs) await deleteDoc(d.ref);
      }
      await addDoc(collection(db, 'inventories'), {
        userId: s.userId,
        itemId: s.itemId,
        qty: Number(s.qty || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    toast('seedDemo completo ✅ (usa seedDemo({force:true}) para sobrescribir).');
    return true;
  } catch (err) {
    console.error('seedDemo error:', err);
    toast('Error creando datos demo: ' + (err.message || err), 'error', 8000);
    throw err;
  }
}

window.seedDemo = seedDemo;

/* --------------------------
   FIN
   -------------------------- */
