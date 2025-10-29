// js/aplicacion.js
// Lógica principal en español. Usa Firebase Auth (email/password) y Firestore.
// Seguridad: solo administradores (colección 'administradores') pueden escribir.

import { signInWithEmailAndPassword, signOut, onAuthStateChanged, getIdToken } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const { auth, db } = window.__FB;

// DOM
const seccionLogin = document.getElementById('seccion-login');
const principal = document.getElementById('principal');
const btnEntrar = document.getElementById('btn-entrar');
const btnLogout = document.getElementById('btn-logout');

const buscarMiembroInput = document.getElementById('buscar-miembro');
const sugerenciasMiembro = document.getElementById('sugerencias-miembro');
const contenedorItems = document.getElementById('contenedor-items');
const btnAddItem = document.getElementById('btn-add-item');
const actividadSel = document.getElementById('actividad');
const formRegistro = document.getElementById('form-registro');

const listaCatalogoDiv = document.getElementById('lista-catalogo');
const btnCrearCatalogo = document.getElementById('btn-crear-catalogo');
const catNombre = document.getElementById('cat-nombre');
const catValor = document.getElementById('cat-valor');
const catEx = document.getElementById('cat-excepcion');
const catPagable = document.getElementById('cat-pagable');

const filtroMiembros = document.getElementById('filtro-miembros');
const gridMiembros = document.getElementById('grid-miembros');

// Estado
let catalogo = [];
let miembros = [];
let rangos = {};
let usuarioActual = null;

// --- Handler de login (reemplazar el anterior) ---
btnEntrar.onclick = async () => {
  console.log('[DEBUG] click en boton Entrar');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  console.log('[DEBUG] credenciales->', { email: email ? '****' : '(vacío)', password: password ? '****' : '(vacío)' });

  if (!email || !password) {
    alert("Rellena email y contraseña");
    return;
  }

  try {
    // usa la función modular importada al principio del archivo
    const resp = await signInWithEmailAndPassword(auth, email, password);
    console.log('[DEBUG] signInWithEmailAndPassword resp:', resp);
    alert('Inicio de sesión correcto: ' + (resp.user.email || resp.user.uid));
  } catch (err) {
    // muestra mensaje claro y el error devuelto por Firebase
    console.error('[DEBUG] fallo signIn:', err);
    let msg = err && err.message ? err.message : String(err);
    // extraer error concreto si viene en err.code
    if (err.code) msg = `${err.code} — ${msg}`;
    alert('Error al iniciar sesión: ' + msg);
  }
};

// Estado auth
onAuthStateChanged(auth, async user => {
  usuarioActual = user;
  if (user) {
    seccionLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    principal.style.display = 'flex';
    await cargarDatosIniciales();
  } else {
    seccionLogin.style.display = 'block';
    btnLogout.style.display = 'none';
    principal.style.display = 'none';
  }
});

// ---- DATOS INICIALES ----
async function cargarDatosIniciales(){
  // rangos
  const rSnap = await getDocs(collection(db,"rangos"));
  rangos = {}; rSnap.forEach(d=> rangos[d.id] = d.data());

  // catalogo
  const cSnap = await getDocs(collection(db,"catalogo"));
  catalogo = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCatalogo();

  // miembros
  const mSnap = await getDocs(collection(db,"miembros"));
  miembros = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMiembros(miembros);

  // preparar items
  contenedorItems.innerHTML = "";
  addItemRow();
  await precargarInventarios();
}

// ---- RENDER CATALOGO ----
function renderCatalogo(){
  listaCatalogoDiv.innerHTML = "";
  catalogo.forEach(c=>{
    const linea = document.createElement('div');
    linea.className = 'fila';
    linea.innerHTML = `<div style="flex:1">${c.nombre} — $${c.valorBase} ${c.pctExcepcion? '• excep':''} ${c.pagable===false?'• no pagable':''}</div>
      <div><button data-id="${c.id}" class="btn-eliminar-cat">Borrar</button></div>`;
    listaCatalogoDiv.appendChild(linea);
  });
  Array.from(document.getElementsByClassName('btn-eliminar-cat')).forEach(b=>{
    b.onclick = async e=>{
      const id = e.target.dataset.id;
      if (!confirm("Borrar objeto del catálogo?")) return;
      await deleteDoc(doc(db,"catalogo",id));
      await cargarDatosIniciales();
    };
  });
}

// Crear objeto catálogo
document.getElementById('btn-crear-catalogo').onclick = async ()=>{
  const nombre = catNombre.value.trim();
  const valor = Number(catValor.value) || 0;
  const ex = catEx.value.trim()===""?null:Number(catEx.value);
  const pag = catPagable.checked;
  if (!nombre || valor<=0) return alert("Nombre y valor válidos");
  const id = nombre.toLowerCase().replace(/\s+/g,'-');
  await setDoc(doc(db,"catalogo",id), { nombre, valorBase: valor, pctExcepcion: ex, pagable: pag });
  catNombre.value=''; catValor.value=''; catEx.value='';
  await cargarDatosIniciales();
};

// ---- AUTOCOMPLETE MIEMBROS ----
buscarMiembroInput.oninput = ()=>{
  const q = buscarMiembroInput.value.trim().toLowerCase();
  sugerenciasMiembro.innerHTML = "";
  if (!q) return;
  const matches = miembros.filter(m=> (m.nombre||'').toLowerCase().includes(q)).slice(0,8);
  matches.forEach(m=>{
    const d = document.createElement('div');
    d.textContent = m.nombre;
    d.style.cursor = "pointer";
    d.onclick = ()=>{ buscarMiembroInput.value = m.nombre; buscarMiembroInput.dataset.id = m.id; sugerenciasMiembro.innerHTML = ""; };
    sugerenciasMiembro.appendChild(d);
  });
};

// ---- ITEMS DINÁMICOS ----
function addItemRow(pref = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `<select class="sel-item">${catalogo.map(c=>`<option value="${c.id}">${c.nombre} ($${c.valorBase})</option>`).join("")}</select>
    <input class="qty-item" type="number" min="1" value="${pref.qty||1}" />
    <button class="btn-remove-item" type="button">Eliminar</button>`;
  contenedorItems.appendChild(row);
  row.querySelector(".btn-remove-item").onclick = ()=> row.remove();
}
btnAddItem.onclick = ()=> addItemRow();

// ---- ENVIAR REGISTRO ----
formRegistro.onsubmit = async (e)=>{
  e.preventDefault();
  if (!usuarioActual) return alert("Inicia sesión");
  const memberName = buscarMiembroInput.value.trim();
  const memberId = buscarMiembroInput.dataset.id;
  if (!memberId) return alert("Selecciona un miembro válido (usa el buscador)");
  const filas = Array.from(contenedorItems.querySelectorAll('.item-row'));
  if (filas.length===0) return alert("Añade al menos un objeto");
  const items = filas.map(r=>{
    const id = r.querySelector('.sel-item').value;
    const qty = Number(r.querySelector('.qty-item').value)||0;
    const ci = catalogo.find(c=>c.id===id);
    return { itemId:id, nombre:ci.nombre, qty, valorBase:ci.valorBase, pctExcepcion:ci.pctExcepcion===undefined?null:ci.pctExcepcion, pagable:ci.pagable===undefined?true:ci.pagable, removed:false };
  });
  const actividad = actividadSel.value;

  // comprobar admin (solo admins pueden crear)
  const adminDoc = await getDoc(doc(db,"administradores",usuarioActual.uid));
  if (!adminDoc.exists) return alert("No tienes permisos para crear registros");

  // guardar registro en Firestore
  await addDoc(collection(db,"registrosBotin"), {
    memberId, memberName, items, activity:actividad, timestamp: serverTimestamp(), enviadoPor: usuarioActual.uid
  });

  // enviar embed: opcional (si quieres usar webhook directo, mantenlo en app.js)
  // Aquí dejamos la responsabilidad de enviar embed al cliente si webhook público; si lo quieres oculto, usa worker o función.

  alert("Registro guardado.");
  contenedorItems.innerHTML = ""; addItemRow(); buscarMiembroInput.value=''; delete buscarMiembroInput.dataset.id;
  await precargarInventarios();
};

// ---- PRECARGAR INVENTARIOS ----
async function precargarInventarios(){
  const regsSnap = await getDocs(collection(db,"registrosBotin"));
  const regs = regsSnap.docs.map(d=>({ id:d.id, ...d.data() }));
  const agrup = {};
  regs.forEach(r=>{
    if (!agrup[r.memberId]) agrup[r.memberId]=[];
    agrup[r.memberId].push(r);
  });

  miembros.forEach(m=>{
    const registros = agrup[m.id]||[];
    const lista = [];
    registros.forEach(reg=>{
      (reg.items||[]).forEach(it=>{
        if (it.removed) return;
        lista.push({ ...it, registroId: reg.id, timestamp: reg.timestamp });
      });
    });
    m.inventario = lista;
    // calcular total segun rangos (si aplicas)
    const rangoDoc = m.rangoId ? rangos[m.rangoId] : null;
    const pctBase = rangoDoc ? rangoDoc.pct : 0;
    const pct500 = rangoDoc ? rangoDoc.pct500 : pctBase;
    const usarPct = m.tiene500 ? pct500 : pctBase;
    let total = 0;
    m.inventarioPagos = m.inventario.map(it=>{
      const pct = (it.pctExcepcion!==null && it.pctExcepcion!==undefined) ? it.pctExcepcion : usarPct;
      if (it.pagable===false) return { ...it, valorCada:0, total:0, pctUsed:0 };
      const valorCada = Math.round(it.valorBase * pct);
      const t = valorCada * it.qty;
      total += t;
      return { ...it, valorCada, total: t, pctUsed: pct };
    });
    m.totalAPagar = total;
  });
  renderMiembros(miembros);
}

// ---- RENDER MIEMBROS ----
function renderMiembros(lista){
  gridMiembros.innerHTML = "";
  lista.forEach(m=>{
    const el = document.createElement('div');
    el.className = 'miembro-card';
    el.innerHTML = `<div class="avatar"></div>
      <div class="info"><strong>${m.nombre}</strong> ${m.tiene500?'<span class="badge">500+</span>':''}
      <div class="detalle">Rango: ${m.rangoId||'—'} • Total: $${m.totalAPagar||0}</div>
      <div id="inv-${m.id}" class="detalle-mini"></div></div>
      <div class="controls"><button data-id="${m.id}" class="btn-editar">Editar</button><button data-id="${m.id}" class="btn-ver">Ver</button></div>`;
    gridMiembros.appendChild(el);

    el.querySelector('.btn-ver').onclick = ()=> mostrarInventarioDetalle(m);
    el.querySelector('.btn-editar').onclick = ()=> editarRangoPrompt(m);

    const invEl = document.getElementById(`inv-${m.id}`);
    invEl.innerHTML = (m.inventarioPagos||[]).slice(0,4).map(it=>`${it.qty}× ${it.nombre} → $${it.valorCada}`).join('<br>') || 'Sin items';
  });
}

// Mostrar inventario detalle en nueva ventana simple
function mostrarInventarioDetalle(m){
  const win = window.open('','_blank','width=700,height=700');
  let html = `<h2>Inventario — ${m.nombre}</h2><p>Rango: ${m.rangoId||'—'} • Total: $${m.totalAPagar||0}</p><ul>`;
  (m.inventarioPagos||[]).forEach(it=> html+=`<li>${it.qty}× ${it.nombre} — c/u $${it.valorCada} — total $${it.total}</li>`);
  html += `</ul>`;
  win.document.body.style.background = '#07101a'; win.document.body.style.color='#e6eef6';
  win.document.title = `Inventario — ${m.nombre}`;
  win.document.body.innerHTML = html;
}

// Editar rango prompt (solo admin)
async function editarRangoPrompt(m){
  const nuevo = prompt(`Introduce nuevo rango para ${m.nombre} (ej: Peón, Sangre Nueva, Alpha):`, m.rangoId||'');
  if (!nuevo) return;
  // crear rango si no existe
  if (!rangos[nuevo]) {
    if (!confirm('Rango no existe. ¿Crear con valores por defecto?')) return;
    await setDoc(doc(db,"rangos",nuevo), { nivel:1, color:'#999', pct:0.1, pct500:0.2 });
  }
  await updateDoc(doc(db,"miembros",m.id), { rangoId: nuevo, updatedAt: serverTimestamp() });
  await cargarDatosIniciales();
}

// Filtro miembros
filtroMiembros.oninput = ()=>{
  const q = filtroMiembros.value.trim().toLowerCase();
  const filt = q ? miembros.filter(m=> (m.nombre||'').toLowerCase().includes(q) ) : miembros;
  renderMiembros(filt);
};
