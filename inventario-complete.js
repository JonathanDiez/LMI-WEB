(function () {
  'use strict';

  // ====================================
  // AUDIO ENGINE — Web Audio API (sin archivos externos)
  // ====================================

  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * Genera un tono sintético breve.
   * @param {number} freq - Frecuencia Hz
   * @param {number} duration - Duración en segundos
   * @param {'sine'|'square'|'sawtooth'|'triangle'} type - Forma de onda
   * @param {number} gain - Volumen (0-1)
   * @param {number} attack - Tiempo de ataque s
   * @param {number} decay - Tiempo de caída s
   */
  function playTone(freq = 440, duration = 0.12, type = 'sine', gain = 0.12, attack = 0.004, decay = 0.1) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(gain, ctx.currentTime + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  function playChord(freqs, duration = 0.15, type = 'sine', gain = 0.08) {
    freqs.forEach(f => playTone(f, duration, type, gain));
  }

  // Sonidos predefinidos
  const SFX = {
    click() {
      playTone(880, 0.06, 'sine', 0.08, 0.002, 0.055);
    },
    navClick() {
      playTone(660, 0.09, 'sine', 0.09, 0.003, 0.08);
      setTimeout(() => playTone(880, 0.07, 'sine', 0.06, 0.002, 0.06), 60);
    },
    success() {
      playTone(523, 0.1, 'sine', 0.10, 0.003, 0.09);
      setTimeout(() => playTone(659, 0.1, 'sine', 0.09, 0.003, 0.09), 80);
      setTimeout(() => playTone(784, 0.15, 'sine', 0.10, 0.003, 0.13), 160);
    },
    error() {
      playTone(200, 0.14, 'sawtooth', 0.08, 0.004, 0.12);
      setTimeout(() => playTone(150, 0.14, 'sawtooth', 0.07, 0.003, 0.12), 100);
    },
    delete() {
      playTone(330, 0.06, 'triangle', 0.08, 0.002, 0.055);
      setTimeout(() => playTone(220, 0.10, 'triangle', 0.07, 0.003, 0.09), 50);
    },
    open() {
      playTone(440, 0.08, 'sine', 0.07, 0.003, 0.07);
      setTimeout(() => playTone(550, 0.07, 'sine', 0.06, 0.002, 0.06), 55);
    },
    close() {
      playTone(550, 0.07, 'sine', 0.07, 0.003, 0.06);
      setTimeout(() => playTone(440, 0.08, 'sine', 0.06, 0.002, 0.07), 55);
    },
    toggle() {
      playTone(660, 0.08, 'triangle', 0.08, 0.002, 0.07);
    },
    submit() {
      playTone(440, 0.1, 'sine', 0.10, 0.003, 0.09);
      setTimeout(() => playTone(554, 0.1, 'sine', 0.09, 0.003, 0.09), 90);
      setTimeout(() => playTone(659, 0.14, 'sine', 0.11, 0.003, 0.12), 180);
    },
    addRow() {
      playTone(500, 0.08, 'sine', 0.07, 0.002, 0.07);
    },
    theme() {
      playTone(440, 0.07, 'sine', 0.07, 0.002, 0.06);
      setTimeout(() => playTone(880, 0.09, 'sine', 0.06, 0.002, 0.08), 70);
    }
  };

  // Activar contexto de audio al primer gesto del usuario
  function unlockAudio() {
    getAudioCtx();
    document.removeEventListener('pointerdown', unlockAudio, { once: true });
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  // ====================================
  // BIND DE SONIDOS A ELEMENTOS DEL DOM
  // ====================================

  function bindSounds() {
    // Delegación global para no romper eventos existentes
    document.addEventListener('click', (e) => {
      const el = e.target;

      // Botones de navegación
      if (el.closest('.nav-btn')) { SFX.navClick(); return; }

      // Theme toggle
      if (el.closest('.theme-toggle')) { SFX.theme(); return; }

      // Botón añadir fila de item
      if (el.id === 'btn-add-item') { SFX.addRow(); return; }

      // Submit form
      if (el.closest('#form-registro button[type="submit"]')) { SFX.submit(); return; }

      // Botones de eliminar
      if (el.closest('.btn-delete') || el.closest('.btn-remove-item') || el.closest('.item-delete')) {
        SFX.delete(); return;
      }

      // Toggle 500
      if (el.closest('.btn-toggle-500') || el.closest('.mi-500-btn')) { SFX.toggle(); return; }

      // Cerrar modal
      if (el.closest('.modal-close') || el.closest('#modal-close')) { SFX.close(); return; }

      // Abrir inventario card
      if (el.closest('.inventario-card') && !el.closest('button')) { SFX.open(); return; }

      // Crear miembro / catálogo
      if (el.id === 'btn-crear-miembro' || el.id === 'btn-crear-catalogo') { SFX.success(); return; }

      // Editar item
      if (el.closest('.btn-edit-item')) { SFX.click(); return; }

      // Logout
      if (el.id === 'btn-logout' || el.id === 'btn-logout-sidebar' || el.closest('.nav-logout')) { SFX.close(); return; }

      // Login
      if (el.id === 'btn-entrar') { SFX.click(); return; }

      // Custom select trigger (abrir/cerrar dropdown)
      if (el.closest('.custom-select-trigger')) { SFX.click(); return; }

      // Genérico para botones primarios y secundarios
      if (el.closest('.btn-pri') || el.closest('.btn-sec')) { SFX.click(); return; }

    }, true); // capture = true para que no interfiera con stopPropagation existente
  }

  // Interceptar toasts para añadir sonido según tipo
  function patchToastSound() {
    const container = document.getElementById('toasts');
    if (!container) return;

    const obs = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.classList.contains('error')) { SFX.error(); }
          else if (node.classList.contains('success')) { SFX.success(); }
        });
      });
    });
    obs.observe(container, { childList: true });
  }

  // ====================================
  // SISTEMA DE TEMAS
  // ====================================

  function initThemeSystem() {
    function getSavedTheme() {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'dark';
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      const toggle = document.querySelector('.theme-toggle');
      if (toggle) toggle.innerHTML = theme === 'dark' ? '🌙' : '☀️';
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        toggleTheme();
        SFX.theme();
      }
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) applyTheme(e.matches ? 'dark' : 'light');
      });
    }

    const theme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', theme);

    // El botón lo crea app.js; solo aseguramos el ícono
    const existing = document.querySelector('.theme-toggle');
    if (existing) existing.innerHTML = theme === 'dark' ? '🌙' : '☀️';

    window.themeManager = {
      toggle: toggleTheme,
      set: applyTheme,
      get: () => document.documentElement.getAttribute('data-theme') || 'dark'
    };
  }

  // ====================================
  // DROPDOWN FIX — z-index y scroll con rueda
  // ====================================

  function initDropdownFix() {
    // Asegurar que el scroll con rueda del ratón funcione en los dropdowns
    // aunque haya stopPropagation en elementos padres
    document.addEventListener('wheel', (e) => {
      const dropdown = e.target.closest('.custom-select-wrapper .sugerencias');
      if (!dropdown) return;
      // Permitir scroll nativo dentro del dropdown
      e.stopPropagation();
    }, { passive: true, capture: true });

    // También touch scroll
    document.addEventListener('touchmove', (e) => {
      const dropdown = e.target.closest('.custom-select-wrapper .sugerencias');
      if (dropdown) {
        e.stopPropagation();
      }
    }, { passive: true, capture: true });

    // Cerrar dropdown con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
        w.classList.remove('open');
        const l = w.querySelector('.sugerencias');
        if (l) l.classList.remove('active');
      });
    });

    // Cerrar al click fuera
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
        if (!w.contains(e.target)) {
          w.classList.remove('open');
          const l = w.querySelector('.sugerencias');
          if (l) l.classList.remove('active');
        }
      });
    });

    // Observer para elevar z-index de item-rows con dropdown abierto
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        if (m.type !== 'attributes') return;
        const wrapper = m.target;
        if (!wrapper.classList.contains('custom-select-wrapper')) return;
        const isOpen = wrapper.classList.contains('open');
        const row = wrapper.closest('.item-row');
        const section = wrapper.closest('.form-section');
        if (row) row.style.zIndex = isOpen ? '10000' : '';
        if (section) section.style.zIndex = isOpen ? '9998' : '';
      });
    });

    function observeWrappers() {
      document.querySelectorAll('.custom-select-wrapper').forEach(w => {
        observer.observe(w, { attributes: true, attributeFilter: ['class'] });
      });
    }
    observeWrappers();

    // Volver a observar cuando se añadan nuevas filas
    const bodyObserver = new MutationObserver(() => observeWrappers());
    const itemsContainer = document.getElementById('contenedor-items');
    if (itemsContainer) bodyObserver.observe(itemsContainer, { childList: true });
  }

  // ====================================
  // EFECTOS VARIOS
  // ====================================

  function initEffects() {
    // Scroll to top button
    const scrollBtn = document.createElement('button');
    scrollBtn.className = 'scroll-to-top';
    scrollBtn.innerHTML = '↑';
    scrollBtn.title = 'Volver arriba';
    scrollBtn.style.display = 'none';
    document.body.appendChild(scrollBtn);

    scrollBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      SFX.click();
    });

    window.addEventListener('scroll', () => {
      scrollBtn.style.display = window.scrollY > 400 ? 'flex' : 'none';
    });

    // Exponer SFX globalmente por si app.js quiere usarlo
    window.SFX = SFX;
  }

  // ====================================
  // INICIALIZACIÓN
  // ====================================

  function init() {
    initThemeSystem();
    bindSounds();
    initEffects();

    setTimeout(() => {
      initDropdownFix();
      patchToastSound();
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();