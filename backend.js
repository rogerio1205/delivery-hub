const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ================================================
// CONFIGURACAO GLOBAL
// ================================================
var userPreferences = {
    latitude: -23.6821,
    longitude: -46.5650,
    raioMaximo: 5,
    ganhoMinimo: 15,
    distanciaMaxima: 10
};

var activePlatforms = {
    ifood:    { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta:    { rides: [], enabled: true },
    loggi:    { rides: [], enabled: true }
};

var pendingAcceptCommands = [];
var simulatorActive = true;

// ================================================
// VALIDACAO DE DADOS
// ================================================
function validateRideData(ride) {
    if (!ride) return false;
    if (!ride.platform || !ride.lat || !ride.lng) return false;
    if (isNaN(parseFloat(ride.earnings)) || isNaN(parseFloat(ride.distance))) return false;
    if (!ride.destination || ride.destination.trim() === '') return false;
    return true;
}

function sanitizeString(str) {
    if (!str) return '';
    return String(str).trim().substring(0, 200);
}

// ================================================
// ROTAS BASICAS
// ================================================
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/config', function(req, res) {
    res.json(userPreferences);
});

app.post('/api/config', function(req, res) {
    try {
        var body = req.body;
        if (body.latitude !== undefined) userPreferences.latitude = parseFloat(body.latitude);
        if (body.longitude !== undefined) userPreferences.longitude = parseFloat(body.longitude);
        if (body.raioMaximo !== undefined) userPreferences.raioMaximo = parseFloat(body.raioMaximo);
        if (body.ganhoMinimo !== undefined) userPreferences.ganhoMinimo = parseFloat(body.ganhoMinimo);
        if (body.distanciaMaxima !== undefined) userPreferences.distanciaMaxima = parseFloat(body.distanciaMaxima);

        console.log('[CONFIG] Atualizada:', userPreferences);
        res.json({ success: true });
    } catch (e) {
        console.error('[CONFIG] Erro:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ================================================
// RECEBER NOTIFICACAO REAL DO MACRODROID
// ================================================
app.post('/api/notification', function(req, res) {
    try {
        var platform    = req.body.platform;
        var title       = req.body.title;
        var text        = req.body.text;
        var packageName = req.body.packageName;

        console.log('[NOTIF] Recebida de:', packageName || platform);

        var packageMap = {
            'br.com.brainweb.ifood': 'ifood',
            'com.ubercab.eats':      'ubereats',
            'com.keeta.courier':     'keeta',
            'com.keeta.driver':      'keeta',
            'br.com.loggi.android':  'loggi'
        };

        var detectedPlatform = platform;
        if (!detectedPlatform && packageName) {
            detectedPlatform = packageMap[packageName];
            if (!detectedPlatform) {
                var pkg = packageName.toLowerCase();
                if (pkg.indexOf('ifood') >= 0)      detectedPlatform = 'ifood';
                else if (pkg.indexOf('uber') >= 0)  detectedPlatform = 'ubereats';
                else if (pkg.indexOf('keeta') >= 0) detectedPlatform = 'keeta';
                else if (pkg.indexOf('loggi') >= 0) detectedPlatform = 'loggi';
                else                                detectedPlatform = 'ifood';
            }
        }

        if (!detectedPlatform || !activePlatforms[detectedPlatform]) {
            console.log('[NOTIF] Plataforma invalida:', detectedPlatform);
            return res.json({ success: false, reason: 'Plataforma invalida' });
        }

        var fullText = (title || '') + ' ' + (text || '');
        var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
        var earnings   = moneyMatch ? parseFloat(moneyMatch[1].replace(',', '.')) : 0;

        if (earnings < (userPreferences.ganhoMinimo || 0)) {
            console.log('[NOTIF] Ignorada: R$' + earnings + ' < R$' + userPreferences.ganhoMinimo);
            return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
        }

        var distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
        var distance  = distMatch ? parseFloat(distMatch[1].replace(',', '.')) : (Math.random() * 3 + 0.5).toFixed(1);

        var destination = sanitizeString(text || title || 'Verificar no app');

        var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
        var lat = (userPreferences.latitude  || -23.6821) + (Math.random() - 0.5) * spread;
        var lng = (userPreferences.longitude || -46.5650) + (Math.random() - 0.5) * spread;

        var newRide = {
            id:          detectedPlatform + '-real-' + Date.now(),
            platform:    detectedPlatform,
            lat:         parseFloat(lat.toFixed(6)),
            lng:         parseFloat(lng.toFixed(6)),
            distance:    parseFloat(distance).toFixed(1),
            earnings:    parseFloat(earnings).toFixed(2),
            destination: destination,
            timestamp:   new Date().toISOString(),
            status:      'pending',
            source:      'real'
        };

        if (!validateRideData(newRide)) {
            console.log('[NOTIF] Dados invalidos');
            return res.json({ success: false, reason: 'Dados invalidos' });
        }

        activePlatforms[detectedPlatform].rides.push(newRide);
        console.log('[NOTIF] REAL adicionada:', detectedPlatform, 'R$' + newRide.earnings);
        res.json({ success: true, ride: newRide });
    } catch (e) {
        console.error('[NOTIF] Erro:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ================================================
// SIMULADOR DE CORRIDAS (para testes)
// ================================================
function generateSimulatedRide(platform) {
    var platforms = ['ifood', 'ubereats', 'keeta', 'loggi'];
    var p = platform || platforms[Math.floor(Math.random() * platforms.length)];

    var earnings = (Math.random() * 30 + 10).toFixed(2);
    var distance = (Math.random() * 8 + 0.5).toFixed(1);
    var destinations = [
        'Rua das Flores, 123',
        'Avenida Paulista, 456',
        'Rua Oscar Freire, 789',
        'Avenida Brasil, 321',
        'Rua Augusta, 654'
    ];

    var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    var lat = (userPreferences.latitude  || -23.6821) + (Math.random() - 0.5) * spread;
    var lng = (userPreferences.longitude || -46.5650) + (Math.random() - 0.5) * spread;

    return {
        id:          p + '-sim-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        platform:    p,
        lat:         parseFloat(lat.toFixed(6)),
        lng:         parseFloat(lng.toFixed(6)),
        distance:    parseFloat(distance),
        earnings:    parseFloat(earnings),
        destination: destinations[Math.floor(Math.random() * destinations.length)],
        timestamp:   new Date().toISOString(),
        status:      'pending',
        source:      'simulator'
    };
}

setInterval(function() {
    if (!simulatorActive) return;

    var platforms = Object.keys(activePlatforms).filter(function(p) {
        return activePlatforms[p].enabled;
    });

    if (platforms.length > 0 && Math.random() > 0.6) {
        var p = platforms[Math.floor(Math.random() * platforms.length)];
        var ride = generateSimulatedRide(p);
        activePlatforms[p].rides.push(ride);
        console.log('[SIM] Corrida gerada:', p, 'R$' + ride.earnings);
    }
}, 8000);

// ================================================
// GET RIDES
// ================================================
app.get('/api/rides', function(req, res) {
    try {
        var allRides = [];
        Object.keys(activePlatforms).forEach(function(platform) {
            if (!activePlatforms[platform].enabled) return;
            activePlatforms[platform].rides.forEach(function(ride) {
                if (ride.status !== 'pending') return;
                allRides.push(ride);
            });
        });

        allRides.sort(function(a, b) {
            return parseFloat(b.earnings) - parseFloat(a.earnings);
        });

        res.json(allRides);
    } catch (e) {
        console.error('[RIDES] Erro:', e.message);
        res.json([]);
    }
});

// ================================================
// ACEITAR CORRIDA
// ================================================
app.post('/api/accept-ride', function(req, res) {
    try {
        var rideId   = req.body.rideId;
        var platform = req.body.platform;

        if (!rideId || !platform || !activePlatforms[platform]) {
            return res.json({ success: false, error: 'Dados invalidos' });
        }

        var ride = null;
        for (var i = 0; i < activePlatforms[platform].rides.length; i++) {
            if (activePlatforms[platform].rides[i].id === rideId) {
                ride = activePlatforms[platform].rides[i];
                break;
            }
        }

        if (!ride) {
            return res.json({ success: false, error: 'Corrida nao encontrada' });
        }

        ride.status = 'accepted';
        ride.acceptedAt = new Date().toISOString();

        pendingAcceptCommands.push({
            rideId:    rideId,
            platform:  platform,
            timestamp: new Date().toISOString(),
            executed:  false
        });

        console.log('[ACCEPT] Corrida aceita:', rideId, 'plataforma:', platform);
        res.json({ success: true, isReal: ride.source === 'real' });
    } catch (e) {
        console.error('[ACCEPT] Erro:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ================================================
// REJEITAR CORRIDA
// ================================================
app.post('/api/reject-ride', function(req, res) {
    try {
        var rideId   = req.body.rideId;
        var platform = req.body.platform;

        if (!rideId || !platform || !activePlatforms[platform]) {
            return res.json({ success: false });
        }

        var ride = null;
        for (var i = 0; i < activePlatforms[platform].rides.length; i++) {
            if (activePlatforms[platform].rides[i].id === rideId) {
                ride = activePlatforms[platform].rides[i];
                break;
            }
        }

        if (ride) {
            ride.status = 'rejected';
            ride.rejectedAt = new Date().toISOString();
            console.log('[REJECT] Corrida rejeitada:', rideId);
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (e) {
        console.error('[REJECT] Erro:', e.message);
        res.json({ success: false });
    }
});

// ================================================
// MACRODROID — COMANDOS PENDENTES
// ================================================
app.get('/api/pending-commands', function(req, res) {
    try {
        var pending = pendingAcceptCommands.filter(function(c) { return !c.executed; });
        pending.forEach(function(c) { c.executed = true; });
        res.json(pending);
    } catch (e) {
        console.error('[COMMANDS] Erro:', e.message);
        res.json([]);
    }
});

// ================================================
// TOGGLE PLATAFORMA
// ================================================
app.post('/api/platform/:platform/toggle', function(req, res) {
    try {
        var platform = req.params.platform;
        if (!activePlatforms[platform]) {
            return res.json({ success: false, error: 'Plataforma invalida' });
        }

        activePlatforms[platform].enabled = !activePlatforms[platform].enabled;
        console.log('[TOGGLE]', platform + ':', (activePlatforms[platform].enabled ? 'ON' : 'OFF'));
        res.json({ success: true, enabled: activePlatforms[platform].enabled });
    } catch (e) {
        console.error('[TOGGLE] Erro:', e.message);
        res.json({ success: false });
    }
});

// ================================================
// ESTATISTICAS
// ================================================
app.get('/api/stats', function(req, res) {
    try {
        var stats = {};
        Object.keys(activePlatforms).forEach(function(platform) {
            var rides = activePlatforms[platform].rides;
            var pending = 0, accepted = 0, rejected = 0;
            for (var i = 0; i < rides.length; i++) {
                if (rides[i].status === 'pending')  pending++;
                if (rides[i].status === 'accepted') accepted++;
                if (rides[i].status === 'rejected') rejected++;
            }
            stats[platform] = {
                total:    rides.length,
                pending:  pending,
                accepted: accepted,
                rejected: rejected
            };
        });
        res.json(stats);
    } catch (e) {
        console.error('[STATS] Erro:', e.message);
        res.json({});
    }
});

// ================================================
// LIMPEZA AUTOMATICA
// ================================================
setInterval(function() {
    var cutoff = Date.now() - (10 * 60 * 1000);
    var cleaned = 0;

    Object.keys(activePlatforms).forEach(function(platform) {
        var before = activePlatforms[platform].rides.length;
        activePlatforms[platform].rides = activePlatforms[platform].rides.filter(function(r) {
            if (r.status === 'pending') return true;
            var rideTime = new Date(r.timestamp).getTime();
            return rideTime > cutoff;
        });
        cleaned += before - activePlatforms[platform].rides.length;
    });

    var cmdCutoff = Date.now() - 60000;
    var cmdBefore = pendingAcceptCommands.length;
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > cmdCutoff;
    });
    cleaned += cmdBefore - pendingAcceptCommands.length;

    if (cleaned > 0) {
        console.log('[CLEANUP] ' + cleaned + ' itens removidos em', new Date().toLocaleTimeString('pt-BR'));
    }
}, 600000);

// ================================================
// INICIAR SERVIDOR
// ================================================
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('\n╔════════════════════════════════════╗');
    console.log('║       🚗 DeliveryHub v1.0.0        ║');
    console.log('╚════════════════════════════════════╝\n');
    console.log('✅ Servidor rodando em: http://localhost:' + PORT);
    console.log('📱 Modo: REAL + SIMULADOR');
    console.log('🔔 Endpoint /api/notification ATIVO');
    console.log('🤖 Simulador de corridas ATIVO\n');
});
