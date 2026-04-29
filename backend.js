const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

var userPreferences = {
    latitude: -23.6722,
    longitude: -46.6072,
    raioMaximo: 5,
    ganhoMinimo: 5,
    distanciaMaxima: 10
};

var activePlatforms = {
    ifood:    { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta:    { rides: [], enabled: true },
    loggi:    { rides: [], enabled: true }
};

var pendingAcceptCommands = [];

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/config', function(req, res) {
    res.json(userPreferences);
});

app.post('/api/config', function(req, res) {
    userPreferences = Object.assign({}, userPreferences, req.body);
    console.log('Config atualizada:', JSON.stringify(userPreferences));
    res.json({ success: true });
});

// ================================================
// RECEBER NOTIFICACAO REAL DO MACRODROID
// ================================================
app.post('/api/notification', function(req, res) {
    var platform    = req.body.platform;
    var title       = req.body.title;
    var text        = req.body.text;
    var packageName = req.body.packageName;

    console.log('=== NOTIFICACAO RECEBIDA ===');
    console.log('Package: ' + (packageName || platform || 'vazio'));
    console.log('Titulo: ' + (title || 'vazio'));
    console.log('Texto: ' + (text || 'vazio'));

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
            else {
                console.log('App ignorado: ' + packageName);
                return res.json({ success: false, reason: 'App nao e delivery' });
            }
        }
    }

    if (!detectedPlatform) {
        console.log('Plataforma nao detectada');
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    var fullText = (title || '') + ' ' + (text || '');

    var moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    var earnings   = moneyMatch ? parseFloat(moneyMatch[1].replace(',', '.')) : null;

    var distMatch  = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    var distance   = distMatch ? parseFloat(distMatch[1].replace(',', '.')) : 2.0;

    if (earnings !== null && earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('Ignorado: R$' + earnings + ' < minimo R$' + userPreferences.ganhoMinimo);
        return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
    }

    var destination = 'Verificar no app';
    if (text && text.length > 0)        destination = text.substring(0, 150).trim();
    else if (title && title.length > 0) destination = title.substring(0, 150).trim();

    var spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    var lat    = (userPreferences.latitude  || -23.6722) + (Math.random() - 0.5) * spread;
    var lng    = (userPreferences.longitude || -46.6072) + (Math.random() - 0.5) * spread;

    var newRide = {
        id:          detectedPlatform + '-' + Date.now(),
        platform:    detectedPlatform,
        lat:         lat,
        lng:         lng,
        distance:    parseFloat(distance).toFixed(1),
        earnings:    (earnings !== null ? earnings : 0).toFixed(2),
        destination: destination,
        timestamp:   new Date(),
        status:      'pending',
        source:      'real',
        rawTitle:    title,
        rawText:     text
    };

    if (activePlatforms[detectedPlatform]) {
        activePlatforms[detectedPlatform].rides.push(newRide);
        console.log('✅ CORRIDA REAL: ' + detectedPlatform + ' R$' + newRide.earnings + ' — ' + destination.substring(0,50));
        console.log('Total ' + detectedPlatform + ': ' + activePlatforms[detectedPlatform].rides.length);
        res.json({ success: true, ride: newRide });
    } else {
        res.json({ success: false, reason: 'Plataforma desabilitada' });
    }
});

// ================================================
// GET RIDES
// ================================================
app.get('/api/rides', function(req, res) {
    var allRides = [];
    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;
        activePlatforms[platform].rides.forEach(function(ride) {
            if (ride.status !== 'pending') return;
            var r = Object.assign({}, ride);
            r.platform = platform;
            allRides.push(r);
        });
    });
    allRides.sort(function(a, b) {
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });
    console.log('GET /api/rides → ' + allRides.length + ' corridas pendentes');
    res.json(allRides);
});

// ================================================
// ACEITAR CORRIDA
// ================================================
app.post('/api/accept-ride', function(req, res) {
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
        ride.status = 'accepted';
        pendingAcceptCommands.push({
            rideId: rideId, platform: platform,
            timestamp: new Date(), executed: false
        });
        console.log('Aceita: ' + rideId);
        res.json({ success: true, isReal: true });
    } else {
        res.json({ success: false });
    }
});

// ================================================
// REJEITAR CORRIDA
// ================================================
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
        console.log('Rejeitada: ' + rideId);
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
        var p=0,a=0,r=0;
        for (var i=0;i<rides.length;i++){
            if(rides[i].status==='pending')  p++;
            if(rides[i].status==='accepted') a++;
            if(rides[i].status==='rejected') r++;
        }
        stats[platform]={total:rides.length,pending:p,accepted:a,rejected:r};
    });
    res.json(stats);
});

// Limpeza a cada 10 minutos
setInterval(function() {
    var cutoff = Date.now() - (10 * 60 * 1000);
    Object.keys(activePlatforms).forEach(function(platform) {
        activePlatforms[platform].rides = activePlatforms[platform].rides.filter(function(r) {
            return r.status === 'pending' || new Date(r.timestamp).getTime() > cutoff;
        });
    });
    pendingAcceptCommands = pendingAcceptCommands.filter(function(c) {
        return new Date(c.timestamp).getTime() > (Date.now() - 30000);
    });
    console.log('Limpeza: ' + new Date().toLocaleTimeString('pt-BR'));
}, 600000);

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('=====================================');
    console.log('DeliveryHub porta: ' + PORT);
    console.log('MODO: SOMENTE CORRIDAS REAIS');
    console.log('SEM SIMULADOR');
    console.log('POST /api/notification — ATIVO');
    console.log('=====================================');
});
