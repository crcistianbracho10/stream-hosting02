const { spawn } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";

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
    return dia >= 1 && dia <= 5 && (
        (horaVE >= 6 && horaVE < 8) ||
        (horaVE >= 13 && horaVE < 15)
    );
}

function esHorarioTVES() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24;
    const minutoVE = ahora.getUTCMinutes();
    return (horaVE >= 23) || (horaVE < 3) || (horaVE === 3 && minutoVE <= 30);
}

function esSeisAM() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24;
    const minutoVE = ahora.getUTCMinutes();
    return horaVE === 6 && minutoVE === 0;
}

const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

async function iniciarMotor() {
    console.log("🚀 Iniciando Transmisión Canal C Optimizada...");
    let ultimoVideo = null;

    while (true) {
        const usarCanal11 = esHorarioCanal11();
        const usarTVES = esHorarioTVES();
        const moverLogoDerecha = esSeisAM();

        let playlist = [];

        if (!usarCanal11 && !usarTVES) {
            playlist = await obtenerPlaylist();
            if (!playlist.length) {
                console.log("⚠️ Playlist vacía, esperando 10 segundos...");
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }
        }

        if (usarCanal11) {
            await transmitirEspecial(
                "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8",
                "Cortesía Canal 11 del Zulia",
                true
            );
            continue;
        }

        if (usarTVES) {
            await transmitirEspecial(
                "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8",
                "Cortesía TVES",
                true
            );
            continue;
        }

        for (let i = 0; i < playlist.length; i++) {
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

            let xLogo = moverLogoDerecha ? "W-w-180" : 180;
            let yLogo = 70;

            let filtro = "[0:v]scale=1280:720,setsar=1[base];";
            filtro += "[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];";
            filtro += `[base][logo_sc]overlay=${xLogo}:${yLogo}[outv];`;
            filtro += "[outv]format=yuv420p[outv_final]";

            const ffmpegArgs = [
                '-re',
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '2',
                '-i', videoURL,
                '-i', 'logo.png',
                '-filter_complex', filtro,
                '-map', '[outv_final]',
                '-map', '0:a?',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-tune', 'zerolatency',
                '-threads', '2',
                '-b:v', '1000k',
                '-maxrate', '1000k',
                '-bufsize', '15000k',   // buffer moderado
                '-pix_fmt', 'yuv420p',
                '-g', '90',             // GOP intermedio
                '-r', '30',
                '-c:a', 'aac',
                '-b:a', '96k',
                '-ar', '44100',
                '-s', '1280x720',
                '-f', 'flv', RTMP_DESTINO
            ];

            if (duracion > 0) {
                ffmpegArgs.push("-t", String(duracion));
            }

            await lanzarFFmpeg(ffmpegArgs, item.title);
            ultimoVideo = videoURL;
        }
    }
}

async function transmitirEspecial(url, textoOverlay, logoDerecha) {
    console.log(`🎥 Transmisión especial activa: ${textoOverlay}`);

    let xLogo = logoDerecha ? "W-w-180" : 180;
    let yLogo = 70;

    let filtro = "[0:v]scale=1280:720,setsar=1[base];";
    filtro += "[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];";
    filtro += `[base][logo_sc]overlay=${xLogo}:${yLogo}[outv];`;
    filtro += `[outv]drawtext=text='${textoOverlay}':`;
    filtro += "fontcolor=white:fontsize=32:borderw=2:shadowcolor=black:shadowx=2:shadowy=2:";
    filtro += "x=W-tw-40:y=H-th-40[outv2];";
    filtro += "[outv2]format=yuv420p[outv_final]";

    const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        '-i', url,
        '-i', 'logo.png',
        '-filter_complex', filtro,
        '-map', '[outv_final]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-threads', '2',
        '-b:v', '1000k',
        '-maxrate', '1000k',
        '-bufsize', '15000k',
        '-pix_fmt', 'yuv420p',
        '-g', '90',
        '-r', '30',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-ar', '44100',
        '-s', '1280x720',
        '-f', 'flv', RTMP_DESTINO
    ];

    await lanzarFFmpeg(ffmpegArgs, textoOverlay);
}

async function lanzarFFmpeg(ffmpegArgs, titulo) {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.stderr.on("data", data => {
            const msg = data.toString();
            console
