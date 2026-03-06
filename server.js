const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3001;

const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";
const RTMP_DESTINO = "rtmp://rtmp.livepeer.com/live/2b9f-9c8t-kr9k-f5f4";

let ffmpegProceso = null;
let advertenciaProceso = null;
let indiceActual = 0;

async function prepararAssets() {
    console.log("📥 Descargando recursos...");
    await new Promise(resolve => exec('curl -L -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&dl=1"', resolve));
    await new Promise(resolve => exec('curl -L -o advertencia.png "https://www.dropbox.com/scl/fi/x9xpsosc6mlmn5rw8e2at/Copilot_20260224_002036.png?rlkey=340kgc42pa64ytajhzv0vl53b&st=d6pk9m66&dl=1"', resolve));
}

function iniciarAdvertencia() {
    if (advertenciaProceso) return;
    console.log("⚠️ FALLO DETECTADO: Imagen de advertencia activa.");
    const args = [
        '-loop', '1', '-i', 'advertencia.png',
        '-c:v', 'libx264', '-t', '5', 
        '-pix_fmt', 'yuv420p', '-s', '1920x1080', '-f', 'flv', RTMP_DESTINO
    ];
    advertenciaProceso = spawn('ffmpeg', args);
    advertenciaProceso.on("close", () => { advertenciaProceso = null; });
}

function obtenerContenidoEspecial() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24;
    const minVE = ahora.getUTCMinutes();
    const dia = ahora.getUTCDay();

    // TeleSUR (Logo debe ir a la IZQUIERDA)
    if (horaVE === 8 || (horaVE >= 18 && (horaVE < 20 || (horaVE === 20 && minVE < 30)))) {
        return { url: "https://mblesmain01.telesur.ultrabase.net/mbliveMain/hd/chunklist.m3u8", title: "TeleSUR Vivo", vivo: true, logoDerecha: false };
    }
    // Canal 11 (Logo debe ir a la DERECHA)
    if (dia >= 1 && dia <= 5 && ((horaVE >= 6 && horaVE < 8) || (horaVE >= 13 && horaVE < 15))) {
        return { url: "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8", title: "Canal 11 Zulia", vivo: true, logoDerecha: true };
    }
    // TVES (Logo debe ir a la DERECHA)
    if (horaVE >= 23 || horaVE < 4) {
        return { url: "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8", title: "TVES En Vivo", vivo: true, logoDerecha: true };
    }
    return null;
}

async function iniciarMotor() {
    await prepararAssets();
    
    while (true) {
        let videoActual = null;
        const especial = obtenerContenidoEspecial();

        if (especial) {
            videoActual = especial;
        } else {
            const playlist = await obtenerPlaylist();
            if (playlist.length > 0) {
                if (indiceActual >= playlist.length) indiceActual = 0;
                videoActual = playlist[indiceActual];
                videoActual.logoDerecha = false; // Playlist normal a la izquierda
                indiceActual++;
            }
        }

        if (!videoActual || !videoActual.url) {
            iniciarAdvertencia();
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        console.log(`\n--- [TRANSMITIENDO] ${videoActual.title} ---`);
        
        // Definir posición X del logo
        // W-w-180 lo manda a la derecha (Ancho Video - Ancho Logo - Margen)
        const xPos = videoActual.logoDerecha ? "W-w-180" : "180";

        const inputArgs = videoActual.vivo ? [
            '-fflags', 'nobuffer+igndts+genpts+discardcorrupt',
            '-flags', 'low_delay',
            '-reconnect', '1', '-reconnect_at_eof', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
            '-i', videoActual.url
        ] : [
            '-re', '-i', videoActual.url
        ];

        const args = [
            ...inputArgs,
            '-i', 'logo.png',
            '-filter_complex', `[0:v]scale=1920:1080,setsar=1[base];[1:v]scale=260:260[logo];[base][logo]overlay=${xPos}:70,format=yuv420p[v]`,
            '-map', '[v]', '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
            '-b:v', '3500k', '-maxrate', '3500k', '-bufsize', '7000k',
            '-g', '50', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
            '-f', 'flv', RTMP_DESTINO
        ];

        if (videoActual.duration > 0 && !especial) args.push("-t", String(videoActual.duration));

        ffmpegProceso = spawn('ffmpeg', args, { stdio: 'inherit' });

        await new Promise((resolve) => {
            ffmpegProceso.on("close", (code) => {
                if (code !== 0 && code !== null) {
                    console.log(`❌ Error en stream. Reintentando...`);
                    iniciarAdvertencia();
                    setTimeout(resolve, 4000);
                } else {
                    resolve();
                }
                ffmpegProceso = null;
            });
        });

        await new Promise(r => setTimeout(r, 1000));
    }
}

async function obtenerPlaylist() {
    try {
        const res = await axios.get(PLAYLIST_URL, { timeout: 5000 });
        return Array.isArray(res.data) ? res.data : [];
    } catch (e) { return []; }
}

iniciarMotor();
app.listen(port);
