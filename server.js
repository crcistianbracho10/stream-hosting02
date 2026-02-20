const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

let ffmpegProcess = null; // referencia al proceso activo

async function obtenerPlaylist() {
    try {
        const respuesta = await axios.get(PLAYLIST_URL, {
            headers: { "Cache-Control": "no-cache" }
        });
        console.log("📥 Playlist actualizada desde Gist");
        return respuesta.data;
    } catch (error) {
        console.error("❌ Error cargando playlist desde Gist:", error);
        return [];
    }
}

function esHorarioCanal11() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24;
    const dia = ahora.getUTCDay();
    return dia >= 1 && dia <= 5 && horaVE >= 6 && horaVE < 8;
}

function esSeisAM() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24;
    const minutoVE = ahora.getUTCMinutes();
    return horaVE === 6 && minutoVE === 0;
}

async function iniciarMotor() {
    if (ffmpegProcess) {
        console.log("⚠️ Ya hay una transmisión en curso.");
        return;
    }

    console.log("🚀 Iniciando Transmisión Canal C Full HD...");

    console.log("Descargando logo...");
    await new Promise((resolve) => {
        exec('curl -L -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&st=d3zoo3t8&dl=1"', resolve);
    });

    const playlist = await obtenerPlaylist();
    if (!playlist.length) {
        console.log("⚠️ Playlist vacía, no se puede iniciar transmisión.");
        return;
    }

    // Tomamos el primer video de la playlist como ejemplo
    const item = playlist[0];
    let videoURL = item.url;

    let filtro = "[0:v]scale=1920:1080,setsar=1[base];";
    filtro += "[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];";
    filtro += `[base][logo_sc]overlay=180:70[outv];[outv]format=yuv420p[outv_final]`;

    const ffmpegArgs = [
        '-re', '-i', videoURL,
        '-i', 'logo.png',
        '-filter_complex', filtro,
        '-map', '[outv_final]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '2500k',
        '-maxrate', '2500k',
        '-bufsize', '5000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        '-s', '1280x720',
        '-f', 'flv',
        RTMP_DESTINO
    ];

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on("data", data => {
        console.log("FFmpeg:", data.toString());
    });

    ffmpegProcess.on('close', () => {
        console.log("❌ FFmpeg se cerró.");
        ffmpegProcess = null;
    });
}

// Detener transmisión
function detenerMotor() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
        console.log("🛑 Transmisión detenida.");
    } else {
        console.log("⚠️ No hay transmisión activa.");
    }
}

// Rutas web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/start', (req, res) => {
    iniciarMotor();
    res.send('🚀 Transmisión iniciada');
});

app.get('/stop', (req, res) => {
    detenerMotor();
    res.send('🛑 Transmisión detenida');
});

app.listen(port, () => {
    console.log(`Servidor web en http://localhost:${port}`);
});
