// js/app.js — versión limpia, mínima y funcional
'use strict';

import { FIREBASE_CONFIG } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, getIdToken
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

// INIT
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

// DOM helpers
const byId = id => document.getElementById(id);
const seccionLogin = byId('seccion-login');
const seccionDashboard = byId('seccion-dashboard');
const btnEntrar = byId('btn-entrar');
const btnLogout = byId('btn-logout');
const btnLogoutSidebar = byId('btn-logout-sidebar');
const userNombreEl = byId('user-nombre');
const contenedorItems = byId('contenedor-items');
const buscarMiembroInput = byId('buscar-miembro');
const sugerenciasMiembro = byId('sugerencias-miembro');
const listaCatalogoEl = byId('lista-catalogo');

// estado
let ranks = {};
let catalogo = [];
let membersLocal = [];
let inventoriesLocal = {}; // map userId -> array

// unsub helpers
let unsubscribeFns = [];
let isWatching = false;
const addUnsub = fn => typeof fn === 'function' && unsubscribeFns.push(fn);
const unsubscribeAll = () => { unsubscribeFns.forEach(f => { try { f(); } catch{} }); unsubscribeFns = []; isWatching = false; };

// utilidades
const escapeHtml = str => str == null ? '' : String(str)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'", '&#039;');

const toast = (msg, type = 'info', timeout = 2500) => {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.textContent = msg;
  const container = byId('toasts') || document.body;
  container.appendChild(t);
  setTimeout(() => t.style.opacity = '0', Math.max(0, timeout - 300));
  setTimeout(() => t.remove(), timeout);
};

const formatNumber = (n) => {
  const num = Math.round(Number(n) || 0);
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const getRankClass = rankId => {
  const nivel = ranks[rankId]?.nivel ?? 0;
  return nivel ? `rango-${nivel}` : '';
};

// ---------- Navegación (robusta y dinámica) ----------
function switchToView(viewName) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  document.querySelectorAll('.view').forEach(v => {
    const shouldShow = v.id === ('view-' + viewName);
    v.classList.toggle('active', shouldShow);
    v.hidden = !shouldShow;
  });
}

// Delegación: funciona aunque los botones se creen después
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  const view = btn.dataset.view;
  if (!view) {
    console.warn('nav-btn sin data-view:', btn);
    return;
  }
  e.preventDefault();
  switchToView(view);
});

// ------------------ Auth ------------------
btnEntrar?.addEventListener('click', async () => {
  const email = (byId('email')?.value || '').trim();
  const pass = (byId('password')?.value || '').trim();
  if (!email || !pass) return toast('Rellena email y contraseña', 'error');
  try { await signInWithEmailAndPassword(auth, email, pass); toast('Sesión iniciada'); }
  catch (err) { console.error(err); toast('Error login: ' + (err.message || err), 'error'); }
});

const doLogout = async () => {
  try { unsubscribeAll(); await signOut(auth); toast('Sesión cerrada'); }
  catch (err) { console.error(err); toast('Error cerrando sesión: ' + (err.message || err), 'error'); }
};
btnLogout?.addEventListener('click', doLogout);
btnLogoutSidebar?.addEventListener('click', doLogout);

onAuthStateChanged(auth, async user => {
  if (user) {
    try {
      const adm = await getDoc(doc(db, 'admins', user.uid));
      if (!adm.exists()) { toast('No eres admin. Acceso restringido', 'error'); unsubscribeAll(); await signOut(auth); return; }
      seccionLogin.hidden = true; seccionDashboard.hidden = false;
      userNombreEl.textContent = user.email || '';
      await cargarDatosIniciales();
      watchCollectionsRealtime();
    } catch (err) { console.error(err); toast('Error comprobando usuario: ' + (err.message || err), 'error'); }
  } else {
    unsubscribeAll();
    seccionLogin.hidden = false; seccionDashboard.hidden = true;
  }
});

// ------------------ Carga inicial ------------------
async function cargarDatosIniciales() {
  const [rSnap, iSnap, pSnap, invSnap] = await Promise.all([
    getDocs(collection(db, 'ranks')),
    getDocs(collection(db, 'items')),
    getDocs(collection(db, 'profiles')),
    getDocs(collection(db, 'inventories'))
  ]);
  ranks = {}; rSnap.forEach(d => ranks[d.id] = d.data());
  catalogo = []; iSnap.forEach(d => catalogo.push({ id: d.id, ...d.data() }));
  membersLocal = []; pSnap.forEach(d => membersLocal.push({ id: d.id, ...d.data() }));
  inventoriesLocal = {}; invSnap.forEach(d => {
    const data = d.data();
    if (!inventoriesLocal[data.userId]) inventoriesLocal[data.userId] = [];
    inventoriesLocal[data.userId].push({ id: d.id, ...data });
  });

  showMemberSuggestions('');
  renderSelectRangos();
  renderCatalogo();
  renderMiembros();
  if (contenedorItems) { contenedorItems.innerHTML = ''; addItemRow(); }
  renderInventariosGrid('');
}

// ------------------ Realtime (limpio) ------------------
function watchCollectionsRealtime() {
  if (isWatching || !auth.currentUser) return;
  isWatching = true;
  unsubscribeAll();

  addUnsub(onSnapshot(collection(db, 'items'), snap => {
    catalogo = []; snap.forEach(d => catalogo.push({ id: d.id, ...d.data() })); renderCatalogo();
  }));

  addUnsub(onSnapshot(collection(db, 'ranks'), snap => {
    ranks = {}; snap.forEach(d => ranks[d.id] = d.data()); renderSelectRangos(); renderMiembros(); renderInventariosGrid('');
  }));

  addUnsub(onSnapshot(collection(db, 'profiles'), snap => {
    membersLocal = []; snap.forEach(d => membersLocal.push({ id: d.id, ...d.data() })); renderMiembros(); renderInventariosGrid('');
  }));

  addUnsub(onSnapshot(collection(db, 'inventories'), snap => {
    inventoriesLocal = {};
    snap.forEach(d => {
      const data = d.data();
      if (!inventoriesLocal[data.userId]) inventoriesLocal[data.userId] = [];
      inventoriesLocal[data.userId].push({ id: d.id, ...data });
    });
    renderInventariosGrid('');
  }));
}

// ------------------ Custom select ------------------
function createCustomSelectFromNative(selectEl) {
  if (!selectEl) return;
  const next = selectEl.nextElementSibling;
  if (next && next.classList.contains('custom-select-wrapper')) next.remove();
  selectEl.style.display = 'none';

  const wrapper = document.createElement('div'); wrapper.className = 'custom-select-wrapper';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'custom-select-trigger btn-sec';
  const placeholderOpt = selectEl.querySelector('option[value=""]');
  trigger.textContent = (selectEl.selectedIndex >= 0 && selectEl.options[selectEl.selectedIndex]) ? selectEl.options[selectEl.selectedIndex].text : (placeholderOpt ? placeholderOpt.text : '-- selecciona --');

  const list = document.createElement('div'); list.className = 'sugerencias';
  Array.from(selectEl.options).forEach(opt => {
    if (opt.value === '') return;
    const item = document.createElement('div'); item.textContent = opt.text; item.dataset.value = opt.value;
    item.addEventListener('click', (ev) => { ev.stopPropagation(); trigger.textContent = opt.text; selectEl.value = opt.value; list.classList.remove('active'); selectEl.dispatchEvent(new Event('change', { bubbles: true })); });
    list.appendChild(item);
  });

  selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
  wrapper.appendChild(trigger); wrapper.appendChild(list);
  trigger.addEventListener('click', ev => { ev.stopPropagation(); document.querySelectorAll('.sugerencias.active').forEach(s => { if (s !== list) s.classList.remove('active'); }); list.classList.toggle('active'); });
  document.addEventListener('click', () => list.classList.remove('active'));
  selectEl.addEventListener('change', () => {
    const cur = selectEl.options[selectEl.selectedIndex];
    trigger.textContent = cur ? cur.text : (placeholderOpt ? placeholderOpt.text : '-- selecciona --');
  });
}

// ------------------ Items UI ------------------
function addItemRow() {
  if (!contenedorItems) return;
  const row = document.createElement('div'); row.className = 'item-row';
  const sel = document.createElement('select'); sel.className = 'sel-item';
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '-- Selecciona un objeto --';
  sel.appendChild(placeholder);
  if (catalogo.length) {
    catalogo.forEach(c => {
      const opt = document.createElement('option'); opt.value = c.id; opt.textContent = `${c.nombre} - ${formatNumber(Number(c.valorBase||0))} $`;
      sel.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option'); opt.disabled = true; opt.textContent = '— No hay items en catálogo —'; sel.appendChild(opt);
  }
  const qty = document.createElement('input'); qty.className = 'qty-item'; qty.type = 'number'; qty.min = 1; qty.value = 1;
  const btnRemove = document.createElement('button'); btnRemove.className = 'btn-remove-item'; btnRemove.type = 'button'; btnRemove.title = 'Quitar fila'; btnRemove.textContent = '✖';
  btnRemove.addEventListener('click', () => row.remove());

  row.appendChild(sel); row.appendChild(qty); row.appendChild(btnRemove);
  contenedorItems.appendChild(row);
  createCustomSelectFromNative(sel);
}
byId('btn-add-item')?.addEventListener('click', addItemRow);

// ------------------ Form submit ------------------
byId('form-registro')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const memberName = (buscarMiembroInput?.value || '').trim();
  let member = null;
  const chosenId = buscarMiembroInput?.dataset?.id;
  if (chosenId) member = membersLocal.find(m => m.id === chosenId) || null;
  if (!member) member = membersLocal.find(m => (m.displayName === memberName) || (m.username === memberName)) || null;
  if (!member) return toast('Selecciona un miembro válido', 'error');

  const filas = Array.from((contenedorItems || document).querySelectorAll('.item-row'));
  if (!filas.length) return toast('Añade al menos un objeto', 'error');
  const actividad = (byId('actividad')?.value || '').trim();
  if (!actividad) return toast('Selecciona la actividad', 'error');

  const items = filas.map(r => {
    const id = r.querySelector('.sel-item')?.value;
    const qty = Number(r.querySelector('.qty-item')?.value) || 0;
    const item = catalogo.find(c => c.id === id) || {};
    return { itemId: id, nombre: item.nombre || id, qty, valorBase: item.valorBase || 0, pct: (typeof item.pct === 'number') ? item.pct : null };
  });

  try {
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

    // upsert inventories
    for (const it of items) {
      const q = query(collection(db, 'inventories'), where('userId','==', member.id), where('itemId','==', it.itemId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const existing = snap.docs[0];
        const newQty = (existing.data().qty || 0) + it.qty;
        await updateDoc(existing.ref, { qty: newQty, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'inventories'), { userId: member.id, itemId: it.itemId, qty: it.qty, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
    }

    // summary (no bloquear)
    let totalValor = 0; const lootParts = [];
    const rango = ranks[member.rankId] || {};
    const pctRank = member.tiene500 ? (rango.pct500 || rango.pct || 0) : (rango.pct || 0);
    for (const it of items) {
      const pctItem = (typeof it.pct === 'number') ? it.pct : null;
      const eff = (pctItem !== null) ? pctItem : pctRank;
      const valorUnit = Math.round((it.valorBase || 0) * (eff || 1));
      totalValor += valorUnit * (it.qty || 0);
      lootParts.push(`${it.nombre} x${it.qty}`);
    }
    const lootSummary = lootParts.join(', ');

    // enviar worker (intento, no bloquea la UI)
    try {
      let authorName = auth.currentUser.email || auth.currentUser.uid;
      try {
        const admSnap = await getDoc(doc(db, 'admins', auth.currentUser.uid));
        if (admSnap.exists() && admSnap.data().displayName) authorName = admSnap.data().displayName;
      } catch {}
      const idToken = await getIdToken(auth.currentUser, true);
      const payload = { registryId: registryRef.id, authorId: auth.currentUser.uid, authorEmail: auth.currentUser.email, authorName, memberId: member.id, memberName: member.displayName || member.username || member.id, actividad, items, lootSummary, totalValor, createdAt: new Date().toISOString() };
      fetch('https://flat-scene-48ab.ggoldenhhands.workers.dev/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }, body: JSON.stringify(payload) })
        .then(resp => { if (resp?.ok) updateDoc(registryRef, { processed: true, processedAt: serverTimestamp() }).catch(()=>{}); })
        .catch(()=>{});
    } catch (err) { /* silent */ }

    // limpiar UI
    if (contenedorItems) contenedorItems.innerHTML = '';
    addItemRow(); if (buscarMiembroInput) { buscarMiembroInput.value = ''; buscarMiembroInput.dataset.id = ''; }
    if (byId('actividad')) byId('actividad').value = '';
    toast('Registro guardado', 'info', 1400);
  } catch (err) {
    console.error(err); toast('Error guardando registro: ' + (err.message || err), 'error');
  }
});

// ------------------ Renders ------------------
function renderSelectRangos() {
  const sel = byId('mi-rango'); if (!sel) return;
  const rankEntries = Object.keys(ranks).map(k => ({ id: k, nivel: (ranks[k]?.nivel ?? 0) })).sort((a,b) => b.nivel - a.nivel);
  sel.innerHTML = '<option value="">-- Selecciona un rango --</option>' + rankEntries.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)}</option>`).join('');
  createCustomSelectFromNative(sel);
}

function renderCatalogo() {
  const lista = listaCatalogoEl || byId('lista-catalogo');
  if (!lista) return;
  lista.innerHTML = '';
  if (!catalogo.length) { lista.innerHTML = '<p class="sub">No hay items en el catálogo</p>'; return; }

  catalogo.forEach(c => {
    const el = document.createElement('div'); el.className = 'catalogo-item';
    const pagable = (c.pagable === false) ? ' • No pagable' : '';
    const valorFmt = formatNumber(Number(c.valorBase || 0));
    const pctBadge = (typeof c.pct === 'number') ? `<span class="pct-badge" title="Porcentaje fijo del item">${Math.round(c.pct*100)}%</span>` : '';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.25rem;min-width:0;">
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.nombre)}</strong>
          ${pctBadge}
        </div>
        <div class="small" style="margin-top:0.2rem;text-align:left;">
          Valor: ${valorFmt}${pagable}
        </div>
      </div>
      <div style="display:flex;flex-direction:row;align-items:center;gap:0.5rem;">
        <span class="value-badge" title="Valor del item" style="font-weight:700;padding:0.25rem 0.5rem;border-radius:8px;border:1px solid var(--border);min-width:70px;text-align:right;">${valorFmt} $</span>
        <button class="btn-delete" data-id="${c.id}">🗑️</button>
      </div>
    `;
    el.querySelector('.btn-delete')?.addEventListener('click', async () => {
      if (!confirm('¿Borrar objeto del catálogo?')) return;
      try { await deleteDoc(doc(db, 'items', c.id)); toast('Objeto eliminado'); }
      catch (err) { console.error(err); toast('Error borrando item: ' + (err.message || err), 'error'); }
    });
    lista.appendChild(el);
  });
}

function renderMiembros() {
  const grid = byId('grid-miembros'); if (!grid) return; grid.innerHTML = '';
  const sorted = [...membersLocal].sort((a,b) => (ranks[b.rankId]?.nivel || 0) - (ranks[a.rankId]?.nivel || 0));
  sorted.forEach(m => grid.appendChild(createMemberCard(m)));
}

function renderInventariosGrid(filter = '') {
  const grid = byId('grid-inventarios'); if (!grid) return; grid.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const membersSorted = [...membersLocal].sort((a,b) => (ranks[b.rankId]?.nivel || 0) - (ranks[a.rankId]?.nivel || 0));
  if (!membersSorted.length) { grid.innerHTML = '<p class="sub">No se encontraron miembros</p>'; return; }

  membersSorted.forEach(m => {
    const name = (m.displayName || m.username || m.id || '').toString();
    if (q && !name.toLowerCase().includes(q)) return;
    const inv = inventoriesLocal[m.id] || [];
    const totalItems = inv.reduce((s,it) => s + (Number(it.qty) || 0), 0);
    const rankName = m.rankId || '—';
    const nivelClass = getRankClass(rankName);
    const card = document.createElement('div'); card.className = 'inventario-card';
    card.innerHTML = `
      <div class="miembro-info">
        <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
        <span class="rango-badge ${nivelClass}" aria-label="Rango ${escapeHtml(rankName)}">${escapeHtml(rankName)}</span>
      </div>
      <div class="inventario-meta">
        <div class="items-count">${totalItems}</div>
        <div class="items-sub">objetos</div>
      </div>
    `;
    card.addEventListener('click', () => mostrarInventarioMiembro(m));
    grid.appendChild(card);
  });
}

// ------------------ Member card + eliminar ------------------
function createMemberCard(member) {
  const name = (member.displayName || member.username || member.id || '').toString();
  const rankName = member.rankId || '—';
  const nivelClass = getRankClass(rankName);

  const card = document.createElement('div');
  card.className = 'miembro-card';
  card.innerHTML = `
    <div class="miembro-info">
      <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
      <span class="rango-badge ${nivelClass}" aria-label="Rango ${escapeHtml(rankName)}">${escapeHtml(rankName)}</span>
    </div>
    <div class="miembro-actions" style="display:flex;gap:0.5rem;align-items:center;">
      <button class="btn-toggle-500" data-id="${member.id}" title="Toggle 500">${member.tiene500 ? '🎖️ 500' : '❌ 500'}</button>
      <button class="btn-delete miembro-delete" data-id="${member.id}" title="Eliminar miembro">🗑️</button>
    </div>
  `;

  // Eliminar (ya lo tenías)
  const btnDelete = card.querySelector('.miembro-delete');
  if (btnDelete) {
    btnDelete.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btnDelete.dataset.id;
      if (!id) return;
      if (!confirm(`¿Seguro que quieres eliminar al miembro "${member.displayName || member.username || id}"?\nSe borrarán su perfil, su inventario y los registros asociados.`)) return;
      try {
        const invQ = query(collection(db, 'inventories'), where('userId','==', id));
        const invSnap = await getDocs(invQ);
        for (const d of invSnap.docs) await deleteDoc(d.ref);

        const regQ = query(collection(db, 'registries'), where('memberId','==', id));
        const regSnap = await getDocs(regQ);
        for (const d of regSnap.docs) await deleteDoc(d.ref);

        await deleteDoc(doc(db, 'profiles', id));

        membersLocal = membersLocal.filter(m => m.id !== id);
        delete inventoriesLocal[id];
        renderMiembros();
        renderInventariosGrid('');
        toast('Miembro eliminado correctamente', 'info', 2000);
      } catch (err) {
        console.error('Error eliminando miembro:', err);
        toast('Error al eliminar miembro: ' + (err.message || err), 'error');
      }
    });
  }

  // Toggle 500 - botón interactivo
  const btnToggle = card.querySelector('.btn-toggle-500');
  if (btnToggle) {
    btnToggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btnToggle.dataset.id;
      if (!id) return;
      // estado actual desde memoria local (fallback a false)
      const memberLocal = membersLocal.find(m => m.id === id) || member;
      const current = !!memberLocal.tiene500;
      const next = !current;

      // optimista: actualizar UI inmediatamente
      btnToggle.textContent = next ? '🎖️ 500' : '➕ 500';
      btnToggle.classList.toggle('active', next);

      try {
        await updateDoc(doc(db, 'profiles', id), { tiene500: next });
        // actualizar memoria local inmediatamente
        if (memberLocal) memberLocal.tiene500 = next;
        toast(`500 aportaciones ${next ? 'activadas' : 'desactivadas'}`, 'info', 1400);
      } catch (err) {
        // revertir UI en caso de fallo
        btnToggle.textContent = current ? '🎖️ 500' : '➕ 500';
        btnToggle.classList.toggle('active', current);
        console.error('Error toggling tiene500:', err);
        toast('Error actualizando (500): ' + (err.message || err), 'error');
      }
    });

    // reflejar estado inicial de forma visual
    if (member.tiene500) btnToggle.classList.add('active');
    else btnToggle.classList.remove('active');
  }

  return card;
}

// ------------------ Sugerencias ------------------
function showMemberSuggestions(q) {
  if (!sugerenciasMiembro) return;
  sugerenciasMiembro.innerHTML = '';
  if (!q) { if (buscarMiembroInput) buscarMiembroInput.dataset.id = ''; sugerenciasMiembro.classList.remove('active'); return; }
  const matches = membersLocal.filter(m => {
    const name = (m.displayName || m.username || '').toLowerCase();
    return name.includes(q);
  }).slice(0,8);
  if (!matches.length) { if (buscarMiembroInput) buscarMiembroInput.dataset.id = ''; sugerenciasMiembro.classList.remove('active'); return; }
  matches.forEach(m => {
    const div = document.createElement('div'); div.textContent = m.displayName || m.username; div.tabIndex = 0;
    div.addEventListener('click', () => {
      buscarMiembroInput.value = m.displayName || m.username;
      buscarMiembroInput.dataset.id = m.id;
      sugerenciasMiembro.classList.remove('active');
      sugerenciasMiembro.innerHTML = '';
    });
    div.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') div.click(); });
    sugerenciasMiembro.appendChild(div);
  });
  sugerenciasMiembro.classList.add('active');
}

buscarMiembroInput?.addEventListener('input', (e) => {
  const q = (e.target.value || '').trim().toLowerCase();
  if (buscarMiembroInput.dataset.id) {
    const sel = membersLocal.find(m => m.id === buscarMiembroInput.dataset.id);
    if (!sel || ((sel.displayName || sel.username || '').toLowerCase() !== (e.target.value || '').toLowerCase())) buscarMiembroInput.dataset.id = '';
  }
  showMemberSuggestions(q);
});

document.addEventListener('click', (e) => {
  const target = e.target;
  if (target === buscarMiembroInput || (sugerenciasMiembro && sugerenciasMiembro.contains(target))) return;
  if (sugerenciasMiembro) sugerenciasMiembro.classList.remove('active');
});

// Modal inventario (control consistente show/hide)
const modal = byId('modal-inventario');
const modalClose = byId('modal-close');

// Cerrar con el botón: quitar clase .active y ocultar
modalClose?.addEventListener('click', () => {
  if (!modal) return;
  modal.classList.remove('active');
  modal.hidden = true;
});

// Click fuera del contenido -> cerrar igual
modal?.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.classList.remove('active');
    modal.hidden = true;
  }
});

// Mostrar Inventario
async function mostrarInventarioMiembro(miembro) {
  try {
    console.log('DEBUG: mostrarInventarioMiembro llamado para:', miembro.id);

    const snap = await getDocs(query(collection(db, 'inventories'), where('userId', '==', miembro.id)));
    const items = []; snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    const rango = ranks[miembro.rankId] || {};
    const basePct = (typeof rango.pct === 'number') ? rango.pct : 0;
    const pct500 = (typeof rango.pct500 === 'number') ? rango.pct500 : null;
    const pctRankEffective = miembro.tiene500 ? (pct500 ?? basePct) : basePct;
    // calcula diferencia para mostrar +X% si pct500 > basePct
    const extraPct = (miembro.tiene500 && pct500 !== null && pct500 > basePct) ? Math.round((pct500 - basePct) * 100) : 0;
    const totalObjetos = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

    const body = byId('modal-body');
    if (!body) { console.error('DEBUG: modal-body no encontrado en DOM'); toast('Error: modal no configurado en el HTML', 'error'); return; }

    if (!items.length) {
      body.innerHTML = '<p class="sub">Este miembro no tiene objetos en su inventario</p>';
    } else {
      let totalValor = 0;

      const itemCards = items.map(it => {
        const itemMeta = catalogo.find(ci => ci.id === it.itemId) || {};
        const pctItem = (typeof itemMeta.pct === 'number') ? itemMeta.pct : null;
        const eff = (pctItem !== null) ? pctItem : pctRankEffective;
        const valorUnit = Math.round((itemMeta.valorBase || 0) * (eff || 1));
        totalValor += valorUnit * (it.qty || 0);

        // imagen local o default
        const fileName = itemMeta.imagen ? String(itemMeta.imagen) : 'default.png';
        const imageUrl = `./images/${encodeURIComponent(fileName)}`;

        const pctHtml = pctItem !== null ? ` <strong class="pct-strong">(${Math.round(pctItem * 100)}%)</strong>` : '';

        return `
          <div class="item-card" data-inv-id="${it.id}">
            <div class="item-image">
              <button class="item-delete" data-id="${it.id}" title="Quitar 1">✕</button>
              <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(itemMeta.nombre || it.itemId)}" loading="lazy" />
            </div>

            <strong class="item-name">${escapeHtml(itemMeta.nombre || it.itemId)}</strong>

            <div class="small"><strong>Cantidad:</strong> <span class="item-qty" data-id="${it.id}">${it.qty}</span></div>

            <div class="small"><strong>Valor por unidad:</strong> ${formatNumber(valorUnit)}${pctHtml}</div>

            <div class="item-total" aria-hidden="true">${formatNumber(valorUnit * it.qty)} $</div>
          </div>
        `;
      }).join('');

      // Header personalizado: OBJETOS + badge (izq) | Vaciar + badge VALOR TOTAL (der)
      const totalValorFmt = formatNumber(totalValor);

      body.innerHTML = `
        <div class="modal-top" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:1rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div style="font-weight:700;text-transform:uppercase;">Objetos en inventario:</div>
            <span class="header-badge items-badge">${totalObjetos}</span>
          </div>

          <div style="display:flex;align-items:center;gap:0.5rem;flex-direction: row-reverse;">
            <button class="btn-delete btn-delete--big" id="clear-inventory">Vaciar inventario</button>
            <span class="header-badge total-badge">Valor total: <strong>${totalValorFmt} $</strong></span>
          </div>
        </div>

        <div class="inventario-items">${itemCards}</div>
      `;

      // título: RANGO en grande + badge; subtítulo: nombre del miembro (más discreto)
      const rangoNombre = miembro.rankId || '—';
      const basePctDisplay = Math.round(basePct * 100);
      let badgeInside = `${basePctDisplay}%`;
      if (miembro.tiene500 && extraPct > 0) {
        badgeInside = `${basePctDisplay}% + ${extraPct}% POR 500 APORTACIONES`;
      }

      // modal-titulo mostrará: RANGO [50% + 10% POR 500 APORTACIONES]
      byId('modal-titulo').innerHTML = `
        <span style="font-weight:800;text-transform:uppercase;">${escapeHtml(String(rangoNombre))}</span>
        <span class="rango-badge-detail">[${escapeHtml(badgeInside)}]</span>
      `;

      // modal-subtitulo mostrará el nombre del miembro (más pequeño / secundario)
      byId('modal-subtitulo').innerHTML = `
        <span style="font-weight:600;opacity:0.9;">${escapeHtml(miembro.displayName || miembro.username || miembro.id)}</span>
      `;

      // Delegación local: quitar 1 unidad
      const inventBody = body;
      inventBody.onclick = async (e) => {
        const btn = e.target.closest('.item-delete');
        if (!btn) return;
        e.stopPropagation();
        const invId = btn.dataset.id;
        try {
          const invRef = doc(db, 'inventories', invId);
          const invSnap = await getDoc(invRef);
          if (!invSnap.exists()) return mostrarInventarioMiembro(miembro);
          const currentQty = Number(invSnap.data().qty || 0);
          if (currentQty > 1) await updateDoc(invRef, { qty: currentQty - 1, updatedAt: serverTimestamp() });
          else await deleteDoc(invRef);
          mostrarInventarioMiembro(miembro);
        } catch (err) { console.error(err); toast('Error al quitar 1 unidad: ' + (err.message || err), 'error'); }
      };

      // Evitar listeners duplicados en clear-inventory
      const existingClear = byId('clear-inventory');
      if (existingClear) {
        const clone = existingClear.cloneNode(true);
        existingClear.parentNode.replaceChild(clone, existingClear);
        clone.addEventListener('click', async () => {
          if (!confirm(`¿Vaciar todo el inventario de ${miembro.displayName || miembro.username}?`)) return;
          const snapClear = await getDocs(query(collection(db, 'inventories'), where('userId', '==', miembro.id)));
          for (const d of snapClear.docs) await deleteDoc(d.ref);
          toast('Inventario vaciado');
          mostrarInventarioMiembro(miembro);
        });
      }
    }

    // abrir modal de forma robusta
    const modalEl = byId('modal-inventario');
    if (modalEl) {
      modalEl.hidden = false;
      requestAnimationFrame(() => modalEl.classList.add('active'));
      modalEl.querySelector('.modal-content')?.focus();
    } else {
      console.error('DEBUG: modal-inventario no encontrado en DOM');
    }
  } catch (err) {
    console.error('mostrarInventarioMiembro error:', err);
    toast('Error abriendo inventario: ' + (err.message || err), 'error');
  }
}

// ------------------ Crear member / item ------------------
byId('btn-crear-miembro')?.addEventListener('click', async () => {
  const nombre = (byId('mi-nombre')?.value || '').trim();
  if (!nombre) return toast('Nombre obligatorio', 'error');

  const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  const rango = byId('mi-rango')?.value || '';
  const tiene500 = byId('mi-500')?.checked || false;

  try {
    await setDoc(doc(db, 'profiles', id), { displayName: nombre, username: id, rankId: rango, tiene500 });
    toast('Miembro creado: ' + nombre);
    byId('mi-nombre').value = '';
  } catch (err) {
    console.error(err);
    toast('Error creando miembro: ' + (err.message || err), 'error');
  }
});

byId('btn-crear-catalogo')?.addEventListener('click', async () => {
  const nombre = (byId('cat-nombre')?.value || '').trim();
  const valor = Number(byId('cat-valor')?.value) || 0;
  const pagable = byId('cat-pagable')?.checked ?? true;
  const pctInput = (byId('cat-pct')?.value || '').trim();
  const imagen = (byId('cat-imagen')?.value || '').trim() || null;

  if (!nombre || valor <= 0) return toast('Nombre y valor válidos requeridos', 'error');

  // normalizamos el id (declarado antes de su uso)
  const itemId = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

  // parseo del porcentaje (si existe)
  let pct = null;
  if (pctInput !== '') {
    const n = Number(pctInput);
    if (isNaN(n) || n < 0 || n > 100) return toast('Porcentaje inválido (0-100)', 'error');
    pct = n / 100;
  }

  const docData = { nombre, valorBase: valor, pagable, pct };
  if (imagen) docData.imagen = imagen;

  try {
    await setDoc(doc(db, 'items', itemId), docData);
    toast('Objeto agregado al catálogo');
    // limpiar inputs
    if (byId('cat-nombre')) byId('cat-nombre').value = '';
    if (byId('cat-valor')) byId('cat-valor').value = '';
    if (byId('cat-pct')) byId('cat-pct').value = '';
    if (byId('cat-pagable')) byId('cat-pagable').checked = true;
    if (byId('cat-imagen')) byId('cat-imagen').value = '';
    // si usas realtime, el catálogo se actualizará automáticamente; si no, podrías llamar a cargarDatosIniciales() o renderCatalogo()
  } catch (err) {
    console.error(err);
    toast('Error creando item: ' + (err.message || err), 'error');
  }
});

// ------------------ Init UI ------------------
document.addEventListener('DOMContentLoaded', () => {
  // --- Inicializar vista activa o por defecto ---
  const activeNav = document.querySelector('.nav-btn.active');
  if (!activeNav) {
    const first = document.querySelector('.nav-btn[data-view]');
    if (first) {
      const view = first.dataset.view;
      first.classList.add('active');
      switchToView(view);
    }
  } else {
    const cur = activeNav.dataset.view;
    if (cur) switchToView(cur);
  }

  // --- Inicializar custom select de actividad ---
  const actividadSel = byId('actividad');
  if (actividadSel) createCustomSelectFromNative(actividadSel);

  // --- Botón visual para "Tiene 500 aportaciones" ---
  (function initMi500Toggle() {
    const chk = byId('mi-500');
    if (!chk) return;

    // buscar label contenedor o usar el padre
    const labelWrap = chk.closest('.checkbox-label') || chk.parentNode;

    // ocultar checkbox real
    chk.style.display = 'none';

    // crear botón visual
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mi-500-btn';
    btn.className = 'mi-500-btn';
    btn.setAttribute('aria-pressed', chk.checked ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.className = 'mi-500-icon';
    icon.textContent = chk.checked ? '🏆' : '❌';

    const txt = document.createElement('span');
    txt.className = 'mi-500-text';
    txt.textContent = chk.checked
      ? 'Tiene 500 aportaciones'
      : 'No tiene 500 (activar)';

    btn.appendChild(icon);
    btn.appendChild(txt);

    // insertar el botón en el label o junto al checkbox
    if (labelWrap) {
      const existingSpan = labelWrap.querySelector('span');
      if (existingSpan) existingSpan.remove();
      labelWrap.appendChild(btn);
    } else {
      chk.parentNode.insertBefore(btn, chk.nextSibling);
    }

    // sincronizar apariencia
    const syncBtn = () => {
      const is = !!chk.checked;
      icon.textContent = is ? '🏆' : '❌';
      txt.textContent = is ? 'Tiene 500 aportaciones' : 'No tiene 500 (activar)';
      btn.classList.toggle('active', is);
      btn.setAttribute('aria-pressed', is ? 'true' : 'false');
    };

    // toggle manual
    btn.addEventListener('click', () => {
      chk.checked = !chk.checked;
      syncBtn();
    });

    chk.addEventListener('change', syncBtn);
    syncBtn();
  })();

  // --- Forzar carga inicial si no hay datos ---
  if (!membersLocal.length) cargarDatosIniciales().catch(() => {});
});

// --- Botón de cambio de tema ---
if (!document.querySelector('.theme-toggle')) {
  const themeToggle = document.createElement('button');
  themeToggle.className = 'theme-toggle';
  themeToggle.setAttribute('aria-label', 'Cambiar tema');

  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.innerHTML = savedTheme === 'dark' ? '🌙' : '☀️';

  document.body.appendChild(themeToggle);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    themeToggle.innerHTML = newTheme === 'dark' ? '🌙' : '☀️';
  });
}
