const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Servir o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let userPreferences = {
    latitude: -23.5505,
    longitude: -46.6333,
    raioMaximo: 5,
    ganhoMinimo: 15,
    distanciaMaxima: 10
};

let activePlatforms = {
    ifood: { rides: [], enabled: true },
    ubereats: { rides: [], enabled: true },
    keeta: { rides: [], enabled: true },
    loggi: { rides: [], enabled: true }
};

let acceptedRides = [];

// Salvar preferências
app.post('/api/config', (req, res) => {
    userPreferences = req.body;
    console.log('✅ Configurações atualizadas:', userPreferences);
    res.json({ success: true, message: 'Configurações salvas!' });
});

// Obter todas as corridas
app.get('/api/rides', (req, res) => {
    const allRides = [];
    Object.keys(activePlatforms).forEach(platform => {
        if (activePlatforms[platform].enabled) {
            activePlatforms[platform].rides.forEach(ride => {
                allRides.push({ ...ride, platform });
            });
        }
    });
    res.json(allRides);
});

// Aceitar corrida
app.post('/api/accept-ride', (req, res) => {
    const { rideId, platform } = req.body;
    const ride = activePlatforms[platform].rides.find(r => r.id === rideId);

    if (ride) {
        ride.status = 'accepted';
        acceptedRides.push({ ...ride, platform, acceptedAt: new Date() });
        console.log(`✅ Corrida ${rideId} aceita em ${platform}!`);
        res.json({ success: true, message: `Corrida aceita em ${platform}!` });
    } else {
        res.json({ success: false, message: 'Corrida não encontrada' });
    }
});

// Rejeitar corrida
app.post('/api/reject-ride', (req, res) => {
    const { rideId, platform } = req.body;
    const ride = activePlatforms[platform].rides.find(r => r.id === rideId);

    if (ride) {
        ride.status = 'rejected';
        console.log(`❌ Corrida ${rideId} rejeitada em ${platform}`);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Alternar plataforma
app.post('/api/platform/:platform/toggle', (req, res) => {
    const { platform } = req.params;
    if (activePlatforms[platform]) {
        activePlatforms[platform].enabled = !activePlatforms[platform].enabled;
        res.json({ success: true, enabled: activePlatforms[platform].enabled });
    } else {
        res.json({ success: false });
    }
});

// Obter estatísticas
app.get('/api/stats', (req, res) => {
    const stats = {};
    Object.keys(activePlatforms).forEach(platform => {
        const rides = activePlatforms[platform].rides;
        stats[platform] = {
            total: rides.length,
            accepted: rides.filter(r => r.status === 'accepted').length,
            pending: rides.filter(r => r.status === 'pending').length,
            rejected: rides.filter(r => r.status === 'rejected').length
        };
    });
    res.json(stats);
});

// Configurações das plataformas
const platformConfigs = {
    ifood: { 
        color: '#ea1d2c', 
        destinations: ['Av. Paulista', 'Rua Augusta', 'Consolação', 'Vila Mariana', 'Bela Vista', 'Pinheiros'],
        minEarnings: 12,
        maxEarnings: 45
    },
    ubereats: { 
        color: '#000000', 
        destinations: ['Bela Vista', 'Pinheiros', 'Higienópolis', 'Cerqueira César', 'Itaim', 'Brooklin'],
        minEarnings: 15,
        maxEarnings: 50
    },
    keeta: { 
        color: '#00d4ff', 
        destinations: ['Jardins', 'Tatuapé', 'Aricanduva', 'Mooca', 'Vila Olímpia', 'Saúde'],
        minEarnings: 10,
        maxEarnings: 40
    },
    loggi: { 
        color: '#ff6b00', 
        destinations: ['Itaim', 'Brooklin', 'Vila Olímpia', 'Saúde', 'Consolação', 'Higienópolis'],
        minEarnings: 18,
        maxEarnings: 55
    }
};

// Gerar corridas simuladas
setInterval(() => {
    const centerLat = userPreferences.latitude || -23.5505;
    const centerLng = userPreferences.longitude || -46.6333;
    const raioMaximo = userPreferences.raioMaximo || 5;
    const ganhoMinimo = userPreferences.ganhoMinimo || 15;

    Object.keys(activePlatforms).forEach(platform => {
        if (!activePlatforms[platform].enabled) return;

        // Gerar 1-2 corridas por plataforma
        const numRides = Math.random() > 0.7 ? 2 : 1;

        for (let i = 0; i < numRides; i++) {
            const randomOffset = (Math.random() - 0.5) * (raioMaximo / 111); // Converter km para graus
            const config = platformConfigs[platform];

            const distance = Math.random() * raioMaximo + 0.5;
            const earnings = Math.random() * (config.maxEarnings - config.minEarnings) + config.minEarnings;

            // Filtrar por critérios do usuário
            if (earnings < ganhoMinimo) continue;

            const newRide = {
                id: `${platform}-${Date.now()}-${i}`,
                platform: platform,
                lat: centerLat + randomOffset,
                lng: centerLng + randomOffset,
                distance: distance.toFixed(1),
                earnings: earnings.toFixed(2),
                destination: config.destinations[Math.floor(Math.random() * config.destinations.length)],
                timestamp: new Date(),
                status: 'pending',
                color: config.color
            };

            activePlatforms[platform].rides.push(newRide);
        }

        // Manter apenas as últimas 50 corridas
        if (activePlatforms[platform].rides.length > 50) {
            activePlatforms[platform].rides = activePlatforms[platform].rides.slice(-50);
        }
    });

    console.log(`📍 Corridas geradas às ${new Date().toLocaleTimeString('pt-BR')}`);
}, 5000); // Gerar a cada 5 segundos

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor DeliveryHub rodando em porta ${PORT}`);
    console.log('📱 Monitorando: iFood, Uber Eats, Keeta, Loggi');
    console.log('⏳ Aguardando conexão do app...');
});
