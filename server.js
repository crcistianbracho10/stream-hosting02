const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios'); 
const app = express();
const port = process.env.PORT || 3001;

// --- CONFIGURACIÓN ---
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";
const GIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";
const M3U8_URL = "https://vs20.live.opencaster.com/cristianhilos_314b91b0/index.m3u8";

let playlist = [];
let indiceActual = 0;

// --- REPRODUCTOR WEB FULL SCREEN ---
app.get('/', (req, res) => {
    res.send(`<html><head><title>Canal C Player</title><style>body,html{margin:0;padding:0;background:#000;overflow:hidden;}video{width:100vw;height:100vh;object-fit:contain;}</style></head>
    <body><video id="v" controls autoplay muted playsinline></video>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <script>if(Hls.isSupported()){var h=new Hls({maxBufferLength:30});h.loadSource("${M3U8_URL}");h.attachMedia(document.getElementById('v'));}</script>
    </body></html>`);
});

// --- PREPARAR LOGO ---
async function prepararAssets() {
    return new Promise(resolve => {
        exec('curl -L -s -o canal-C.gif "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&dl=1"', () => {
            console.log("✅ canal-C.gif descargado y listo.");
            resolve();
        });
    });
}

// --- LÓGICA DE HORARIOS Y CANALES ---
function obtenerVivo() {
    const ahora = new Date();
    const utc = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
    const fechaVE = new Date(utc + (3600000 * -4)); // Hora Venezuela
    const h = fechaVE.getHours();
    const m = fechaVE.getMinutes();
    const d = fechaVE.getDay();
    const esAntesDelCierre = (m < 58);

    // Lunes a Viernes: Canal 11 Zulia -> DERECHA
    if (d >= 1 && d <= 5) {
        if ((h === 6 || h === 13) && esAntesDelCierre) {
            return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", pos: "derecha" };
        }
    }
    // TeleSUR -> IZQUIERDA
    if ((h === 8 || h === 18) && esAntesDelCierre) {
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR", pos: "izquierda" };
    }
    // TVES -> DERECHA (Desde las 11:00 PM hasta las 3:57:59 AM)
    if (((h >= 23) || (h < 3) || (h === 3 && esAntesDelCierre))) {
        return { url: "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8", title: "TVES", pos: "derecha" };
    }
    
    return null; // Si no hay vivo, devuelve null para usar la Playlist
}

// --- MOTOR PRINCIPAL ---
async function motorCanalC() {
    await prepararAssets();
    
    while (true) {
        try {
            const res = await axios.get(`${GIST_URL}?nocache=${Date.now()}`);
            playlist = Array.isArray(res.data) ? res.data : JSON.parse(res.data);
        } catch (e) { console.log("⚠️ Error actualizando Gist, usando última lista."); }

        let vivo = obtenerVivo();
        let video = vivo || (playlist.length > 0 ? playlist[indiceActual] : null);
        
        if (!video) {
            console.log("⏳ No hay contenido, reintentando en 5s...");
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        // Corrección de URL de Dropbox
        let urlFinal = video.url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "").replace("?dl=1", "");
        
        // Posicionamiento del logo (160px de tamaño, 140px horizontal, 70px vertical)
        // Si no tiene posición definida (playlist), va a la IZQUIERDA por defecto.
        let xPos = (video.pos === "derecha") ? "main_w-overlay_w-140" : "140";

        console.log(`\n📺 [${new Date().toLocaleTimeString()}] TRANSMITIENDO: ${video.title}`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
            '-i', urlFinal, 
            '-ignore_loop', '0', '-i', 'canal-C.gif',
            '-filter_complex', `[0:v]fps=24,scale=1280:720,setsar=1[b];[1:v]scale=160:-1[l];[b][l]overlay=${xPos}:70:shortest=1`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
            '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);

        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes("403 Forbidden") || msg.includes("Connection timed out")) {
                console.log("⚠️ Error de conexión en la fuente, saltando...");
                ffmpeg.kill('SIGKILL');
            }
        });

        await new Promise((resolve) => {
            ffmpeg.on("close", () => {
                // Si terminó un video de la playlist, pasamos al siguiente
                if (!vivo) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
            
            // Monitor para cambios de horario en tiempo real
            const monitor = setInterval(() => {
                const check = obtenerVivo();
                // Si el estado del "Vivo" cambió, reiniciamos FFmpeg
                if ((vivo && !check) || (!vivo && check) || (vivo && check && vivo.title !== check.title)) {
                    console.log("🔄 Cambio de horario detectado, actualizando señal...");
                    ffmpeg.kill('SIGKILL');
                    clearInterval(monitor);
                }
            }, 5000);
        });

        await new Promise(r => setTimeout(r, 2000)); 
    }
}

motorCanalC();
app.listen(port, () => console.log(`🚀 Sistema Online en puerto ${port}`));
