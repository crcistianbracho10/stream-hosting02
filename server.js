const { spawn, exec } = require('child_process');
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

const PLAYLIST_URL = "https://gist.githubusercontent.com/crcistianbracho10/6e4a07d268460ea807abf28f77c3880e/raw";
const RTMP_DESTINO = "rtmp://live.restream.io/live/re_8275433_event74378d151bdc489d857a4212c6a591cd";

// Función para logs con hora
function log(msg) {
    console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

// Descargar playlist
async function obtenerPlaylist() {
    try {
        const respuesta = await axios.get(PLAYLIST_URL, { headers: { "Cache-Control": "no-cache" } });
        log("📥 Playlist actualizada desde Gist");
        return respuesta.data;
    } catch (error) {
        log("❌ Error cargando playlist: " + error.message);
        return [];
    }
}

// Horarios especiales
function horaVE() { return (new Date().getUTCHours() - 4 + 24) % 24; }
function diaVE() { return new Date().getUTCDay(); }
function esHorarioCanal11() { return diaVE() >= 1 && diaVE() <= 5 && horaVE() >= 6 && horaVE() < 8; }
function esHorarioCanal11Tarde() { return diaVE() >= 1 && diaVE() <= 5 && horaVE() >= 13 && horaVE() < 15; }
function esHorarioTVES() { return (horaVE() >= 23 || horaVE() < 4); }
function esSeisAM() { return horaVE() === 6 && new Date().getUTCMinutes() === 0; }

async function iniciarMotor() {
    log("🚀 Iniciando transmisión Canal C Full HD...");

    // Descargar logo
    await new Promise(resolve => {
        exec('curl -L -o logo.png "https://www.dropbox.com/scl/fi/snh8onwq9gx6zlum089j6/logo.png?rlkey=o5f2vp3q0hyaa513ucmq3sd6w&st=d3zoo3t8&dl=1"', resolve);
    });

    let ultimoVideo = null;

    while (true) {
        const playlist = await obtenerPlaylist();
        if (!playlist.length) {
            log("⚠️ Playlist vacía, esperando 10 segundos...");
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        for (const item of playlist) {
            let videoURL = item.url;
            const duracion = item.duration || 0;

            if (!videoURL) {
                log("⚠️ Item inválido, saltando...");
                continue;
            }

            // Horarios especiales
            if (esHorarioCanal11() || esHorarioCanal11Tarde()) {
                log("📺 Horario Canal 11 activo");
                videoURL = "https://tv.streamcasthd.com:3676/live/canal11delzulialive.m3u8";
            } else if (esHorarioTVES()) {
                log("📺 Horario TVES activo");
                videoURL = "https://vs20.live.opencaster.com/tves_5fd18b1e/index.m3u8";
            }

            if (videoURL === ultimoVideo) {
                log("⏭️ Video repetido, pasando...");
                continue;
            }

            log(`🎥 Transmitiendo: ${item.title}`);

            let xLogo = 180, yLogo = 70;
            if (esHorarioCanal11() || esHorarioCanal11Tarde() || esHorarioTVES() || esSeisAM()) {
                xLogo = "W-w-180";
            }

            let filtro = "[0:v]scale=1920:1080,setsar=1[base];" +
                         "[1:v]scale=260:260:flags=lanczos,setsar=1[logo];" +
                         `[base][logo]overlay=${xLogo}:${yLogo}[outv];`;

            if (esHorarioCanal11() || esHorarioCanal11Tarde()) {
                filtro += "[outv]drawtext=text='Cortesía Canal 11 del Zulia':" +
                          "fontcolor=white:fontsize=32:borderw=2:shadowcolor=black:shadowx=2:shadowy=2:" +
                          "x=W-tw-40:y=H-th-40[outv2];[outv2]format=yuv420p[outv_final]";
            } else {
                filtro += "[outv]format=yuv420p[outv_final]";
            }

            const ffmpegArgs = [
                '-re', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
                '-i', videoURL,
                '-i', 'logo.png',
                '-filter_complex', filtro,
                '-map', '[outv_final]',
                '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
                '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
                '-pix_fmt', 'yuv420p', '-g', '60',
                '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
                '-s', '1280x720',
                '-f', 'flv', RTMP_DESTINO
            ];

            if (duracion > 0) ffmpegArgs.push("-t", String(duracion));

            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            ffmpeg.stderr.on("data", data => {
                const msg = data.toString();
                if (/Error|Invalid|failed/i.test(msg)) {
                    log("❌ FFmpeg error, saltando...");
                    ffmpeg.kill("SIGKILL");
                }
            });

            await new Promise(resolve => ffmpeg.on('close', resolve));
            ultimoVideo = videoURL;
            log("➡️ Video terminado, siguiente...");
        }
    }
}

iniciarMotor();

app.get('/', (req, res) => res.send('✅ Transmisión Canal C Activa 24/7 en Full HD'));
app.listen(port, () => log(`Servidor Express escuchando en puerto ${port}`));
