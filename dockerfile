# Usa Node 18 como base
FROM node:18

# Instala ffmpeg y fuentes para drawtext
RUN apt-get update && \
    apt-get install -y ffmpeg curl fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Crea directorio de la app
WORKDIR /usr/src/app

# Copia package.json y package-lock.json
COPY package*.json ./

# Instala dependencias de Node
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto para Express
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]
