// Firebase configuración mínima (solo lectura para demo)
const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_PROJECT.firebaseapp.com",
    projectId: "inventario-lm"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Aquí se harían lecturas/escrituras seguras para inventarios reales
