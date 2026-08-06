/**
 * =====================================================================
 * scripts/build-protected.js
 * Pipeline de build com 3 camadas de proteção para o GestorOS:
 *   1. javascript-obfuscator  — embaralha variáveis e encripta strings
 *   2. bytenode               — compila JS ofuscado para V8 Bytecode (.jsc)
 *   3. electron-builder       — empacota em ASAR com verificação de integridade
 *
 * ⚠️  NUNCA modifica o código-fonte original do projeto.
 * =====================================================================
 */

const fs        = require('fs');
const path      = require('path');
const { execSync }  = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ─── Configuração ───────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..'); // Raiz do projeto
const BUILD_TMP   = path.join(ROOT, '.build-tmp'); // Pasta temporária de trabalho

/**
 * Arquivos do Node/backend que serão ofuscados E compilados para bytecode.
 * O require() original no index.js e em cada src/ será substituído por
 * bytenode.runBytecodeFile(), ou pelo require do .jsc via bytenode.
 */
const BACKEND_FILES = [
    'index.js',
    path.join('src', 'Logger.js'),
    path.join('src', 'Database.js'),
    path.join('src', 'ApiServer.js'),
    path.join('src', 'WhatsAppBot.js'),
];

/**
 * Arquivo do frontend (browser) — somente ofuscação, sem bytecode.
 */
const FRONTEND_FILE = path.join('public', 'script.js');

/**
 * Configuração do javascript-obfuscator para o BACKEND.
 * - compact: minimiza espaços
 * - stringArray + encoding: encripta todas as strings literais
 * - renameGlobals: false (não renomear globals para não quebrar require/exports)
 * - selfDefending: trava o código se ele for formatado/pretty-printed
 */
const OBFUSCATOR_CONFIG_BACKEND = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: false,     // Desative em dev/debug, ative só no build final
    disableConsoleOutput: false, // Manter logs de erro no console
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['rc4'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    target: 'node',
};

/**
 * Configuração do obfuscator para o FRONTEND (browser).
 * Mais conservadora para não quebrar dependências dinâmicas do DOM.
 */
const OBFUSCATOR_CONFIG_FRONTEND = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
    target: 'browser',
};

// ─── Utilitários ─────────────────────────────────────────────────────────────

function log(msg) {
    const t = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${t}] [BUILD] ${msg}`);
}

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function removeDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║         GestorOS — Build Protegido (3 Camadas)      ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // ── Passo 0: Limpeza da pasta temporária ─────────────────────────────────
    log('Limpando pasta temporária anterior...');
    removeDir(BUILD_TMP);
    fs.mkdirSync(BUILD_TMP, { recursive: true });

    // ── Passo 1: Cópia do projeto para o BUILD_TMP ────────────────────────────
    log('Copiando projeto para pasta temporária...');
    const dirsToInclude = ['src', 'public', 'gui', 'build', 'node_modules'];
    const filesToInclude = ['main.js', 'index.js', 'package.json', '.env'];

    for (const d of dirsToInclude) {
        const src = path.join(ROOT, d);
        if (fs.existsSync(src)) {
            copyDir(src, path.join(BUILD_TMP, d));
        }
    }
    for (const f of filesToInclude) {
        const src = path.join(ROOT, f);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(BUILD_TMP, f));
        }
    }
    log('Cópia concluída.');

    // ── Passo 2: CAMADA 1 — Ofuscação dos arquivos de backend ─────────────────
    log('CAMADA 1: Iniciando ofuscação do backend (javascript-obfuscator)...');
    for (const relPath of BACKEND_FILES) {
        const filePath = path.join(BUILD_TMP, relPath);
        if (!fs.existsSync(filePath)) {
            log(`  [AVISO] Arquivo não encontrado, ignorando: ${relPath}`);
            continue;
        }
        const source = fs.readFileSync(filePath, 'utf8');
        const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_CONFIG_BACKEND);
        fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
        log(`  [OK] Ofuscado: ${relPath}`);
    }

    // Ofuscação do frontend
    log('CAMADA 1: Ofuscando frontend (public/script.js)...');
    const frontendPath = path.join(BUILD_TMP, FRONTEND_FILE);
    if (fs.existsSync(frontendPath)) {
        const src = fs.readFileSync(frontendPath, 'utf8');
        const result = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_CONFIG_FRONTEND);
        fs.writeFileSync(frontendPath, result.getObfuscatedCode(), 'utf8');
        log(`  [OK] Ofuscado: ${FRONTEND_FILE}`);
    }

    // ── Passo 3: CAMADA 2 — Compilação V8 Bytecode (bytenode) ─────────────────
    log('CAMADA 2: Compilando backend para V8 Bytecode (bytenode)...');

    // Pequeno script auxiliar para compilar via bytenode
    const compileScriptPath = path.join(BUILD_TMP, '_compile_helper.js');
    const compileScript = `
const bytenode = require('bytenode');
const fs = require('fs');
const files = ${JSON.stringify(BACKEND_FILES)};
for (const f of files) {
    const full = require('path').join(__dirname, f);
    if (!fs.existsSync(full)) {
        console.log('[BYTENODE] [AVISO] Arquivo nao encontrado, ignorando:', f);
        continue;
    }
    bytenode.compileFile({ filename: full, output: full.replace(/\.js$/, '.jsc') });
    fs.unlinkSync(full); // Remove o .js ofuscado, mantém apenas o .jsc
    console.log('[BYTENODE] Compilado:', f.replace(/\.js$/, '.jsc'));
}
`;
    fs.writeFileSync(compileScriptPath, compileScript, 'utf8');
    execSync(`node "${compileScriptPath}"`, { cwd: BUILD_TMP, stdio: 'inherit' });
    fs.unlinkSync(compileScriptPath);

    // ── Passo 4: Ajustar as referências para carregar os .jsc ─────────────────
    log('Ajustando referências de require() para carregar arquivos .jsc...');

    // O main.js precisa registrar o bytenode e exigir o index.jsc
    const mainJscPath = path.join(BUILD_TMP, 'main.js');
    const mainSource = fs.readFileSync(mainJscPath, 'utf8');

    // Injeta require('bytenode') no topo e substitui require('./index.js') pelo .jsc
    const mainPatched = `require('bytenode');\n` +
        mainSource.replace(`require('./index.js')`, `require('./index.jsc')`);
    fs.writeFileSync(mainJscPath, mainPatched, 'utf8');
    log('  [OK] main.js atualizado para carregar index.jsc via bytenode.');

    // ── Passo 5: CAMADA 3 — electron-builder com ASAR Integrity ───────────────
    log('CAMADA 3: Executando electron-builder com ASAR habilitado...');
    execSync(`npx electron-builder --win --x64 --project "${BUILD_TMP}"`, {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
            ...process.env,
            // Garante que o electron-builder usa a pasta tmp como raiz do projeto
        }
    });

    // ── Passo 6: Limpeza final ─────────────────────────────────────────────────
    log('Limpando pasta temporária de build...');
    removeDir(BUILD_TMP);

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║        Build protegido concluído com sucesso!        ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
}

main().catch((err) => {
    console.error('\n[ERRO FATAL NO BUILD]', err.message || err);
    // Sempre limpa o temporário em caso de falha
    removeDir(BUILD_TMP);
    process.exit(1);
});
