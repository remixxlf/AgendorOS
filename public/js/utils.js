/**
 * utils.js — Utilitários globais do GestorOS
 * - escapeHTML: Sanitização anti-XSS para interpolação segura de strings no DOM
 * - toast: Sistema de notificações flutuantes (substitui alert/confirm nativos)
 * - formatMoeda, formatarDataHora: formatações de exibição
 */

// ==================== SANITIZAÇÃO XSS ====================
/**
 * Escapa caracteres HTML perigosos de uma string para prevenir XSS.
 * Use sempre que inserir dados do usuário/banco no innerHTML.
 * @param {any} str - Valor a ser escapado
 * @returns {string}
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==================== FORMATADORES ====================
export function formatMoeda(valor) {
    const n = parseFloat(valor) || 0;
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

export function formatarDataHora(dataString) {
    if (!dataString) return '';
    try {
        const dateObj = new Date(dataString);
        if (isNaN(dateObj.getTime())) return dataString;
        const dia = dateObj.getDate().toString().padStart(2, '0');
        const mes = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const ano = dateObj.getFullYear();
        const horas = dateObj.getHours().toString().padStart(2, '0');
        const minutos = dateObj.getMinutes().toString().padStart(2, '0');
        if (dataString.length <= 10) return `${dia}/${mes}/${ano}`;
        return `${dia}/${mes}/${ano} ${horas}:${minutos}`;
    } catch (e) {
        return dataString;
    }
}

// ==================== TOAST NOTIFICATIONS ====================
/**
 * Exibe uma notificação flutuante elegante.
 * @param {string} msg - Mensagem
 * @param {'success'|'error'|'info'|'warning'} type - Tipo de toast
 * @param {number} duration - Duração em ms (default 3500)
 */
export function toast(msg, type = 'info', duration = 3500) {
    const container = _getOrCreateToastContainer();

    const colors = {
        success: { bg: 'bg-emerald-50',   border: 'border-emerald-200', text: 'text-emerald-800', icon: 'ph-check-circle',       iconColor: 'text-emerald-500' },
        error:   { bg: 'bg-rose-50',      border: 'border-rose-200',    text: 'text-rose-800',    icon: 'ph-x-circle',           iconColor: 'text-rose-500'    },
        warning: { bg: 'bg-amber-50',     border: 'border-amber-200',   text: 'text-amber-800',   icon: 'ph-warning-circle',     iconColor: 'text-amber-500'   },
        info:    { bg: 'bg-indigo-50',    border: 'border-indigo-200',  text: 'text-indigo-800',  icon: 'ph-info',               iconColor: 'text-indigo-500'  },
    };
    const c = colors[type] || colors.info;

    const el = document.createElement('div');
    el.className = `flex items-start gap-3 w-80 max-w-xs p-4 rounded-2xl shadow-lg border ${c.bg} ${c.border} ${c.text} text-sm font-medium translate-x-full opacity-0 transition-all duration-300 ease-out`;
    el.innerHTML = `
        <i class="ph-fill ${c.icon} ${c.iconColor} text-xl shrink-0 mt-0.5"></i>
        <span class="flex-1 leading-snug">${escapeHTML(msg)}</span>
        <button class="shrink-0 opacity-50 hover:opacity-100 transition-opacity" onclick="this.parentElement.remove()">
            <i class="ph-bold ph-x text-base"></i>
        </button>
    `;

    container.appendChild(el);

    // Animação de entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.classList.remove('translate-x-full', 'opacity-0');
        });
    });

    // Auto-remover após duração
    setTimeout(() => {
        el.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => el.remove(), 350);
    }, duration);
}

function _getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none';
        container.style.pointerEvents = 'none';
        // Cada toast individual tem pointer-events próprios
        const style = document.createElement('style');
        style.textContent = '#toast-container > * { pointer-events: all; }';
        document.head.appendChild(style);
        document.body.appendChild(container);
    }
    return container;
}

// ==================== CONFIRM MODAL (substitui confirm() nativo) ====================
/**
 * Exibe um modal de confirmação estilizado.
 * Retorna Promise<boolean>.
 * @param {string} msg
 * @param {string} confirmText
 * @returns {Promise<boolean>}
 */
export function confirmar(msg, confirmText = 'Confirmar') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-fade-in-up">
                <div class="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <i class="ph-fill ph-warning text-rose-500 text-3xl"></i>
                </div>
                <p class="text-center text-slate-700 font-medium mb-6 leading-relaxed">${escapeHTML(msg)}</p>
                <div class="flex gap-3">
                    <button id="_confirmar-cancelar" class="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors">Cancelar</button>
                    <button id="_confirmar-ok" class="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors">${escapeHTML(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#_confirmar-ok').addEventListener('click', () => { overlay.remove(); resolve(true); });
        overlay.querySelector('#_confirmar-cancelar').addEventListener('click', () => { overlay.remove(); resolve(false); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    });
}
