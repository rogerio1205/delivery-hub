const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ================================================
// DADOS GLOBAIS
// ================================================
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

let acceptedRides = [];
let pendingAcceptCommands = [];

// ================================================
// SERVIR FRONTEND
// ================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ================================================
// CONFIGURACOES
// ================================================
app.post('/api/config', (req, res) => {
    userPreferences = { ...userPreferences, ...req.body };
    console.log('Config atualizada:', userPreferences);
    res.json({ success: true });
});

app.get('/api/config', (req, res) => {
    res.json(userPreferences);
});

// ================================================
// RECEBER NOTIFICACAO REAL DO MACRODROID
// ================================================
app.post('/api/notification', (req, res) => {
    const { platform, title, text, packageName, timestamp } = req.body;

    console.log('=== NOTIFICACAO REAL ===');
    console.log('Package: ' + (packageName || platform));
    console.log('Titulo: ' + title);
    console.log('Texto: ' + text);

    // Detectar plataforma
    const packageMap = {
        'br.com.brainweb.ifood':  'ifood',
        'com.ubercab.eats':       'ubereats',
        'com.keeta.courier':      'keeta',
        'com.keeta.driver':       'keeta',
        'br.com.loggi.android':   'loggi'
    };

    let detectedPlatform = platform;

    if (!detectedPlatform && packageName) {
        detectedPlatform = packageMap[packageName];
        if (!detectedPlatform) {
            const pkg = packageName.toLowerCase();
            if (pkg.indexOf('ifood') >= 0)       detectedPlatform = 'ifood';
            else if (pkg.indexOf('uber') >= 0)   detectedPlatform = 'ubereats';
            else if (pkg.indexOf('keeta') >= 0)  detectedPlatform = 'keeta';
            else if (pkg.indexOf('loggi') >= 0)  detectedPlatform = 'loggi';
            else                                 detectedPlatform = 'ifood';
        }
    }

    if (!detectedPlatform) {
        console.log('ERRO: Plataforma nao detectada');
        return res.json({ success: false, reason: 'Plataforma nao detectada' });
    }

    const fullText = (title || '') + ' ' + (text || '');

    // Extrair valor R$
    const moneyMatch = fullText.match(/R\$\s*(\d+[,.]?\d*)/i);
    const earnings = moneyMatch
        ? parseFloat(moneyMatch[1].replace(',', '.'))
        : null;

    // Extrair distancia km
    const distMatch = fullText.match(/(\d+[,.]?\d*)\s*km/i);
    const distance = distMatch
        ? parseFloat(distMatch[1].replace(',', '.'))
        : (Math.random() * 4 + 0.5).toFixed(1);

    // Verificar ganho minimo
    if (earnings !== null && earnings < (userPreferences.ganhoMinimo || 0)) {
        console.log('Ignorado: R$' + earnings + ' abaixo do minimo R$' + userPreferences.ganhoMinimo);
        return res.json({ success: false, reason: 'Abaixo do ganho minimo' });
    }

    // Extrair destino
    let destination = 'Destino nao informado';
    if (text && text.length > 0) {
        destination = text.substring(0, 80).trim();
    } else if (title && title.length > 0) {
        destination = title.substring(0, 80).trim();
    }

    // Gerar posicao proxima ao usuario
    const spread = (userPreferences.raioMaximo || 5) / 111 / 2;
    const lat = (userPreferences.latitude  || -23.6821) + (Math.random() - 0.5) * spread;
    const lng = (userPreferences.longitude || -46.5650) + (Math.random() - 0.5) * spread;

    const newRide = {
        id:          detectedPlatform + '-real-' + Date.now(),
        platform:    detectedPlatform,
        lat:         lat,
        lng:         lng,
        distance:    parseFloat(distance).toFixed(1),
        earnings:    (earnings !== null ? earnings : 20).toFixed(2),
        destination: destination,
        timestamp:   timestamp || new Date(),
        status:      'pending',
        source:      'real',
        rawTitle:    title,
        rawText:     text
    };

    if (activePlatforms[detectedPlatform]) {
        // Remover corridas simuladas dessa plataforma quando chegar real
        activePlatforms[detectedPlatform].rides = activePlatforms[detectedPlatform].rides.filter(
            function(r) { return r.source === 'real'; }
        );
        activePlatforms[detectedPlatform].rides.push(newRide);
        console.log('Corrida REAL adicionada: ' + detectedPlatform + ' R$' + newRide.earnings);
        res.json({ success: true, ride: newRide });
    } else {
        res.json({ success: false, reason: 'Plataforma desabilitada' });
    }
});

// ================================================
// CORRIDAS GET
// ================================================
app.get('/api/rides', (req, res) => {
    const allRides = [];
    Object.keys(activePlatforms).forEach(function(platform) {
        if (activePlatforms[platform].enabled) {
            activePlatforms[platform].rides.forEach(function(ride) {
                const r = {};
                Object.keys(ride).forEach(function(k) { r[k] = ride[k]; });
                r.platform = platform;
                allRides.push(r);
            });
        }
    });

    // Reais primeiro, depois por ganho
    allRides.sort(function(a, b) {
        if (a.source === 'real' && b.source !== 'real') return -1;
        if (b.source === 'real' && a.source !== 'real') return  1;
        return parseFloat(b.earnings) - parseFloat(a.earnings);
    });

    res.json(allRides);
});

// ================================================
// ACEITAR CORRIDA
// ================================================
app.post('/api/accept-ride', (req, res) => {
    const { rideId, platform } = req.body;

    if (!activePlatforms[platform]) {
        return res.json({ success: false, message: 'Plataforma invalida' });
    }

    let ride = null;
    for (let i = 0; i < activePlatforms[platform].rides.length; i++) {
        if (activePlatforms[platform].rides[i].id === rideId) {
            ride = activePlatforms[platform].rides[i];
            break;
        }
    }

    if (ride) {
        ride.status = 'accepted';
        acceptedRides.push({ platform: platform, acceptedAt: new Date(), id: rideId });

        if (ride.source === 'real') {
            pendingAcceptCommands.push({
                rideId:    rideId,
                platform:  platform,
                timestamp: new Date(),
                executed:  false
            });
            console.log('Comando MacroDroid enviado: ' + platform);
        }

        console.log('Corrida aceita: ' + rideId);
        res.json({ success: true, isReal: ride.source === 'real' });
    } else {
        res.json({ success: false, message: 'Corrida nao encontrada' });
    }
});

// ================================================
// REJEITAR CORRIDA
// ================================================
app.post('/api/reject-ride', (req, res) => {
    const { rideId, platform } = req.body;

    if (!activePlatforms[platform]) {
        return res.json({ success: false });
    }

    let ride = null;
    for (let i = 0; i < activePlatforms[platform].rides.length; i++) {
        if (activePlatforms[platform].rides[i].id === rideId) {
            ride = activePlatforms[platform].rides[i];
            break;
        }
    }

    if (ride) {
        ride.status = 'rejected';
        console.log('Corrida rejeitada: ' + rideId);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ================================================
// MACRODROID COMANDOS PENDENTES
// ================================================
app.get('/api/pending-commands', (req, res) => {
    const pending = [];
    for (let i = 0; i < pendingAcceptCommands.length; i++) {
        if (!pendingAcceptCommands[i].executed) {
            pending.push(pendingAcceptCommands[i]);
            pendingAcceptCommands[i].executed = true;
        }
    }
    res.json(pending);
});

// ================================================
// TOGGLE PLATAFORMA
// ================================================
app.post('/api/platform/:platform/toggle', (req, res) => {
    const { platform } = req.params;
    if (activePlatforms[platform]) {
        activePlatforms[platform].enabled = !activePlatforms[platform].enabled;
        console.log(platform + ': ' + (activePlatforms[platform].enabled ? 'ON' : 'OFF'));
        res.json({ success: true, enabled: activePlatforms[platform].enabled });
    } else {
        res.json({ success: false });
    }
});

// ================================================
// ESTATISTICAS
// ================================================
app.get('/api/stats', (req, res) => {
    const stats = {};
    Object.keys(activePlatforms).forEach(function(platform) {
        const rides = activePlatforms[platform].rides;
        let pending = 0, accepted = 0, rejected = 0, real = 0;
        for (let i = 0; i < rides.length; i++) {
            if (rides[i].status === 'pending')  pending++;
            if (rides[i].status === 'accepted') accepted++;
            if (rides[i].status === 'rejected') rejected++;
            if (rides[i].source === 'real')     real++;
        }
        stats[platform] = {
            total:    rides.length,
            pending:  pending,
            accepted: accepted,
            rejected: rejected,
            real:     real
        };
    });
    res.json(stats);
});

// ================================================
// SIMULADOR
// ================================================
const platformConfigs = {
    ifood: {
        destinations: [
            'Av. Lions, Santo Andre',
            'Rua das Figueiras, Santo Andre',
            'Vila Jordanopolis',
            'Assai Atacadista',
            'Eng. Salvador Arena',
            'Centro de Santo Andre'
        ],
        minEarnings: 12,
        maxEarnings: 45
    },
    ubereats: {
        destinations: [
            'Vila Jordanopolis',
            'Universidade Federal ABC',
            'Benz Brasil',
            'Vila Luzita',
            'Av. Lions'
        ],
        minEarnings: 15,
        maxEarnings: 50
    },
    keeta: {
        destinations: [
            'Santo Andre Centro',
            'Av. Industrial',
            'Vila Palmares',
            'Campestre',
            'Silveira',
            'Jardim Bela Vista'
        ],
        minEarnings: 10,
        maxEarnings: 40
    },
    loggi: {
        destinations: [
            'Sao Bernardo do Campo',
            'Rudge Ramos',
            'Diadema',
            'Maua',
            'Ribeirao Pires',
            'Rio Grande da Serra'
        ],
        minEarnings: 18,
        maxEarnings: 55
    }
};

setInterval(function() {
    const centerLat = userPreferences.latitude  || -23.6821;
    const centerLng = userPreferences.longitude || -46.5650;
    const raio      = userPreferences.raioMaximo  || 5;
    const ganhoMin  = userPreferences.ganhoMinimo || 15;

    Object.keys(activePlatforms).forEach(function(platform) {
        if (!activePlatforms[platform].enabled) return;

        // Se tem corrida REAL pendente nao gera simulada
        let realPending = 0;
        for (let i = 0; i < activePlatforms[platform].rides.length; i++) {
            if (activePlatforms[platform].rides[i].status === 'pending' &&
                activePlatforms[platform].rides[i].source === 'real') {
                realPending++;
            }
        }
        if (realPending > 0) return;

        const config   = platformConfigs[platform];
        const numRides = Math.random() > 0.7 ? 2 : 1;

        for (let i = 0; i < numRides; i++) {
            const offset   = (Math.random() - 0.5) * (raio / 111);
            const distance = (Math.random() * raio + 0.5).toFixed(1);
            const earnings = (
                Math.random() * (config.maxEarnings - config.minEarnings) + config.minEarnings
            ).toFixed(2);

            if (parseFloat(earnings) < ganhoMin) continue;

            activePlatforms[platform].rides.push({
                id:          platform + '-sim-' + Date.now() + '-' + i,
                platform:    platform,
                lat:         centerLat + offset,
                lng:         centerLng + offset,
                distance:    distance,
                earnings:    earnings,
                destination: config.destinations[
                    Math.floor(Math.random() * config.destinations.length)
                ],
                timestamp:   new Date(),
                status:      'pending',
                source:      'simulated'
            });
        }

        // Manter so as ultimas 50
        if (activePlatforms[platform].rides.length > 50) {
            activePlatforms[platform].rides =
                activePlatforms[platform].rides.slice(-50);
        }
    });

    // Limpar comandos antigos
    const cutoff = Date.now() - 30000;
    const newCommands = [];
    for (let i = 0; i < pendingAcceptCommands.length; i++) {
        if (new Date(pendingAcceptCommands[i].timestamp).getTime() > cutoff) {
            newCommands.push(pendingAcceptCommands[i]);
        }
    }
    pendingAcceptCommands = newCommands;

    console.log('Simulador: ' + new Date().toLocaleTimeString('pt-BR'));

}, 5000);

// ================================================
// INICIAR SERVIDOR
// ================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('DeliveryHub rodando na porta ' + PORT);
    console.log('Aguardando notificacoes reais do MacroDroid...');
    console.log('Simulador ativo como fallback');
});
