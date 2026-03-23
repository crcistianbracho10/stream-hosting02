FROM node:18-slim

# Instalamos FFmpeg y curl para tu streaming y el logo
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos dependencias
COPY package*.json ./
RUN npm install

# Copiamos tu server.js y logos
COPY . .

# El puerto 3001 que configuraste
EXPOSE 3001

CMD ["node", "server.js"]
