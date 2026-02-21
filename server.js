const { spawn } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 📥 Playlist desde tu gist
const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";

// 📡 RTMP destino
const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

// 🎬 Intro y stream de Canal 11
const VIDEO_INTRO_CANAL11 = "https://archive.org/download/graficos-canal-11-del-zulia-2022-vigente-la-tele-vzla-720p-h-264-online-video-cutter.com-1/Graficos%20canal%2011%20del%20zulia%202022%20vigente%20-%20LA%20Tele%20vzla%20%28720p%2C%20h264%29%20%28online-video-cutter.com%29%20%281%29.mp4";
const STREAM_CANAL11 = "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8";

// 📺 Stream de TVES
const STREAM_TVES = "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8";

// ✅ Logo local en la misma carpeta
const LOGO_URL = "logo.png";

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

// 🕒 Horario especial TVES: todos los días, 11pm–3:30am VE
function esHorarioTVES() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24; // UTC-4 Caracas
    const minutoVE = ahora.getUTCMinutes();
    const enHorarioNoche = (horaVE >= 23 || horaVE < 3 || (horaVE === 3 && minutoVE <= 30));
    return { activo: enHorarioNoche, horaVE, minutoVE };
}

async function transmitir(videoURL, duracion = 0, usarLogo = true, esArchivo = false, usarCanal = false, moverLogoDerecha = false, textoExtra = "") {
    // POSICIÓN DEL LOGO
    let xLogo = 180; // más aire respecto al borde izquierdo
    let yLogo = 70;  // más aire respecto al borde superior

    if (usarCanal) {
        xLogo = "W-w-180"; // mover al lado derecho en Canal especial
    } else if (moverLogoDerecha) {
        xLogo = "W-w-180"; // mover a la derecha en horarios especiales
    }

    // Filtro FFmpeg con logo más pequeño
    let filtro = "";
    filtro += "[0:v]scale=1920:1080,setsar=1[base];";
    filtro += "[1:v]scale=160:160:flags=lanczos,setsar=1[logo_sc];"; // logo más pequeño
    filtro += `[base][logo_sc]overlay=${xLogo}:${yLogo}[outv]`;

    if (textoExtra) {
        filtro += `;[outv]drawtext=text='${textoExtra}':x=W-tw-20:y=H-th-20:fontsize=32:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2[outv2];[outv2]format=yuv420p[outv_final]`;
    } else {
        filtro += ";[outv]format=yuv420p[outv_final]";
    }

    const ffmpegArgs = [];
    if (esArchivo) ffmpegArgs.push('-re'); // lectura en tiempo real para archivos

    ffmpegArgs.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', videoURL
    );
    if (usarLogo) ffmpegArgs.push('-i', LOGO_URL);

    ffmpegArgs.push(
        '-filter_complex', filtro,
        '-map', '[outv_final]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'superfast',   // más rápido que veryfast
        '-tune', 'zerolatency',
        '-b:v', '2500k',
        '-maxrate', '2500k',
        '-bufsize', '5000k',      // buffer más grande
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-ar', '44100',
        '-ac', '2',
        '-s', '1280x720',
        '-f', 'flv', RTMP_DESTINO
    );

    if (duracion > 0) ffmpegArgs.push("-t", String(duracion));

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
    await new Promise(r => setTimeout(r, 2000));
}

async function iniciarMotor() {
    if (motorActivo) return;
    motorActivo = true;
    console.log("🚀 Iniciando Transmisión Canal C Full HD...");

    let ultimoVideo = null;

    while (motorActivo) {
        const { activo: usarCanal11, horaVE, minutoVE } = esHorarioCanal11();
        const { activo: usarTVES } = esHorarioTVES();

        if (usarCanal11) {
            if ((horaVE === 6 && minutoVE === 0) || (horaVE === 13 && minutoVE === 0)) {
                console.log("🎬 Intro Canal 11...");
                await transmitir(VIDEO_INTRO_CANAL11, 0, false, true);
            }
            console.log("📺 Transmitiendo Canal 11...");
            await transmitir(STREAM_CANAL11, 0, true, false, true, true, "Cortesía Canal 11 del Zulia");
            continue;
        }

        if (usarTVES) {
            console.log("📺 Transmitiendo TVES (11pm–3:30am VE)...");
            await transmitir(STREAM_TVES, 0, true, false, true, true, "Cortesía TVES");
            continue;
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

//
