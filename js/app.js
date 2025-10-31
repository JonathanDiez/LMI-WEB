// js/app.js
import { FIREBASE_CONFIG } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  // getIdToken // no necesitamos tokens en frontend ahora
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
   Inicializar Firebase
   -------------------------- */
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

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
   Toast
   -------------------------- */
function toast(msg, type='info', timeout=3000) {
  const el = document.createElement('div');
  el.className = 'toast' + (type==='error'?' error':'');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.style.opacity = '0', timeout-400);
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
   NAV (simple)
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
  await signOut(auth);
  toast('Sesión cerrada');
});
btnLogoutSidebar.addEventListener('click', async () => {
  await signOut(auth);
  toast('Sesión cerrada');
});

/* --------------------------
   Auth state
   -------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // verificar admins/{uid}
    const adminDoc = await getDoc(doc(db,'admins', user.uid));
    const isAdmin = adminDoc.exists();
    if (!isAdmin) {
      toast('No eres admin. Acceso restringido', 'error');
      await signOut(auth);
      return;
    }
    seccionLogin.style.display = 'none';
    seccionDashboard.style.display = 'flex';
    userBadge.style.display = 'flex';
    userNombreEl.textContent = user.email;
    await cargarDatosIniciales();
    watchCollectionsRealtime();
  } else {
    seccionLogin.style.display = 'block';
    seccionDashboard.style.display = 'none';
    userBadge.style.display = 'none';
  }
});

/* --------------------------
   Cargar datos iniciales (una vez)
   -------------------------- */
async function cargarDatosIniciales() {
  // Ranks
  const ranksSnap = await getDocs(collection(db,'ranks'));
  ranks = {};
  ranksSnap.forEach(d => ranks[d.id] = d.data());

  // Items (catalogo)
  const itemsSnap = await getDocs(collection(db,'items'));
  catalogo = [];
  itemsSnap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));

  // Profiles (miembros)
  const profilesSnap = await getDocs(collection(db,'profiles'));
  membersLocal = [];
  profilesSnap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));

  // Inventories (lazy: se llenará por realtime)
  inventoriesLocal = {};

  // render
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
function watchCollectionsRealtime(){
  onSnapshot(collection(db,'items'), (snap) => {
    catalogo = [];
    snap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));
    renderCatalogo();
  });
  onSnapshot(collection(db,'ranks'), (snap) => {
    ranks = {};
    snap.forEach(d => ranks[d.id] = d.data());
    renderSelectRangos();
  });
  onSnapshot(collection(db,'profiles'), (snap) => {
    membersLocal = [];
    snap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));
    renderMiembros();
  });
  onSnapshot(collection(db,'inventories'), (snap) => {
    inventoriesLocal = {};
    snap.forEach(d => {
      const data = d.data();
      if(!inventoriesLocal[data.userId]) inventoriesLocal[data.userId] = [];
      inventoriesLocal[data.userId].push({ id: d.id, ...data });
    });
  });
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
   Submit formulario: guarda registries y actualiza inventories
   NOTE: NO se llama a Cloud Function. El GitHub Action procesará 'registries'.
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
    return { itemId: id, nombre: item.nombre || id, qty, valorBase: item.valorBase || 0 };
  });

  try {
    // 1) crear registry en Firestore con processed:false
    const registryRef = await addDoc(collection(db,'registries'), {
      authorId: auth.currentUser.uid,
      authorEmail: auth.currentUser.email,
      memberId: member.id,
      memberName: member.displayName || member.username || member.id,
      actividad,
      items,
      createdAt: serverTimestamp(),
      processed: false
    });

    // 2) actualizar inventarios (upsert simplificado)
    for (const it of items) {
      const q = query(collection(db,'inventories'), where('userId','==',member.id), where('itemId','==',it.itemId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const existingDoc = snap.docs[0];
        const newQty = (existingDoc.data().qty || 0) + it.qty;
        await updateDoc(existingDoc.ref, { qty: newQty, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db,'inventories'), {
          userId: member.id,
          itemId: it.itemId,
          qty: it.qty,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }

    toast('Registro guardado. En pocos minutos se notificará en Discord.');
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
   RENDERS
   -------------------------- */
function renderSelectRangos() {
  const select = document.getElementById('mi-rango');
  if(!select) return;
  select.innerHTML = '<option value="">-- Selecciona un rango --</option>' +
    Object.keys(ranks).map(k => `<option value="${k}">${escapeHtml(k)}</option>`).join('');
}

function renderCatalogo() {
  const lista = document.getElementById('lista-catalogo');
  if(lista) {
    lista.innerHTML = '';
    catalogo.forEach(c => {
      const el = document.createElement('div');
      el.className = 'catalogo-item';
      el.innerHTML = `
        <div>
          <strong>${escapeHtml(c.nombre)}</strong>
          <div class="small">Valor: ${Number(c.valorBase||0)} ${c.pagable === false ? '• No pagable' : ''}</div>
        </div>
        <button class="btn-delete" data-id="${c.id}">🗑️</button>
      `;
      el.querySelector('.btn-delete').onclick = async () => {
        if (!confirm('¿Borrar objeto del catálogo?')) return;
        await deleteDoc(doc(db,'items',c.id));
        toast('Objeto eliminado');
      };
      lista.appendChild(el);
    });
  }
}

function renderMiembros() {
  const grid = document.getElementById('grid-miembros');
  if(!grid) return;
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
      if (!confirm('¿Eliminar miembro ' + (m.displayName||m.username) + '?')) return;
      await deleteDoc(doc(db,'profiles',m.id));
      toast('Miembro eliminado');
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
  const matches = membersLocal.filter(m => ((m.displayName||'').toLowerCase().includes(q) || (m.username||'').toLowerCase().includes(q))).slice(0,8);
  if (matches.length>0) {
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

// cerrar sugerencias al click fuera
document.addEventListener('click', (e) => {
  if (!buscarMiembroInput.contains(e.target) && !sugerenciasMiembro.contains(e.target)) {
    sugerenciasMiembro.classList.remove('active');
  }
});

/* --------------------------
   MODAL INVENTARIO
   -------------------------- */
const modal = document.getElementById('modal-inventario');
const modalClose = document.getElementById('modal-close');
modalClose.onclick = () => modal.classList.remove('active');
modal.onclick = (e) => { if (e.target===modal) modal.classList.remove('active'); };

async function mostrarInventarioMiembro(miembro) {
  const q = query(collection(db,'inventories'), where('userId','==',miembro.id));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  const rango = ranks[miembro.rankId] || {};
  const pct = miembro.tiene500 ? (rango.pct500 || rango.pct || 0) : (rango.pct || 0);
  let totalValor = 0;
  const body = document.getElementById('modal-body');
  if (items.length === 0) {
    body.innerHTML = '<p class="sub">Este miembro no tiene objetos en su inventario</p>';
  } else {
    let html = `<div style="display:flex;justify-content:space-between;margin-bottom:1rem;">
      <h4>Objetos en inventario (${items.length})</h4>
      <button class="btn-delete" id="clear-inventory">Vaciar inventario</button>
    </div><div class="inventario-items">`;
    for (const it of items) {
      const itemMeta = catalogo.find(ci => ci.id === it.itemId) || {};
      const valorUnit = Math.round((itemMeta.valorBase || 0) * (pct || 1));
      totalValor += valorUnit * (it.qty || 0);
      html += `<div class="item-card">
        <button class="btn-delete item-delete" data-id="${it.id}">🗑️</button>
        <div class="item-image">📦</div>
        <strong>${escapeHtml(itemMeta.nombre || it.itemId)}</strong>
        <div class="small">Cantidad: ${it.qty}</div>
        <div class="small">Valor unit.: ${valorUnit}</div>
        <div style="color: var(--accent); font-weight: 600; margin-top: 0.5rem;">
          ${valorUnit * it.qty}
        </div>
      </div>`;
    }
    html += `</div>`;
    body.innerHTML = html;

    body.querySelectorAll('.item-delete').forEach(btn => {
      btn.onclick = async (e) => {
        const id = btn.dataset.id;
        if (!confirm('¿Eliminar este objeto?')) return;
        await deleteDoc(doc(db,'inventories', id));
        toast('Objeto eliminado del inventario');
        mostrarInventarioMiembro(miembro);
      };
    });
    document.getElementById('clear-inventory').onclick = async () => {
      if (!confirm('¿Vaciar todo el inventario de ' + (miembro.displayName||miembro.username) + '?')) return;
      const snapClear = await getDocs(query(collection(db,'inventories'), where('userId','==',miembro.id)));
      for (const d of snapClear.docs) await deleteDoc(d.ref);
      toast('Inventario vaciado');
      mostrarInventarioMiembro(miembro);
    };
  }

  document.getElementById('modal-titulo').textContent = miembro.displayName || miembro.username || miembro.id;
  document.getElementById('modal-subtitulo').innerHTML = `Rango: ${miembro.rankId || '—'} • Porcentaje: ${Math.round((pct||0)*100)}% • <strong>Total: ${Math.round(totalValor)}</strong>`;
  modal.classList.add('active');
}

/* --------------------------
   Crear miembro y crear item
   -------------------------- */
document.getElementById('btn-crear-miembro').addEventListener('click', async () => {
  const nombre = document.getElementById('mi-nombre').value.trim();
  if (!nombre) return toast('Nombre obligatorio','error');
  const id = nombre.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-_]/g,'');
  const rango = document.getElementById('mi-rango').value;
  const tiene500 = document.getElementById('mi-500').checked;
  await setDoc(doc(db,'profiles', id), { displayName: nombre, username: id, rankId: rango, tiene500 });
  toast('Miembro creado: ' + nombre);
  document.getElementById('mi-nombre').value='';
});

document.getElementById('btn-crear-catalogo').addEventListener('click', async () => {
  const nombre = document.getElementById('cat-nombre').value.trim();
  const valor = Number(document.getElementById('cat-valor').value) || 0;
  const pagable = document.getElementById('cat-pagable').checked;
  if (!nombre || valor<=0) return toast('Nombre y valor válidos requeridos','error');
  const id = nombre.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-_]/g,'');
  await setDoc(doc(db,'items',id), { nombre, valorBase: valor, pagable });
  toast('Objeto agregado al catálogo');
  document.getElementById('cat-nombre').value='';
  document.getElementById('cat-valor').value='';
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

  // Buscar por usuario
  const miembroMatch = membersLocal.filter(m => (m.displayName||'').toLowerCase().includes(q));

  // Buscar por objeto
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
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

/* --------------------------
   Seed demo (ejecutar desde consola si quieres crear datos de ejemplo)
   Uso: logueate como admin y ejecuta en consola: seedDemo()
   -------------------------- */
window.seedDemo = async function seedDemo() {
  if (!auth.currentUser) return alert('Loguéate como admin primero');
  if (!confirm('Crear datos demo (ranks, items, 2 perfiles)?')) return;
  const demoRanks = {
    'Sangre Nueva': { nivel: 1, pct: 0.20, pct500: 0.30 },
    'Soldado': { nivel: 3, pct: 0.35, pct500: 0.45 },
    'Capo': { nivel: 7, pct: 0.50, pct500: 0.60 },
    'Blood Line': { nivel: 10, pct: 0.65, pct500: 0.75 }
  };
  const demoItems = [
    { id: 'ak-47', nombre: 'AK-47', valorBase: 15000, pagable: true },
    { id: 'm4a1', nombre: 'M4A1', valorBase: 18000, pagable: true },
    { id: 'usp', nombre: 'USP', valorBase: 5000, pagable: true }
  ];
  for (const k of Object.keys(demoRanks)) {
    await setDoc(doc(db,'ranks',k), demoRanks[k]);
  }
  for (const it of demoItems) {
    await setDoc(doc(db,'items',it.id), { nombre: it.nombre, valorBase: it.valorBase, pagable: it.pagable });
  }
  await setDoc(doc(db,'profiles','juan-perez'), { displayName: 'Juan Pérez', username: 'juan-perez', rankId: 'Soldado', tiene500: true });
  await setDoc(doc(db,'profiles','maria-lopez'), { displayName: 'María López', username: 'maria-lopez', rankId: 'Capo', tiene500: false });
  toast('Datos demo creados. Recarga la página si no ves los cambios.');
};

/* --------------------------
   FIN
   -------------------------- */
