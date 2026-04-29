// ============================================================
// DeliveryHub — backend.js v2.1
// Correção: aceita GET e POST, deduplicação, health-check
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── Estado ───────────────────────────────────────────────────
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

var pendingAcceptCommands = [];

// Deduplicação: evita mesma notificação em 15 segundos
var recentNotifKeys = {};

// ── Mapa de packageName → plataforma ─────────────────────────
var PACKAGE_MAP = {
    'br.com.brainweb.ifood':  'ifood',
    'com.ubercab.eats':       'ubereats',
    'com.keeta.courier':      'keeta',
    'com.keeta.driver':       'keeta',
    'br.com.loggi.android':   'loggi'
};

function detectPlatform(platform, packageName) {
    // Tenta pelo campo platform primeiro
    if (platform && activePlatforms[platform]) return platform;
    // Tenta pelo packageName exato
    if (packageName && PACKAGE_MAP[packageName]) return PACKAGE_MAP[packageName];
    // Tenta por substring
    if (packageName) {
        var pkg = packageName.toLowerCase();
        if (pkg.indexOf('ifood')  >= 0) return 'ifood';
        if (pkg.indexOf('uber')   >= 0) return 'ubereats';
        if (pkg.indexOf('keeta')  >= 0) return 'keeta';
        if (pkg.indexOf('loggi')  >= 0) return 'loggi';
    }
    return null;
}

// ── Lógica de processar notificação (GET ou POST) ─────────────
function processNotification(data, res) {
    var platform    = (data.platform    || '').toString().trim();
    var packageName = (data.packageName || '').toString().trim();
    var title       = (data.title       || '').toString().trim();
    var text        = (data.text        || '').toString().trim();

    console.log('\n=== NOTIFICAÇÃO RECEBIDA ===');
    console.log('platform   :', platform);
    console.log('packageName:', packageName);
    console.log('title      :', title);
    console.log('text       :', text);

    // Detectar plataforma
    var detectedPlatform = detectPlatform(platform, packageName);
    if (!detectedPlatform) {
        console.log('[ERRO] Plataforma não identificada');
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    // Verifica se plataforma está habilitada
    if (!activePlatforms[detectedPlatform].enabled) {
        console.log('[SKIP] Plataforma desabilitada:', detectedPlatform);
        return res.json({ success: false, reason: 'Plataforma desabilitada' });
    }

    // Deduplicação por conteúdo (janela de 15s)
    var dedupKey = detectedPlatform + '|' + title + '|' + text;
    if (recentNotifKeys[dedupKey]) {
        console.log('[DEDUP] Notificação duplicada ignorada');
        return res.json({ success: false, reason: 'Duplicata ignorada' });
    }
    recentNotifKeys[dedupKey] = true;
    setTimeout(function() { delete recentNotifKeys[dedupKey]; }, 15000);

    var fullText = title + ' ' + text;

    // Extrair valor R$
    var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    var earnings   = moneyMatch
        ? parseFloat(moneyMatch[1].replace(',', '.'))
        : null;

    // Verificar ganho mínimo (só filtra se encontrou um valor)
    if (earnings !== null && earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('[SKIP] R$' + earnings + ' < mínimo R$' + userPreferences.ganhoMinimo);
        return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
    }

    // Extrair distância km
    var distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    var distance  = distMatch
        ? parseFloat(distMatch[1].replace(',', '.'))
        : parseFloat((Math.random() * 3 + 0.5).toFixed(1));

    // Destino — usa texto da notificação
    var destination = text.length > 0
        ? text.substring(0, 120)
        : (title.length > 0 ? title.substring(0, 120) : 'Verificar no app');

    // Posição aproximada dentro do raio configurado
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
    console.log('[OK] Corrida adicionada:', detectedPlatform, 'R$' + newRide.earnings);
    res.json({ success: true, ride: newRide });
}

// ── Rotas ─────────────────────────────────────────────────────

// Health-check — testa se o servidor está vivo
app.get('/api/ping', function(req, res) {
    res.json({ ok: true, ts: new Date().toISOString(), msg: 'DeliveryHub online' });
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

// ── NOTIFICAÇÃO — aceita POST (body JSON) e GET (query params) ─
// POST é o método correto — use na aba "Corpo da requisição" do MacroDroid
app.post('/api/notification', function(req, res) {
    processNotification(req.body, res);
});

// GET — fallback caso o MacroDroid coloque params na URL
app.get('/api/notification', function(req, res) {
    processNotification(req.query, res);
});

// ── Corridas pendentes ────────────────────────────────────────
app.get('/api/rides', function(req, res) {
    var allRides = [];
    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;
        activePlatforms[platform].rides.forEach(function(ride) {
            if (ride.status !== 'pending') return;
            allRides.push(Object.assign({}, ride, { platform: platform }));
        });
    });
    allRides.sort(function(a, b) {
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });
    res.json(allRides);
});

// ── Aceitar corrida ───────────────────────────────────────────
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
    console.log('[ACEITA]', rideId, platform);
    res.json({ success: true, isReal: ride.source === 'real' });
});

// ── Rejeitar corrida ──────────────────────────────────────────
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

// ── Comandos pendentes para MacroDroid ───────────────────────
app.get('/api/pending-commands', function(req, res) {
    var pending = pendingAcceptCommands.filter(function(c) { return !c.executed; });
    pending.forEach(function(c) { c.executed = true; });
    res.json(pending);
});

// ── Toggle plataforma ─────────────────────────────────────────
app.post('/api/platform/:platform/toggle', function(req, res) {
    var p = req.params.platform;
    if (!activePlatforms[p]) return res.json({ success: false });
    activePlatforms[p].enabled = !activePlatforms[p].enabled;
    console.log('[TOGGLE]', p, activePlatforms[p].enabled ? 'ON' : 'OFF');
    res.json({ success: true, enabled: activePlatforms[p].enabled });
});

// ── Estatísticas ──────────────────────────────────────────────
app.get('/api/stats', function(req, res) {
    var stats = {};
    Object.keys(activePlatforms).forEach(function(p) {
        var rides = activePlatforms[p].rides;
        stats[p] = {
            total:    rides.length,
            pending:  rides.filter(function(r){ return r.status==='pending';  }).length,
            accepted: rides.filter(function(r){ return r.status==='accepted'; }).length,
            rejected: rides.filter(function(r){ return r.status==='rejected'; }).length
        };
    });
    res.json(stats);
});

// ── Limpeza a cada 5 minutos ──────────────────────────────────
setInterval(function() {
    var cutoff = Date.now() - (5 * 60 * 1000);
    Object.keys(activePlatforms).forEach(function(p) {
        var before = activePlatforms[p].rides.length;
        activePlatforms[p].rides = activePlatforms[p].rides.filter(function(r) {
            if (r.status === 'pending') return true;
            return new Date(r.timestamp).getTime() > cutoff;
        });
        var removed = before - activePlatforms[p].rides.length;
        if (removed > 0) console.log('[LIMPEZA]', p, removed, 'removidas');
    });

    var cmdCutoff = Date.now() - 30000;
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > cmdCutoff;
    });
    console.log('[LIMPEZA] OK:', new Date().toLocaleTimeString('pt-BR'));
}, 300000);

// ── Start ──────────────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║   DeliveryHub v2.1 — ONLINE          ║');
    console.log('║   Porta : ' + PORT + '                       ║');
    console.log('║   POST /api/notification  (correto)  ║');
    console.log('║   GET  /api/notification  (fallback) ║');
    console.log('║   GET  /api/ping          (teste)    ║');
    console.log('╚══════════════════════════════════════╝');
});
