const { spawn } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 📥 Playlist desde tu gist
const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";

// 📡 RTMP destino (pegado exacto como pediste)
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

// 🎬 Intro y stream de Canal 11
const VIDEO_INTRO_CANAL11 = "https://archive.org/download/graficos-canal-11-del-zulia-2022-vigente-la-tele-vzla-720p-h-264-online-video-cutter.com-1/Graficos%20canal%2011%20del%20zulia%202022%20vigente%20-%20LA%20Tele%20vzla%20%28720p%2C%20h264%29%20%28online-video-cutter.com%29%20%281%29.mp4";
const STREAM_CANAL11 = "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8";

// ✅ Logo directo desde Wikipedia
const LOGO_URL = "https://upload.wikimedia.org/wikipedia/commons/4/43/Canal_C_del_Zulia.png";

let motorActivo = false;

async function obtenerPlaylist() {
    try {
        const respuesta = await axios.get(PLAYLIST_URL, { headers: { "Cache-Control": "no-cache" } });
        console.log("📥 Playlist actualizada desde Gist");
        return respuesta.data;
    } catch (error) {
        console.error("❌ Error cargando playlist desde Gist:", error);
        return [];
    }
}

// 🕒 Horario especial Canal 11: lunes a viernes, 6–8am y 1–3pm VE
function esHorarioCanal11() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24; // UTC-4 Caracas
    const minutoVE = ahora.getUTCMinutes();
    const dia = ahora.getUTCDay();
    const esDiaSemana = dia >= 1 && dia <= 5;
    const enHorarioManana = horaVE >= 6 && horaVE < 8;
    const enHorarioTarde = horaVE >= 13 && horaVE < 15;
    return { activo: esDiaSemana && (enHorarioManana || enHorarioTarde), horaVE, minutoVE };
}

async function transmitir(videoURL, duracion = 0, usarLogo = true, esArchivo = false, moverLogoDerecha = false, textoCortesia = false) {
    let xLogo = moverLogoDerecha ? "W-w-180" : 180;
    let yLogo = 70;

    let filtro = "[0:v]scale=1920:1080,setsar=1[base];";
    if (usarLogo) {
        filtro += `[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];`;
        filtro += `[base][logo_sc]overlay=${xLogo}:${yLogo}[tmp];`;
    } else {
        filtro += "[base]copy[tmp];";
    }

    if (textoCortesia) {
        filtro += `[tmp]drawtext=text='Cortesía Canal 11 del Zulia':x=W-tw-20:y=H-th-20:fontsize=32:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2[outv];`;
    } else {
        filtro += "[tmp]copy[outv];";
    }

    filtro += "[outv]format=yuv420p[outv_final]";

    const ffmpegArgs = [];
    if (esArchivo) ffmpegArgs.push('-re'); // ✅ solo para archivos

    ffmpegArgs.push('-i', videoURL);
    if (usarLogo) ffmpegArgs.push('-i', LOGO_URL);

    ffmpegArgs.push(
    '-filter_complex', filtro,
    '-map', '[outv_final]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'faster',       
    '-tune', 'zerolatency',    
    '-b:v', '2500k',         
    '-maxrate', '2500k',
    '-bufsize', '4000k',       
    '-g', '60',              
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',         
    '-ac', '2',
    '-s', '1280x720'
);

    if (duracion > 0) ffmpegArgs.push("-t", String(duracion));
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
    if (motorActivo) return;
    motorActivo = true;
    console.log("🚀 Iniciando Transmisión Canal C Full HD...");

    let ultimoVideo = null;

    while (motorActivo) {
        const { activo: usarCanal11, horaVE, minutoVE } = esHorarioCanal11();

        if (usarCanal11) {
            if ((horaVE === 6 && minutoVE === 0) || (horaVE === 13 && minutoVE === 0)) {
                console.log("🎬 Intro Canal 11...");
                await transmitir(VIDEO_INTRO_CANAL11, 0, false, true);
            }
            console.log("📺 Transmitiendo Canal 11...");
            await transmitir(STREAM_CANAL11, 0, true, false, true, true);

            const ahora = new Date();
            const horaActual = (ahora.getUTCHours() - 4 + 24) % 24;
            if ((horaActual >= 8 && horaActual < 13) || horaActual >= 15) {
                console.log("⏹️ Fin del bloque Canal 11, regresando a playlist");
                continue;
            }
        }

        const playlist = await obtenerPlaylist();
        if (!playlist.length) {
            console.log("⚠️ Playlist vacía, esperando...");
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        for (const item of playlist) {
            if (!motorActivo) break;
            let videoURL = item.url;
            const duracion = item.duration || 0;
            if (!videoURL) continue;
            if (videoURL === ultimoVideo) continue;

            console.log(`🎥 Transmitiendo: ${item.title}`);
            await transmitir(videoURL, duracion, true, true, false, false);

            ultimoVideo = videoURL;
            console.log("➡️ Video terminado, siguiente...");
        }
        ultimoVideo = null;
    }
}

// 🚀 Arranca el motor automáticamente
iniciarMotor();

// 🌐 Endpoints Express
app.get('/', (req, res) => res.send('Transmisión Canal C Activa 24/7 en Full HD'));

// 📡 Servidor web
app.listen(port, () => {
    console.log(`Servidor Express escuchando en puerto ${port}`);
});
