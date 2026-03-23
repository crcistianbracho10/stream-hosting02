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

// --- REPRODUCTOR HLS PROFESIONAL ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
            video { width: 100vw; height: 100vh; object-fit: contain; }
            .controls { position: absolute; top: 20px; right: 20px; z-index: 10; opacity: 0.4; transition: 0.3s; }
            .controls:hover { opacity: 1; }
            select { background: #222; color: #fff; border: 1px solid #444; padding: 10px; border-radius: 5px; cursor: pointer; }
        </style>
    </head>
    <body>
        <video id="video" autoplay muted playsinline controls></video>
        <div class="controls"><select id="qSel"><option>Calidad: Auto</option></select></div>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script>
            const v = document.getElementById('video');
            const s = document.getElementById('qSel');
            if (Hls.isSupported()) {
                const hls = new Hls();
                hls.loadSource("${M3U8_URL}");
                hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    hls.levels.forEach((l, i) => {
                        const o = document.createElement('option');
                        o.value = i; o.text = l.height + 'p';
                        s.appendChild(o);
                    });
                });
                s.onchange = () => hls.currentLevel = parseInt(s.value);
            }
        </script>
    </body>
    </html>
    `);
});

// --- MOTOR DE TRANSMISIÓN ---

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

    // DERECHA: Canal 11 y TVES | IZQUIERDA: TeleSUR
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
        } catch (e) { console.log("Error Gist, usando playlist local"); }

        let vivo = obtenerVivo();
        let video = vivo || (playlist.length > 0 ? playlist[indiceActual] : null);
        
        if (!video) {
            console.log("Esperando contenido...");
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        const urlFinal = video.url.includes("dropbox.com") 
            ? video.url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com").replace(/\?dl=[01]/, "") 
            : video.url;

        // --- AJUSTES DE LOGO SOLICITADOS ---
        // Tamaño: 250px | Vertical: 80px | Horizontal: 240px
        let xPos = (video.posicion === "derecha") ? "main_w-overlay_w-240" : "240";
        let yPos = "80";

        console.log(`\n🚀 TRANSMITIENDO: ${video.title}`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-re', '-i', urlFinal, 
            '-i', 'logo.png',
            '-filter_complex', 
            `[0:v]fps=24,scale=1280:720,setsar=1[bg];` +
            `[1:v]scale=250:-1[logo];` + // Tamaño del logo a 250px
            `[bg][logo]overlay=${xPos}:${yPos},format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a?', // El '?' evita que FFmpeg falle si un video no tiene audio
            '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1500k', 
            '-maxrate', '1500k', '-bufsize', '3000k',
            '-g', '48', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let detectadoError = false;

        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            // Si la señal m3u8 da error 403, 404 o timeout, marcamos para reiniciar
            if (msg.includes("Server returned 403") || msg.includes("Connection timed out") || msg.includes("Immediate exit requested")) {
                detectadoError = true;
                ffmpeg.kill('SIGKILL');
            }
        });

        await new Promise((resolve) => {
            ffmpeg.on("close", () => {
                // Si la señal se cayó o terminó y no es un "vivo" programado, pasamos al siguiente de la playlist
                if (!vivo || detectadoError) {
                    indiceActual = (indiceActual + 1) % playlist.length;
                }
                resolve();
            });
            
            // Watchdog: Si el vivo cambia o termina el horario, matamos proceso para actualizar
            const checkInterval = setInterval(() => {
                const ahoraVivo = obtenerVivo();
                if (vivo && !ahoraVivo) ffmpeg.kill('SIGKILL');
                if (!vivo && ahoraVivo) ffmpeg.kill('SIGKILL');
            }, 5000);

            ffmpeg.on("close", () => clearInterval(checkInterval));
        });

        await new Promise(r => setTimeout(r, 2000)); 
    }
}

motorCanalC();
app.listen(port, () => console.log(`Servidor en puerto ${port}`));
