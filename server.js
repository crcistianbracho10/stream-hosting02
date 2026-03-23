const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios'); 
const app = express();
const port = process.env.PORT || 3001;

const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";
const GIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";
const M3U8_URL = "https://vs20.live.opencaster.com/cristianhilos_314b91b0/index.m3u8";

let playlist = [];
let indiceActual = 0;

// --- REPRODUCTOR HLS PANTALLA COMPLETA ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; font-family: sans-serif; }
            video { width: 100vw; height: 100vh; object-fit: contain; }
            .controls { position: absolute; top: 20px; right: 20px; z-index: 10; opacity: 0.3; transition: opacity 0.3s; }
            .controls:hover { opacity: 1; }
            select { background: rgba(0,0,0,0.7); color: white; border: 1px solid #fff; padding: 8px; border-radius: 4px; outline: none; }
        </style>
    </head>
    <body>
        <video id="video" autoplay muted playsinline controls></video>
        <div class="controls">
            <select id="qualitySelect"><option>Calidad Auto</option></select>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script>
            const video = document.getElementById('video');
            const selector = document.getElementById('qualitySelect');
            if (Hls.isSupported()) {
                const hls = new Hls();
                hls.loadSource("${M3U8_URL}");
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    hls.levels.forEach((l, i) => {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.text = l.height + 'p';
                        selector.appendChild(opt);
                    });
                });
                selector.onchange = () => hls.currentLevel = parseInt(selector.value);
            }
        </script>
    </body>
    </html>
    `);
});

// --- LÓGICA DE TRANSMISIÓN ---

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

    // SEGÚN TU IMAGEN:
    // Canal 11 y TVES -> DERECHA
    // TeleSUR y Playlist -> IZQUIERDA

    if (d >= 1 && d <= 5 && (h === 6 || h === 13) && esAntesDelCierre) {
        return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", posicion: "derecha" };
    }
    if ((h === 8 || h === 18) && esAntesDelCierre) {
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR", posicion: "izquierda" };
    }
    if (((h >= 23) || (h < 3) || (h === 3 && esAntesDelCierre))) {
        return { url: "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8", title: "TVES", posicion: "derecha" };
    }
    return null;
}

async function motorCanalC() {
    await prepararAssets();
    while (true) {
        try {
            const res = await axios.get(`${GIST_URL}?nocache=${Date.now()}`);
            playlist = Array.isArray(res.data) ? res.data : JSON.parse(res.data);
        } catch (e) { console.log("Error Gist"); }

        const vivo = obtenerVivo();
        const video = vivo || playlist[indiceActual];
        
        if (!video) { await new Promise(r => setTimeout(r, 2000)); continue; }

        const urlFinal = video.url.includes("dropbox.com") 
            ? video.url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com").replace(/\?dl=[01]/, "") 
            : video.url;

        // --- LÓGICA DE POSICIÓN REVERSA ---
        // Si es "derecha" (TVES/Canal 11) -> main_w - overlay_w - 80
        // Si es "izquierda" (TeleSUR/Playlist) -> 80
        let xPos = (video.posicion === "derecha") ? "main_w-overlay_w-80" : "80";

        console.log(`\n📺 [${new Date().toLocaleTimeString()}] TRANSMITIENDO: ${video.title} (Posición: ${xPos})`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
            '-re', '-i', urlFinal, '-i', 'logo.png',
            '-filter_complex', 
            `[0:v]fps=24,scale=1280:720,setsar=1[bg];` +
            `[1:v]scale=200:-1[logo];` +
            `[bg][logo]overlay=${xPos}:80,format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1200k', 
            '-g', '48', '-c:a', 'aac', '-b:a', '96k',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);

        await new Promise((resolve) => {
            ffmpeg.on("close", () => {
                if (!vivo) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
            // Auto-reinicio para evitar bloqueos
            setTimeout(() => ffmpeg.kill('SIGKILL'), 3600000); 
        });
    }
}

motorCanalC();
app.listen(port, () => console.log(`Online en puerto ${port}`));
