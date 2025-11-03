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
   CONFIG - pon aquí tu Worker URL
   -------------------------- */
const WORKER_URL = "https://flat-scene-48ab.ggoldenhhands.workers.dev/";

/* --------------------------
   Inicializar Firebase
   -------------------------- */
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

/* --------------------------
   SELECTORES DOM
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
function toast(msg, type = 'info', timeout = 3000) {
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

/* --------------------------
   Unsubscribe helpers (realtime)
   -------------------------- */
let unsubscribeFns = [];
let isWatching = false;

function addUnsub(fn) {
  if (typeof fn === 'function') unsubscribeFns.push(fn);
}

function unsubscribeAll() {
  try {
    unsubscribeFns.forEach(f => { try { f(); } catch (e) { /* ignore */ }});
  } finally {
    unsubscribeFns = [];
    isWatching = false;
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
   CARGAR DATOS INICIALES (una vez)
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
  if (isWatching) return;
  if (!auth.currentUser) return;

  isWatching = true;
  unsubscribeAll();

  try {
    const unsubItems = onSnapshot(collection(db, 'items'),
      (snap) => {
        catalogo = [];
        snap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));
        renderCatalogo();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) return;
        console.error('[realtime] items error:', err);
        toast('Error realtime (items): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    addUnsub(unsubItems);

    const unsubRanks = onSnapshot(collection(db, 'ranks'),
      (snap) => {
        ranks = {};
        snap.forEach(d => ranks[d.id] = d.data());
        renderSelectRangos();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) return;
        console.error('[realtime] ranks error:', err);
        toast('Error realtime (ranks): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    addUnsub(unsubRanks);

    const unsubProfiles = onSnapshot(collection(db, 'profiles'),
      (snap) => {
        membersLocal = [];
        snap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));
        renderMiembros();
      },
      (err) => {
        if (err?.code === 'permission-denied' && !auth.currentUser) return;
        console.error('[realtime] profiles error:', err);
        toast('Error realtime (profiles): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    addUnsub(unsubProfiles);

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
        if (err?.code === 'permission-denied' && !auth.currentUser) return;
        console.error('[realtime] inventories error:', err);
        toast('Error realtime (inventories): ' + (err.code || err.message || err), 'error', 6000);
      }
    );
    addUnsub(unsubInventories);

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
    ? catalogo.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)} (${Number(c.valorBase || 0)})</option>`).join('')
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
    // 1) crear registry en Firestore con processed:false
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

    // 3) preparar resumen del loot y calcular total
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

    // 4) enviar al Worker con authorName (si existe en admins/{uid})
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

    // limpiar formulario
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

  // convertir el objeto ranks en array con {id, nivel} y ordenar por nivel desc
  const rankEntries = Object.keys(ranks).map(k => {
    const nivel = (ranks[k] && typeof ranks[k].nivel === 'number') ? ranks[k].nivel : 0;
    return { id: k, nivel };
  }).sort((a, b) => b.nivel - a.nivel); // del 9 -> 1

  select.innerHTML = '<option value="">-- Selecciona un rango --</option>' +
    rankEntries.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)}</option>`).join('');
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
    const rankName = m.rankId || '—';
    const rankNivel = (ranks[rankName] && typeof ranks[rankName].nivel === 'number') ? ranks[rankName].nivel : 0;
    const nivelClass = rankNivel ? `rango-${rankNivel}` : '';

    const el = document.createElement('div');
    el.className = 'miembro-card';
    el.innerHTML = `
      <div class="miembro-info">
        <strong>${escapeHtml(m.displayName || m.username || m.id)}</strong>
        <div class="small">Rango: <span class="sr-only">${escapeHtml(rankName)}</span></div>
      </div>

      <div class="miembro-actions" style="display:flex;gap:0.5rem;align-items:center;">
        <span class="rango-badge ${nivelClass}">${escapeHtml(rankName)}</span>
        <button class="btn-delete miembro-delete" data-id="${m.id}" title="Eliminar miembro">🗑️</button>
      </div>
    `;

    // abrir inventario si no clicas en delete
    el.onclick = (e) => {
      if (e.target && (e.target.closest('.miembro-delete') || e.target.classList.contains('miembro-delete'))) {
        // handled below
        return;
      }
      mostrarInventarioMiembro(m);
    };

    // delete handler
    el.querySelector('.miembro-delete').onclick = async (e) => {
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
        <div class="item-image">
          <!-- boton de eliminar encima de la imagen -->
          <button class="item-delete" data-id="${it.id}" title="Quitar 1">✕</button>
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;">📦</div>
        </div>
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

    // <-- Inserta/pega aquí el handler para los botones de borrar 1 unidad
    body.querySelectorAll('.item-delete').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const invId = btn.dataset.id;
        try {
          const invRef = doc(db, 'inventories', invId);
          const invSnap = await getDoc(invRef);
          if (!invSnap.exists()) {
            // si ya no existe refrescamos la vista
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
          // refrescar la ventana modal para reflejar cambios
          mostrarInventarioMiembro(miembro);
        } catch (err) {
          console.error('Error decrementando inventory:', err);
          toast('Error al quitar 1 unidad: ' + (err.message || err), 'error', 4000);
        }
      };
    });

    // Vaciar inventario (botón existente)
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
  const q = e.target.value.trim().toLowerCase();
  const grid = document.getElementById('grid-inventarios');
  grid.innerHTML = '';

  // Si vacío: mostrar todos los miembros
  if (!q) {
    membersLocal.forEach(m => {
      const items = inventoriesLocal[m.id] || [];
      const totalItems = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      const card = document.createElement('div');
      card.className = 'inventario-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <h4>${escapeHtml(m.displayName || m.username)}</h4>
        <p class="small">Rango: ${escapeHtml(m.rankId || '—')}</p>
        <p class="small" style="margin-top: 0.5rem;">Objetos: ${totalItems}</p>
      `;
      card.onclick = () => mostrarInventarioMiembro(m);
      grid.appendChild(card);
    });
    return;
  }

  // Si hay q: primero buscar miembros cuyo nombre ó username EMPIECEN por q
  const miembroMatch = membersLocal.filter(m => {
    const name = (m.displayName || m.username || '').toLowerCase();
    return name.startsWith(q);
  });

  if (miembroMatch.length > 0) {
    miembroMatch.forEach(m => {
      const items = inventoriesLocal[m.id] || [];
      const totalItems = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      const card = document.createElement('div');
      card.className = 'inventario-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <h4>${escapeHtml(m.displayName || m.username)}</h4>
        <p class="small">Rango: ${escapeHtml(m.rankId || '—')}</p>
        <p class="small" style="margin-top: 0.5rem;">Objetos: ${totalItems}</p>
      `;
      card.onclick = () => mostrarInventarioMiembro(m);
      grid.appendChild(card);
    });
    return;
  }

  // Si no hay miembros que empiecen por q, buscar por objeto (incluye)
  const objetoMatch = catalogo.filter(c => c.nombre.toLowerCase().includes(q));
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
    if (grid.innerHTML === '') grid.innerHTML = '<p class="sub">Nadie tiene ese objeto</p>';
    return;
  }

  grid.innerHTML = '<p class="sub">No se encontraron resultados</p>';
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
   FIN
   -------------------------- */
