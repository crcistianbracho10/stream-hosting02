const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

const VIDEO_INTRO_CANAL11 = "https://archive.org/download/graficos-canal-11-del-zulia-2022-vigente-la-tele-vzla-720p-h-264-online-video-cutter.com-1/Graficos%20canal%2011%20del%20zulia%202022%20vigente%20-%20LA%20Tele%20vzla%20%28720p%2C%20h264%29%20%28online-video-cutter.com%29%20%281%29.mp4";
const STREAM_CANAL11 = "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8";

let motorActivo = false;

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

// Horario especial Canal 11: lunes a viernes, 6–8am y 1–3pm VE
function esHorarioCanal11() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24; // UTC-4 Caracas
    const minutoVE = ahora.getUTCMinutes();
    const dia = ahora.getUTCDay(); // 0=Domingo, 1=Lunes, ..., 6=Sábado

    const esDiaSemana = dia >= 1 && dia <= 5;
    const enHorarioManana = horaVE >= 6 && horaVE < 8;
    const enHorarioTarde = horaVE >= 13 && horaVE < 15;

    return { activo: esDiaSemana && (enHorarioManana || enHorarioTarde), horaVE, minutoVE };
}

async function transmitir(videoURL, duracion = 0, usarLogo = true) {
    let filtro = "[0:v]scale=1920:1080,setsar=1[base];";
    if (usarLogo) {
        filtro += "[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];";
        filtro += `[base][logo_sc]overlay=180:70[outv];`;
    } else {
        filtro += "[base]copy[outv];";
    }
    filtro += "[outv]format=yuv420p[outv_final]";

    const ffmpegArgs = [
        '-re', '-i', videoURL,
        ...(usarLogo ? ['-i', 'logo.png'] : []),
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
        '-s', '1280x720'
    ];

    if (duracion > 0) {
        ffmpegArgs.push("-t", String(duracion));
    }

    ffmpegArgs.push('-f', 'flv', RTMP_DESTINO);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on("data", data => {
        const msg = data.toString();
        console.log("FFmpeg:", msg);

        if (msg.includes("Error") || msg.includes("Invalid") || msg.includes("failed")) {
            console.log("❌ FFmpeg no pudo abrir este video, saltando...");
            ffmpeg.kill("SIGKILL");
        }
    });

    await new Promise(resolve => ffmpeg.on('close', resolve));
}

async function iniciarMotor() {
    if (motorActivo) {
        console.log("⚠️ Motor ya está activo");
        return;
    }
    motorActivo = true;
    console.log("🚀 Iniciando Transmisión Canal C Full HD...");

    console.log("Descargando logo...");
    await new Promise((resolve) => {
        exec('curl -L -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&st=d3zoo3t8&dl=1"', resolve);
    });

    let ultimoVideo = null;

    while (motorActivo) {
        const { activo: usarCanal11, horaVE, minutoVE } = esHorarioCanal11();

        if (usarCanal11) {
            // Intro solo a las 6:00 y 13:00 exacto
            if ((horaVE === 6 && minutoVE === 0) || (horaVE === 13 && minutoVE === 0)) {
                console.log("🎬 Lanzando intro Canal 11...");
                await transmitir(VIDEO_INTRO_CANAL11, 0, false);
            }
            console.log("📺 Transmitiendo Canal 11 del Zulia (lunes a viernes, 6–8am y 1–3pm VE)");
            await transmitir(STREAM_CANAL11, 0, true);
            continue; // ✅ Playlist pausada durante Canal 11
        }

        // Si no es horario Canal 11, corre la playlist en bucle
        const playlist = await obtenerPlaylist();

        if (!playlist.length) {
            console.log("⚠️ Playlist vacía, esperando 10 segundos...");
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        for (let i = 0; i < playlist.length; i++) {
            if (!motorActivo) break;

            const item = playlist[i];
            let videoURL = item.url;
            const duracion = item.duration ? item.duration : 0;

            if (!videoURL) {
                console.log("⚠️ Item inválido en playlist, saltando...");
                continue;
            }

            if (videoURL === ultimoVideo) {
                console.log("⏭️ Ya se transmitió este video, pasando al siguiente...");
                continue;
            }

            console.log(`🎥 Preparando transmisión: ${item.title}`);
            await transmitir(videoURL, duracion, true);

            ultimoVideo = videoURL;
            console.log("➡️ Video terminado, pasando al siguiente...");
        }

        // 🔄 Playlist terminada, reiniciando desde el inicio
        ultimoVideo = null;
    }
    console.log("🛑 Motor detenido");
}

// 🚀 Arranca el motor automáticamente
iniciarMotor();

// 🌐 Endpoints Express
app.get('/', (req, res) => res.send('Transmisión Canal C Activa 24/7 en Full HD'));

// 📡 Servidor web
app.listen(port, () => {
    console.log(`Servidor Express escuchando en puerto ${port}`);
});
