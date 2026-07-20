# 1. Usar una base oficial de Node.js
FROM node:18-slim

# 2. Instalar FFmpeg y dependencias del sistema
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 3. Crear el directorio de la aplicación
WORKDIR /app

# 4. Copiar los archivos de dependencias
COPY package*.json ./

# 5. Instalar los módulos de Node.js
RUN npm install

# 6. Copiar el resto del código y tu logo Canal_C.png
COPY . .

# 7. Exponer el puerto que usará Render
EXPOSE 7860

# 8. Comando para arrancar el servidor
CMD ["node", "server.js"]
