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

// --- REPRODUCTOR HLS ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
            video { width: 100vw; height: 100vh; object-fit: contain; }
            .controls { position: absolute; top: 15px; right: 15px; z-index: 10; opacity: 0.4; }
            select { background: #111; color: #fff; border: 1px solid #444; padding: 8px; border-radius: 4px; }
        </style>
    </head>
    <body>
        <video id="video" autoplay muted playsinline controls></video>
        <div class="controls"><select id="qSel"><option>Calidad: Auto</option></select></div>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <script>
            const v = document.getElementById('video');
            if (Hls.isSupported()) {
                const hls = new Hls({ maxBufferLength: 30, liveSyncDuration: 10 });
                hls.loadSource("${M3U8_URL}");
                hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    hls.levels.forEach((l, i) => {
                        const o = document.createElement('option');
                        o.value = i; o.text = l.height + 'p';
                        document.getElementById('qSel').appendChild(o);
                    });
                    v.play();
                });
                document.getElementById('qSel').onchange = () => hls.currentLevel = parseInt(document.getElementById('qSel').value);
            }
        </script>
    </body>
    </html>
    `);
});

// --- MOTOR DE TRANSMISIÓN ---

async function prepararAssets() {
    // Descarga el logo como .gif
    await new Promise(resolve => exec('curl -L -s -o canal-C.gif "https://www.dropbox.com/scl/fi/s5gx3llbkg04b97c2kzrp/canal-C.gif?rlkey=ud9wy691a0v7i6wer7g3avqu2&st=yt9vh02d&dl=1"', resolve));
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
        } catch (e) { console.log("Error de red, reintentando..."); }

        let vivo = obtenerVivo();
        let video = vivo || (playlist.length > 0 ? playlist[indiceActual] : null);
        
        if (!video) { await new Promise(r => setTimeout(r, 5000)); continue; }

        const urlFinal = video.url.includes("dropbox.com") 
            ? video.url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com").replace(/\?dl=[01]/, "") 
            : video.url;

        // --- MEDIDAS ACTUALIZADAS ---
        // Tamaño: 160px | Horizontal: 140px | Vertical: 70px
        let xPos = (video.posicion === "derecha") ? "main_w-overlay_w-140" : "140";
        let yPos = "70";

        console.log(`\n📺 TRANSMITIENDO: ${video.title} [LOGO GIF 140px]`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
            '-probesize', '10M', '-analyzeduration', '10M',
            '-i', urlFinal, 
            '-ignore_loop', '0', '-i', 'canal-C.gif', // -ignore_loop 0 hace que el GIF se repita siempre
            '-filter_complex', 
            `[0:v]fps=24,scale=1280:720,setsar=1[bg];` +
            `[1:v]scale=140:-1[logo];` + // Tamaño 160px
            `[bg][logo]overlay=${xPos}:${yPos}:shortest=1,format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
            '-b:v', '1800k', '-maxrate', '2000k', '-bufsize', '4000k', 
            '-g', '48', '-c:a', 'aac', '-b:a', '128k',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);

        await new Promise((resolve) => {
            ffmpeg.stderr.on('data', (data) => {
                if (data.toString().includes("403 Forbidden")) ffmpeg.kill('SIGKILL');
            });

            ffmpeg.on("close", () => {
                if (!vivo) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
            
            const monitor = setInterval(() => {
                const checkVivo = obtenerVivo();
                if ((vivo && !checkVivo) || (!vivo && checkVivo)) {
                    ffmpeg.kill('SIGKILL');
                    clearInterval(monitor);
                }
            }, 3000);
        });

        await new Promise(r => setTimeout(r, 1000)); 
    }
}

motorCanalC();
app.listen(port, () => console.log(`Online puerto ${port}`));
