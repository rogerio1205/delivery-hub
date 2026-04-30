const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let userPreferences = {};
let activePlatforms = {
    ifood: { rides: [], enabled: true },
    uber: { rides: [], enabled: true },
    keeta: { rides: [], enabled: true },
    loggi: { rides: [], enabled: true }
};

let acceptedRides = [];

// ============================================
// WEBHOOK DO IFOOD - Receber ofertas reais
// ============================================
app.post('/webhook/ifood', (req, res) => {
    const { orderId, restaurantName, deliveryAddress, distance, value, items } = req.body;

    const newRide = {
        id: `ifood-${orderId}`,
        platform: 'ifood',
        lat: -23.5505 + (Math.random() - 0.5) * 0.1,
        lng: -46.6333 + (Math.random() - 0.5) * 0.1,
        distance: distance || Math.random() * 10 + 0.5,
        earnings: value || Math.random() * 40 + 12,
        destination: deliveryAddress || restaurantName || 'Endereço',
        timestamp: new Date(),
        status: 'pending',
        color: '#ea1d2c',
        orderId: orderId,
        items: items
    };

    activePlatforms.ifood.rides.push(newRide);
    console.log(`🍔 Nova oferta iFood recebida: ${orderId}`);

    res.json({ success: true, message: 'Oferta recebida' });
});

// ============================================
// WEBHOOK DO KEETA - Receber ofertas reais
// ============================================
app.post('/webhook/keeta', (req, res) => {
    const { jobId, pickupAddress, deliveryAddress, distance, value } = req.body;

    const newRide = {
        id: `keeta-${jobId}`,
        platform: 'keeta',
        lat: -23.5505 + (Math.random() - 0.5) * 0.1,
        lng: -46.6333 + (Math.random() - 0.5) * 0.1,
        distance: distance || Math.random() * 10 + 0.5,
        earnings: value || Math.random() * 40 + 12,
        destination: deliveryAddress || pickupAddress || 'Endereço',
        timestamp: new Date(),
        status: 'pending',
        color: '#00d4ff',
        jobId: jobId
    };

    activePlatforms.keeta.rides.push(newRide);
    console.log(`📦 Nova oferta Keeta recebida: ${jobId}`);

    res.json({ success: true, message: 'Oferta recebida' });
});

// ============================================
// WEBHOOK DO UBER EATS
// ============================================
app.post('/webhook/uber', (req, res) => {
    const { orderId, pickupAddress, deliveryAddress, distance, value } = req.body;

    const newRide = {
        id: `uber-${orderId}`,
        platform: 'uber',
        lat: -23.5505 + (Math.random() - 0.5) * 0.1,
        lng: -46.6333 + (Math.random() - 0.5) * 0.1,
        distance: distance || Math.random() * 10 + 0.5,
        earnings: value || Math.random() * 40 + 12,
        destination: deliveryAddress || pickupAddress || 'Endereço',
        timestamp: new Date(),
        status: 'pending',
        color: '#000000',
        orderId: orderId
    };

    activePlatforms.uber.rides.push(newRide);
    console.log(`🚗 Nova oferta Uber recebida: ${orderId}`);

    res.json({ success: true, message: 'Oferta recebida' });
});

// ============================================
// WEBHOOK DO LOGGI
// ============================================
app.post('/webhook/loggi', (req, res) => {
    const { jobId, pickupAddress, deliveryAddress, distance, value } = req.body;

    const newRide = {
        id: `loggi-${jobId}`,
        platform: 'loggi',
        lat: -23.5505 + (Math.random() - 0.5) * 0.1,
        lng: -46.6333 + (Math.random() - 0.5) * 0.1,
        distance: distance || Math.random() * 10 + 0.5,
        earnings: value || Math.random() * 40 + 12,
        destination: deliveryAddress || pickupAddress || 'Endereço',
        timestamp: new Date(),
        status: 'pending',
        color: '#ff6b00',
        jobId: jobId
    };

    activePlatforms.loggi.rides.push(newRide);
    console.log(`📍 Nova oferta Loggi recebida: ${jobId}`);

    res.json({ success: true, message: 'Oferta recebida' });
});

// ============================================
// ENDPOINTS EXISTENTES
// ============================================

app.post('/api/preferences', (req, res) => {
    userPreferences = req.body;
    console.log('✅ Preferências atualizadas:', userPreferences);
    res.json({ success: true });
});

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

app.post('/api/accept-ride', (req, res) => {
    const { rideId, platform } = req.body;
    const ride = activePlatforms[platform].rides.find(r => r.id === rideId);

    if (ride) {
        ride.status = 'accepted';
        acceptedRides.push({ ...ride, platform, acceptedAt: new Date() });
        console.log(`✅ Corrida ${rideId} aceita em ${platform}!`);
        res.json({ success: true, message: `Corrida aceita!` });
    } else {
        res.json({ success: false, message: 'Corrida não encontrada' });
    }
});

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

app.post('/api/platform/:platform/toggle', (req, res) => {
    const { platform } = req.params;
    if (activePlatforms[platform]) {
        activePlatforms[platform].enabled = !activePlatforms[platform].enabled;
        res.json({ success: true, enabled: activePlatforms[platform].enabled });
    } else {
        res.json({ success: false });
    }
});

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

// ============================================
// GERAR CORRIDAS SIMULADAS (para testes)
// ============================================
const platformConfigs = {
    ifood: { color: '#ea1d2c', destinations: ['Av. Paulista', 'Rua Augusta', 'Consolação', 'Vila Mariana', 'Bela Vista', 'Pinheiros'] },
    uber: { color: '#000000', destinations: ['Bela Vista', 'Pinheiros', 'Higienópolis', 'Cerqueira César', 'Itaim', 'Brooklin'] },
    keeta: { color: '#00d4ff', destinations: ['Jardins', 'Tatuapé', 'Aricanduva', 'Mooca', 'Vila Olímpia', 'Saúde'] },
    loggi: { color: '#ff6b00', destinations: ['Itaim', 'Brooklin', 'Vila Olímpia', 'Saúde', 'Consolação', 'Higienópolis'] }
};

// Gerar corridas simuladas a cada 6 segundos (apenas para testes)
setInterval(() => {
    const centerLat = userPreferences.latitude || -23.5505;
    const centerLng = userPreferences.longitude || -46.6333;

    Object.keys(activePlatforms).forEach(platform => {
        if (!activePlatforms[platform].enabled) return;

        const numRides = Math.random() > 0.7 ? 1 : 0;

        for (let i = 0; i < numRides; i++) {
            const randomOffset = (Math.random() - 0.5) * 0.15;
            const config = platformConfigs[platform];

            const newRide = {
                id: `${platform}-sim-${Date.now()}-${i}`,
                platform: platform,
                lat: centerLat + randomOffset,
                lng: centerLng + randomOffset,
                distance: Math.random() * 10 + 0.5,
                earnings: Math.random() * 40 + 12,
                destination: config.destinations[Math.floor(Math.random() * config.destinations.length)],
                timestamp: new Date(),
                status: 'pending',
                color: config.color
            };

            activePlatforms[platform].rides.push(newRide);
        }

        if (activePlatforms[platform].rides.length > 50) {
            activePlatforms[platform].rides = activePlatforms[platform].rides.slice(-50);
        }
    });
}, 6000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log('📱 Monitorando: iFood, Uber Eats, Keeta, Loggi');
    console.log('');
    console.log('🔗 Webhooks disponíveis:');
    console.log(`   POST http://localhost:${PORT}/webhook/ifood`);
    console.log(`   POST http://localhost:${PORT}/webhook/keeta`);
    console.log(`   POST http://localhost:${PORT}/webhook/uber`);
    console.log(`   POST http://localhost:${PORT}/webhook/loggi`);
});
