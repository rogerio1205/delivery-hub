const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let userPreferences = {
    latitude: -23.6821,
    longitude: -46.5650,
    raioMaximo: 5,
    ganhoMinimo: 15,
    distanciaMaxima: 10
};

let activePlatforms = {
    ifood:    { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta:    { rides: [], enabled: true },
    loggi:    { rides: [], enabled: true }
};

let pendingAcceptCommands = [];

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/config', function(req, res) {
    userPreferences = Object.assign({}, userPreferences, req.body);
    console.log('Config atualizada');
    res.json({ success: true });
});

app.get('/api/config', function(req, res) {
    res.json(userPreferences);
});

// ================================================
// ENDPOINT PRINCIPAL — RECEBER NOTIFICACAO REAL
// ================================================
app.post('/api/notification', function(req, res) {
    var platform  = req.body.platform;
    var title     = req.body.title;
    var text      = req.body.text;
    var packageName = req.body.packageName;

    console.log('=== NOTIFICACAO REAL ===');
    console.log('Package: ' + (packageName || platform));
    console.log('Titulo: ' + title);
    console.log('Texto: ' + text);

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

    if (!detectedPlatform) {
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    var fullText = (title || '') + ' ' + (text || '');

    // Extrair valor R$
    var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    var earnings = moneyMatch ? parseFloat(moneyMatch[1].replace(',', '.')) : null;

    // Extrair distancia
    var distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    var distance = distMatch
        ? parseFloat(distMatch[1].replace(',', '.'))
        : (Math.random() * 4 + 1).toFixed(1);

    // Verificar ganho minimo
    if (earnings !== null && earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('Ignorado: R$' + earnings + ' abaixo do minimo');
        return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
    }

    // Destino
    var destination = 'Destino nao informado';
    if (text && text.length > 0) {
        destination = text.substring(0, 80).trim();
    } else if (title && title.length > 0) {
        destination = title.substring(0, 80).trim();
    }

    // Posicao proxima ao usuario
    var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    var lat = (userPreferences.latitude  || -23.6821) + (Math.random() - 0.5) * spread;
    var lng = (userPreferences.longitude || -46.5650) + (Math.random() - 0.5) * spread;

    var newRide = {
        id:          detectedPlatform + '-real-' + Date.now(),
        platform:    detectedPlatform,
        lat:         lat,
        lng:         lng,
        distance:    parseFloat(distance).toFixed(1),
        earnings:    (earnings !== null ? earnings : 20).toFixed(2),
        destination: destination,
        timestamp:   new Date(),
        status:      'pending',
        source:      'real',
        rawTitle:    title,
        rawText:     text
    };

    if (activePlatforms[detectedPlatform]) {
        // Remove simuladas dessa plataforma quando chega real
        activePlatforms[detectedPlatform].rides = activePlatforms[detectedPlatform].rides.filter(
            function(r) { return r.source === 'real'; }
        );
        activePlatforms[detectedPlatform].rides.push(newRide);
        console.log('REAL adicionada: ' + detectedPlatform + ' R$' + newRide.earnings);
        res.json({ success: true, ride: newRide });
    } else {
        res.json({ success: false, reason: 'Plataforma desabilitada' });
    }
});

app.get('/api/rides', function(req, res) {
    var allRides = [];
    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;
        activePlatforms[platform].rides.forEach(function(ride) {
            var r = Object.assign({}, ride);
            r.platform = platform;
            allRides.push(r);
        });
    });
    allRides.sort(function(a, b) {
        if (a.source === 'real' && b.source !== 'real') return -1;
        if (b.source === 'real' && a.source !== 'real') return  1;
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });
    res.json(allRides);
});

app.post('/api/accept-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;

    if (!activePlatforms[platform]) {
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
        ride.status = 'accepted';
        if (ride.source === 'real') {
            pendingAcceptCommands.push({
                rideId: rideId,
                platform: platform,
                timestamp: new Date(),
                executed: false
            });
            console.log('Comando aceitar enviado ao MacroDroid');
        }
        console.log('Corrida aceita: ' + rideId);
        res.json({ success: true, isReal: ride.source === 'real' });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/reject-ride', function(req, res) {
    var rideId   = req.body.rideId;
    var platform = req.body.platform;

    if (!activePlatforms[platform]) return res.json({ success: false });

    var ride = null;
    for (var i = 0; i < activePlatforms[platform].rides.length; i++) {
        if (activePlatforms[platform].rides[i].id === rideId) {
            ride = activePlatforms[platform].rides[i];
            break;
        }
    }

    if (ride) {
        ride.status = 'rejected';
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/pending-commands', function(req, res) {
    var pending = pendingAcceptCommands.filter(function(c) { return !c.executed; });
    pending.forEach(function(c) { c.executed = true; });
    res.json(pending);
});

app.post('/api/platform/:platform/toggle', function(req, res) {
    var platform = req.params.platform;
    if (activePlatforms[platform]) {
        activePlatforms[platform].enabled = !activePlatforms[platform].enabled;
        console.log(platform + ': ' + (activePlatforms[platform].enabled ? 'ON' : 'OFF'));
        res.json({ success: true, enabled: activePlatforms[platform].enabled });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/stats', function(req, res) {
    var stats = {};
    Object.keys(activePlatforms).forEach(function(platform) {
        var rides = activePlatforms[platform].rides;
        var pending = 0, accepted = 0, rejected = 0, real = 0;
        for (var i = 0; i < rides.length; i++) {
            if (rides[i].status === 'pending')  pending++;
            if (rides[i].status === 'accepted') accepted++;
            if (rides[i].status === 'rejected') rejected++;
            if (rides[i].source === 'real')     real++;
        }
        stats[platform] = { total: rides.length, pending: pending, accepted: accepted, rejected: rejected, real: real };
    });
    res.json(stats);
});

// ================================================
// SIMULADOR — so roda quando NAO tem corrida real
// ================================================
var platformConfigs = {
    ifood:    { destinations: ['Av. Lions, Santo Andre','Rua das Figueiras','Vila Jordanopolis','Assai Atacadista','Eng. Salvador Arena','Centro de Santo Andre'], minEarnings: 12, maxEarnings: 45 },
    ubereats: { destinations: ['Vila Jordanopolis','Universidade Federal ABC','Benz Brasil','Vila Luzita','Av. Lions'], minEarnings: 15, maxEarnings: 50 },
    keeta:    { destinations: ['Santo Andre Centro','Av. Industrial','Vila Palmares','Campestre','Silveira','Jardim Bela Vista'], minEarnings: 10, maxEarnings: 40 },
    loggi:    { destinations: ['Sao Bernardo do Campo','Rudge Ramos','Diadema','Maua','Ribeirao Pires','Rio Grande da Serra'], minEarnings: 18, maxEarnings: 55 }
};

setInterval(function() {
    var centerLat = userPreferences.latitude  || -23.6821;
    var centerLng = userPreferences.longitude || -46.5650;
    var raio      = userPreferences.raioMaximo  || 5;
    var ganhoMin  = userPreferences.ganhoMinimo || 15;

    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;

        // Se tem corrida REAL pendente nao gera simulada
        var temReal = false;
        for (var j = 0; j < activePlatforms[platform].rides.length; j++) {
            if (activePlatforms[platform].rides[j].status === 'pending' &&
                activePlatforms[platform].rides[j].source === 'real') {
                temReal = true;
                break;
            }
        }
        if (temReal) return;

        var config   = platformConfigs[platform];
        var numRides = Math.random() > 0.7 ? 2 : 1;

        for (var i = 0; i < numRides; i++) {
            var offset   = (Math.random() - 0.5) * (raio / 111);
            var distance = (Math.random() * raio + 0.5).toFixed(1);
            var earnings = (Math.random() * (config.maxEarnings - config.minEarnings) + config.minEarnings).toFixed(2);

            if (parseFloat(earnings) < ganhoMin) continue;

            activePlatforms[platform].rides.push({
                id:          platform + '-sim-' + Date.now() + '-' + i,
                platform:    platform,
                lat:         centerLat + offset,
                lng:         centerLng + offset,
                distance:    distance,
                earnings:    earnings,
                destination: config.destinations[Math.floor(Math.random() * config.destinations.length)],
                timestamp:   new Date(),
                status:      'pending',
                source:      'simulated'
            });
        }

        if (activePlatforms[platform].rides.length > 50) {
            activePlatforms[platform].rides = activePlatforms[platform].rides.slice(-50);
        }
    });

    // Limpar comandos antigos
    var cutoff = Date.now() - 30000;
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > cutoff;
    });

    console.log('Simulador: ' + new Date().toLocaleTimeString('pt-BR'));
}, 5000);

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('DeliveryHub rodando na porta ' + PORT);
    console.log('Endpoint /api/notification ATIVO');
    console.log('Aguardando notificacoes reais...');
});
