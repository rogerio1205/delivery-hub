// ============================================================
// DeliveryHub — backend.js  v2.0
// Correções: expiração, deduplicação, health-check, segurança
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

// ── Middlewares ──────────────────────────────────────────────
app.use(cors());                          // Permite MacroDroid (mesma rede local)
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // suporte a form-data simples
app.use(express.static(path.join(__dirname)));

// ── Estado da aplicação ──────────────────────────────────────
var userPreferences = {
    latitude:         -23.6821,
    longitude:        -46.5650,
    raioMaximo:       5,
    ganhoMinimo:      15,
    distanciaMaxima:  10
};

var activePlatforms = {
    ifood:    { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta:    { rides: [], enabled: true },
    loggi:    { rides: [], enabled: true }
};

// Comandos pendentes para o MacroDroid executar
var pendingAcceptCommands = [];

// IDs de corridas reais já processadas (evita duplicatas)
var processedRealIds = new Set();

// ── Mapeamento packageName → plataforma ─────────────────────
var PACKAGE_MAP = {
    'br.com.brainweb.ifood':   'ifood',
    'com.ubercab.eats':        'ubereats',
    'com.keeta.courier':       'keeta',
    'com.keeta.driver':        'keeta',
    'br.com.loggi.android':    'loggi'
};

function detectPlatform(platform, packageName) {
    if (platform && activePlatforms[platform]) return platform;
    if (packageName) {
        if (PACKAGE_MAP[packageName]) return PACKAGE_MAP[packageName];
        var pkg = packageName.toLowerCase();
        if (pkg.indexOf('ifood')   >= 0) return 'ifood';
        if (pkg.indexOf('uber')    >= 0) return 'ubereats';
        if (pkg.indexOf('keeta')   >= 0) return 'keeta';
        if (pkg.indexOf('loggi')   >= 0) return 'loggi';
    }
    return null;
}

// ── Rotas ────────────────────────────────────────────────────

// Health-check — MacroDroid pode usar GET para testar conexão
app.get('/api/ping', function(req, res) {
    res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Config
app.get('/api/config', function(req, res) {
    res.json(userPreferences);
});

app.post('/api/config', function(req, res) {
    userPreferences = Object.assign({}, userPreferences, req.body);
    console.log('[CONFIG] Atualizada:', JSON.stringify(userPreferences));
    res.json({ success: true });
});

// ============================================================
// RECEBER NOTIFICAÇÃO REAL DO MACRODROID
// Aceita tanto POST com body JSON  (método correto)
// quanto GET com query string      (fallback caso MacroDroid
//   coloque parâmetros na URL)
// ============================================================
function handleNotification(data, res) {
    var platform    = data.platform    || '';
    var packageName = data.packageName || '';
    var title       = data.title       || '';
    var text        = data.text        || '';

    console.log('=== NOTIFICAÇÃO RECEBIDA ===');
    console.log('platform:', platform, '| package:', packageName);
    console.log('title:', title);
    console.log('text:', text);

    var detectedPlatform = detectPlatform(platform, packageName);

    if (!detectedPlatform) {
        console.log('[ERRO] Plataforma não detectada');
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    if (!activePlatforms[detectedPlatform].enabled) {
        console.log('[SKIP] Plataforma desabilitada:', detectedPlatform);
        return res.json({ success: false, reason: 'Plataforma desabilitada' });
    }

    var fullText = title + ' ' + text;

    // Extrair valor R$
    var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    var earnings   = moneyMatch
        ? parseFloat(moneyMatch[1].replace(',', '.'))
        : null;

    // Verificar ganho mínimo (ignora se não encontrou valor — deixa passar)
    if (earnings !== null && earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('[SKIP] R$' + earnings + ' abaixo do mínimo R$' + userPreferences.ganhoMinimo);
        return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
    }

    // Extrair distância km
    var distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    var distance  = distMatch
        ? parseFloat(distMatch[1].replace(',', '.'))
        : parseFloat((Math.random() * 3 + 0.5).toFixed(1));

    // Destino — texto da notificação
    var destination = text.length > 0
        ? text.substring(0, 120).trim()
        : (title.length > 0 ? title.substring(0, 120).trim() : 'Verificar no app');

    // Deduplicação simples por conteúdo + plataforma (janela de 10s)
    var dedupKey = detectedPlatform + '|' + title + '|' + text;
    if (processedRealIds.has(dedupKey)) {
        console.log('[DEDUP] Notificação duplicada ignorada');
        return res.json({ success: false, reason: 'Duplicata' });
    }
    processedRealIds.add(dedupKey);
    setTimeout(function() { processedRealIds.delete(dedupKey); }, 10000);

    // Posição aleatória dentro do raio configurado
    var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    var lat = (userPreferences.latitude  || -23.6821) + (Math.random() - 0.5) * spread;
    var lng = (userPreferences.longitude || -46.5650) + (Math.random() - 0.5) * spread;

    var newRide = {
        id:          detectedPlatform + '-real-' + Date.now(),
        platform:    detectedPlatform,
        lat:         parseFloat(lat.toFixed(6)),
        lng:         parseFloat(lng.toFixed(6)),
        distance:    parseFloat(distance).toFixed(1),
        earnings:    (earnings !== null ? earnings : 0).toFixed(2),
        destination: destination,
        timestamp:   new Date().toISOString(),
        status:      'pending',
        source:      'real',
        rawTitle:    title,
        rawText:     text
    };

    activePlatforms[detectedPlatform].rides.push(newRide);
    console.log('[REAL] Adicionada:', detectedPlatform, 'R$' + newRide.earnings, '—', destination);
    res.json({ success: true, ride: newRide });
}

// POST — MacroDroid envia JSON no corpo (método recomendado)
app.post('/api/notification', function(req, res) {
    handleNotification(req.body, res);
});

// GET — fallback para caso o MacroDroid use query params na URL
app.get('/api/notification', function(req, res) {
    handleNotification(req.query, res);
});

// ============================================================
// GET /api/rides — corridas pendentes filtradas
// ============================================================
app.get('/api/rides', function(req, res) {
    var allRides = [];
    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;
        activePlatforms[platform].rides.forEach(function(ride) {
            if (ride.status !== 'pending') return;
            allRides.push(Object.assign({}, ride, { platform: platform }));
        });
    });

    // Maior ganho primeiro
    allRides.sort(function(a, b) {
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });

    res.json(allRides);
});

// ============================================================
// ACEITAR CORRIDA
// ============================================================
app.post('/api/accept-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;

    if (!activePlatforms[platform]) return res.json({ success: false });

    var ride = activePlatforms[platform].rides.find(function(r) {
        return r.id === rideId;
    });

    if (!ride) return res.json({ success: false, reason: 'Corrida nao encontrada' });

    ride.status = 'accepted';
    pendingAcceptCommands.push({
        rideId:    rideId,
        platform:  platform,
        timestamp: new Date().toISOString(),
        executed:  false
    });

    console.log('[ACEITA]', rideId, '—', platform);
    res.json({ success: true, isReal: ride.source === 'real' });
});

// ============================================================
// REJEITAR CORRIDA
// ============================================================
app.post('/api/reject-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;

    if (!activePlatforms[platform]) return res.json({ success: false });

    var ride = activePlatforms[platform].rides.find(function(r) {
        return r.id === rideId;
    });

    if (!ride) return res.json({ success: false, reason: 'Corrida nao encontrada' });

    ride.status = 'rejected';
    console.log('[REJEITADA]', rideId);
    res.json({ success: true });
});

// ============================================================
// MacroDroid — busca comandos pendentes para executar
// ============================================================
app.get('/api/pending-commands', function(req, res) {
    var pending = pendingAcceptCommands.filter(function(c) { return !c.executed; });
    pending.forEach(function(c) { c.executed = true; });
    res.json(pending);
});

// ============================================================
// TOGGLE PLATAFORMA
// ============================================================
app.post('/api/platform/:platform/toggle', function(req, res) {
    var p = req.params.platform;
    if (!activePlatforms[p]) return res.json({ success: false });
    activePlatforms[p].enabled = !activePlatforms[p].enabled;
    console.log('[TOGGLE]', p, '→', activePlatforms[p].enabled ? 'ON' : 'OFF');
    res.json({ success: true, enabled: activePlatforms[p].enabled });
});

// ============================================================
// ESTATÍSTICAS
// ============================================================
app.get('/api/stats', function(req, res) {
    var stats = {};
    Object.keys(activePlatforms).forEach(function(p) {
        var rides    = activePlatforms[p].rides;
        var pending  = rides.filter(function(r){ return r.status==='pending';  }).length;
        var accepted = rides.filter(function(r){ return r.status==='accepted'; }).length;
        var rejected = rides.filter(function(r){ return r.status==='rejected'; }).length;
        stats[p] = { total: rides.length, pending: pending, accepted: accepted, rejected: rejected };
    });
    res.json(stats);
});

// ============================================================
// LIMPEZA PERIÓDICA — a cada 5 minutos
// Mantém corridas pendentes; remove aceitas/rejeitadas antigas
// ============================================================
setInterval(function() {
    var cutoff = Date.now() - (5 * 60 * 1000);  // 5 min
    Object.keys(activePlatforms).forEach(function(p) {
        var before = activePlatforms[p].rides.length;
        activePlatforms[p].rides = activePlatforms[p].rides.filter(function(r) {
            if (r.status === 'pending') return true;             // sempre mantém pendentes
            return new Date(r.timestamp).getTime() > cutoff;    // remove antigas não-pendentes
        });
        var removed = before - activePlatforms[p].rides.length;
        if (removed > 0) console.log('[LIMPEZA]', p, '— removidas', removed, 'corridas');
    });

    // Limpa comandos MacroDroid já executados com mais de 30s
    var cmdCutoff = Date.now() - 30000;
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > cmdCutoff;
    });

    console.log('[LIMPEZA] Concluída:', new Date().toLocaleTimeString('pt-BR'));
}, 300000);

// ── Inicia servidor ──────────────────────────────────────────
var PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
    console.log('╔════════════════════════════════════╗');
    console.log('║  DeliveryHub v2.0 rodando          ║');
    console.log('║  Porta: ' + PORT + '                        ║');
    console.log('║  /api/ping       → health-check    ║');
    console.log('║  /api/notification → POST e GET    ║');
    console.log('╚════════════════════════════════════╝');
});
