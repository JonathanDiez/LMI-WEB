// Aplicación principal

// Elementos
const loginSection = document.getElementById('login');
const panelSection = document.getElementById('panel');
const btnLogin = document.getElementById('btnLogin');
const usuarioSelect = document.getElementById('usuario');
const inventarioDiv = document.getElementById('inventarioUsuario');
const listaUsuariosDiv = document.getElementById('lista-usuarios');
const formulario = document.getElementById('formularioLoot');

let usuarios = [
    { id: "user1", nombre: "Juan" },
    { id: "user2", nombre: "Ana" },
    { id: "user3", nombre: "Luis" }
];

let inventarios = {}; // Almacena inventarios temporales (solo demo)

// LOGIN SIMULADO
btnLogin.addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;

    if(email && pass){
        loginSection.style.display = 'none';
        panelSection.style.display = 'block';
        cargarUsuarios();
    } else {
        alert("Introduce email y contraseña");
    }
});

// Cargar usuarios en select y lista
function cargarUsuarios(){
    usuarioSelect.innerHTML = '';
    listaUsuariosDiv.innerHTML = '';
    usuarios.forEach(u => {
        let opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.nombre;
        usuarioSelect.appendChild(opt);

        let div = document.createElement('div');
        div.textContent = u.nombre;
        listaUsuariosDiv.appendChild(div);
        if(!inventarios[u.id]) inventarios[u.id] = [];
    });
}

// FORMULARIO PARA AGREGAR LOOT
formulario.addEventListener('submit', (e) => {
    e.preventDefault();
    const userId = usuarioSelect.value;
    const arma = document.getElementById('arma').value;
    const cantidad = parseInt(document.getElementById('cantidad').value);

    if(!userId || !arma || !cantidad) return alert("Rellena todos los campos");

    // Revisar si ya existe el item en esta carga
    let loot = inventarios[userId];
    let existente = loot.find(i => i.arma === arma && !i.futuroLoot);
    if(existente){
        existente.cantidad += cantidad; // Stackear dentro de la misma carga
    } else {
        loot.push({ arma, cantidad });
    }

    mostrarInventario(userId);
    formulario.reset();
});

// Mostrar inventario de usuario
function mostrarInventario(userId){
    inventarioDiv.innerHTML = '';
    let total = 0;
    inventarios[userId].forEach(i => {
        let div = document.createElement('div');
        div.textContent = `${i.arma} - Cantidad: ${i.cantidad}`;
        inventarioDiv.appendChild(div);
        total += i.cantidad;
    });
    let totalDiv = document.createElement('div');
    totalDiv.style.fontWeight = 'bold';
    totalDiv.textContent = `Total items: ${total}`;
    inventarioDiv.appendChild(totalDiv);
}
