const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// URL RAW DE TU PLAYLIST EN GIST
const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/3d2e8c83d060ac1c7dc890c1ed56c35c/raw/playlist.json";

// FUNCIÓN PARA DESCARGAR LA PLAYLIST SIEMPRE ACTUALIZADA
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

// HORARIO ESPECIAL: Lunes a Viernes, 6am a 8am (Hora Venezuela)
function esHorarioCanal11() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24; // Ajuste UTC-4
    const dia = ahora.getUTCDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
    return dia >= 1 && dia <= 5 && horaVE >= 6 && horaVE < 8;
}

// SOLO 6:00 AM exacto (Venezuela)
function esSeisAM() {
    const ahora = new Date();
    const horaVE = (ahora.getUTCHours() - 4 + 24) % 24; // Ajuste UTC-4
    const minutoVE = ahora.getUTCMinutes();
    return horaVE === 6 && minutoVE === 0;
}

const RTMP_DESTINO = "rtmp://vs20.live.opencaster.com/opencaster/cristianhilos_314b91b0?psk=cristianhilos_314b91b0&tk=b77f89cbf4f83af5295e37a562a3379de814c3a945e7402811a589c00d91f442";

async function iniciarMotor() {
    console.log("🚀 Iniciando Transmisión Canal C Full HD...");

    // DESCARGAR LOGO
    console.log("Descargando logo...");
    await new Promise((resolve) => {
        exec('curl -L -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&st=d3zoo3t8&dl=1"', resolve);
    });

    let ultimoVideo = null;

    while (true) {
        const playlist = await obtenerPlaylist();

        if (!playlist.length) {
            console.log("⚠️ Playlist vacía, esperando 10 segundos...");
            await new Promise(r => setTimeout(r, 10000));
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

            const usarCanal11 = esHorarioCanal11();
            const moverLogoDerecha = esSeisAM();

            // Caso especial Canal 11
            if (usarCanal11) {
                console.log("📺 Horario Canal 11 del Zulia activo (6am–8am VE)");
                videoURL = "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8";
            }

            // Evitar repetir consecutivamente
            if (!usarCanal11 && videoURL === ultimoVideo) {
                console.log("⏭️ Ya se transmitió este video, pasando al siguiente...");
                continue;
            }

            console.log(`🎥 Preparando transmisión: ${item.title}`);

            // POSICIÓN DEL LOGO
            let xLogo = 180; // más aire respecto al borde izquierdo
            let yLogo = 70;  // más aire respecto al borde superior

            if (usarCanal11) {
                xLogo = "W-w-180"; // mover al lado derecho en Canal 11
            } else if (moverLogoDerecha) {
                xLogo = "W-w-180"; // mover a la derecha a las 6am
            }

            // Filtro FFmpeg
            let filtro = "";
            filtro += "[0:v]scale=1920:1080,setsar=1[base];";
            filtro += "[1:v]scale=260:260:flags=lanczos,setsar=1[logo_sc];";
            filtro += `[base][logo_sc]overlay=${xLogo}:${yLogo}[outv]`;

            if (usarCanal11) {
                filtro += ";[outv]drawtext=text='Cortesía Canal 11 del Zulia':";
                filtro += "fontcolor=white:fontsize=32:borderw=2:shadowcolor=black:shadowx=2:shadowy=2:";
                filtro += "x=W-tw-40:y=H-th-40[outv2]"; // esquina inferior derecha
                filtro += ";[outv2]format=yuv420p[outv_final]";
            } else {
                filtro += ";[outv]format=yuv420p[outv_final]";
            }

            const ffmpegArgs = [
    '-re', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', videoURL,
    '-i', 'logo.png',
    '-filter_complex', filtro,
    '-map', '[outv_final]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',   // antes "fast" → menos CPU, más compresión
    '-tune', 'zerolatency',
    '-b:v', '2500k',         // antes 4000k → baja bitrate de video
    '-maxrate', '2500k',     // límite máximo de bitrate
    '-bufsize', '5000k',     // buffer proporcional
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '96k',           // antes 128k → audio más ligero
    '-ar', '44100',          // antes 48000 → frecuencia más baja
    '-s', '1280x720',        // antes 1920x1080 → baja resolución a HD estándar
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
                    console.log("❌ FFmpeg no pudo abrir este video, saltando al siguiente...");
                    ffmpeg.kill("SIGKILL");
                }
            });

            await new Promise((resolve) => ffmpeg.on('close', resolve));

            // Marcar último reproducido al cerrar
            ultimoVideo = videoURL;

            console.log("➡️ Video terminado, pasando al siguiente...");
        }
    }
}

iniciarMotor();

app.get('/', (req, res) => res.send('Transmisión Canal C Activa 24/7 en Full HD'));
app.listen(port);
