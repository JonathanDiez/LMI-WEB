// app.js
// Lógica principal en español. Modular. Asegúrate de haber rellenado firebase-config.js
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// ------ CONFIG / CONSTANTES ------
const WEBHOOK_URL = "https://discord.com/api/webhooks/1433053884288602222/ecqxy7VTWOTJ13pCidyMotjSJwg-SyDIExw6KpzN6v-3TZepLTDxbI0tRQM488q5pNKX"; // <-- pega tu webhook (si lo expones)
const DISCORD_CLIENT_ID = "1433087733433372712"; // opcional para login Discord
const DISCORD_REDIRECT = "https://jonathandiez.github.io/LMI-WEB/"; // redirige al root

// ------ DOM ------
const seccionLogin = document.getElementById('seccion-login');
const seccionDashboard = document.getElementById('seccion-dashboard');
const btnEntrar = document.getElementById('btn-entrar');
const btnDiscord = document.getElementById('btn-discord');
const btnLogout = document.getElementById('btn-logout');
const btnLogoutSidebar = document.getElementById('btn-logout-sidebar');

const userBadge = document.getElementById('user-badge');
const userAvatar = document.getElementById('user-avatar');
const userNombre = document.getElementById('user-nombre');

const navBtns = Array.from(document.getElementsByClassName('nav-btn'));
const views = Array.from(document.getElementsByClassName('view'));

const buscarMiembroInput = document.getElementById('buscar-miembro');
const sugerenciasMiembro = document.getElementById('sugerencias-miembro');
const contenedorItems = document.getElementById('contenedor-items');
const btnAddItem = document.getElementById('btn-add-item');
const actividadSel = document.getElementById('actividad');
const formRegistro = document.getElementById('form-registro');

const miNombre = document.getElementById('mi-nombre');
const miDiscordId = document.getElementById('mi-discordId');
const miAvatar = document.getElementById('mi-avatar');
const miRango = document.getElementById('mi-rango');
const mi500 = document.getElementById('mi-500');
const btnCrearMiembro = document.getElementById('btn-crear-miembro');
const filtroMiembros = document.getElementById('filtro-miembros');
const gridMiembros = document.getElementById('grid-miembros');

const listaRangosDiv = document.getElementById('lista-rangos');
const rangoIdIn = document.getElementById('rango-id');
const rangoNivel = document.getElementById('rango-nivel');
const rangoColor = document.getElementById('rango-color');
const rangoPct = document.getElementById('rango-pct');
const rangoPct500 = document.getElementById('rango-pct500');
const btnCrearRango = document.getElementById('btn-crear-rango');

const listaCatalogoDiv = document.getElementById('lista-catalogo');
const catNombre = document.getElementById('cat-nombre');
const catValor = document.getElementById('cat-valor');
const catEx = document.getElementById('cat-excepcion');
const catPagable = document.getElementById('cat-pagable');
const btnCrearCatalogo = document.getElementById('btn-crear-catalogo');

const buscadorInventario = document.getElementById('buscador-inventario');
const gridInventarios = document.getElementById('grid-inventarios');

const toastsEl = document.getElementById('toasts');

// ------ ESTADO ------
let catalogo = [];
let miembros = [];
let rangos = {};
let usuarioActual = null;

// ------ UTILS: toasts ------
function toast(msg, type = "info", timeout = 3000) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.innerHTML = `<div>${msg}</div>`;
  toastsEl.appendChild(el);
  setTimeout(()=> el.style.opacity = '0.0', timeout - 400);
  setTimeout(()=> el.remove(), timeout);
}

// ------ VISTA: navegación simple ------
navBtns.forEach(b => b.addEventListener('click', () => {
  navBtns.forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const view = b.dataset.view;
  views.forEach(v => v.classList.remove('active'));
  const node = document.getElementById('view-' + view);
  if (node) node.classList.add('active');
}));

// ------ AUTH: Login email/password ------
btnEntrar.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!email || !password) { toast('Rellena email y contraseña', 'error'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toast('Sesión iniciada', 'info');
  } catch (err) {
    console.error('login err', err);
    toast('Error al iniciar sesión: ' + (err.message || err.code), 'error');
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.reload();
  } catch (e) { console.error(e); toast('Error cerrando sesión','error'); }
});
btnLogoutSidebar.addEventListener('click', async () => {
  try { await signOut(auth); window.location.reload(); } catch(e){ toast('Error cerrando sesión','error'); }
});

// ------ DISCORD OAUTH (popup, implícito) ------
btnDiscord.addEventListener('click', () => {
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "TU_CLIENT_ID_DISCORD") {
    toast('Pega tu Client ID de Discord en firebase-config.js/app.js para activar OAuth', 'error', 4500);
    return;
  }
  const scopes = encodeURIComponent('identify email');
  const redirect = encodeURIComponent(DISCORD_REDIRECT);
  const url = `https://discord.com/oauth2/authorize?client_id=1433087733433372712&response_type=code&redirect_uri=https%3A%2F%2Fjonathandiez.github.io%2FLMI-WEB%2F&scope=email+identify`;
  const w = window.open(url, 'discord_oauth', 'width=600,height=700');
  // recibir token desde popup (ver abajo)
});

window.addEventListener('message', (ev) => {
  if (ev.data?.discord_token) {
    const t = ev.data.discord_token;
    sessionStorage.setItem('discord_token', t);
    cargarPerfilDiscord(t);
    toast('Discord: identidad añadida', 'info');
  }
});

// Si la página recibe un hash de OAuth (esto ocurre si Discord redirige aquí)
// y la ventana tiene opener, avisamos al opener y cerramos la popup.
(function handleRedirectToken(){
  const hash = location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    if (token && window.opener) {
      window.opener.postMessage({discord_token: token}, window.location.origin);
      try { window.close(); } catch(e){ /* noop */ }
    } else if (token) {
      sessionStorage.setItem('discord_token', token);
    }
    // limpiar hash sin recargar
    history.replaceState(null, '', window.location.pathname);
  }
})();

async function cargarPerfilDiscord(token) {
  try {
    const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const user = await r.json();
    // montar avatar
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : '';
    if (userAvatar) { userAvatar.src = avatarURL; userAvatar.style.display = avatarURL ? 'block' : 'none'; }
    if (userNombre) userNombre.textContent = `${user.username}#${user.discriminator}`;
    userBadge.style.display = 'flex';
  } catch (e) {
    console.error('discord perfil error', e);
  }
}

// ------ AUTH STATE ------
onAuthStateChanged(auth, async user => {
  usuarioActual = user;
  if (user) {
    seccionLogin.style.display = 'none';
    seccionDashboard.style.display = 'flex';
    // mostrar badge básico
    userBadge.style.display = 'flex';
    userNombre.textContent = user.email || user.uid;
    userAvatar.src = ''; userAvatar.style.display = 'none';
    // si hay token discord en session, cargar perfil
    const tk = sessionStorage.getItem('discord_token');
    if (tk) cargarPerfilDiscord(tk);
    // cargar datos
    await cargarDatosIniciales();
  } else {
    seccionLogin.style.display = 'block';
    seccionDashboard.style.display = 'none';
    userBadge.style.display = 'none';
  }
});

// ------ CARGA DATOS ------
async function cargarDatosIniciales() {
  // rangos
  const rSnap = await getDocs(collection(db, "rangos"));
  rangos = {}; rSnap.forEach(d => rangos[d.id] = d.data());
  renderRangos();

  // catalogo
  const cSnap = await getDocs(collection(db, "catalogo"));
  catalogo = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCatalogo();

  // miembros
  const mSnap = await getDocs(collection(db, "miembros"));
  miembros = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMiembros(miembros);

  // preparar items y selects
  contenedorItems.innerHTML = '';
  addItemRow();
  renderSelectRangos();
  await precargarInventarios();
}

// ------ RENDER Y CRUD CATALOGO ------
function renderCatalogo() {
  listaCatalogoDiv.innerHTML = '';
  catalogo.forEach(c => {
    const el = document.createElement('div');
    el.className = 'fila';
    el.innerHTML = `<div style="flex:1">${c.nombre} — $${c.valorBase} ${c.pctExcepcion ? '• excep' : ''} ${c.pagable === false ? '• no pagable' : ''}</div>
      <div><button data-id="${c.id}" class="btn-borrar-cat btn-sec">Borrar</button></div>`;
    listaCatalogoDiv.appendChild(el);
  });
  Array.from(document.getElementsByClassName('btn-borrar-cat')).forEach(b => {
    b.onclick = async (e) => {
      const id = e.target.dataset.id;
      if (!confirm('Borrar objeto del catálogo?')) return;
      await deleteDoc(doc(db, "catalogo", id));
      toast('Objeto borrado', 'info');
      await cargarDatosIniciales();
    };
  });
}
btnCrearCatalogo.addEventListener('click', async () => {
  // validaciones
  const nombre = catNombre.value.trim();
  const valor = Number(catValor.value) || 0;
  const ex = catEx.value.trim() === '' ? null : Number(catEx.value);
  const pag = catPagable.checked;
  if (!nombre || valor <= 0) return toast('Nombre y valor válidos', 'error');
  const id = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  await setDoc(doc(db, "catalogo", id), { nombre, valorBase: valor, pctExcepcion: ex, pagable: pag });
  toast('Objeto creado', 'info');
  catNombre.value = ''; catValor.value = ''; catEx.value = ''; catPagable.checked = true;
  await cargarDatosIniciales();
});

// ------ RANGOS CRUD ------
function renderRangos() {
  listaRangosDiv.innerHTML = '';
  Object.keys(rangos).sort((a,b)=> (rangos[b].nivel||0)-(rangos[a].nivel||0)).forEach(k=>{
    const r = rangos[k];
    const div = document.createElement('div');
    div.style.display = 'flex'; div.style.justifyContent = 'space-between'; div.style.alignItems='center';
    div.innerHTML = `<div><strong>${k}</strong> — Nivel ${r.nivel} • Pct ${r.pct} • Pct500 ${r.pct500}</div>
      <div><button data-id="${k}" class="btn-eliminar-rango btn-sec">Borrar</button></div>`;
    listaRangosDiv.appendChild(div);
  });
  Array.from(document.getElementsByClassName('btn-eliminar-rango')).forEach(b=>{
    b.onclick = async e => {
      const id = e.target.dataset.id;
      if (!confirm('Eliminar rango '+id+' ?')) return;
      await deleteDoc(doc(db,"rangos",id));
      toast('Rango eliminado','info');
      await cargarDatosIniciales();
    };
  });
}
btnCrearRango.addEventListener('click', async ()=>{
  const id = rangoIdIn.value.trim();
  if (!id) return toast('ID de rango requerido','error');
  const nivel = Number(rangoNivel.value) || 1;
  const color = rangoColor.value.trim() || '#999999';
  const pct = Number(rangoPct.value) || 0;
  const pct500 = Number(rangoPct500.value) || pct;
  await setDoc(doc(db,"rangos",id), { nivel, color, pct, pct500 });
  toast('Rango creado/actualizado','info');
  rangoIdIn.value=''; rangoNivel.value=''; rangoColor.value=''; rangoPct.value=''; rangoPct500.value='';
  await cargarDatosIniciales();
});

// ------ MIEMBROS CRUD ------
function renderSelectRangos() {
  miRango.innerHTML = `<option value="">-- Rango (opcional) --</option>` + Object.keys(rangos).map(k=>`<option value="${k}">${k}</option>`).join('');
}
btnCrearMiembro.addEventListener('click', async ()=>{
  if (!usuarioActual) return toast('Inicia sesión','error');
  // comprobar admin
  const adm = await getDoc(doc(db,"administradores",usuarioActual.uid));
  if (!adm.exists) return toast('No tienes permisos para crear miembros','error');
  const nombre = miNombre.value.trim();
  if (!nombre) return toast('Nombre obligatorio','error');
  const id = nombre.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-_]/g,'');
  await setDoc(doc(db,"miembros",id), {
    discordId: miDiscordId.value.trim() || null,
    nombre,
    avatarURL: miAvatar.value.trim() || null,
    rangoId: miRango.value || null,
    tiene500: mi500.checked || false,
    updatedAt: serverTimestamp()
  });
  toast('Miembro creado: ' + nombre, 'info');
  miNombre.value=''; miDiscordId.value=''; miAvatar.value=''; mi500.checked=false;
  await cargarDatosIniciales();
});

function renderMiembros(list){
  gridMiembros.innerHTML = '';
  list.forEach(m=>{
    const el = document.createElement('div');
    el.className = 'miembro-card';
    el.innerHTML = `<div class="avatar"></div>
      <div class="info"><strong>${m.nombre}</strong> ${m.tiene500?'<span class="small">500+</span>':''}
      <div class="small">Rango: ${m.rangoId||'—'}</div>
      <div id="inv-${m.id}" class="small"></div></div>
      <div class="controls">
        <button data-id="${m.id}" class="btn-ver btn-sec">Ver</button>
        <button data-id="${m.id}" class="btn-edit btn-sec">Editar</button>
        <button data-id="${m.id}" class="btn-del btn-sec">Borrar</button>
      </div>`;
    gridMiembros.appendChild(el);

    el.querySelector('.btn-ver').onclick = ()=> mostrarInventarioDetalle(m);
    el.querySelector('.btn-edit').onclick = ()=> editarMiembroPrompt(m);
    el.querySelector('.btn-del').onclick = async ()=>{
      if (!confirm('Borrar miembro '+m.nombre+' ?')) return;
      await deleteDoc(doc(db,"miembros",m.id));
      toast('Miembro eliminado','info');
      await cargarDatosIniciales();
    };
  });
}

async function editarMiembroPrompt(m){
  const nuevo = prompt('Nuevo nombre para '+m.nombre, m.nombre);
  if (!nuevo) return;
  await updateDoc(doc(db,"miembros",m.id), { nombre: nuevo, updatedAt: serverTimestamp() });
  toast('Miembro actualizado','info');
  await cargarDatosIniciales();
}

// buscar/autocomplete miembros
buscarMiembroInput.addEventListener('input', ()=>{
  const q = buscarMiembroInput.value.trim().toLowerCase();
  sugerenciasMiembro.innerHTML = '';
  if (!q) return;
  const matches = miembros.filter(m => (m.nombre||'').toLowerCase().includes(q)).slice(0,8);
  matches.forEach(m=>{
    const d = document.createElement('div'); d.textContent = m.nombre; d.style.cursor='pointer';
    d.onclick = ()=> { buscarMiembroInput.value = m.nombre; buscarMiembroInput.dataset.id = m.id; sugerenciasMiembro.innerHTML=''; };
    sugerenciasMiembro.appendChild(d);
  });
});

// ------ ITEMS DINÁMICOS PARA FORMULARIO ------
function addItemRow(pref={}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `<select class="sel-item">${catalogo.map(c=>`<option value="${c.id}">${c.nombre} ($${c.valorBase})</option>`).join('')}</select>
    <input class="qty-item" type="number" min="1" value="${pref.qty||1}" />
    <button class="btn-remove-item" type="button">Eliminar</button>`;
  contenedorItems.appendChild(row);
  row.querySelector('.btn-remove-item').onclick = ()=> row.remove();
}
btnAddItem.addEventListener('click', ()=> addItemRow());

// ------ ENVIAR FORMULARIO: validar, guardar y enviar embed ------
formRegistro.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!usuarioActual) return toast('Inicia sesión','error');
  const memberId = buscarMiembroInput.dataset.id;
  if (!memberId) return toast('Selecciona un miembro válido','error');
  const filas = Array.from(contenedorItems.querySelectorAll('.item-row'));
  if (filas.length === 0) return toast('Añade al menos un objeto','error');
  const actividad = actividadSel.value || '';
  if (!actividad) return toast('Selecciona la actividad','error');

  const items = filas.map(r=>{
    const id = r.querySelector('.sel-item').value;
    const qty = Number(r.querySelector('.qty-item').value) || 0;
    const ci = catalogo.find(c=>c.id===id);
    return { itemId:id, nombre:ci.nombre, qty, valorBase:ci.valorBase, pctExcepcion:ci.pctExcepcion===undefined?null:ci.pctExcepcion, pagable:ci.pagable===undefined?true:ci.pagable, removed:false };
  });

  // comprobar admin
  const adm = await getDoc(doc(db,"administradores",usuarioActual.uid));
  if (!adm.exists) return toast('No tienes permisos para crear registros','error');

  // guardar registro
  const docRef = await addDoc(collection(db,"registrosBotin"), {
    memberId, items, activity:actividad, timestamp: serverTimestamp(), enviadoPor: usuarioActual.uid
  });

  toast('Registro guardado', 'info');

  // construir embed para Discord
  if (WEBHOOK_URL && WEBHOOK_URL !== "TU_WEBHOOK_AQUI") {
    try {
      const memberDoc = await getDoc(doc(db,"miembros",memberId));
      const member = memberDoc.exists() ? memberDoc.data() : { nombre: buscarMiembroInput.value };
      // calcular totales por item usando rangos
      const rangoDoc = member.rangoId ? (await getDoc(doc(db,"rangos",member.rangoId))).data() : null;
      const pctBase = rangoDoc ? rangoDoc.pct : 0;
      const pct500 = rangoDoc ? rangoDoc.pct500 : pctBase;
      const usarPct = member.tiene500 ? pct500 : pctBase;
      const fields = [
        { name: 'Miembro', value: member.nombre || buscarMiembroInput.value, inline:true },
        { name: 'Actividad', value: actividad, inline:true },
        { name: 'Enviado por', value: usuarioActual.email || usuarioActual.uid, inline:true }
      ];
      let totalEmbed = 0;
      for (const it of items) {
        let pct = (it.pctExcepcion!==null && it.pctExcepcion!==undefined) ? it.pctExcepcion : usarPct;
        if (it.pagable === false) pct = 0;
        const valorCada = Math.round(it.valorBase * pct);
        const tot = valorCada * it.qty;
        totalEmbed += tot;
        fields.push({ name: `${it.qty}× ${it.nombre}`, value: `$${valorCada} c/u → $${tot}` });
      }
      fields.push({ name: 'Total a pagar', value: `$${totalEmbed}`, inline:true });

      const payload = {
        username: "Registro botín",
        embeds: [{
          title: `Registro - ${member.nombre || buscarMiembroInput.value}`,
          description: `Actividad: ${actividad}`,
          color: 65280,
          fields: fields,
          timestamp: new Date().toISOString()
        }]
      };

      await fetch(WEBHOOK_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      toast('Embed enviado a Discord', 'info');
    } catch (e) {
      console.error('error webhook', e);
      toast('Error enviando embed','error');
    }
  } else {
    toast('Webhook no configurado. Registro guardado solo en Firestore', 'info');
  }

  // limpiar formulario
  contenedorItems.innerHTML=''; addItemRow(); buscarMiembroInput.value=''; delete buscarMiembroInput.dataset.id;
  await precargarInventarios();
});

// ------ PRECARGAR INVENTARIOS y render inventarios ------
async function precargarInventarios() {
  const regsSnap = await getDocs(collection(db,"registrosBotin"));
  const regs = regsSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  const agrup = {};
  regs.forEach(r => { if (!agrup[r.memberId]) agrup[r.memberId]=[]; agrup[r.memberId].push(r); });

  // construir inventario por miembro (items separados por registro)
  miembros.forEach(m => {
    const registros = agrup[m.id] || [];
    const lista = [];
    for (const reg of registros) {
      for (const it of reg.items || []) {
        if (it.removed) continue;
        lista.push({ ...it, registroId: reg.id, timestamp: reg.timestamp });
      }
    }
    m.inventario = lista;
    // calcular valor teniendo en cuenta rangos y excepciones
    const rangoDoc = m.rangoId ? rangos[m.rangoId] : null;
    const pctBase = rangoDoc ? rangoDoc.pct : 0;
    const pct500 = rangoDoc ? rangoDoc.pct500 : pctBase;
    const usarPct = m.tiene500 ? pct500 : pctBase;
    let total = 0;
    m.inventarioPagos = m.inventario.map(it => {
      const pct = (it.pctExcepcion!==null && it.pctExcepcion!==undefined) ? it.pctExcepcion : usarPct;
      if (it.pagable === false) return { ...it, valorCada:0, total:0, pctUsed:0 };
      const valorCada = Math.round(it.valorBase * pct);
      const t = valorCada * it.qty;
      total += t;
      return { ...it, valorCada, total: t, pctUsed: pct };
    });
    m.totalAPagar = total;
  });

  renderInventariosGrid(miembros);
  renderMiembrosSummary(miembros);
}

function renderMiembrosSummary(lista) {
  // actualiza la vista de miembros con un resumen
  lista.forEach(m => {
    const el = document.getElementById(`inv-${m.id}`);
    if (el) {
      el.innerHTML = (m.inventarioPagos||[]).slice(0,4).map(it => `${it.qty}× ${it.nombre} → $${it.valorCada}`).join('<br>') || 'Sin items';
    }
  });
}

function renderInventariosGrid(lista) {
  gridInventarios.innerHTML = '';
  lista.forEach(m => {
    const card = document.createElement('div');
    card.className = 'card card-item';
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <strong>${m.nombre}</strong>
      <div class="small">Total: $${m.totalAPagar||0}</div>
    </div>
    <div class="small">Rango: ${m.rangoId||'—'}</div>
    <div style="margin-top:8px">${(m.inventarioPagos||[]).map(it=>`<div>${it.qty}× ${it.nombre} • $${it.valorCada} c/u • tot $${it.total}</div>`).join('')}</div>
    <div style="margin-top:8px"><button data-id="${m.id}" class="btn-detalle btn-sec">Abrir</button></div>`;
    gridInventarios.appendChild(card);
    card.querySelector('.btn-detalle').onclick = ()=> mostrarInventarioDetalle(m);
  });
}

// ------ mostrar inventario detalle (modal simple en nueva ventana) ------
function mostrarInventarioDetalle(m) {
  const win = window.open('', '_blank', 'width=700,height=700');
  let html = `<body style="background:#07101a;color:#e6eef6;font-family:Inter,Arial">
    <h2>Inventario — ${m.nombre}</h2>
    <p>Rango: ${m.rangoId||'—'} • Total: $${m.totalAPagar||0}</p><hr><ul>`;
  (m.inventarioPagos||[]).forEach(it => html += `<li>${it.qty}× ${it.nombre} — c/u $${it.valorCada} — total $${it.total}</li>`);
  html += `</ul><p class="small">Cerrrar ventana para volver.</p></body>`;
  win.document.write(html);
  win.document.title = `Inventario — ${m.nombre}`;
}

// ------ ver/editar miembro desde lista ------
function editarRangoPrompt(m) {
  const nuevo = prompt(`Introduce nuevo rango para ${m.nombre}:`, m.rangoId||'');
  if (!nuevo) return;
  setDoc(doc(db,"rangos",nuevo), { nivel:1, color:'#999', pct:0.1, pct500:0.2 }).catch(()=>{});
  updateDoc(doc(db,"miembros",m.id), { rangoId: nuevo, updatedAt: serverTimestamp() }).then(()=> {
    toast('Rango actualizado','info'); cargarDatosIniciales();
  }).catch(e=>{ toast('Error actualizando','error'); console.error(e); });
}

// ------ FILTROS BUSCADORES ------
filtroMiembros.addEventListener('input', ()=>{
  const q = filtroMiembros.value.trim().toLowerCase();
  const filt = q ? miembros.filter(m=> (m.nombre||'').toLowerCase().includes(q)) : miembros;
  renderMiembros(filt);
});
buscadorInventario.addEventListener('input', ()=>{
  const q = buscadorInventario.value.trim().toLowerCase();
  if (!q) { renderInventariosGrid(miembros); return; }
  const byName = miembros.filter(m => (m.nombre||'').toLowerCase().includes(q));
  const byItem = miembros.filter(m => (m.inventario||[]).some(it => (it.nombre||'').toLowerCase().includes(q)));
  const union = [...new Map([...byName, ...byItem].map(x=>[x.id,x])).values()];
  renderInventariosGrid(union);
});

// ------ INICIALIZACIÓN: muestra lista de miembros sencilla ------
function renderMiembros(list) {
  gridMiembros.innerHTML = '';
  list.forEach(m => {
    const cont = document.createElement('div');
    cont.className = 'miembro-card';
    cont.innerHTML = `<div class="avatar"></div><div class="info"><strong>${m.nombre}</strong><div class="small">Rango: ${m.rangoId||'—'}</div></div>
      <div class="controls">
        <button class="btn-sec" data-id="${m.id}" data-accion="ver">Ver</button>
        <button class="btn-sec" data-id="${m.id}" data-accion="editar">Editar</button>
        <button class="btn-sec" data-id="${m.id}" data-accion="borrar">Borrar</button>
      </div>`;
    gridMiembros.appendChild(cont);
    cont.querySelector('[data-accion="ver"]').onclick = ()=> mostrarInventarioDetalle(m);
    cont.querySelector('[data-accion="editar"]').onclick = ()=> editarMiembroPrompt(m);
    cont.querySelector('[data-accion="borrar"]').onclick = async ()=> {
      if (!confirm('Borrar miembro '+m.nombre+' ?')) return;
      await deleteDoc(doc(db,"miembros",m.id)); toast('Miembro borrado','info'); cargarDatosIniciales();
    };
  });
}

// ------ inicio: listener para exportar token discord desde popup si se abre en ventana hija ------
(function handleIfPopupForDiscord(){
  const hash = location.hash;
  if (hash && hash.includes('access_token')) {
    // esto se ejecuta si Discord redirige aquí en el popup
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    if (token && window.opener) {
      window.opener.postMessage({ discord_token: token }, window.location.origin);
      window.close();
    }
  }
})();

// fin de app.js
