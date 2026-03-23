const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios'); 
const app = express();
const port = process.env.PORT || 3001;

const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";
const GIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";

let playlist = [];
let indiceActual = 0;

function corregirUrl(url) {
    if (url.includes("dropbox.com")) {
        return url.replace(/www\.dropbox\.com/, "dl.dropboxusercontent.com").replace(/\?dl=0/, "").replace(/\?dl=1/, "");
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
    await new Promise(resolve => exec('curl -L -s -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&dl=1"', resolve));
}

function obtenerVivo() {
    const ahora = new Date();
    const utc = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
    const fechaVE = new Date(utc + (3600000 * -4)); 
    const h = fechaVE.getHours();
    const m = fechaVE.getMinutes();
    const s = fechaVE.getSeconds();
    const d = fechaVE.getDay();

    // Validamos que sea antes del minuto 58:00 exacto
    const esAntesDelCierre = (m < 58);

    // Lunes a Viernes: Canal 11 Zulia -> LOGO IZQUIERDA
    if (d >= 1 && d <= 5) {
        if ((h === 6 || h === 13) && esAntesDelCierre) {
            return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", logoDer: false };
        }
    }
    // TeleSUR -> LOGO DERECHA
    if ((h === 8 || h === 18) && esAntesDelCierre) {
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR", logoDer: true };
    }
    // TVES -> LOGO IZQUIERDA (Desde las 11:00 PM hasta las 3:57:59 AM)
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
            await new Promise(r => setTimeout(r, 1000)); 
            continue; 
        }

        const esVivo = !!vivo;
        let xPos = esVivo ? (video.logoDer ? "main_w-overlay_w-200" : "200") : "main_w-overlay_w-200";

        const urlFinal = corregirUrl(video.url);
        console.log(`\n🕒 [${new Date().toLocaleTimeString()}] TRANSMITIENDO: ${video.title}`);

        const args = [
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
            '-fflags', '+genpts+igndts+discardcorrupt', 
            '-re', '-i', urlFinal, 
            '-i', 'logo.png',
            '-filter_complex', 
            `[0:v]fps=24,scale=1920:1080:flags=lanczos,setsar=1[bg];` +
            `[1:v]scale=250:250[logo];` +
            `[bg][logo]overlay=${xPos}:90,format=yuv420p[v];` +
            `[0:a]aresample=async=1:min_comp=0.01[a]`,
            '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
            '-b:v', '2000k', '-maxrate', '2500k', '-bufsize', '4000k', 
            '-g', '48', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
            '-f', 'flv', RTMP_DESTINO
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let ultimoUpdate = Date.now();
        
        ffmpeg.stderr.on('data', (data) => {
            if (data.toString().includes("frame=")) ultimoUpdate = Date.now();
        });

        const watchdog = setInterval(() => {
            const chequeo = obtenerVivo();
            
            // CAMBIO DE GOLPE: 
            // Si estamos en playlist y toca VIVO -> MATAR
            // Si estamos en VIVO y toca PLAYLIST (minuto 58) -> MATAR
            if ((!esVivo && chequeo) || (esVivo && (!chequeo || chequeo.title !== video.title))) {
                console.log("🔄 INTERRUPCIÓN HORARIA: Cambiando señal ahora mismo...");
                ffmpeg.kill('SIGKILL');
            }

            if (Date.now() - ultimoUpdate > 15000) {
                console.log("⚠️ Señal perdida, reintentando...");
                ffmpeg.kill('SIGKILL');
            }
        }, 1000); // Chequeo cada segundo para no perder la marca de las :00 o :58

        await new Promise((resolve) => {
            ffmpeg.on("close", () => {
                clearInterval(watchdog);
                if (!esVivo) indiceActual = (indiceActual + 1) % playlist.length;
                resolve();
            });
        });

        await new Promise(r => setTimeout(r, 500)); 
    }
}

motorCanalC();
app.listen(port, () => console.log(`Sistema listo en puerto ${port}`));
