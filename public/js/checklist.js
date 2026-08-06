/**
 * checklist.js — Módulo do Checklist Dinâmico de Inspeção
 */

let _selectedAvarias = new Set();

const CHECKLIST_PRESETS = {
    smartphone: [
        "🖥️ Tela Trincada/Arranhada", "📷 Câmera Danificada", "🔘 Botões Duros/Quebrados",
        "💥 Carcaça Amassada", "🔌 Conector de Carga Solto", "🔊 Alto-falante Ruim", "📱 Sem Gaveta de SIM"
    ],
    notebook: [
        "🔌 Sem Fonte/Carregador", "⌨️ Teclado Falhando", "🖥️ Tela Manchada/Riscada",
        "🔧 Dobradiça Quebrada", "🔋 Sem Bateria / Viciada", "💻 Carcaça Com Riscos"
    ],
    pc: [
        "🔌 Sem Cabo de Força", "📦 Gabinete Amassado/Riscos", "🖥️ Sem Placa de Vídeo",
        "⚙️ Sujeira / Poeira Excesso", "❌ Faltam Parafusos"
    ],
    outros: [
        "🏷️ Marcas de Uso / Riscos", "🔌 Sem Acessórios/Cabos", "❌ Não Liga", "📦 Corpo / Carcaça Danificada"
    ]
};

export function getSelectedAvarias() {
    return Array.from(_selectedAvarias);
}

export function clearAvarias() {
    _selectedAvarias.clear();
    renderChecklistChips();
    renderSelectedAvarias();
}

export function initChecklist() {
    document.getElementById('osCat')?.addEventListener('change', renderChecklistChips);
    document.getElementById('btnAddCustomAvaria')?.addEventListener('click', adicionarCustomAvaria);
    document.getElementById('inputCustomAvaria')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); adicionarCustomAvaria(); }
    });
    renderChecklistChips();
    renderSelectedAvarias();
}

function renderChecklistChips() {
    const catSelect = document.getElementById('osCat');
    const cat = catSelect ? catSelect.value : 'smartphone';
    const presets = CHECKLIST_PRESETS[cat] || CHECKLIST_PRESETS.outros;
    const container = document.getElementById('checklist-chips-sugeridos');
    if (!container) return;
    container.innerHTML = '';

    presets.forEach(tag => {
        const isSelected = _selectedAvarias.has(tag);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            isSelected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`;
        btn.textContent = tag;
        btn.onclick = () => {
            if (_selectedAvarias.has(tag)) _selectedAvarias.delete(tag);
            else _selectedAvarias.add(tag);
            renderChecklistChips();
            renderSelectedAvarias();
        };
        container.appendChild(btn);
    });
}

function renderSelectedAvarias() {
    const container = document.getElementById('checklist-selecionados');
    const vazioMsg = document.getElementById('checklist-vazio-msg');
    if (!container) return;

    container.querySelectorAll('.avaria-pill').forEach(el => el.remove());

    if (_selectedAvarias.size === 0) {
        if (vazioMsg) vazioMsg.style.display = 'block';
        return;
    }

    if (vazioMsg) vazioMsg.style.display = 'none';

    _selectedAvarias.forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'avaria-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-200 text-xs font-semibold';
        pill.textContent = tag;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hover:text-rose-600 font-bold ml-1';
        btn.textContent = '×';
        btn.onclick = () => {
            _selectedAvarias.delete(tag);
            renderChecklistChips();
            renderSelectedAvarias();
        };
        pill.appendChild(btn);
        container.appendChild(pill);
    });
}

function adicionarCustomAvaria() {
    const input = document.getElementById('inputCustomAvaria');
    if (!input) return;
    const valor = input.value.trim();
    if (!valor) return;
    _selectedAvarias.add(valor);
    input.value = '';
    renderChecklistChips();
    renderSelectedAvarias();
}
