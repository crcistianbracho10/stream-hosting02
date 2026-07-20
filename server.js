const { spawn } = require('child_process');
const express = require('express');
const axios = require('axios'); 
const fs = require('fs');
const path = require('path');

const app = report === undefined ? express() : express(); 
const port = process.env.PORT || 7860; 

// Carpeta HLS local dentro del contenedor de Render
const hlsFolder = path.join(__dirname, 'hls_output');
if (!fs.existsSync(hlsFolder)) {
    fs.mkdirSync(hlsFolder, { recursive: true });
}

const GIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";
let playlist = [];
let indiceActual = 0;

// Servir HLS (M3U8) generado en la carpeta local
app.use('/hls', express.static(hlsFolder));

// Página principal para monitoreo
app.get('/', (req, res) => {
    res.status(200).send({
        status: "ok",
        message: "Canal C transmitiendo en HLS privado desde Render en /hls/index.m3u8"
    });
});

// ==========================================
// 🎬 GENERADOR HLS OPTIMIZADO (COINCIDENCIA DE TIEMPO EXACTA)
// ==========================================
function iniciarHLS() {
    console.log("🎬 [HLS] Generando M3U8 privado en Render...");
    const hls = spawn('ffmpeg', [
        '-i', 'udp://127.0.0.1:9999?buffer_size=5000000', // 🚀 Búfer ampliado para que Render no tire paquetes de red
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'hls',
        '-hls_time', '2',            // 🔑 CAMBIADO A 2 SEGUNDOS: Coincide exactamente con el Keyframe (-g 48 / 24fps)
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+split_by_time', // 🔑 Fuerza el corte en el tiempo exacto sin retrasos
        path.join(hlsFolder, 'index.m3u8')
    ]);

    hls.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.includes("Opening")) console.log("[HLS] Segmento generado");
    });

    hls.on('close', () => {
        console.log("⚠️ [HLS] Se cerró. Reiniciando en 2s...");
        setTimeout(iniciarHLS, 2000);
    });
}

// ==========================================
// 📺 MOTOR PRINCIPAL OPTIMIZADO EN TRANSMISIÓN
// ==========================================
function corregirUrl(url) {
    if (url.includes("dropbox.com")) {
        return url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com")
                  .replace(/\?dl=0/, "")
                  .replace(/\?dl=1/, "");
    }
    return url;
}

async function cargarPlaylistSegura() {
    try {
        const response = await axios.get(`${GIST_URL}?nocache=${Date.now()}`);
        const nuevaLista = Array.isArray(response.data) ? response.data : JSON.parse(response.data);
        if (nuevaLista.length > 0) {
            playlist = nuevaLista;
            if (indiceActual >= playlist.length) indiceActual = 0;
        }
    } catch (e) { console.error("❌ Error Gist."); }
}

async function prepararAssets() {
    if (!fs.existsSync('Canal_C.png')) {
        console.error("❌ Error: El archivo local 'Canal_C.png' no se encuentra en la raíz del proyecto.");
    } else {
        console.log("✅ Imagen de marca 'Canal_C.png' detectada localmente de manera correcta.");
    }
}

function obtenerVivo() {
    const ahora = new Date();
    const utc = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
    const fechaVE = new Date(utc + (3600000 * -4)); 
    const h = fechaVE.getHours();
    const m = fechaVE.getMinutes();
    const d = fechaVE.getDay();
    const esAntesDelCierre = (m < 58);

    if (d >= 1 && d <= 5 && (h === 6 || h === 13) && esAntesDelCierre)
        return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", logoDer: false };
    if ((h === 8 || h === 18) && esAntesDelCierre)
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR", logoDer: true };
    if ((h >= 22 || h < 3 || (h === 3 && esAntesDelCierre)))
        return { url: "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8", title: "TVES", logoDer: false };
    
    return null;
}

async function motorCanalC() {
    await prepararAssets();
    iniciarHLS();

    while (true) {
        await cargarPlaylistSegura();
        const vivo = obtenerVivo();
        const video = vivo || playlist[indiceActual];

        if (!video) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const esVivo = !!vivo;
        let xPos = esVivo ? (video.logoDer ? "main_w-overlay_w-200" : "200") : "main_w-overlay_w-200";
        const urlFinal = corregirUrl(video.url);

        console.log(`\n📺 AIRE: ${video.title}`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-re', '-i', urlFinal,
            '-i', 'Canal_C.png', 
            '-filter_complex',
            `[0:v]fps=24,scale=1920:1080:flags=lanczos,setsar=1[bg];` + // 💻 Calidad Full HD 1080p intacta
            `[1:v]scale=250:250[logo];` +
            `[bg][logo]overlay=${xPos}:90,format=yuv420p[v];` +
            `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]`,
            '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', 
            '-preset', 'ultrafast',     
            '-tune', 'zerolatency',     
            '-b:v', '2000k', 
            '-maxrate', '2000k',        
            '-bufsize', '4000k',        // 🚀 Ajustado el tamaño del búfer de transmisión para dar holgura a la red
            '-g', '48',                 // 🔑 Genera un fotograma clave exacto cada 2 segundos (48 frames / 24 fps)
            '-sc_threshold', '0',       // 🚀 Desactiva la creación de fotogramas clave extra por cambios bruscos de color
            '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
            '-f', 'mpegts', 'udp://127.0.0.1:9999?pkt_size=1316'
        ];

        const ffmpegTrabajador = spawn('ffmpeg', args);
        let ultimoUpdate = Date.now();

        ffmpegTrabajador.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes("frame=")) ultimoUpdate = Date.now();
        });

        const watchdog = setInterval(() => {
            if (Date.now() - ultimoUpdate > 10000) {
                console.log("⚠️ [Watchdog] No hay frames, reiniciando FFmpeg...");
                ffmpegTrabajador.kill('SIGKILL');
            }
        }, 3000);

        await new Promise(resolve => {
            ffmpegTrabajador.on("close", () => {
                clearInterval(watchdog);
                if (!esVivo) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
        });

        await new Promise(r => setTimeout(r, 300));
    }
}

app.listen(port, () => {
    console.log(`🚀 Servidor activo en Render en el puerto ${port}`);
    motorCanalC();
});
