// firebase-config.js
// Pegar aquí la configuración web de Firebase (verdadera)
const firebaseConfig = {
  apiKey: "AIzaSyBmbQfw7KzEMaGvP3xft6g3vOTQpQkUjOE",
  authDomain: "inventario-lm.firebaseapp.com",
  projectId: "inventario-lm",
  storageBucket: "inventario-lm.firebasestorage.app",
  messagingSenderId: "286539412641",
  appId: "1:286539412641:web:a20e6386a2b90fe2bcace0"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// exportar objetos para usar en app.js
export { app, auth, db };
