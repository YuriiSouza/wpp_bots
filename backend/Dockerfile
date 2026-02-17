FROM node:20

WORKDIR /app

# Dependências
COPY package*.json ./
RUN npm install

# Código
COPY . .

# Porta do Nest
EXPOSE 3000

# Prisma precisa gerar client
RUN npx prisma generate

RUN npm run build
CMD ["node", "dist/main.js"]