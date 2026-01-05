(function() {
  'use strict';
  
  // ====================================
  // SISTEMA DE TEMAS
  // ====================================
  
  function initThemeSystem() {
    // Crear el botón de toggle si no existe
    function createThemeToggle() {
      if (document.querySelector('.theme-toggle')) return;
      
      const toggle = document.createElement('button');
      toggle.className = 'theme-toggle';
      toggle.setAttribute('aria-label', 'Cambiar tema');
      toggle.setAttribute('title', 'Cambiar tema (Ctrl+T)');
      document.body.appendChild(toggle);
      
      return toggle;
    }
    
    // Obtener tema guardado o preferencia del sistema
    function getSavedTheme() {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      
      return 'light';
    }
    
    // Aplicar tema
    function applyTheme(theme) {
      const html = document.documentElement;
      html.style.transition = 'all 0.3s ease';
      html.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }
    
    // Cambiar tema
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = current === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
      
      const toggle = document.querySelector('.theme-toggle');
      if (toggle) {
        toggle.style.transform = 'scale(0.9) rotate(180deg)';
        setTimeout(() => {
          toggle.style.transform = '';
        }, 300);
      }
    }
    
    // Atajo de teclado
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        toggleTheme();
      }
    });
    
    // Detectar cambios en preferencia del sistema
    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      darkModeQuery.addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
    
    // Aplicar tema guardado inmediatamente
    const theme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', theme);
    
    // Crear botón de toggle cuando el DOM esté listo
    const toggle = createThemeToggle();
    if (toggle) {
      toggle.addEventListener('click', toggleTheme);
    }
    
    // Exportar funciones
    window.themeManager = {
      toggle: toggleTheme,
      set: applyTheme,
      get: () => document.documentElement.getAttribute('data-theme') || 'light'
    };
    
    console.log('🎨 Sistema de temas inicializado');
  }
  
  // ====================================
  // DROPDOWN FIX (POLLING SIMPLE - SIN LOOPS)
  // ====================================
  
  function initDropdownFix() {
    let overlayElement = null;
    let lastDropdownCheck = new Set();
    
    // Crear overlay
    function getOrCreateOverlay() {
      if (!overlayElement) {
        overlayElement = document.createElement('div');
        overlayElement.className = 'dropdown-overlay';
        overlayElement.style.cssText = `
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: transparent;
          display: none;
          cursor: default;
        `;
        document.body.appendChild(overlayElement);
        
        overlayElement.addEventListener('click', () => {
          closeAllDropdowns();
        });
      }
      return overlayElement;
    }
    
    // Cerrar todos los dropdowns
    function closeAllDropdowns() {
      document.querySelectorAll('.sugerencias.active').forEach(dropdown => {
        dropdown.classList.remove('active');
        
        // Restaurar z-index
        const itemRow = dropdown.closest('.item-row');
        if (itemRow) itemRow.style.zIndex = '';
        
        const wrapper = dropdown.closest('.custom-select-wrapper');
        if (wrapper) {
          wrapper.classList.remove('open');
          wrapper.style.zIndex = '';
        }
        
        const formSection = dropdown.closest('.form-section');
        if (formSection) formSection.style.zIndex = '';
      });
      
      const overlay = getOrCreateOverlay();
      overlay.style.display = 'none';
      lastDropdownCheck.clear();
    }
    
    // Chequear dropdowns activos periódicamente (polling)
    // Este método es simple y no causa loops infinitos
    setInterval(() => {
      const activeDropdowns = document.querySelectorAll('.sugerencias.active');
      const overlay = getOrCreateOverlay();
      
      if (activeDropdowns.length > 0) {
        // Hay dropdowns activos
        overlay.style.display = 'block';
        
        // Ajustar z-index solo si no está ya ajustado
        activeDropdowns.forEach(dropdown => {
          // Usar ID o crear uno temporal para tracking
          if (!dropdown.dataset.dropdownId) {
            dropdown.dataset.dropdownId = 'dd-' + Date.now() + '-' + Math.random();
          }
          
          const dropdownId = dropdown.dataset.dropdownId;
          
          // Solo log una vez por dropdown
          if (!lastDropdownCheck.has(dropdownId)) {
            const itemRow = dropdown.closest('.item-row');
            if (itemRow) {
              console.log('📦 Dropdown en item-row detectado');
              lastDropdownCheck.add(dropdownId);
            }
          }
          
          const itemRow = dropdown.closest('.item-row');
          if (itemRow && itemRow.style.zIndex !== '10000') {
            itemRow.style.zIndex = '10000';
          }
          
          const wrapper = dropdown.closest('.custom-select-wrapper');
          if (wrapper && wrapper.style.zIndex !== '10000') {
            wrapper.classList.add('open');
            wrapper.style.zIndex = '10000';
          }
          
          const formSection = dropdown.closest('.form-section');
          if (formSection && formSection.style.zIndex !== '9998') {
            formSection.style.zIndex = '9998';
          }
        });
      } else {
        // No hay dropdowns activos
        if (overlay.style.display !== 'none') {
          overlay.style.display = 'none';
          lastDropdownCheck.clear();
        }
      }
    }, 150); // Check cada 150ms
    
    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeAllDropdowns();
      }
    });
    
    // Exportar función
    window.closeAllDropdowns = closeAllDropdowns;
    
    console.log('✅ Dropdown fix activado (polling simple)');
  }
  
  // ====================================
  // EFECTOS ADICIONALES
  // ====================================
  
  function initEffects() {
    // Scroll to top button
    const scrollBtn = document.createElement('button');
    scrollBtn.className = 'scroll-to-top';
    scrollBtn.innerHTML = '↑';
    scrollBtn.style.cssText = `
      position: fixed;
      bottom: 30px;
      right: 30px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      border: none;
      cursor: pointer;
      font-size: 1.5rem;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-lg);
      z-index: 99;
      transition: all 0.3s ease;
    `;
    
    scrollBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    document.body.appendChild(scrollBtn);
    
    window.addEventListener('scroll', () => {
      scrollBtn.style.display = window.scrollY > 300 ? 'flex' : 'none';
    });
    
    // Toast helper
    window.showToast = function(message, type = 'info', duration = 5000) {
      const toastsContainer = document.getElementById('toasts');
      if (!toastsContainer) return;
      
      const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
      };
      
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="font-size: 1.5rem;">${icons[type] || icons.info}</div>
          <div>
            <div style="font-weight: 600; margin-bottom: 0.25rem;">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary);">${message}</div>
          </div>
        </div>
      `;
      
      toastsContainer.appendChild(toast);
      
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => toast.remove(), 300);
      }, duration);
      
      return toast;
    };
    
    console.log('✨ Efectos adicionales listos');
  }
  
  // ====================================
  // INICIALIZACIÓN
  // ====================================
  
  function init() {
    console.log('🔧 Inicializando Inventario LM...');
    
    initThemeSystem();
    
    // Esperar un poco antes de iniciar el dropdown fix
    // para asegurarnos de que el DOM esté estable
    setTimeout(() => {
      initDropdownFix();
      initEffects();
    }, 500);
    
    console.log('✅ Inventario LM inicializado');
  }
  
  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
