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

// INIT - Actualizado 04/03
const WORKER_URL = 'https://inventario-lm-worker.ggoldenhhands.workers.dev/';
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
let inventoriesLocal = {};

// unsub helpers
let unsubscribeFns = [];
let isWatching = false;
const addUnsub = fn => typeof fn === 'function' && unsubscribeFns.push(fn);
const unsubscribeAll = () => { unsubscribeFns.forEach(f => { try { f(); } catch { } }); unsubscribeFns = []; isWatching = false; };

// utilidades
const escapeHtml = str => str == null ? '' : String(str)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

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

// ---------- Cálculo de porcentaje efectivo ----------
/**
 * Calcula el porcentaje efectivo a aplicar a un item.
 * Si el item tiene porcentaje fijo y el porcentaje del rango es superior,
 * usa el del rango. En caso contrario, usa el del item.
 * @param {number|null} itemFixedPct - Porcentaje fijo del item (0-1) o null
 * @param {number} rankPct - Porcentaje del rango (0-1)
 * @returns {number} Porcentaje efectivo (0-1)
 */
const calculateEffectivePercentage = (itemFixedPct, rankPct) => {
  if (itemFixedPct === null || typeof itemFixedPct !== 'number') {
    return rankPct;
  }
  // Si el porcentaje del rango es superior, usarlo
  return rankPct > itemFixedPct ? rankPct : itemFixedPct;
};

/**
 * Obtiene el porcentaje a aplicar de un miembro considerando 500 aportaciones
 * @param {Object} member - Objeto del miembro
 * @param {Object} rankData - Datos del rango
 * @returns {number} Porcentaje (0-1)
 */
const getMemberRankPercentage = (member, rankData) => {
  if (!rankData) return 0;
  if (member.tiene500 && typeof rankData.pct500 === 'number') {
    return rankData.pct500;
  }
  return typeof rankData.pct === 'number' ? rankData.pct : 0;
};

// ---------- Debouncing helper para optimización de búsquedas ----------
const createDebounce = (fn, delay = 300) => {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
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
  unsubscribeFns.forEach(f => { try { f(); } catch {} });
  unsubscribeFns = [];

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

  const textSpan = document.createElement('span');
  textSpan.className = 'custom-select-text';
  textSpan.textContent = (selectEl.selectedIndex >= 0 && selectEl.options[selectEl.selectedIndex]) ? selectEl.options[selectEl.selectedIndex].text : (placeholderOpt ? placeholderOpt.text : '-- selecciona --');

  const thumb = document.createElement('img');
  thumb.className = 'custom-select-thumb';
  // tamaño controlado por CSS; JS mantiene solo comportamiento
  thumb.style.objectFit = 'cover';
  thumb.style.borderRadius = '6px';
  thumb.style.marginRight = '0.5rem';
  thumb.style.display = 'none';

  if (selectEl.classList.contains('sel-item')) {
    const curOpt = selectEl.options[selectEl.selectedIndex];
    if (curOpt && curOpt.dataset && curOpt.dataset.image) {
      thumb.src = curOpt.dataset.image;
      thumb.style.display = '';
    }
    trigger.appendChild(thumb);
  }
  trigger.appendChild(textSpan);

  const list = document.createElement('div'); list.className = 'sugerencias';
  list.style.maxHeight = '220px';
  list.style.overflowY = 'auto';

  let searchInput = null;
  const enableSearch = selectEl.classList.contains('sel-item');
  if (enableSearch) {
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filtrar objetos...';
    searchInput.className = 'custom-select-search';
    searchInput.style.width = '100%';
    searchInput.style.boxSizing = 'border-box';
    searchInput.style.padding = '6px 8px';
    searchInput.style.marginBottom = '6px';
    list.appendChild(searchInput);
  }

  Array.from(selectEl.options).forEach(opt => {
    if (opt.value === '') return;
    const item = document.createElement('div');
    item.textContent = opt.text;
    if (opt.dataset && opt.dataset.value) item.dataset.value = opt.dataset.value;
    item.dataset.value = opt.value;
    if (opt.dataset && opt.dataset.image) item.dataset.image = opt.dataset.image;
    item.tabIndex = 0;

    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectEl.value = opt.value;
      textSpan.textContent = opt.text;
      if (opt.dataset && opt.dataset.image) {
        thumb.src = opt.dataset.image;
        thumb.style.display = '';
      } else {
        thumb.style.display = 'none';
      }
      list.classList.remove('active');
      wrapper.classList.remove('open'); // cerrar visualmente el wrapper también
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') item.click(); });
    list.appendChild(item);
  });

  selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
  wrapper.appendChild(trigger); wrapper.appendChild(list);

  // abrir/cerrar: toggle .active en lista y .open en wrapper; cierra otros selects abiertos
  trigger.addEventListener('click', ev => {
    ev.stopPropagation();

    // cerrar otros selects abiertos
    document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
      if (w !== wrapper) {
        w.classList.remove('open');
        const l = w.querySelector('.sugerencias');
        if (l) l.classList.remove('active');
      }
    });

    const now = list.classList.toggle('active');
    wrapper.classList.toggle('open', now);

    if (now && searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  });

  // actualizar visual al cambiar desde código
  selectEl.addEventListener('change', () => {
    const cur = selectEl.options[selectEl.selectedIndex];
    textSpan.textContent = cur ? cur.text : (placeholderOpt ? placeholderOpt.text : '-- selecciona --');
    if (cur && cur.dataset && cur.dataset.image) {
      thumb.src = cur.dataset.image;
      thumb.style.display = '';
    } else {
      thumb.style.display = 'none';
    }
  });

  // búsqueda/filtrado simple (si aplica)
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').trim().toLowerCase();
      Array.from(list.querySelectorAll('div')).forEach(node => {
        if (!node.dataset || !node.dataset.value) return;
        const text = (node.textContent || '').toLowerCase();
        node.style.display = q ? (text.includes(q) ? '' : 'none') : '';
      });
    });
  }
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
      const opt = document.createElement('option'); opt.value = c.id;
      opt.textContent = `${c.nombre} - ${formatNumber(Number(c.valorBase || 0))} $`;
      const fileName = c.imagen ? String(c.imagen) : 'default.png';
      const imageUrl = `./images/${encodeURIComponent(fileName)}`;
      opt.dataset.image = imageUrl;
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

  const chosenId = buscarMiembroInput?.dataset?.id;
  let member = null;

  if (chosenId) {
    member = membersLocal.find(m => m.id === chosenId) || null;
  } else {
    const q = (buscarMiembroInput?.value || '').trim().toLowerCase();
    if (q) {
      member = membersLocal.find(m => ((m.displayName || '').toLowerCase() === q) || ((m.username || '').toLowerCase() === q)) || null;
      if (!member) {
        member = membersLocal.find(m => ((m.displayName || '').toLowerCase().includes(q)) || ((m.username || '').toLowerCase().includes(q))) || null;
      }
    }
  }

  if (!member) return toast('Selecciona un miembro válido', 'error');

  // --- resto del submit sin cambios ---
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

    for (const it of items) {
      const q2 = query(collection(db, 'inventories'), where('userId', '==', member.id), where('itemId', '==', it.itemId));
      const snap = await getDocs(q2);
      if (!snap.empty) {
        const existing = snap.docs[0];
        const newQty = (existing.data().qty || 0) + it.qty;
        await updateDoc(existing.ref, { qty: newQty, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'inventories'), { userId: member.id, itemId: it.itemId, qty: it.qty, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
    }

    // calcular resumen con lógica de porcentaje efectivo...
    let totalValor = 0; const lootParts = [];
    const rango = ranks[member.rankId] || {};
    const pctRank = getMemberRankPercentage(member, rango);
    for (const it of items) {
      const pctItem = (typeof it.pct === 'number') ? it.pct : null;
      const eff = calculateEffectivePercentage(pctItem, pctRank);
      const valorUnit = Math.round((it.valorBase || 0) * eff);
      totalValor += valorUnit * (it.qty || 0);
      lootParts.push(`${it.nombre} x${it.qty}`);
    }
    const lootSummary = lootParts.join(', ');

    try {
      let authorName = auth.currentUser.email || auth.currentUser.uid;
      try {
        const admSnap = await getDoc(doc(db, 'admins', auth.currentUser.uid));
        if (admSnap.exists() && admSnap.data().displayName) authorName = admSnap.data().displayName;
      } catch (e) { }

      const idTokenPromise = getIdToken(auth.currentUser, true);
      const payload = {
        registryId: registryRef.id,
        authorId: auth.currentUser.uid,
        authorEmail: auth.currentUser.email,
        authorName,
        memberId: member.id,
        memberName: member.displayName || member.username || member.id,
        activity: actividad,
        items: items,
        lootSummary: lootSummary,
        totalValue: totalValor,
        createdAt: new Date().toISOString()
      };

      if (typeof WORKER_URL === 'undefined' || !WORKER_URL) {
        console.warn('DEBUG: WORKER_URL no está definido — salto el envío al worker (define WORKER_URL arriba del script).');
      } else {
        let idToken = null;
        try {
          idToken = await idTokenPromise;
          console.log('DEBUG: Obtenido idToken (long):', idToken ? idToken.length : 'no-token');
        } catch (errToken) {
          console.error('DEBUG: getIdToken falló:', errToken);
          toast('Aviso: no se pudo obtener idToken (posible bloqueador). Comprueba extensiones o prueba en incógnito.', 'error', 5000);
        }

        console.log('DEBUG: Intentando enviar payload al worker', WORKER_URL);
        console.log('DEBUG: payload', payload);

        const headers = { 'Content-Type': 'application/json' };
        if (idToken) headers['Authorization'] = 'Bearer ' + idToken;

        try {
          const resp = await fetch(WORKER_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
          const text = await resp.text().catch(() => '');
          console.log('DEBUG: Worker response status=', resp.status, 'body=', text);
          if (resp.ok) {
            await updateDoc(registryRef, { processed: true, processedAt: serverTimestamp() }).catch(() => { });
          } else {
            console.error('Worker returned error', resp.status, text);
            toast('Worker error: ' + resp.status + ' — ' + (text || resp.statusText), 'error', 6000);
          }
        } catch (errFetch) {
          console.error('Worker fetch error:', errFetch);
          toast('Worker fetch error: ' + (errFetch.message || errFetch), 'error', 6000);
        }
      }
    } catch (errOuter) {
      console.error('Error en la sección de envío al worker:', errOuter);
    }

    if (contenedorItems) contenedorItems.innerHTML = '';
    addItemRow();

    if (buscarMiembroInput) {
      buscarMiembroInput.value = '';
      buscarMiembroInput.dataset.id = '';
    }
    if (sugerenciasMiembro) {
      sugerenciasMiembro.classList.remove('active');
      sugerenciasMiembro.innerHTML = '';
    }

    const actividadEl = byId('actividad');
    if (actividadEl) {
      actividadEl.value = '';
      actividadEl.dispatchEvent(new Event('change', { bubbles: true }));
      const wrapper = actividadEl.nextElementSibling;
      if (wrapper && wrapper.classList && wrapper.classList.contains('custom-select-wrapper')) {
        const trigger = wrapper.querySelector('.custom-select-trigger');
        const placeholderOpt = actividadEl.querySelector('option[value=""]');
        const text = trigger.querySelector('.custom-select-text');
        if (text) text.textContent = placeholderOpt ? placeholderOpt.text : '-- selecciona --';
      }
    }

    toast('Registro guardado', 'info', 1400);
  } catch (err) {
    console.error(err); toast('Error guardando registro: ' + (err.message || err), 'error');
  }
});

// ---------- Editar Item del Catálogo ----------
async function mostrarEditarItem(item) {
  const modalContainer = document.createElement('div');
  modalContainer.className = 'edit-item-modal-container';
  modalContainer.innerHTML = `
    <div class="edit-item-modal" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:1rem;">
      <div style="background:var(--bg-2);border-radius:var(--radius);padding:2rem;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid var(--border);">
        <h3 style="margin-bottom:1.5rem;font-size:1.25rem;">Editar Objeto</h3>
        
        <div class="form-section">
          <label class="form-label">Nombre (no editable)</label>
          <input type="text" value="${escapeHtml(item.nombre)}" disabled style="opacity:0.6;" />
        </div>

        <div class="form-section">
          <label class="form-label">Valor Base ($)</label>
          <input id="edit-valor" type="number" value="${item.valorBase || 0}" min="1" />
        </div>

        <div class="form-section">
          <label class="form-label">Imagen (URL o nombre de archivo)</label>
          <input id="edit-imagen" type="text" value="${escapeHtml(item.imagen || '')}" placeholder="ej: ak-47.png" />
        </div>

        <div class="form-section">
          <label class="form-label">Porcentaje Fijo (%) - Dejar vacío para sin %</label>
          <input id="edit-pct" type="number" value="${item.pct !== null && typeof item.pct === 'number' ? Math.round(item.pct * 100) : ''}" min="0" max="100" placeholder="ej: 80" />
        </div>

        <div class="form-section">
          <label style="display:flex;align-items:center;gap:0.5rem;">
            <input id="edit-pagable" type="checkbox" ${item.pagable !== false ? 'checked' : ''} />
            <span>Es pagable</span>
          </label>
        </div>

        <div style="display:flex;gap:0.75rem;margin-top:2rem;">
          <button id="edit-cancel" class="btn-sec" style="flex:1;">Cancelar</button>
          <button id="edit-save" class="btn-pri" style="flex:1;">Guardar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);

  const btnCancel = modalContainer.querySelector('#edit-cancel');
  const btnSave = modalContainer.querySelector('#edit-save');
  const inputValor = modalContainer.querySelector('#edit-valor');
  const inputImagen = modalContainer.querySelector('#edit-imagen');
  const inputPct = modalContainer.querySelector('#edit-pct');
  const inputPagable = modalContainer.querySelector('#edit-pagable');

  btnCancel?.addEventListener('click', () => {
    modalContainer.remove();
  });

  btnSave?.addEventListener('click', async () => {
    try {
      const nuevoValor = Number(inputValor?.value) || 0;
      if (nuevoValor <= 0) {
        toast('Valor debe ser mayor a 0', 'error');
        return;
      }

      const nuevoImagen = (inputImagen?.value || '').trim() || null;
      const nuevoPctStr = (inputPct?.value || '').trim();
      let nuevoPct = item.pct;
      if (nuevoPctStr !== '') {
        const n = Number(nuevoPctStr);
        if (isNaN(n) || n < 0 || n > 100) {
          toast('Porcentaje debe estar entre 0-100', 'error');
          return;
        }
        nuevoPct = n / 100;
      } else {
        nuevoPct = null;
      }

      const nuevoPagable = inputPagable?.checked ?? true;

      const updateData = {
        valorBase: nuevoValor,
        pagable: nuevoPagable,
        pct: nuevoPct
      };
      if (nuevoImagen !== null) updateData.imagen = nuevoImagen;

      await updateDoc(doc(db, 'items', item.id), updateData);
      toast('Item actualizado', 'info', 1400);
      modalContainer.remove();
      renderCatalogo();
      // Actualizar catálogo local
      const idx = catalogo.findIndex(c => c.id === item.id);
      if (idx !== -1) {
        catalogo[idx] = { ...catalogo[idx], ...updateData };
      }
    } catch (err) {
      console.error(err);
      toast('Error actualizando item: ' + (err.message || err), 'error');
    }
  });

  // Cerrar al clickear fuera
  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
      modalContainer.remove();
    }
  });
}

// ------------------ Renders ------------------
function renderSelectRangos() {
  const sel = byId('mi-rango'); if (!sel) return;
  const rankEntries = Object.keys(ranks).map(k => ({ id: k, nivel: (ranks[k]?.nivel ?? 0) })).sort((a, b) => b.nivel - a.nivel);
  sel.innerHTML = '<option value="">-- Selecciona un rango --</option>' + rankEntries.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)}</option>`).join('');
  createCustomSelectFromNative(sel);
}

function renderCatalogo() {
  const lista = listaCatalogoEl || byId('lista-catalogo');
  if (!lista) return;

  lista.innerHTML = '';
  if (!catalogo.length) {
    lista.innerHTML = '<p class="sub">No hay items en el catálogo</p>';
    return;
  }

  catalogo.forEach(c => {
    const el = document.createElement('div');
    el.className = 'catalogo-item';

    const pagable = (c.pagable === false) ? ' • No pagable' : '';
    const valorFmt = formatNumber(Number(c.valorBase || 0));
    const pctBadge = (typeof c.pct === 'number')
      ? `<span class="pct-badge" title="Porcentaje fijo del item">${Math.round(c.pct * 100)}%</span>`
      : '';

    const fileName = c.imagen ? String(c.imagen) : 'default.png';
    const imageUrl = `./images/${encodeURIComponent(fileName)}`;

    el.innerHTML = `
      <div style="display:flex;gap:0.75rem;align-items:center;min-width:0;">
        <div class="catalogo-image">
          <img
            src="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(c.nombre)}"
            loading="lazy"
          />
        </div>

        <div style="display:flex;flex-direction:column;gap:0.25rem;min-width:0;">
          <div style="display:flex;gap:0.5rem;align-items:center;min-width:0;">
            <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(c.nombre)}
            </strong>
            ${pctBadge}
          </div>

          <div class="small" style="margin-top:0.2rem;text-align:left;">
            Valor por: ${valorFmt}${pagable}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:row;align-items:center;gap:0.5rem;">
        <span
          class="value-badge"
          title="Valor del item"
          style="font-weight:700;padding:0.25rem 0.5rem;border-radius:8px;border:1px solid var(--border);min-width:70px;text-align:right;"
        >
          ${valorFmt} $
        </span>
        <button class="btn-edit-item" data-id="${c.id}" title="Editar">✏️</button>
        <button class="btn-delete" data-id="${c.id}">🗑️</button>
      </div>
    `;

    el.querySelector('.btn-edit-item')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await mostrarEditarItem(c);
    });

    el.querySelector('.btn-delete')?.addEventListener('click', async () => {
      if (!confirm('¿Borrar objeto del catálogo?')) return;
      try {
        await deleteDoc(doc(db, 'items', c.id));
        toast('Objeto eliminado');
      } catch (err) {
        console.error(err);
        toast('Error borrando item: ' + (err.message || err), 'error');
      }
    });

    lista.appendChild(el);
  });
}

function renderMiembros(filter = '') {
  const grid = byId('grid-miembros'); if (!grid) return; grid.innerHTML = '';
  const q = (filter || '').trim().toLowerCase();

  const sorted = [...membersLocal].sort((a, b) => (ranks[b.rankId]?.nivel || 0) - (ranks[a.rankId]?.nivel || 0));
  const filtered = q ? sorted.filter(m => {
    const name = (m.displayName || m.username || '').toLowerCase();
    return name.includes(q);
  }) : sorted;

  if (!filtered.length) {
    grid.innerHTML = '<p class="sub">No se encontraron miembros</p>';
    return;
  }

  filtered.forEach(m => grid.appendChild(createMemberCard(m)));
}

function renderInventariosGrid(filter = '') {
  const grid = byId('grid-inventarios'); if (!grid) return; grid.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const membersSorted = [...membersLocal].sort((a, b) => (ranks[b.rankId]?.nivel || 0) - (ranks[a.rankId]?.nivel || 0));
  if (!membersSorted.length) { grid.innerHTML = '<p class="sub">No se encontraron miembros</p>'; return; }

  membersSorted.forEach(m => {
    const name = (m.displayName || m.username || m.id || '').toString();
    if (q && !name.toLowerCase().includes(q)) return;
    const inv = inventoriesLocal[m.id] || [];
    const totalItems = inv.reduce((s, it) => s + (Number(it.qty) || 0), 0);
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
        const invQ = query(collection(db, 'inventories'), where('userId', '==', id));
        const invSnap = await getDocs(invQ);
        for (const d of invSnap.docs) await deleteDoc(d.ref);

        const regQ = query(collection(db, 'registries'), where('memberId', '==', id));
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

  // Toggle 500 - botón
  const btnToggle = card.querySelector('.btn-toggle-500');
  if (btnToggle) {
    btnToggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btnToggle.dataset.id;
      if (!id) return;
      const memberLocal = membersLocal.find(m => m.id === id) || member;
      const current = !!memberLocal.tiene500;
      const next = !current;

      btnToggle.textContent = next ? '🎖️ 500' : '➕ 500';
      btnToggle.classList.toggle('active', next);

      try {
        await updateDoc(doc(db, 'profiles', id), { tiene500: next });
        if (memberLocal) memberLocal.tiene500 = next;
        toast(`500 aportaciones ${next ? 'activadas' : 'desactivadas'}`, 'info', 1400);
      } catch (err) {
        btnToggle.textContent = current ? '🎖️ 500' : '➕ 500';
        btnToggle.classList.toggle('active', current);
        console.error('Error toggling tiene500:', err);
        toast('Error actualizando (500): ' + (err.message || err), 'error');
      }
    });

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
  }).slice(0, 8);
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

// Debounce la búsqueda de miembros para mejor rendimiento
const debouncedShowMemberSuggestions = createDebounce(showMemberSuggestions, 150);

buscarMiembroInput?.addEventListener('input', (e) => {
  const q = (e.target.value || '').trim().toLowerCase();
  if (buscarMiembroInput.dataset.id) {
    const sel = membersLocal.find(m => m.id === buscarMiembroInput.dataset.id);
    if (!sel || ((sel.displayName || sel.username || '').toLowerCase() !== (e.target.value || '').toLowerCase())) buscarMiembroInput.dataset.id = '';
  }
  debouncedShowMemberSuggestions(q);
});

document.addEventListener('click', (e) => {
  const target = e.target;
  if (target === buscarMiembroInput || (sugerenciasMiembro && sugerenciasMiembro.contains(target))) return;
  if (sugerenciasMiembro) sugerenciasMiembro.classList.remove('active');
});

const modal = byId('modal-inventario');
const modalClose = byId('modal-close');

modalClose?.addEventListener('click', () => {
  if (!modal) return;
  modal.classList.remove('active');
  modal.hidden = true;
});

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

    // Crear un Map para búsquedas O(1) en lugar de O(n)
    const catalogoMap = new Map(catalogo.map(c => [c.id, c]));

    const rango = ranks[miembro.rankId] || {};
    const basePct = (typeof rango.pct === 'number') ? rango.pct : 0;
    const pct500 = (typeof rango.pct500 === 'number') ? rango.pct500 : null;
    const pctRank = getMemberRankPercentage(miembro, rango);
    const extraPct = (miembro.tiene500 && pct500 !== null && pct500 > basePct) ? Math.round((pct500 - basePct) * 100) : 0;

    const totalObjetos = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

    let totalValor = 0;
    for (const it of items) {
      const itemMeta = catalogoMap.get(it.itemId) || {};
      const pctItem = (typeof itemMeta.pct === 'number') ? itemMeta.pct : null;
      const eff = calculateEffectivePercentage(pctItem, pctRank);
      const valorUnit = Math.round((itemMeta.valorBase || 0) * eff);
      totalValor += valorUnit * (it.qty || 0);
    }
    const totalValorFmt = formatNumber(totalValor);

    const rangoNombre = miembro.rankId || '—';
    const basePctDisplay = Math.round(basePct * 100);
    let badgeInside = `${basePctDisplay}%`;
    if (miembro.tiene500 && extraPct > 0) {
      badgeInside = `${basePctDisplay}% + ${extraPct}% POR 500 APORTACIONES`;
    }

    byId('modal-titulo').innerHTML = `
      <span style="font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(String(rangoNombre))}</span>
      <span class="rango-badge-detail" style="margin-left:0.5rem;padding:4px 8px;border-radius:8px;border:1px solid var(--border);font-weight:700;">[${escapeHtml(badgeInside)}]</span>
    `;

    byId('modal-subtitulo').innerHTML = `
      <span style="font-weight:600;opacity:0.95;">${escapeHtml(miembro.displayName || miembro.username || miembro.id)}</span>
    `;

    const body = byId('modal-body');
    if (!body) { console.error('DEBUG: modal-body no encontrado en DOM'); toast('Error: modal no configurado en el HTML', 'error'); return; }

    let itemCards = '';
    if (items.length) {
      itemCards = items.map(it => {
        const itemMeta = catalogoMap.get(it.itemId) || {};
        const pctItem = (typeof itemMeta.pct === 'number') ? itemMeta.pct : null;
        const eff = calculateEffectivePercentage(pctItem, pctRank);
        const valorUnit = Math.round((itemMeta.valorBase || 0) * eff);

        const fileName = itemMeta.imagen ? String(itemMeta.imagen) : 'default.png';
        const imageUrl = `./images/${encodeURIComponent(fileName)}`;

        // Solo mostrar el porcentaje efectivo (el más alto)
        let pctHtml = '';
        if (pctItem !== null || pctRank > 0) {
          const effDisplay = Math.round(eff * 100);
          pctHtml = ` <strong class="pct-strong">${effDisplay}%</strong>`;
        }

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
    }

    body.innerHTML = `
      <div class="modal-top" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:1rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div style="font-weight:700;text-transform:uppercase;">Objetos en inventario:</div>
          <span class="header-badge items-badge" style="font-weight:700;padding:0.2rem 0.5rem;border-radius:8px;border:1px solid var(--border);">${totalObjetos}</span>
        </div>

        <div style="display:flex;align-items:center;gap:0.5rem;">
          <button class="btn-delete btn-delete--big" id="clear-inventory">Vaciar inventario</button>
          <span class="header-badge total-badge" style="font-weight:700;padding:0.2rem 0.5rem;border-radius:8px;border:1px solid var(--border);">Valor total: <strong>${totalValorFmt} $</strong></span>
        </div>
      </div>

      ${items.length ? `<div class="inventario-items">${itemCards}</div>` : `<p class="sub">Este miembro no tiene objetos en su inventario</p>`}
    `;

    body.onclick = async (e) => {
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

  const itemId = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

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
    if (byId('cat-nombre')) byId('cat-nombre').value = '';
    if (byId('cat-valor')) byId('cat-valor').value = '';
    if (byId('cat-pct')) byId('cat-pct').value = '';
    if (byId('cat-pagable')) byId('cat-pagable').checked = true;
    if (byId('cat-imagen')) byId('cat-imagen').value = '';
  } catch (err) {
    console.error(err);
    toast('Error creando item: ' + (err.message || err), 'error');
  }
});

document.addEventListener('click', (e) => {
  document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
    if (!w.contains(e.target)) {
      w.classList.remove('open');
      const l = w.querySelector('.sugerencias');
      if (l) l.classList.remove('active');
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
      w.classList.remove('open');
      w.querySelector('.sugerencias')?.classList.remove('active');
    });
  }
});

// ------------------ Init UI ------------------
document.addEventListener('DOMContentLoaded', () => {
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

  const actividadSel = byId('actividad');
  if (actividadSel) createCustomSelectFromNative(actividadSel);

  (function initMi500Toggle() {
    const chk = byId('mi-500');
    if (!chk) return;

    const labelWrap = chk.closest('.checkbox-label') || chk.parentNode;

    chk.style.display = 'none';

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

    if (labelWrap) {
      const existingSpan = labelWrap.querySelector('span');
      if (existingSpan) existingSpan.remove();
      labelWrap.appendChild(btn);
    } else {
      chk.parentNode.insertBefore(btn, chk.nextSibling);
    }

    const syncBtn = () => {
      const is = !!chk.checked;
      icon.textContent = is ? '🏆' : '❌';
      txt.textContent = is ? 'Tiene 500 aportaciones' : 'No tiene 500 (activar)';
      btn.classList.toggle('active', is);
      btn.setAttribute('aria-pressed', is ? 'true' : 'false');
    };

    btn.addEventListener('click', () => {
      chk.checked = !chk.checked;
      syncBtn();
    });

    chk.addEventListener('change', syncBtn);
    syncBtn();
  })();

  if (!membersLocal.length) cargarDatosIniciales().catch(() => { });
});

// Debounce para los filtros de búsqueda
const debouncedRenderMiembros = createDebounce((q) => {
  renderMiembros(q);
  renderInventariosGrid(q);
}, 200);

const debouncedRenderInventarios = createDebounce((q) => {
  renderInventariosGrid(q);
}, 200);

byId('filtro-miembros')?.addEventListener('input', (e) => {
  const q = (e.target.value || '').trim();
  debouncedRenderMiembros(q);
});

byId('buscador-inventario')?.addEventListener('input', (e) => {
  const q = (e.target.value || '').trim();
  debouncedRenderInventarios(q);
});

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
