const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios'); 
const app = express();
const port = process.env.PORT || 3001;

// --- CONFIGURACIÓN ---
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";
const GIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";
const APP_URL = `https://${process.env.BACK4APP_APP_NAME}.back4app.io`; // Reemplaza con tu URL real si es necesario

let playlist = [];
let indiceActual = 0;

// --- REPRODUCTOR WEB ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <link href="https://vjs.zencdn.net/7.20.3/video-js.css" rel="stylesheet" />
        <title>Stream Player - Canal C</title>
        <style>
            body { background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .video-js { width: 80%; height: 80%; border-radius: 8px; overflow: hidden; box-shadow: 0 0 20px rgba(255,255,255,0.1); }
        </style>
    </head>
    <body>
        <video id="my-video" class="video-js vjs-big-play-centered" controls preload="auto" data-setup='{}'>
            <source src="https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8" type="application/x-mpegURL">
        </video>
        <script src="https://vjs.zencdn.net/7.20.3/video.min.js"></script>
        <script src="https://unpkg.com/videojs-contrib-quality-levels@2.1.0/dist/videojs-contrib-quality-levels.min.js"></script>
        <script src="https://unpkg.com/@silvermine/videojs-quality-selector/dist/js/silvermine-videojs-quality-selector.min.js"></script>
        <link href="https://unpkg.com/@silvermine/videojs-quality-selector/dist/css/quality-selector.css" rel="stylesheet">
    </body>
    </html>
    `);
});

// --- SISTEMA ANTI-APAGADO (KEEP-ALIVE) ---
function keepAlive() {
    setInterval(async () => {
        try {
            await axios.get(APP_URL);
            console.log("Ping de supervivencia enviado.");
        } catch (e) {
            console.log("Error en auto-ping, pero el servidor sigue vivo.");
        }
    }, 600000); // Cada 10 minutos
}

// --- LÓGICA DE VIDEO (FFMPEG) ---
function corregirUrl(url) {
    if (url.includes("dropbox.com")) {
        return url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com").replace(/\?dl=0/, "").replace(/\?dl=1/, "");
    }
    return url;
}

async function cargarPlaylistSegura() {
    try {
        const response = await axios.get(`${GIST_URL}?nocache=${Date.now()}`);
        playlist = Array.isArray(response.data) ? response.data : JSON.parse(response.data);
    } catch (e) { console.error("❌ Error cargando Playlist."); }
}

async function prepararAssets() {
    await new Promise(resolve => exec('curl -L -s -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&dl=1"', resolve));
}

function obtenerVivo() {
    const ahora = new Date();
    const utc = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
    const fechaVE = new Date(utc + (3600000 * -4)); 
    const h = fechaVE.getHours();
    const m = fechaVE.getMinutes();
    const d = fechaVE.getDay();

    const esAntesDelCierre = (m < 58);

    if (d >= 1 && d <= 5 && (h === 6 || h === 13) && esAntesDelCierre) {
        return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", logoDer: false };
    }
    if ((h === 8 || h === 18) && esAntesDelCierre) {
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR", logoDer: true };
    }
    if (((h >= 23) || (h < 3) || (h === 3 && esAntesDelCierre))) {
        return { url: "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8", title: "TVES", logoDer: false };
    }
    return null;
}

async function motorCanalC() {
    await prepararAssets();
    
    while (true) {
        await cargarPlaylistSegura();
        const vivo = obtenerVivo();
        const video = vivo || playlist[indiceActual];
        
        if (!video) { 
            await new Promise(r => setTimeout(r, 5000)); 
            continue; 
        }

        const esVivo = !!vivo;
        let xPos = esVivo ? (video.logoDer ? "main_w-overlay_w-50" : "50") : "main_w-overlay_w-50";

        const urlFinal = corregirUrl(video.url);
        console.log(`\n🕒 [${new Date().toLocaleTimeString()}] TRANSMITIENDO: ${video.title}`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
            '-re', '-i', urlFinal, 
            '-i', 'logo.png',
            '-filter_complex', 
            `[0:v]fps=24,scale=1280:720,setsar=1[bg];` +
            `[1:v]scale=150:-1[logo];` +
            `[bg][logo]overlay=${xPos}:50,format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a',
            '-c:v', 'libx264', '-preset', 'ultrafast', 
            '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k', 
            '-g', '48', '-c:a', 'aac', '-b:a', '128k',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let ultimoUpdate = Date.now();
        
        ffmpeg.stderr.on('data', (data) => {
            if (data.toString().includes("frame=")) ultimoUpdate = Date.now();
        });

        const watchdog = setInterval(() => {
            const chequeo = obtenerVivo();
            if ((!esVivo && chequeo) || (esVivo && (!chequeo || chequeo.title !== video.title))) {
                ffmpeg.kill('SIGKILL');
            }
            if (Date.now() - ultimoUpdate > 20000) {
                ffmpeg.kill('SIGKILL');
            }
        }, 2000);

        await new Promise((resolve) => {
            ffmpeg.on("close", () => {
                clearInterval(watchdog);
                if (!esVivo && playlist.length > 0) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
        });

        await new Promise(r => setTimeout(r, 1000)); 
    }
}

// --- INICIO ---
app.listen(port, () => {
    console.log(`Servidor activo en puerto ${port}`);
    motorCanalC();
    keepAlive();
});
