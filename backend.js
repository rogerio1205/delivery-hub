// ============================================================
// DeliveryHub — backend.js v3.0
// Exibe oferta DENTRO do DeliveryHub com timer real
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── Tempo de expiração por plataforma (segundos) ─────────────
var EXPIRY = {
    ifood:    40,
    keeta:    40,
    ubereats: 30,
    loggi:    30
};

// ── Estado ───────────────────────────────────────────────────
var userPreferences = {
    latitude:         -23.6721,
    longitude:        -46.6077,
    raioMaximo:       5,
    ganhoMinimo:      10,
    distanciaMaxima:  10
};

var activePlatforms = {
    ifood:    { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta:    { rides: [], enabled: true },
    loggi:    { rides: [], enabled: true }
};

var pendingAcceptCommands = [];
var recentNotifKeys = {};

// ── packageName → plataforma ──────────────────────────────────
var PACKAGE_MAP = {
    'br.com.brainweb.ifood': 'ifood',
    'com.ubercab.eats':      'ubereats',
    'com.keeta.courier':     'keeta',
    'com.keeta.driver':      'keeta',
    'br.com.loggi.android':  'loggi'
};

var PACKAGE_NAME = {
    'ifood':    'br.com.brainweb.ifood',
    'ubereats': 'com.ubercab.eats',
    'keeta':    'com.keeta.courier',
    'loggi':    'br.com.loggi.android'
};

function detectPlatform(platform, packageName) {
    if (platform && activePlatforms[platform]) return platform;
    if (packageName && PACKAGE_MAP[packageName]) return PACKAGE_MAP[packageName];
    if (packageName) {
        var pkg = packageName.toLowerCase();
        if (pkg.indexOf('ifood')  >= 0) return 'ifood';
        if (pkg.indexOf('uber')   >= 0) return 'ubereats';
        if (pkg.indexOf('keeta')  >= 0) return 'keeta';
        if (pkg.indexOf('loggi')  >= 0) return 'loggi';
    }
    return null;
}

// ── Extrai dados da notificação ───────────────────────────────
function extractRideData(fullText) {
    // Valor R$
    var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    var earnings   = moneyMatch ? parseFloat(moneyMatch[1].replace(',', '.')) : null;

    // Distância km
    var distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    var distance  = distMatch
        ? parseFloat(distMatch[1].replace(',', '.'))
        : parseFloat((Math.random() * 3 + 1).toFixed(1));

    // Timer (ex: "Pegar(40s)" ou "40s")
    var timerMatch = fullText.match(/(\d+)\s*s\b/i);
    var timerSecs  = timerMatch ? parseInt(timerMatch[1]) : null;

    // Endereço restaurante (linha que contém número de rua)
    var lines = fullText.split(/[\n|•·,]/);
    var origem  = '';
    var destino = '';
    lines.forEach(function(line) {
        line = line.trim();
        if (!line) return;
        if (/rua|av\.|avenida|alameda|estrada/i.test(line) && !origem) {
            origem = line;
        } else if (/rua|av\.|avenida|alameda|estrada/i.test(line) && !destino) {
            destino = line;
        }
    });

    return {
        earnings:  earnings,
        distance:  distance,
        timerSecs: timerSecs,
        origem:    origem,
        destino:   destino
    };
}

// ── Processar notificação ─────────────────────────────────────
function processNotification(data, res) {
    var platform    = (data.platform    || '').toString().trim();
    var packageName = (data.packageName || '').toString().trim();
    var title       = (data.title       || '').toString().trim();
    var text        = (data.text        || '').toString().trim();

    console.log('\n=== NOTIFICACAO RECEBIDA ===');
    console.log('platform   :', platform);
    console.log('packageName:', packageName);
    console.log('title      :', title);
    console.log('text       :', text);

    var det = detectPlatform(platform, packageName);
    if (!det) {
        console.log('[ERRO] Plataforma nao identificada');
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    if (!activePlatforms[det].enabled) {
        console.log('[SKIP] Desabilitada:', det);
        return res.json({ success: false, reason: 'Plataforma desabilitada' });
    }

    // Deduplicação 15s
    var key = det + '|' + title + '|' + text;
    if (recentNotifKeys[key]) {
        console.log('[DEDUP] Ignorada');
        return res.json({ success: false, reason: 'Duplicata' });
    }
    recentNotifKeys[key] = true;
    setTimeout(function() { delete recentNotifKeys[key]; }, 15000);

    var fullText = title + '\n' + text;
    var ext      = extractRideData(fullText);

    // Verifica mínimo
    if (ext.earnings !== null && ext.earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('[SKIP] R$' + ext.earnings + ' < minimo');
        return res.json({ success: false, reason: 'Abaixo do minimo' });
    }

    // Timer: usa o do app, senão padrão da plataforma
    var expirySecs = ext.timerSecs || EXPIRY[det] || 40;
    var expiresAt  = new Date(Date.now() + expirySecs * 1000).toISOString();

    // Destino para exibição
    var destination = ext.destino || ext.origem ||
        (text.length > 0 ? text.substring(0, 120) : title.substring(0, 120)) ||
        'Verificar no app';

    // Origem (restaurante)
    var origem = ext.origem || 'Restaurante — verificar no app';

    // Posição aproximada
    var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    var lat = (userPreferences.latitude  || -23.6721) + (Math.random() - 0.5) * spread;
    var lng = (userPreferences.longitude || -46.6077) + (Math.random() - 0.5) * spread;

    var newRide = {
        id:          det + '-real-' + Date.now(),
        platform:    det,
        packageName: PACKAGE_NAME[det] || '',
        lat:         parseFloat(lat.toFixed(6)),
        lng:         parseFloat(lng.toFixed(6)),
        distance:    parseFloat(ext.distance).toFixed(1),
        earnings:    (ext.earnings !== null ? ext.earnings : 0).toFixed(2),
        origem:      origem,
        destination: destination,
        timestamp:   new Date().toISOString(),
        expiresAt:   expiresAt,
        expirySecs:  expirySecs,
        status:      'pending',
        source:      'real',
        rawTitle:    title,
        rawText:     text
    };

    activePlatforms[det].rides.push(newRide);
    console.log('[OK]', det, 'R$' + newRide.earnings, '| timer:', expirySecs + 's');
    res.json({ success: true, ride: newRide });
}

// ── Rotas ─────────────────────────────────────────────────────
app.get('/api/ping', function(req, res) {
    res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/config', function(req, res) {
    res.json(userPreferences);
});

app.post('/api/config', function(req, res) {
    userPreferences = Object.assign({}, userPreferences, req.body);
    console.log('[CONFIG]', JSON.stringify(userPreferences));
    res.json({ success: true });
});

app.post('/api/notification', function(req, res) {
    processNotification(req.body, res);
});
app.get('/api/notification', function(req, res) {
    processNotification(req.query, res);
});

// Corridas — expira automaticamente
app.get('/api/rides', function(req, res) {
    var now = Date.now();
    var all = [];
    Object.keys(activePlatforms).forEach(function(p) {
        if (!activePlatforms[p].enabled) return;
        activePlatforms[p].rides.forEach(function(ride) {
            if (ride.status !== 'pending') return;
            if (ride.expiresAt && new Date(ride.expiresAt).getTime() < now) {
                ride.status = 'expired';
                console.log('[EXPIRADA]', ride.id);
                return;
            }
            all.push(Object.assign({}, ride, { platform: p }));
        });
    });
    all.sort(function(a, b) {
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });
    res.json(all);
});

app.post('/api/accept-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;
    if (!activePlatforms[platform]) return res.json({ success: false });

    var ride = activePlatforms[platform].rides.find(function(r) {
        return r.id === rideId;
    });
    if (!ride) return res.json({ success: false, reason: 'Nao encontrada' });

    if (ride.expiresAt && new Date(ride.expiresAt).getTime() < Date.now()) {
        ride.status = 'expired';
        return res.json({ success: false, reason: 'Oferta expirada' });
    }

    ride.status = 'accepted';
    pendingAcceptCommands.push({
        rideId:      rideId,
        platform:    platform,
        packageName: ride.packageName || PACKAGE_NAME[platform] || '',
        timestamp:   new Date().toISOString(),
        executed:    false
    });
    console.log('[ACEITA]', rideId, platform);
    res.json({ success: true, isReal: true });
});

app.post('/api/reject-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;
    if (!activePlatforms[platform]) return res.json({ success: false });

    var ride = activePlatforms[platform].rides.find(function(r) {
        return r.id === rideId;
    });
    if (!ride) return res.json({ success: false, reason: 'Nao encontrada' });

    ride.status = 'rejected';
    console.log('[REJEITADA]', rideId);
    res.json({ success: true });
});

// MacroDroid busca comandos
app.get('/api/pending-commands', function(req, res) {
    var pending = pendingAcceptCommands.filter(function(c) { return !c.executed; });
    pending.forEach(function(c) { c.executed = true; });
    res.json(pending);
});

app.post('/api/platform/:platform/toggle', function(req, res) {
    var p = req.params.platform;
    if (!activePlatforms[p]) return res.json({ success: false });
    activePlatforms[p].enabled = !activePlatforms[p].enabled;
    console.log('[TOGGLE]', p, activePlatforms[p].enabled ? 'ON' : 'OFF');
    res.json({ success: true, enabled: activePlatforms[p].enabled });
});

app.get('/api/stats', function(req, res) {
    var stats = {};
    Object.keys(activePlatforms).forEach(function(p) {
        var rides = activePlatforms[p].rides;
        stats[p] = {
            total:    rides.length,
            pending:  rides.filter(function(r){ return r.status==='pending';  }).length,
            accepted: rides.filter(function(r){ return r.status==='accepted'; }).length,
            rejected: rides.filter(function(r){ return r.status==='rejected'; }).length,
            expired:  rides.filter(function(r){ return r.status==='expired';  }).length
        };
    });
    res.json(stats);
});

// Limpeza 5min
setInterval(function() {
    var cutoff = Date.now() - (5 * 60 * 1000);
    Object.keys(activePlatforms).forEach(function(p) {
        var before = activePlatforms[p].rides.length;
        activePlatforms[p].rides = activePlatforms[p].rides.filter(function(r) {
            if (r.status === 'pending') return true;
            return new Date(r.timestamp).getTime() > cutoff;
        });
        var rm = before - activePlatforms[p].rides.length;
        if (rm > 0) console.log('[LIMPEZA]', p, rm, 'removidas');
    });
    var cc = Date.now() - 30000;
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > cc;
    });
    console.log('[LIMPEZA] OK:', new Date().toLocaleTimeString('pt-BR'));
}, 300000);

var PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║   DeliveryHub v3.0 — ONLINE          ║');
    console.log('║   Porta: ' + PORT + '                        ║');
    console.log('║   Oferta com timer real do app       ║');
    console.log('╚══════════════════════════════════════╝');
});
